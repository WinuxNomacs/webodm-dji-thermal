"""
A dataset's conversions: its images converted with dji-thermal-cli's process, several side by side to compare
settings. The settings a user can choose are checked here, kept with the conversion and as the user's saved defaults
(in the plugin's user data store, beside their display preferences); the conversion runs in WebODM's worker.

Each conversion is a folder of the dataset's (see datasets), with records changed under the dataset's lock:

    thermal/conversions/<id>/conversion.json   its name, settings, who made it and when
    thermal/conversions/<id>/job.json          the conversion's status, progress, stage, error and run id
    thermal/conversions/<id>/results.json      what was written for each image (see compact), and the frames
                                               removed from it since (see remove_frames)
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
import statistics
import time
import uuid

from . import converter, datasets
from .analysis import PROGRESS_INTERVAL, Canceled, clean, relative

CONVERSIONS_DIR = 'conversions'
RECORD_FILE = 'conversion.json'
JOB_FILE = 'job.json'
RESULTS_FILE = 'results.json'
ALIGNMENT_FILE = 'alignment.json'   # harmonizing's alignment of the frames, which the mosaics are placed with
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
    'normalize': False,     # one ambient and reflected temperature for every frame: the flight's medians
    'harmonize': False,     # and each frame's drift against its overlapping neighbours removed (needs normalize)
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
COLOURED = ('pseudo', 'rjpeg')     # and conversions.js's COLOURED


def products():
    """The outputs dji-thermal-cli can write: [{product, description, formats}]"""
    return [{'product': name, 'description': p.description, 'formats': list(p.formats)}
            for name, p in converter.library().outputs.PRODUCTS.items()]


def frames_palette(settings):
    """The DJI palette a workset's frames are drawn in: the one it chose (for its coloured images, or DJI Thermal
    Task's map), else None"""
    palette = settings.get('palette')
    return palette if palette in palettes() else None


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
    out['harmonize'] = harmonized(raw)
    out['normalize'] = bool(get('normalize')) or out['harmonize']
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


def harmonized(s):
    """Whether the settings harmonize: those saved before harmonize existed did whenever they normalized"""
    return bool(s.get('harmonize', s.get('normalize')))


def summary_text(s):
    """A short description of a conversion's settings, for the list"""
    parts = [', '.join(output_text(o, s.get('palette')) for o in s.get('outputs') or [])]
    if harmonized(s):
        parts.append('harmonized')
    elif s.get('normalize'):
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


def api_arguments(s, medians=None):
    """
    The keyword arguments of dji-thermal-cli's process for these settings (checked by parse_settings), measured
    with the SDK in use. Harmonizing is dji-thermal-cli's own normalization (the flight's medians and each frame's
    offset); normalizing alone measures every frame with medians, the flight's (ambient_c, reflected_c) (see
    flight_medians), where the settings give no value. Harmonizing compares the frames the mosaics are built from (the
    pitch limit's, -80° without one), so that the mosaics can be placed with its alignment.
    :raises sdk.SdkError: the SDK set at deployment is missing
    """
    from . import sdk
    dtc = converter.library()
    max_pitch = s['max_pitch'] if s['max_pitch'] is not None else dtc.MosaicOptions().max_pitch
    fields = {f: s[f] for f in SETTINGS_FIELDS}
    if s.get('normalize') and not harmonized(s) and medians:
        unit = s.get('unit') or 'C'
        for field, value in zip(('ambient_temp', 'reflected_temp'), medians):
            if fields[field] is None and value is not None:
                fields[field] = round(float(dtc.units.from_celsius(value, unit)), 4)
    return {
        'settings': dtc.Settings(sdk=sdk.current(), **fields),
        'outputs': tuple(s['outputs']),
        'compression': s['compression'],
        'normalize': harmonized(s),
        'max_pitch': s['max_pitch'],
        'mosaic_options': dtc.MosaicOptions(max_pitch=max_pitch),
    }


def normalized_medians(task, cid):
    """The flight's medians a conversion normalized with alone (without harmonizing), as its results keep them"""
    norm = results(task, cid).get('normalization') or {}
    return None if norm.get('offsets', True) else (norm.get('ambient_c'), norm.get('reflected_c'))


def flight_medians(root, jpegs):
    """The medians of the ambient and reflected temperatures (°C) the thermal frames recorded: (ambient_c,
    reflected_c), None for one no frame recorded"""
    values = {'ambient_temp': [], 'reflected_temp': []}
    for path in jpegs:
        try:
            recorded = converter.describe(str(path))['recorded']
        except Exception:  # noqa: BLE001 - not a thermal frame it can read: left out, as dji-thermal-cli does
            recorded = {}
        for k, v in values.items():
            if recorded.get(k) is not None:
                v.append(float(recorded[k]))
    return tuple(float(statistics.median(v)) if v else None for v in values.values())


def compact(report, root, out_dir, version="", thermal=None, damaged=None):
    """What a conversion keeps of dji-thermal-cli's process report: {files, converted, oblique, not_thermal, skipped,
    normalization, version}; thermal: the thermal JPEGs, when known (the others marked not_thermal: dji-thermal-cli
    reports one above the pitch limit as oblique, before it looks for thermal data), but those damaged ({JPEG: why},
    as the dataset's analysis says), skipped with that reason"""
    files = []
    offsets = report.normalization.offsets_c if report.normalization is not None else {}
    damaged = damaged or {}
    for r in report.results:
        why = damaged.get(r.src) if not r.ok and not (r.reason or "").startswith('oblique') else None
        files.append({
            'path': relative(r.src, root),
            'ok': bool(r.ok),
            'reason': why or r.reason or "",
            'outputs': [relative(p, out_dir) for p in (r.outputs or [])],
            'notes': list(r.notes or []),
            'distance': r.distance,
            'distance_source': r.distance_source or "",
            # What normalizing subtracted from the frame (°C)
            'offset_c': offsets.get(r.src),
            'not_thermal': thermal is not None and r.src not in thermal and r.src not in damaged,
        })
    files.sort(key=lambda f: f['path'])
    norm = None
    if report.normalization is not None:
        n = report.normalization
        values = list(n.offsets_c.values())
        norm = {'ambient_c': n.ambient_c, 'reflected_c': n.reflected_c, 'frames': n.frames,
                'without_offset': n.without_offset,
                'offset_min': min(values) if values else None, 'offset_max': max(values) if values else None}
    return clean(dict(counts(files), files=files, normalization=norm, version=version))


def counts(files):
    """A conversion's images by result: {converted, oblique (above its pitch limit), not_thermal (the RGB photos
    beside the thermal ones, and any other JPEG), skipped (those that failed)}, as compact marks them, else as
    dji-thermal-cli's reasons say"""
    out = {'converted': 0, 'oblique': 0, 'not_thermal': 0, 'skipped': 0}
    for f in files:
        reason = f.get('reason') or ''
        out['converted' if f.get('ok') else 'not_thermal' if f.get('not_thermal') or 'not an R-JPEG' in reason else
            'oblique' if reason.startswith('oblique') else 'skipped'] += 1
    return out


def thermal_jpegs(dtc, jpegs):
    """The thermal JPEGs among jpegs, as dji-thermal-cli tells them by their content, and those neither thermal nor
    another camera's photo (damaged, cut short, unreadable, not a JPEG inside): ({JPEG}, {JPEG: why})"""
    thermal, damaged = set(), {}
    for p in jpegs:
        try:
            status = dtc.classify(p)
        except Exception as e:  # noqa: BLE001 - not one it can read
            damaged[p] = str(e) or type(e).__name__
            continue
        if status.kind == 'thermal':
            thermal.add(p)
        elif status.kind != 'not_thermal':
            damaged[p] = status.reason or status.kind
    return thermal, damaged


def frames_to_convert(dtc, thermal, settings):
    """The thermal JPEGs a conversion writes files for, judged before it starts so that its progress counts only
    them: those at or below its pitch limit (the gimbal pitch it sets, else each frame's own; a frame without one is
    converted, as dji-thermal-cli does)"""
    limit, fixed = settings.get('max_pitch'), settings.get('gimbal_pitch')
    out = set()
    for p in thermal:
        try:
            pitch = fixed if fixed is not None or limit is None else \
                dtc.djixmp.number(dtc.djixmp.fields(p.read_bytes()), 'GimbalPitchDegree')
        except Exception:  # noqa: BLE001 - counted: dji-thermal-cli reports it as skipped
            pitch = None
        if limit is None or pitch is None or pitch <= limit:
            out.add(p)
    return out


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


def removed_paths(task, cid):
    """The frames removed from a conversion (see remove_frames), as paths in the dataset"""
    return {f.get('path') for f in results(task, cid).get('removed') or []}


class NotRemoved(ValueError):
    """Frames that can't be removed from a conversion (the message is for the user)"""


def remove_frames(task, cid, frames, user):
    """
    Frames taken out of a converted conversion: their files deleted and they moved from its results' files to its
    'removed' ({path, removed_by, removed_at}), so its Files, the tasks and mosaics made from it after leave them out;
    the measurements saved on them are deleted too. The tasks made before keep their images (links or copies), and
    the mosaics built before stay as they are until built again (see mosaics.result's frames).
    :return: how many were removed
    :raises NotRemoved: the conversion isn't converted, its mosaics are being built, none of frames is one of its own,
        or they are all it has
    """
    from . import measurements, mosaics
    frames = set(frames)
    with datasets.locked(task):
        if job(task, cid)['status'] != 'ready':
            raise NotRemoved("Only a converted workset's frames can be removed")
        if mosaics.job(task, cid)['status'] == 'building':
            raise NotRemoved("Wait for the mosaics to be built, or cancel them, before removing frames")
        r = results(task, cid)
        files = r.get('files') or []
        gone = [f for f in files if f.get('path') in frames]
        if not gone:
            raise NotRemoved("None of these frames is in the workset")
        kept = [f for f in files if f.get('path') not in frames]
        if not any(f.get('ok') for f in kept):
            raise NotRemoved("A workset keeps at least one converted frame: delete the workset instead")
        out_dir = output_path(task, cid)
        for f in gone:
            for o in f.get('outputs') or []:
                try:
                    os.remove(os.path.join(out_dir, o))
                except FileNotFoundError:
                    pass
        now = datasets.now()
        r['files'] = kept
        r.update(counts(kept))
        r['removed'] = (r.get('removed') or []) + [{'path': f['path'], 'removed_by': user.username, 'removed_at': now}
                                                   for f in gone]
        datasets.write_json(path(task, cid, RESULTS_FILE), r)
    measurements.remove_frames(task, measurements.frames_path(task, cid), {f['path'] for f in gone})
    datasets.update_size(task)
    return len(gone)


def busy(task):
    """Why a dataset's images can't change now, its worksets reading them: "Wait for <workset> to ..." (to which the
    caller adds "before ..."), or "" when they can"""
    from . import mosaics
    for cid in ids(task):
        check_stale(task, cid)
        name = record(task, cid).get('name') or cid
        if job(task, cid)['status'] == 'converting':
            return "Wait for {} to finish converting, or cancel it,".format(name)
        if mosaics.job(task, cid)['status'] == 'building':
            return "Wait for {}'s mosaics to be built, or cancel them,".format(name)
    return ""


def remove_images(task, paths, user):
    """
    Images deleted from a dataset: from each converted conversion that has them too (see remove_frames), then from the
    images folder and from its analysis' files, which is kept but no longer matches the images (as after adding some)
    :return: the paths removed, as the dataset lists them
    :raises NotRemoved: the dataset is being analyzed, a conversion converting or building its mosaics, none of paths
        is one of its images, or a conversion would be left without a converted frame
    """
    if datasets.job(task)['status'] == 'analyzing':
        raise NotRemoved("Wait for the analysis to finish, or cancel it, before removing files")
    images = {rel.replace(os.sep, '/') for rel, _ in datasets.image_files(task)}
    gone = sorted(set(paths) & images)
    if not gone:
        raise NotRemoved("None of these files is in the dataset")
    waiting = busy(task)
    if waiting:
        raise NotRemoved(waiting + " before removing files")
    affected = []
    for cid in ids(task):
        name = record(task, cid).get('name') or cid
        if job(task, cid)['status'] != 'ready':
            continue
        files = results(task, cid).get('files') or []
        if not any(f.get('path') in gone for f in files):
            continue
        if not any(f.get('ok') for f in files if f.get('path') not in gone):
            raise NotRemoved("That would leave {} without a converted frame: delete it first, or keep one of its "
                             "frames".format(name))
        affected.append(cid)
    for cid in affected:
        remove_frames(task, cid, gone, user)
    root = datasets.images_path(task)
    for rel in gone:
        try:
            os.remove(os.path.join(root, *rel.split('/')))
        except FileNotFoundError:
            pass
    with datasets.locked(task):
        a = dict(datasets.analysis(task))       # shared while unchanged: a copy changed (see datasets.analysis)
        if a.get('files'):
            a['files'] = [f for f in a['files'] if f.get('path') not in gone]
            datasets.write_json(datasets.data_path(task, datasets.ANALYSIS_FILE), a)
    datasets.images_changed(task)
    datasets.update_size(task)
    return gone


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


def create(task, name, settings, user, then=None):
    """A new conversion of the dataset, started in WebODM's worker; then: what to do once it is converted (see
    conversion_tasks.commit_parent). :return: its id"""
    cid = uuid.uuid4().hex[:12]
    record_ = {'name': name, 'settings': settings, 'created_by': user.username, 'created_at': datasets.now()}
    if then:
        record_['then'] = then
    with datasets.locked(task):
        os.makedirs(output_path(task, cid))
        datasets.write_json(path(task, cid, RECORD_FILE), record_)
        datasets.write_json(path(task, cid, JOB_FILE), {'status': 'converting'})
    datasets.start_job(task, 'conversions', 'convert', cid, rel=rel(cid, JOB_FILE), running='converting', stage={}, frames={})
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
        settings = record(task, cid).get('settings') or DEFAULTS
        medians = None
        if settings.get('normalize') and not harmonized(settings):
            medians = flight_medians(root, dtc.scan(root).jpegs)
        args = api_arguments(settings, medians)
        # Each image is reported once when it is written; the progress counts only the frames converted, not the
        # RGB photos or the oblique frames, skipped at once. Harmonizing first compares the frames' overlaps, stage by
        # stage: the page shows the stage and how far its run of stages is while the progress is 0
        from .mosaics import stage_fraction
        thermal, damaged = thermal_jpegs(dtc, dtc.scan(root).jpegs)
        frames = frames_to_convert(dtc, thermal, settings)
        total = max(1, len(frames))
        state = {'done': 0, 'written': time.time(), 'stage': None}

        def write(now, **fields):
            t = time.time()
            if now or t - state['written'] >= PROGRESS_INTERVAL:
                state['written'] = t
                if not datasets.update_job(task, if_run=run_id, rel=job_rel, **fields):
                    raise Canceled()

        write(True, frames={'done': 0, 'total': len(frames)})

        def progress(event):
            if event.kind == 'mosaic':
                key = stage_key(event)
                write(key != state['stage'], stage=mosaic_stage(event, fraction=stage_fraction(event.data)))
                state['stage'] = key
            elif event.kind == 'file':
                # A conversion or dataset deleted stops at once, before it writes more files where they were
                if not os.path.exists(job_file):
                    raise Canceled()
                if event.path not in frames:
                    return
                state['done'] += 1
                write(state['stage'] is not None or state['done'] == len(frames), progress=min(0.99, state['done'] / total),
                      stage={}, frames={'done': state['done'], 'total': len(frames)})
                state['stage'] = None

        # jobs=1: a Celery worker's processes cannot start processes of their own
        alignment = path(task, cid, ALIGNMENT_FILE)
        if os.path.exists(alignment):
            os.remove(alignment)
        report = dtc.process(root, out_dir, jobs=1, progress=progress, **args)
        if report.normalization is not None and report.normalization.alignment is not None:
            report.normalization.alignment.save(alignment)
        result = compact(report, root, out_dir, dtc.__version__, thermal, damaged)
        if medians is not None:
            result['normalization'] = {'ambient_c': medians[0], 'reflected_c': medians[1], 'offsets': False}
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
    if ok:
        from . import frames
        frames.start_figures(task, cid)
    then = record(task, cid).get('then')
    if ok and then:
        from . import conversion_tasks
        conversion_tasks.wait_for_plan(task, then)
        conversion_tasks.commit_parent(task, cid, then)
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


# The user's display preferences: the unit temperatures are shown in (°C or °F, linked to WebODM's metric and imperial
# units in each browser; None: not chosen, the administrator's default, else °C) and the palette they are drawn in
# throughout the UI and on WebODM's map (None: each picture's own where the frames hold one, else WebODM's default),
# one of DJI's or of WebODM's colour maps.

DISPLAY_UNITS = ('C', 'F')
DEFAULT_UNIT_KEY = 'default_unit'

COLORMAPS = ('inferno', 'magma', 'plasma', 'viridis', 'hot', 'jet', 'rainbow', 'gray', 'gray_r')   # WebODM's


def display_palettes():
    return palettes() + list(COLORMAPS)


def saved_display(user):
    saved = preferences_store(user).get_json(DISPLAY_KEY, None)
    return saved if isinstance(saved, dict) else {}


def default_unit():
    """The unit an administrator chose for users who haven't chosen one (C or F), else C"""
    from app.plugins.data_store import GlobalDataStore
    unit = GlobalDataStore(converter.PLUGIN_NAME).get_string(DEFAULT_UNIT_KEY, 'C')
    return unit if unit in DISPLAY_UNITS else 'C'


def set_default_unit(unit):
    """:raises ValueError: not C or F"""
    from app.plugins.data_store import GlobalDataStore
    if unit not in DISPLAY_UNITS:
        raise ValueError("Not a unit temperatures are shown in: {}".format(unit))
    GlobalDataStore(converter.PLUGIN_NAME).set_string(DEFAULT_UNIT_KEY, unit)


def display(user):
    """{'unit': the unit the user chose (C or F) or None, 'default_unit': the administrator's (default_unit),
    'palette': one of display_palettes() or None, 'legend': whether the Thermal Inspector shows the legend on
    WebODM's map (shown unless hidden), 'pointer_temperature': whether Temperature On Pointer is ticked, None until the
    user first ticks or clears it (each page then has its own default: off, but on in the Thermal Inspector)}"""
    saved = saved_display(user)
    return {'unit': saved.get('unit') if saved.get('unit') in DISPLAY_UNITS else None, 'default_unit': default_unit(),
            'palette': saved.get('palette') if saved.get('palette') in display_palettes() else None,
            'legend': saved.get('legend') is not False,
            'pointer_temperature': saved.get('pointer_temperature') if isinstance(saved.get('pointer_temperature'), bool) else None}


def parse_display(raw):
    """The display preferences the API was sent (a palette left blank: None), and {field: message} for what is not
    valid; those not sent are left out"""
    raw = raw if isinstance(raw, dict) else {}
    out, errors = {}, {}
    if 'unit' in raw:
        out['unit'] = None if blank(raw.get('unit')) else raw.get('unit')
        if out['unit'] is not None and out['unit'] not in DISPLAY_UNITS:
            errors['unit'] = "Must be C or F"
    if 'palette' in raw:
        palette = raw.get('palette')
        out['palette'] = None if blank(palette) else palette
        if out['palette'] is not None and out['palette'] not in display_palettes():
            errors['palette'] = "Not one of DJI's palettes or WebODM's colour maps"
    if 'legend' in raw:
        out['legend'] = raw.get('legend')
        if not isinstance(out['legend'], bool):
            errors['legend'] = "Must be true or false"
    if 'pointer_temperature' in raw:
        out['pointer_temperature'] = raw.get('pointer_temperature')
        if not isinstance(out['pointer_temperature'], bool):
            errors['pointer_temperature'] = "Must be true or false"
    return out, errors


def save_display(user, value):
    """The preferences sent saved over those saved before"""
    saved = saved_display(user)
    saved.update(value)
    preferences_store(user).set_json(DISPLAY_KEY, saved)
