"""
Converts DJI radiometric R-JPEGs into temperature images ODM processes as thermal: a single-band float32 TIFF
in degrees Celsius, with the R-JPEG's EXIF and XMP metadata (GPS, capture time, camera and gimbal orientation),
the XMP band name ODM reads and the measurement parameters used. The temperatures come from dji-thermal-cli, a
pure-Python port of DJI's Thermal SDK, or from DJI's own SDK where an administrator gave one (see sdk), with each
camera's recorded measurement parameters unless the upload changes them.

Nothing here raises on a bad file: a file that is not a thermal R-JPEG, or does not convert, is reported and
left as it is, so one problem image never stops the rest of an upload.
"""

import functools
import logging
import math
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager

from PIL import Image

from . import portable

logger = logging.getLogger('app.logger')

PLUGIN_NAME = 'dji-thermal'

JPEG_EXTENSIONS = ('.jpg', '.jpeg')

# The measurement parameters an upload can change, as dji-thermal-cli's Settings fields. Temperatures are in the
# upload's unit; humidity is a percent.
MEASUREMENT_FIELDS = ('emissivity', 'reflected_temp', 'ambient_temp', 'humidity')
DISTANCES = ('lrf', 'embedded')
UNITS = ('C', 'F', 'K')

# The library's measurement parameter names (in a Measurement's .params, and describe()) to the Settings fields
PARAM_FIELDS = {'distance': 'distance', 'humidity': 'humidity', 'emissivity': 'emissivity',
                'reflection': 'reflected_temp', 'ambient_temp': 'ambient_temp'}


def site_packages_path():
    """Where WebODM installs the plugin's requirements.txt"""
    from app.plugins.functions import get_plugins_persistent_path
    return get_plugins_persistent_path(PLUGIN_NAME, 'site-packages')


def remove_stale_metadata(path, requirements):
    """
    Removes the metadata (name-version.dist-info) of the versions requirements.txt no longer pins from site-packages
    at path, where the pinned version is installed. WebODM installs a plugin's requirements with pip's --target,
    which replaces a package's code on an upgrade but leaves the old version's metadata beside the new one; packages
    read their version from it (dji-thermal-cli's __version__, written in the converted images), and would name the
    old one. Returns the folders removed.
    """
    def canonical(name):
        return re.sub(r'[-_.]+', '-', name).lower()

    pinned = {}
    with open(requirements) as f:
        for line in f:
            m = re.match(r'\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^\s;#]+)', line)
            if m:
                pinned[canonical(m.group(1))] = m.group(2)
    found = {}
    for entry in os.listdir(path) if os.path.isdir(path) else []:
        m = re.match(r'(.+)-([^-]+)\.dist-info$', entry)
        if m and canonical(m.group(1)) in pinned:
            found.setdefault(canonical(m.group(1)), []).append((m.group(2), entry))
    removed = []
    for name, entries in found.items():
        if not any(version == pinned[name] for version, _entry in entries):
            continue        # the pinned version isn't installed (yet): left as it is
        for version, entry in entries:
            if version != pinned[name]:
                shutil.rmtree(os.path.join(path, entry), ignore_errors=True)
                removed.append(entry)
    return removed


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


@functools.lru_cache(maxsize=1)
def palette_luts():
    """DJI's palettes by name (as the library's PALETTES), each a uint8 (256, 3) RGB table, without a frame"""
    return library().palette_luts()


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
    ('C', 'F' or 'K', of the temperatures) and the MEASUREMENT_FIELDS. A field left out, None or '' keeps each photo's
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
        raise ValueError("unit must be C, F or K, not {!r}".format(values.get('unit')))
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


def palette_picture(path, palette):
    """
    An R-JPEG's temperatures drawn in one of DJI's palettes, with its colours as the file holds them, over the frame's
    own range (as DJI's preview is stretched): a PIL RGB image of the thermal resolution
    :raises: the library's errors, for a file it cannot measure; ValueError, a palette the file does not hold
    """
    import numpy as np
    dtc = library()
    with open(path, 'rb') as f:
        lut = dtc.tsdk.open(f.read()).get_pseudo_color_lut()        # (3, palettes, 256)
    index = dtc.PALETTES.index(palette)
    if index >= lut.shape[1]:
        raise ValueError("the file does not hold the palette {}".format(palette))
    t = measure(path).temperature
    finite = t[np.isfinite(t)]
    lo, hi = (float(finite.min()), float(finite.max())) if finite.size else (0.0, 1.0)
    levels = np.clip((np.nan_to_num(t, nan=lo) - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(lut[:, index, :].T.astype(np.uint8)[levels], 'RGB')


def describe(path):
    """
    What the upload form needs to know of an R-JPEG's camera: {'camera': its model, 'recorded': the measurement
    parameters it recorded, 'ranges': [lowest, highest] each parameter can be set to, 'palette': the DJI palette it
    was shot in, or ''}, with the Settings names and
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
            'ranges': {PARAM_FIELDS[key]: list(ranges[key]) for key in used},
            'palette': (info['thermal'].get('palette') or {}).get('name') or ''}


def convert(source_path, dest_path, measurement_settings=None):
    """
    Writes the temperature TIFF of the R-JPEG source_path to dest_path, measured with measurement_settings (see
    measure); source_path is left as it is. dest_path appears only once it is complete, with its metadata.
    dji-thermal-cli writes it (process, its temp_c TIFF): the R-JPEG's EXIF kept as it is (GPS, camera, maker
    notes), its XMP with Camera:BandName = LWIR added (ODM treats the image as thermal from it, opendm/photo.py)
    and the measurement recorded (namespace dtc). Uncompressed, the simplest TIFF for every reader.
    :return: '' if converted, or why not (the file is not a DJI thermal image, or failed to convert)
    """
    if not is_thermal_rjpeg(source_path):
        return "not a DJI thermal image"

    # Written in a folder beside dest_path, then moved into place
    work = tempfile.mkdtemp(prefix='.dji-thermal-', dir=os.path.dirname(os.path.abspath(dest_path)))
    try:
        report = library().process(source_path, work, measurement_settings or settings(),
                                   outputs=('temp_c:tiff',), compression='none', jobs=1)
        result = report.results[0] if report.results else None
        if result is None or not result.ok or not result.outputs:
            raise RuntimeError(result.reason if result else "not converted")
        portable.replace(str(result.outputs[0]), dest_path)
    except Exception as e:  # noqa: BLE001 - one bad file must never stop an upload
        logger.warning("DJI thermal conversion failed for {}: {}".format(source_path, str(e)))
        return str(e) or type(e).__name__
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return ''
