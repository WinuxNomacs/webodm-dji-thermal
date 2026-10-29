"""
Converts DJI radiometric R-JPEGs into temperature images ODM processes as thermal: a single-band float32 TIFF
in degrees Celsius, with the R-JPEG's EXIF and XMP metadata (GPS, capture time, camera and gimbal orientation),
the XMP band name ODM reads and the measurement parameters used. The temperatures come from dji-thermal-cli, a
pure-Python port of DJI's Thermal SDK, or from DJI's own SDK where an administrator gave one (see sdk), with each
camera's recorded measurement parameters unless the upload changes them.

Nothing here raises on a bad file: a file that is not a thermal R-JPEG, or does not convert, is reported and
left as it is, so one problem image never stops the rest of an upload.
"""

import logging
import math
import os
import shutil
import subprocess
import sys
from contextlib import contextmanager

from PIL import Image

logger = logging.getLogger('app.logger')

PLUGIN_NAME = 'dji-thermal'

# ODM decides that an image is thermal from its XMP tag Camera:BandName being "LWIR" (opendm/photo.py)
THERMAL_BAND_NAME = 'LWIR'

# exiftool does not know the XMP "Camera" namespace and cannot write a tag it does not define: this config
# file defines it
EXIFTOOL_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exiftool_camera.config')
EXIFTOOL_TIMEOUT = 60

JPEG_EXTENSIONS = ('.jpg', '.jpeg')

# The measurement parameters an upload can change, as dji-thermal-cli's Settings fields. Temperatures are in the
# upload's unit; humidity is a percent.
MEASUREMENT_FIELDS = ('emissivity', 'reflected_temp', 'ambient_temp', 'humidity')
DISTANCES = ('lrf', 'embedded')
UNITS = ('C', 'F')

# The library's measurement parameter names (in a Measurement's .params, and describe()) to the Settings fields
PARAM_FIELDS = {'distance': 'distance', 'humidity': 'humidity', 'emissivity': 'emissivity',
                'reflection': 'reflected_temp', 'ambient_temp': 'ambient_temp'}

# The XMP tags (namespace dtc, see exiftool_camera.config) for the parameters a temperature image was measured
# with, as dji-thermal-cli's own outputs name them
MEASUREMENT_TAGS = {'distance': 'Distance', 'humidity': 'Humidity', 'emissivity': 'Emissivity',
                    'reflection': 'ReflectedTemperatureC', 'ambient_temp': 'AmbientTemperatureC'}


def site_packages_path():
    """Where WebODM installs the plugin's requirements.txt"""
    from app.plugins.functions import get_plugins_persistent_path
    return get_plugins_persistent_path(PLUGIN_NAME, 'site-packages')


@contextmanager
def _plugin_packages():
    # As PluginBase.python_imports(), which needs the plugin's instance: this module also runs in the worker
    path = site_packages_path()
    sys.path.insert(0, path)
    try:
        yield
    finally:
        sys.path.remove(path)


def library():
    """dji-thermal-cli, from the plugin's site-packages"""
    with _plugin_packages():
        import dji_thermal_cli
    return dji_thermal_cli


def decoder_status():
    """
    Whether dji-thermal-cli, which computes the temperatures, can be used here.
    :return: (ok, message)
    """
    try:
        dtc = library()
    except Exception as e:  # noqa: BLE001 - whatever stops the library loading is reported
        return False, "dji-thermal-cli cannot be loaded ({}): DJI thermal images cannot be converted".format(str(e))
    return True, "Temperatures are computed with dji-thermal-cli {}".format(dtc.__version__)


def is_thermal_rjpeg(path):
    """
    :return: True if path is a DJI thermal R-JPEG dji-thermal-cli can measure, judged by the file's content (the
        RGB photos DJI's thermal drones take beside them, and any other JPEG or file, are not)
    """
    if os.path.splitext(path)[1].lower() not in JPEG_EXTENSIONS:
        return False

    try:
        status = library().classify(path)
    except Exception as e:  # noqa: BLE001 - a file the library chokes on is not converted
        logger.warning("Cannot tell whether {} is a DJI thermal image: {}".format(path, str(e)))
        return False

    if status.kind not in ('thermal', 'not_thermal'):
        logger.info("{} is not converted: {}".format(path, status.reason))
    return status.kind == 'thermal'


def settings(values=None):
    """
    dji-thermal-cli's Settings from an upload's measurement values (a dict): 'distance' ('lrf', the laser
    rangefinder's distance where valid, else the recorded one; 'embedded', the recorded one; or metres), 'unit'
    ('C' or 'F', of the temperatures) and the MEASUREMENT_FIELDS. A field left out, None or '' keeps each photo's
    recorded value. Measured with the SDK in use (sdk.current()).
    :raises ValueError: a value that is not a number, or that the library refuses, naming the field; the SDK
        set at deployment is missing (sdk.SdkError)
    """
    from . import sdk
    values = values or {}

    def number(name):
        value = values.get(name)
        if value is None or value == '':
            return None
        try:
            n = float(value)
        except (TypeError, ValueError):
            n = float('nan')
        if not math.isfinite(n):
            raise ValueError("{} must be a number, not {!r}".format(name, value))
        return n

    unit = str(values.get('unit') or 'C').upper()
    if unit not in UNITS:
        raise ValueError("unit must be C or F, not {!r}".format(values.get('unit')))
    distance = values.get('distance')
    distance = 'lrf' if distance is None or distance == '' else distance
    if distance not in DISTANCES:
        distance = number('distance')
    return library().Settings(distance=distance, unit=unit, sdk=sdk.current(),
                              **{name: number(name) for name in MEASUREMENT_FIELDS})


def measure(path, measurement_settings=None):
    """
    An R-JPEG measured with dji-thermal-cli: its .temperature in degrees Celsius (a float32 array of shape
    (height, width)), the .params used (Celsius) and the .distance_source ('rangefinder', 'embedded' or 'option').
    :param measurement_settings: from settings(); by default each photo's rangefinder distance where valid and
        the other parameters the camera recorded
    :raises: the library's errors, for a file it cannot measure or a value outside the camera's range
    """
    return library().measure(path, measurement_settings or settings(), unit='C')


def describe(path):
    """
    What the upload form needs to know of an R-JPEG's camera: {'camera': its model, 'recorded': the measurement
    parameters it recorded, 'ranges': [lowest, highest] each parameter can be set to}, with the Settings names and
    in degrees Celsius. A parameter the camera does not use (the ambient temperature on the H20T and XT S) is in
    neither.
    :raises: the library's errors, for a file that is not a thermal R-JPEG it can measure; sdk.SdkError
    """
    from . import sdk
    info = library().describe(path, stats=False, sdk=sdk.current())
    recorded, ranges = info['thermal']['measurement_params'], info['thermal']['measurement_params_range']
    used = [key for key, limits in ranges.items() if limits and tuple(limits) != (0, 0)]
    return {'camera': info['camera']['model'],
            'recorded': {PARAM_FIELDS[key]: recorded[key] for key in used if recorded.get(key) is not None},
            'ranges': {PARAM_FIELDS[key]: list(ranges[key]) for key in used}}


def measurement_tags(measurement, native=False):
    """
    The XMP tags (name: value) recording how measurement was made, as dji-thermal-cli's own outputs do.
    :param native: measured with DJI's own SDK, not the built-in port
    """
    dtc = library()
    software = 'dji-thermal-cli {}'.format(dtc.__version__)
    if native:
        software += " with DJI's Thermal SDK {}".format(dtc.native.SDK_VERSION)
    tags = {'Software': software}
    for key, name in MEASUREMENT_TAGS.items():
        if measurement.params.get(key) is not None:
            tags[name] = '{:.4f}'.format(float(measurement.params[key])).rstrip('0').rstrip('.')
    tags['DistanceSource'] = measurement.distance_source
    return tags


def exiftool_command(source_path, dest_path, dtc_tags=None):
    """
    The exiftool command that gives the converted file (dest_path) the metadata of its R-JPEG (source_path),
    marks it as thermal and adds dtc_tags (name: value, see measurement_tags). Of DJI's XMP tags, exiftool copies
    those it can write, which include all ODM and OpenSfM read (position, altitudes, camera and gimbal angles, RTK
    accuracy); the rest (ImageSource, the rangefinder's) are left out.
    """
    return ([shutil.which('exiftool') or 'exiftool',
             '-config', EXIFTOOL_CONFIG_FILE,
             '-TagsFromFile', source_path, '-all:all>all:all',
             '-XMP-Camera:BandName={}'.format(THERMAL_BAND_NAME)]
            + ['-XMP-dtc:{}={}'.format(name, value) for name, value in (dtc_tags or {}).items()]
            + ['-overwrite_original', dest_path])


def copy_metadata(source_path, dest_path, dtc_tags=None):
    """
    Copies the metadata of source_path onto dest_path and marks it as thermal (see exiftool_command).
    :return: '' if it was all written, or why not
    """
    if not shutil.which('exiftool'):
        return "exiftool not found"

    try:
        result = subprocess.run(exiftool_command(source_path, dest_path, dtc_tags), check=False, capture_output=True,
                                text=True, timeout=EXIFTOOL_TIMEOUT)
    except Exception as e:  # noqa: BLE001 - reported as the metadata not written
        return "exiftool did not run: {}".format(str(e))

    # exiftool reports "1 image files updated" even when it could not write a tag: look at what it said
    output = (result.stdout or '') + (result.stderr or '')
    problems = [line for line in output.splitlines()
                if line.startswith('Error') or 'Sorry' in line or "Can't find table" in line
                or 'is not defined' in line]
    if result.returncode != 0 or problems:
        return "; ".join(problems) or "exiftool exit code {}".format(result.returncode)
    return ''


def convert(source_path, dest_path, measurement_settings=None):
    """
    Writes the temperature TIFF of the R-JPEG source_path to dest_path, measured with measurement_settings (see
    measure); source_path is left as it is. dest_path appears only once it is complete, with its metadata.
    :return: '' if converted, or why not (the file is not a DJI thermal image, or failed to convert)
    """
    if not is_thermal_rjpeg(source_path):
        return "not a DJI thermal image"

    part_path = dest_path + '.part'
    try:
        # A float32 array is one band of mode F (32-bit floating point) pixels
        measurement_settings = measurement_settings or settings()
        measurement = measure(source_path, measurement_settings)
        Image.fromarray(measurement.temperature).save(part_path, format='TIFF')
        problem = copy_metadata(source_path, part_path,
                                measurement_tags(measurement, native=measurement_settings.sdk is not None))
        if problem:
            raise RuntimeError("the metadata could not be written: {}".format(problem))
        os.replace(part_path, dest_path)
    except Exception as e:  # noqa: BLE001 - one bad file must never stop an upload
        logger.warning("DJI thermal conversion failed for {}: {}".format(source_path, str(e)))
        if os.path.exists(part_path):
            os.remove(part_path)
        return str(e) or type(e).__name__
    return ''
