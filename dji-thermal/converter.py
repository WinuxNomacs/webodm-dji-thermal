"""
Converts DJI radiometric R-JPEGs into temperature images ODM processes as thermal: a single-band float32 TIFF
in degrees Celsius, with the R-JPEG's EXIF and XMP metadata (GPS, capture time, camera and gimbal orientation)
and the XMP band name ODM reads. The temperatures come from dji-thermal-cli, a pure-Python port of DJI's
Thermal SDK, with each camera's own recorded measurement parameters.

Nothing here raises on a bad file: a file that is not a thermal R-JPEG, or does not convert, is reported and
left as it is, so one problem image never stops the rest of an upload.
"""

import logging
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


def measure(path):
    """
    The temperatures of an R-JPEG in degrees Celsius, as a float32 array of shape (height, width), decoded with
    the measurement parameters the camera recorded. That includes the distance: dji-thermal-cli would otherwise
    take the laser rangefinder's reading where there is one, which changes the temperatures from what the
    camera's own settings give.
    """
    dtc = library()
    return dtc.measure(path, dtc.Settings(unit='C', distance='embedded'), unit='C').temperature


def exiftool_command(source_path, dest_path):
    """
    The exiftool command that gives the converted file (dest_path) the metadata of its R-JPEG (source_path) and
    marks it as thermal. Of DJI's XMP tags, exiftool copies those it can write, which include all ODM and OpenSfM
    read (position, altitudes, camera and gimbal angles, RTK accuracy); the rest (ImageSource, the rangefinder's)
    are left out.
    """
    return [shutil.which('exiftool') or 'exiftool',
            '-config', EXIFTOOL_CONFIG_FILE,
            '-TagsFromFile', source_path, '-all:all>all:all',
            '-XMP-Camera:BandName={}'.format(THERMAL_BAND_NAME),
            '-overwrite_original', dest_path]


def copy_metadata(source_path, dest_path):
    """
    Copies the metadata of source_path onto dest_path and marks it as thermal (see exiftool_command).
    :return: '' if it was all written, or why not
    """
    if not shutil.which('exiftool'):
        return "exiftool not found"

    try:
        result = subprocess.run(exiftool_command(source_path, dest_path), check=False, capture_output=True,
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


def convert(source_path, dest_path):
    """
    Writes the temperature TIFF of the R-JPEG source_path to dest_path; source_path is left as it is. dest_path
    appears only once it is complete, with its metadata.
    :return: '' if converted, or why not (the file is not a DJI thermal image, or failed to convert)
    """
    if not is_thermal_rjpeg(source_path):
        return "not a DJI thermal image"

    part_path = dest_path + '.part'
    try:
        # A float32 array is one band of mode F (32-bit floating point) pixels
        Image.fromarray(measure(source_path)).save(part_path, format='TIFF')
        problem = copy_metadata(source_path, part_path)
        if problem:
            raise RuntimeError("the metadata could not be written: {}".format(problem))
        os.replace(part_path, dest_path)
    except Exception as e:  # noqa: BLE001 - one bad file must never stop an upload
        logger.warning("DJI thermal conversion failed for {}: {}".format(source_path, str(e)))
        if os.path.exists(part_path):
            os.remove(part_path)
        return str(e) or type(e).__name__
    return ''
