"""
A dataset's conversions: its images converted with dji-thermal-cli's process, several side by side to compare
settings. The settings a user can choose are checked here, kept with the conversion and as the user's saved defaults
(in the plugin's user data store, beside their display preferences); the conversion runs in WebODM's worker.

Each conversion is a folder of the dataset's (see datasets), with records changed under the dataset's lock:

    thermal/conversions/<id>/conversion.json   its name, settings, who made it and when
    thermal/conversions/<id>/job.json          the conversion's status, progress, stage, error and run id
    thermal/conversions/<id>/results.json      what was written for each image (see compact)
    thermal/conversions/<id>/output/           the files written, mirroring the images' folders
    thermal/conversions/<id>/mosaics/ ...      its mosaics, when built (see mosaics)

Settings are kept as JSON: dji-thermal-cli's Settings fields (None keeps each image's own embedded value), plus the
outputs, the compression, normalization, the nadir-only pitch limit and whether to build the mosaics after the
images. DJI's own SDK measures them when one is
installed (sdk.current()).
"""

import math
import os
import shutil
import time
import uuid

from . import converter, datasets
from .analysis import PROGRESS_INTERVAL, Canceled, clean, relative

CONVERSIONS_DIR = 'conversions'
RECORD_FILE = 'conversion.json'
JOB_FILE = 'job.json'
RESULTS_FILE = 'results.json'
OUTPUT_DIR = 'output'
PREFERENCES_KEY = 'conversion_settings'
DISPLAY_KEY = 'display'

UNITS = ('C', 'F', 'K')
COMPRESSIONS = ('deflate', 'none')

# dji-thermal-cli's own defaults (Settings(), process()), what "Reset to defaults" goes back to
DEFAULTS = {
    'distance': 'lrf',
    'humidity': None,
    'emissivity': None,
    'reflected_temp': None,
    'ambient_temp': None,
    'unit': 'C',
    'range_min': None,
    'range_max': None,
    'palette': None,
    'gimbal_yaw': None,
    'gimbal_pitch': None,
    'gimbal_roll': None,
    'replace_above': None,
    'replace_above_value': None,
    'replace_below': None,
    'replace_below_value': None,
    'strip_location': False,
    'normalize': False,
    'max_pitch': None,
    'outputs': ['temp_c:tiff', 'pseudo:png'],
    'compression': 'deflate',
    'mosaics': True,        # the plugin's own: build the mosaics after the images
}

# (low, high) of the numbers; the camera's own limits are narrower and are checked per image when converting
LIMITS = {
    'distance': (0.1, 1000.0),
    'humidity': (0.0, 100.0),
    'emissivity': (0.1, 1.0),
    'gimbal_yaw': (-360.0, 360.0),
    'gimbal_pitch': (-180.0, 180.0),
    'gimbal_roll': (-180.0, 180.0),
    'max_pitch': (-90.0, 90.0),
}
# In the chosen unit: checked by dji-thermal-cli's Settings (above absolute zero, ranges in order)
TEMPERATURES = ('reflected_temp', 'ambient_temp', 'range_min', 'range_max', 'replace_above', 'replace_below')
SETTINGS_FIELDS = ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp', 'unit', 'range_min',
                   'range_max', 'palette', 'gimbal_yaw', 'gimbal_pitch', 'gimbal_roll', 'replace_above',
                   'replace_above_value', 'replace_below', 'replace_below_value', 'strip_location')


# dji-thermal-cli's products in words, for the pages; the coloured ones (pseudo, rjpeg) are drawn in the palette
PRODUCT_NAMES = {'temp_c': '°C', 'temp_f': '°F', 'temp_k': 'K', 'temp_ck': 'centi-kelvin', 'temp_dc': 'tenth-°C',
                 'raw': 'raw counts', 'gray16': '16-bit grey', 'pseudo': 'colour', 'rjpeg': 'R-JPEG'}
COLOURED = ('pseudo', 'rjpeg')


def products():
    """The outputs dji-thermal-cli can write: [{product, name, description, formats}]"""
    return [{'product': name, 'name': PRODUCT_NAMES.get(name, name), 'description': p.description,
             'formats': list(p.formats)}
            for name, p in converter.library().outputs.PRODUCTS.items()]


def output_text(output, palette=None):
    """An output ('temp_c:tiff', or a product alone) in words: '°C TIFF', 'colour PNG in ironred'"""
    product, _, fmt = output.partition(':')
    text = PRODUCT_NAMES.get(product, product)
    if product != 'rjpeg':
        text += ' ' + (fmt.upper() if fmt else 'images')
    return text + (' in ' + palette if palette and product in COLOURED else '')


def palettes():
    return list(converter.library().PALETTES)


def blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def number(value):
    """A finite float, or raises TypeError or ValueError"""
    if isinstance(value, bool):
        raise TypeError()
    n = float(value)
    if not math.isfinite(n):
        raise ValueError()
    return n


def parse_settings(raw):
    """
    :param raw: the settings as sent ({field: value}, missing fields take the defaults; "" keeps the embedded value)
    :return: (settings, errors): the settings checked and complete (as DEFAULTS), and {field: message} for the ones
        that are not valid (empty when all are)
    """
    raw = raw if isinstance(raw, dict) else {}
    out, errors = dict(DEFAULTS), {}

    def get(field):
        return raw.get(field, DEFAULTS[field])

    distance = get('distance')
    if distance in ('lrf', 'embedded'):
        out['distance'] = distance
    elif blank(distance):
        out['distance'] = 'lrf'
    else:
        try:
            out['distance'] = number(distance)
        except (TypeError, ValueError):
            errors['distance'] = "The distance is the rangefinder's, the embedded one, or a number of metres"

    unit = str(get('unit') or 'C').upper()
    if unit in UNITS:
        out['unit'] = unit
    else:
        errors['unit'] = "The unit is C, F or K"

    for field in ('humidity', 'emissivity', 'gimbal_yaw', 'gimbal_pitch', 'gimbal_roll', 'max_pitch') + TEMPERATURES:
        value = get(field)
        if blank(value):
            out[field] = None
            continue
        try:
            out[field] = number(value)
        except (TypeError, ValueError):
            errors[field] = "Not a number"

    for field, (low, high) in LIMITS.items():
        value = out.get(field)
        if isinstance(value, float) and field not in errors and not (low <= value <= high):
            errors[field] = "Between {:g} and {:g}".format(low, high)

    for side in ('above', 'below'):
        field = 'replace_{}_value'.format(side)
        value = get(field)
        if blank(value):
            out[field] = None
        elif isinstance(value, str) and value.strip().lower() == 'nodata':
            out[field] = 'nodata'
        else:
            try:
                out[field] = number(value)
            except (TypeError, ValueError):
                errors[field] = "A temperature, or no data"

    palette = get('palette')
    if blank(palette):
        out['palette'] = None
    elif palette in palettes():
        out['palette'] = palette
    else:
        errors['palette'] = "Not one of dji-thermal-cli's palettes"

    out['strip_location'] = bool(get('strip_location'))
    out['normalize'] = bool(get('normalize'))
    out['mosaics'] = bool(get('mosaics'))

    compression = get('compression')
    if compression in COMPRESSIONS:
        out['compression'] = compression
    else:
        errors['compression'] = "deflate or none"

    wanted = get('outputs')
    allowed = {p['product']: p['formats'] for p in products()}
    if not isinstance(wanted, (list, tuple)) or not wanted:
        errors['outputs'] = "Choose at least one output"
    else:
        chosen = []
        for spec in wanted:
            product, _, fmt = str(spec).partition(':')
            fmt = {'tif': 'tiff', 'jpeg': 'jpg'}.get(fmt, fmt)
            if product not in allowed or (fmt and fmt not in allowed[product]):
                errors['outputs'] = "{} is not an output dji-thermal-cli writes".format(spec)
                break
            spec = '{}:{}'.format(product, fmt or allowed[product][0])
            if spec not in chosen:
                chosen.append(spec)
        out['outputs'] = chosen

    if not errors:
        # What dji-thermal-cli itself checks: a range given whole and in order, replacements with their value,
        # temperatures above absolute zero
        dtc = converter.library()
        try:
            dtc.Settings(**{f: out[f] for f in SETTINGS_FIELDS})
        except dtc.SettingsError as e:
            errors['settings'] = str(e)
    return out, errors


def summary_text(s):
    """A short description of a conversion's settings, for the list"""
    parts = [', '.join(output_text(o, s.get('palette')) for o in s.get('outputs') or [])]
    if s.get('normalize'):
        parts.append('normalized')
    if s.get('max_pitch') is not None:
        parts.append('pitch ≤ {:g}°'.format(s['max_pitch']))
    changed = [f for f in ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp')
               if s.get(f) != DEFAULTS[f]]
    if changed:
        parts.append('measurement: ' + ', '.join(f.replace('_', ' ') for f in changed))
    if s.get('mosaics'):
        parts.append('mosaics')
    return ' · '.join(p for p in parts if p)


def api_arguments(s):
    """
    The keyword arguments of dji-thermal-cli's process for these settings (checked by parse_settings), measured
    with the SDK in use.
    :raises sdk.SdkError: the SDK set at deployment is missing
    """
    from . import sdk
    dtc = converter.library()
    return {
        'settings': dtc.Settings(sdk=sdk.current(), **{f: s[f] for f in SETTINGS_FIELDS}),
        'outputs': tuple(s['outputs']),
        'compression': s['compression'],
        'normalize': bool(s['normalize']),
        'max_pitch': s['max_pitch'],
    }


def compact(report, root, out_dir, version=""):
    """What a conversion keeps of dji-thermal-cli's process report: {files, converted, skipped, normalization,
    version}"""
    files = []
    offsets = report.normalization.offsets_c if report.normalization is not None else {}
    for r in report.results:
        files.append({
            'path': relative(r.src, root),
            'ok': bool(r.ok),
            'reason': r.reason or "",
            'outputs': [relative(p, out_dir) for p in (r.outputs or [])],
            'notes': list(r.notes or []),
            'distance': r.distance,
            'distance_source': r.distance_source or "",
            # What normalizing subtracted from the frame (°C)
            'offset_c': offsets.get(r.src),
        })
    files.sort(key=lambda f: f['path'])
    norm = None
    if report.normalization is not None:
        n = report.normalization
        values = list(n.offsets_c.values())
        norm = {'ambient_c': n.ambient_c, 'reflected_c': n.reflected_c, 'frames': n.frames,
                'without_offset': n.without_offset,
                'offset_min': min(values) if values else None, 'offset_max': max(values) if values else None}
    converted = sum(1 for f in files if f['ok'])
    return clean({'files': files, 'converted': converted, 'skipped': len(files) - converted,
                  'normalization': norm, 'version': version})


def mosaic_stage(event, **extra):
    """A dji-thermal-cli "mosaic" event (normalizing compares the frames as a mosaic does) as the pages show it: the
    stage, its step of steps (round of rounds while aligning), done of total in its unit; with extra"""
    keys = ('stage', 'step', 'steps', 'round', 'rounds', 'done', 'total', 'unit')
    return dict({k: event.data[k] for k in keys if k in event.data}, **extra)


def stage_key(event):
    """What changes when a new stage (or an alignment round, or its solve) starts: its first event is written at once"""
    return event.data['stage'], event.data.get('round'), event.data['unit']


# The records

def rel(cid, *parts):
    """A conversion's path within the dataset's folder"""
    return os.path.join(CONVERSIONS_DIR, cid, *parts)


def path(task, cid, *parts):
    return datasets.data_path(task, rel(cid, *parts))


def output_path(task, cid):
    return path(task, cid, OUTPUT_DIR)


def valid_id(cid):
    return isinstance(cid, str) and len(cid) == 12 and all(c in '0123456789abcdef' for c in cid)


def ids(task):
    """The dataset's conversions, oldest first"""
    found = []
    try:
        names = os.listdir(datasets.data_path(task, CONVERSIONS_DIR))
    except OSError:
        return []
    for cid in names:
        record = datasets.read_json(path(task, cid, RECORD_FILE)) if valid_id(cid) else {}
        if record:
            found.append((record.get('created_at') or '', cid))
    return [cid for _, cid in sorted(found)]


def record(task, cid):
    """A conversion's record ({name, settings, created_by, created_at}), or {} when there is none"""
    return datasets.read_json(path(task, cid, RECORD_FILE)) if valid_id(cid) else {}


def job(task, cid):
    return datasets.job(task, rel(cid, JOB_FILE))


def results(task, cid):
    return datasets.read_json(path(task, cid, RESULTS_FILE))


def files_size(task, cid):
    """A conversion's files: (the outputs and mosaics to download, the bytes of all it holds)"""
    from . import mosaics
    total = 0
    for dirpath, _, filenames in os.walk(path(task, cid)):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    return len(output_files(task, cid)) + len(mosaics.files(task, cid)), total


def output_files(task, cid):
    """The files a conversion wrote, as paths within its output folder, in order"""
    root = output_path(task, cid)
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                out.append(os.path.relpath(fp, root))
    return out


def create(task, name, settings, user):
    """A new conversion of the dataset, started in WebODM's worker: :return: its id"""
    cid = uuid.uuid4().hex[:12]
    with datasets.locked(task):
        os.makedirs(output_path(task, cid))
        datasets.write_json(path(task, cid, RECORD_FILE), {'name': name, 'settings': settings,
                                                            'created_by': user.username,
                                                            'created_at': datasets.now()})
        datasets.write_json(path(task, cid, JOB_FILE), {'status': 'converting'})
    datasets.start_job(task, 'conversions', 'convert', cid, rel=rel(cid, JOB_FILE), running='converting', stage={})
    return cid


def rename(task, cid, name):
    with datasets.locked(task):
        r = record(task, cid)
        if r:
            r['name'] = name
            datasets.write_json(path(task, cid, RECORD_FILE), r)


def delete(task, cid):
    """A conversion and its files: a running one finds its job file gone and stops"""
    with datasets.locked(task):
        state = job(task, cid)
        shutil.rmtree(path(task, cid), ignore_errors=True)
    if state['status'] == 'converting':
        datasets.revoke(state.get('celery_task_id'))
    datasets.update_size(task)


def cancel(task, cid):
    """A running conversion stops at its next progress write; what it wrote so far is kept, and counted. Once the
    images are converted, it is the mosaics being built that are canceled"""
    from . import mosaics
    if mosaics.cancel(task, cid):
        return
    try:
        with datasets.locked(task):
            state = job(task, cid)
            if state['status'] != 'converting':
                return
            datasets.write_json(path(task, cid, JOB_FILE), {'status': 'canceled', 'finished_at': datasets.now()})
    except datasets.Gone:
        return
    datasets.revoke(state.get('celery_task_id'))
    datasets.update_size(task)


def check_stale(task, cid):
    from . import mosaics
    mosaics.check_stale(task, cid)
    return datasets.check_stale(task, rel(cid, JOB_FILE), 'converting', 'conversion')


def left_behind(task, cid):
    """After a run that stopped: the files of a conversion deleted while it ran, or of a dataset deleted while it ran
    (the run's writes may have made their folders again), are removed"""
    from app.models import Task
    if not Task.objects.filter(pk=task.pk).exists():
        shutil.rmtree(task.task_path(), ignore_errors=True)
    elif not os.path.exists(path(task, cid, RECORD_FILE)):
        shutil.rmtree(path(task, cid), ignore_errors=True)
    else:
        datasets.update_size(task)


def convert(task_id, run_id, cid):
    """
    Converts a dataset's images (its task's id) with a conversion's settings, into the conversion's output folder,
    while its run is still run_id.
    :return: what the run did, for the job's result
    """
    from app.models import Task

    task = Task.objects.filter(pk=task_id).first()
    job_rel = rel(cid, JOB_FILE)
    if task is None or job(task, cid).get('run_id') != run_id:
        return {'canceled': True}
    root, out_dir = datasets.images_path(task), output_path(task, cid)
    job_file = path(task, cid, JOB_FILE)

    try:
        dtc = converter.library()
        if not datasets.image_files(task):
            raise RuntimeError("The dataset has no images")
        args = api_arguments(record(task, cid).get('settings') or DEFAULTS)
        # Each image is reported once when it is written. Normalizing first compares the frames' overlaps, stage by
        # stage: the page shows the stage while the progress is 0
        total = max(1, len(dtc.scan(root).jpegs))
        state = {'done': 0, 'written': time.time(), 'stage': None}

        def write(now, **fields):
            t = time.time()
            if now or t - state['written'] >= PROGRESS_INTERVAL:
                state['written'] = t
                if not datasets.update_job(task, if_run=run_id, rel=job_rel, **fields):
                    raise Canceled()

        def progress(event):
            if event.kind == 'mosaic':
                key = stage_key(event)
                write(key != state['stage'], stage=mosaic_stage(event))
                state['stage'] = key
            elif event.kind == 'file':
                # A conversion or dataset deleted stops at once, before it writes more files where they were
                if not os.path.exists(job_file):
                    raise Canceled()
                state['done'] += 1
                write(state['stage'] is not None, progress=min(0.99, state['done'] / total), stage={})
                state['stage'] = None

        # jobs=1: a Celery worker's processes cannot start processes of their own
        report = dtc.process(root, out_dir, jobs=1, progress=progress, **args)
        result = compact(report, root, out_dir, dtc.__version__)
    except Canceled:
        left_behind(task, cid)
        return {'canceled': True}
    except Exception as e:  # noqa: BLE001 - shown on the conversion
        datasets.update_job(task, if_run=run_id, rel=job_rel, status='failed', error=str(e) or type(e).__name__,
                            progress=0, stage={}, run_id='', finished_at=datasets.now())
        left_behind(task, cid)
        return {'error': str(e)}

    ok = bool(result['converted'])
    if not datasets.finish_job(task, run_id, result, rel=job_rel, result_rel=rel(cid, RESULTS_FILE),
                               status='ready' if ok else 'failed', stage={},
                               error='' if ok else "No image could be converted: see each image's reason"):
        left_behind(task, cid)
        return {'canceled': True}
    datasets.update_size(task)
    if ok and (record(task, cid).get('settings') or {}).get('mosaics'):
        from . import mosaics
        mosaics.start(task, cid)
    return {'converted': result['converted']}


# The user's defaults

def preferences_store(user):
    from app.plugins.data_store import UserDataStore
    return UserDataStore(converter.PLUGIN_NAME, user)


def preferences(user):
    """A user's saved conversion settings (None when none are saved), completed and checked as when converting"""
    saved = preferences_store(user).get_json(PREFERENCES_KEY, None)
    if not isinstance(saved, dict):
        return None
    settings, errors = parse_settings(saved)
    # Saved settings a newer dji-thermal-cli no longer accepts fall back to the defaults, field by field
    for field in errors:
        if field in settings:
            settings[field] = DEFAULTS[field]
    return settings


def save_preferences(user, settings):
    preferences_store(user).set_json(PREFERENCES_KEY, settings)


def forget_preferences(user):
    preferences_store(user).del_key(PREFERENCES_KEY)


# The user's display preferences: the palette temperatures are drawn in throughout the UI and on WebODM's map (None:
# each picture's own where the frames hold one, else WebODM's default), one of DJI's or of WebODM's colour maps. The
# unit is WebODM's own (its unit_system, kept in the browser); a unit saved here before it was is handed to the page
# once ('unit') to become WebODM's, then dropped by the page saving the preferences again.

COLORMAPS = ('inferno', 'magma', 'plasma', 'viridis', 'hot', 'jet', 'rainbow', 'gray', 'gray_r')   # WebODM's


def display_palettes():
    return palettes() + list(COLORMAPS)


def display(user):
    """{'unit': a unit saved before (C, F or K) or None, 'palette': one of display_palettes() or None}"""
    saved = preferences_store(user).get_json(DISPLAY_KEY, None)
    saved = saved if isinstance(saved, dict) else {}
    return {'unit': saved.get('unit') if saved.get('unit') in UNITS else None,
            'palette': saved.get('palette') if saved.get('palette') in display_palettes() else None}


def parse_display(raw):
    """Display preferences from the API (blank: None) and {field: message} for what is not valid"""
    raw = raw if isinstance(raw, dict) else {}
    out, errors = {}, {}
    palette = raw.get('palette')
    out['palette'] = None if blank(palette) else palette
    if out['palette'] is not None and out['palette'] not in display_palettes():
        errors['palette'] = "Not one of DJI's palettes or WebODM's colour maps"
    return out, errors


def save_display(user, value):
    preferences_store(user).set_json(DISPLAY_KEY, value)
