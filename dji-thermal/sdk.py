"""
DJI's own Thermal SDK in place of dji-thermal-cli's built-in port, where an administrator gives one: the folder
set at deployment in DJI_THERMAL_SDK_DIR (it wins), else the one uploaded on the plugin's page, kept in the
plugin's persistent folder. dji-thermal-cli loads DJI's library only in a child process of its own, so a crash
there fails a photo, never WebODM.

An upload is DJI's zip as downloaded. Only what the plugin needs is kept: the libraries for this system, DJI's
License.txt and one sample image per camera, to check the SDK with. It is checked in a staging folder before it
replaces the SDK in place.
"""

import datetime
import json
import os
import platform
import shutil
import tempfile
import zipfile

from . import portable

ENV = 'DJI_THERMAL_SDK_DIR'
INFO_FILE = 'dji-thermal-sdk.json'      # beside an installed SDK: its version, and where it came from
LICENSE_FILE = 'License.txt'
SAMPLES_DIR = 'samples'
LIB_PREFIX = 'tsdk-core/lib/'
DATASET_PREFIX = 'dataset/'
MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
STAGING_PREFIX = '.staging-'
OLD_PREFIX = '.old-'
# The processors DJI's libraries are built for (x64 and x86): none for ARM, which an Apple Silicon Mac's Docker runs
# WebODM on
SDK_MACHINES = ('x86_64', 'amd64', 'x86', 'i386', 'i686')


class SdkError(ValueError):
    """DJI's SDK cannot be installed or used, with the reason"""


def deploy_dir():
    """The folder set at deployment, or None"""
    return os.environ.get(ENV, '').strip() or None


def uploaded_dir():
    from app.plugins.functions import get_plugins_persistent_path
    from .converter import PLUGIN_NAME
    return get_plugins_persistent_path(PLUGIN_NAME, 'sdk')


def target_dir():
    """Where an upload goes: the folder set at deployment, else the plugin's persistent folder"""
    return deploy_dir() or uploaded_dir()


def _has_library(folder):
    from .converter import library
    try:
        library().native.find_library(folder)
    except (FileNotFoundError, OSError):
        return False
    return True


def current():
    """
    The SDK folder conversions use, or None for the built-in port.
    :raises SdkError: DJI_THERMAL_SDK_DIR is set to a folder without the SDK (photos then fail with this reason
        rather than being measured by another SDK than the one deployed)
    """
    deployed = deploy_dir()
    if deployed:
        if not _has_library(deployed):
            raise SdkError("{} is set to {}, which has no DJI Thermal SDK: upload one on the DJI Thermal page"
                           .format(ENV, deployed))
        return deployed
    uploaded = uploaded_dir()
    return uploaded if _has_library(uploaded) else None


def read_info(folder):
    try:
        with open(os.path.join(folder, INFO_FILE)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def samples(folder):
    """The sample images kept with an installed SDK"""
    d = os.path.join(folder, SAMPLES_DIR)
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, n) for n in os.listdir(d) if n.lower().endswith(('.jpg', '.jpeg')))


def unsupported_machine():
    """Why DJI's SDK can't run on this server's processor, or ''"""
    machine = platform.machine()
    if machine.lower() in SDK_MACHINES:
        return ''
    return ("DJI's Thermal SDK has no libraries for this server's processor ({}), only for x64 and x86: temperatures "
            "come from the built-in port, which gives the same results").format(machine or "unknown")


def status():
    """What the plugin's page shows: {'source': 'builtin', 'deployment' or 'upload', 'folder', 'info' (from the
    install: version, revisions, zip, when, by whom), 'problem', 'deploy_dir', 'writable', 'unsupported' (see
    unsupported_machine)}"""
    from .converter import library
    dtc = library()
    result = {'source': 'builtin', 'folder': None, 'info': {}, 'problem': '', 'deploy_dir': deploy_dir(),
              'library_version': dtc.__version__, 'port_sdk_version': dtc.native.SDK_VERSION}
    try:
        folder = current()
    except SdkError as e:
        result['problem'] = str(e)
        folder = None
    if folder:
        result.update(source='deployment' if deploy_dir() else 'upload', folder=folder, info=read_info(folder))
    target = target_dir()
    probe = target if os.path.isdir(target) else os.path.dirname(target)
    result['writable'] = os.access(probe, os.W_OK)
    result['unsupported'] = unsupported_machine()
    return result


def check(folder=None):
    """
    The SDK measuring its own samples (see dji-thermal-cli's check_sdk).
    :return: {'library', 'sdk_version', 'api_revisions', 'measured'}
    :raises SdkError: with the reason
    """
    from .converter import library
    dtc = library()
    folder = folder or current()
    if not folder:
        raise SdkError("No DJI Thermal SDK is installed: temperatures come from the built-in port")
    images = samples(folder)
    if not images:
        raise SdkError("{} has no sample images to check the SDK with: update it with DJI's zip".format(folder))
    try:
        return dtc.check_sdk(folder, images)
    except (dtc.SettingsError, dtc.NativeError, FileNotFoundError) as e:
        raise SdkError(str(e)) from None


def _platform_dirs():
    from .converter import library
    osname, arch = library().native.bindings.platform_dirs()
    return '{}/{}/'.format(osname, arch)


def _members(names):
    """
    The zip members to keep, as (name in the zip, path in the installed folder), from DJI's zip, which may have
    one folder around everything.
    :raises SdkError: not DJI's SDK, or no libraries for this system
    """
    if unsupported_machine():
        raise SdkError(unsupported_machine())
    lib_names = [n for n in names if LIB_PREFIX in n]
    if not lib_names:
        raise SdkError("This is not DJI's Thermal SDK: the zip has no {}".format(LIB_PREFIX))
    root = lib_names[0][:lib_names[0].index(LIB_PREFIX)]
    platform_prefix = root + LIB_PREFIX + _platform_dirs()
    keep = [(n, n[len(root):]) for n in names if n.startswith(platform_prefix) and not n.endswith('/')]
    if not keep:
        raise SdkError("The zip has no DJI Thermal SDK libraries for this server ({})".format(_platform_dirs()[:-1]))
    if root + LICENSE_FILE in names:
        keep.append((root + LICENSE_FILE, LICENSE_FILE))
    cameras = {}
    for n in sorted(names):
        parts = n[len(root):].split('/') if n.startswith(root + DATASET_PREFIX) else []
        if len(parts) == 3 and parts[2].lower().endswith(('.jpg', '.jpeg')) and parts[1] not in cameras:
            cameras[parts[1]] = n
    keep += [(n, '{}/{}.jpg'.format(SAMPLES_DIR, camera)) for camera, n in cameras.items()]
    return keep


def _extract(archive, keep, dest):
    size = 0
    for name, rel in keep:
        info = archive.getinfo(name)
        size += info.file_size
        if size > MAX_EXTRACTED_BYTES:
            raise SdkError("The zip's SDK files are larger than expected: not DJI's Thermal SDK")
        path = os.path.realpath(os.path.join(dest, rel))
        if os.path.commonpath([path, os.path.realpath(dest)]) != os.path.realpath(dest):
            raise SdkError("The zip has a file outside its folder: {}".format(name))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with archive.open(info) as src, open(path, 'wb') as out:
            shutil.copyfileobj(src, out, 1024 * 1024)


def install(zip_path, zip_name='', user=''):
    """
    Installs DJI's SDK from its zip in target_dir(), replacing the SDK there once the new one is checked.
    :return: the new SDK's info (as read_info)
    :raises SdkError: with the reason; the SDK in place is then left as it was
    """
    target = target_dir()
    try:
        os.makedirs(target, exist_ok=True)
        stage = tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=target)
    except OSError as e:
        raise SdkError("Cannot write to {}: {}".format(target, e.strerror or e)) from None
    try:
        try:
            with zipfile.ZipFile(zip_path) as archive:
                _extract(archive, _members(archive.namelist()), stage)
        except (zipfile.BadZipFile, OSError) as e:
            raise SdkError("Not a zip file DJI's Thermal SDK can be read from: {}".format(e)) from None
        found = check(stage)
        info = {'sdk_version': found['sdk_version'], 'api_revisions': found['api_revisions'],
                'checked_with': found['measured'], 'zip': os.path.basename(zip_name or zip_path),
                'installed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                'installed_by': user}
        with open(os.path.join(stage, INFO_FILE), 'w') as f:
            json.dump(info, f, indent=2)
        _replace(target, stage)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return info


def _replace(target, stage):
    """The SDK in target replaced by stage's files: the old ones moved aside first, then removed"""
    old = tempfile.mkdtemp(prefix=OLD_PREFIX, dir=target)
    try:
        for name in os.listdir(target):
            if not name.startswith((STAGING_PREFIX, OLD_PREFIX)):
                portable.replace(os.path.join(target, name), os.path.join(old, name))
        for name in os.listdir(stage):
            portable.replace(os.path.join(stage, name), os.path.join(target, name))
    finally:
        shutil.rmtree(old, ignore_errors=True)


def remove():
    """
    Removes the uploaded SDK: temperatures then come from the built-in port.
    :raises SdkError: the SDK in use was set at deployment (it is the deployment's to remove)
    """
    if deploy_dir():
        raise SdkError("The SDK is set at deployment ({}): it is removed by unsetting it there".format(ENV))
    shutil.rmtree(uploaded_dir(), ignore_errors=True)
