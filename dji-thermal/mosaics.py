"""
A conversion's mosaics: dji-thermal-cli's make_mosaic over the dataset's nadir frames, as converted and harmonized
(normalized), with the conversion's settings. Built in WebODM's worker after the conversion's images (when its
settings ask for them) or later on their own, and shown on a map by the viewer, whose tiles and readout are read here.

Files, in the conversion's folder (see conversions):
    mosaics/<kind>/mosaic_temp_<unit>.tif (+ .json), mosaic_preview.png    as dji-thermal-cli writes them (downloads)
    viewer/<kind>.tif (+ .json)    a georeferenced copy for the map, only when the conversion strips the location (the
                                   downloads are then stripped); never downloaded
    viewer/palettes.json           DJI's palettes, read from one of the frames
    mosaic-job.json                the build's status, progress, stage, error and run id
    mosaics.json                   what was built (see build)
"""

import colorsys
import json
import math
import os
import shutil
import time
from functools import cache
from pathlib import Path

from . import converter, datasets
from .analysis import PROGRESS_INTERVAL, Canceled, clean

# The mosaics built: (kind, normalized)
KINDS = (('as_converted', False), ('harmonized', True))
# The viewer's tabs: (tab, kind whose file it reads, band)
TABS = (('as_converted', 'as_converted', 1), ('harmonized', 'harmonized', 1),
        ('source_frame', 'as_converted', 2), ('view_angle', 'as_converted', 3))
MOSAICS_DIR = 'mosaics'
VIEWER_DIR = 'viewer'
PALETTES_FILE = 'palettes.json'
JOB_FILE = 'mosaic-job.json'
RESULT_FILE = 'mosaics.json'
PERCENTILES = (2, 98)
ABSOLUTE_ZERO = {'C': -273.15, 'F': -459.67, 'K': 0.0}
# dji-thermal-cli's mosaic default (nadir frames), unless the conversion sets its own pitch limit
DEFAULT_MAX_PITCH = -80.0
# Long per-pair or per-frame lists of the report, left out of what is kept (the JSON sidecar has them all)
REPORT_DETAIL = ('pairs_detail', 'frames', 'per_frame')

# The colour maps of WebODM's tiler offered beside DJI's palettes
VIEWER_COLORMAPS = ('inferno', 'magma', 'plasma', 'viridis', 'hot', 'jet', 'rainbow', 'gray', 'gray_r')
DJI_PREFIX = 'dji_'
FRAME_COLORS = 256      # the source frame tab colours frame n with colour n % FRAME_COLORS
TILE_SIZE = 256


def conversions_module():
    from . import conversions
    return conversions


def rel(cid, *parts):
    return conversions_module().rel(cid, *parts)


def path(task, cid, *parts):
    return conversions_module().path(task, cid, *parts)


def job(task, cid):
    return datasets.job(task, rel(cid, JOB_FILE))


def result(task, cid):
    """What was built: {'kinds': {kind: ...}, 'frames': [names], 'unit', 'stripped'}, or {}"""
    return datasets.read_json(path(task, cid, RESULT_FILE))


def low_value(unit):
    """Temperatures at or below this are dji-thermal-cli's no-data marker (absolute zero), not measurements"""
    return ABSOLUTE_ZERO.get(unit, ABSOLUTE_ZERO['C']) + 1


def band_stats(values):
    """min, max and the PERCENTILES of the finite values of an array, or None when there are none"""
    import numpy as np
    v = values[np.isfinite(values)]
    if v.size == 0:
        return None
    low, high = (float(p) for p in np.percentile(v, PERCENTILES))
    return {'min': float(v.min()), 'max': float(v.max()), 'percentiles': [low, high]}


def raster_info(raster, unit):
    """Where a mosaic is (lon/lat bounds, zooms) and the range of its temperature and view angle bands"""
    import numpy as np
    from rio_tiler.io import COGReader

    from app.api.tiler import get_zoom_safe
    with COGReader(raster) as src:
        minzoom, maxzoom = get_zoom_safe(src)
        info = {'bounds': list(src.bounds), 'minzoom': minzoom, 'maxzoom': maxzoom}
        temperature = src.dataset.read(1)
        temperature = np.where(temperature > low_value(unit), temperature, np.nan)
        info['temperature'] = band_stats(temperature)
        info['view_angle'] = band_stats(src.dataset.read(3))
    return info


def trimmed(value):
    """dji-thermal-cli's mosaic report without its long per-pair and per-frame lists"""
    if isinstance(value, dict):
        return {k: trimmed(v) for k, v in value.items() if k not in REPORT_DETAIL}
    if isinstance(value, list) and len(value) > 20:
        return None
    return value


def dji_palettes(jpegs):
    """DJI's palettes {name: [[r, g, b] x 256]} as the first R-JPEG that has them holds them, or {}"""
    dtc = converter.library()
    for jpeg in jpegs:
        try:
            lut = dtc.tsdk.open(Path(jpeg).read_bytes()).get_pseudo_color_lut()     # (3, palettes, 256)
        except Exception:  # noqa: BLE001, S112 - the next frame, then none
            continue
        return {name: lut[:, i, :].T.astype(int).tolist() for i, name in enumerate(dtc.PALETTES) if i < lut.shape[1]}
    return {}


def stage_fraction(d):
    """How far a run of stages is, 0 to 1, each step counting the same; within an alignment round, measuring its
    pairs is the first half and the solve the second"""
    part = min(1.0, d['done'] / d['total']) if d['total'] else 0.0
    if 'round' in d:
        part = (d['round'] - 1 + (0.5 + part / 2 if d['unit'] == 'solve steps' else part / 2)) / d['rounds']
    return (d['step'] - 1 + part) / d['steps']


def remove(task, cid):
    """A conversion's mosaics and the viewer's files"""
    for d in (MOSAICS_DIR, VIEWER_DIR):
        shutil.rmtree(path(task, cid, d), ignore_errors=True)
    try:
        os.remove(path(task, cid, RESULT_FILE))
    except FileNotFoundError:
        pass


def files(task, cid):
    """The mosaics' files to download, as <kind>/<file>"""
    out = []
    for kind, _ in KINDS:
        d = path(task, cid, MOSAICS_DIR, kind)
        if os.path.isdir(d):
            out += sorted('{}/{}'.format(kind, f) for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)))
    return out


def build(task, cid, write_progress):
    """
    Builds a conversion's mosaics into its folder (see result).
    :raises Canceled: the run is no longer wanted (checked at each progress write); MosaicError when no mosaic can be
        made, and whatever else goes wrong
    """
    conversions = conversions_module()
    dtc = converter.library()
    root, out_dir = datasets.images_path(task), path(task, cid)
    if not datasets.image_files(task):
        raise RuntimeError("The dataset has no images")
    remove(task, cid)
    os.makedirs(os.path.join(out_dir, VIEWER_DIR), exist_ok=True)

    options = conversions.record(task, cid).get('settings') or conversions.DEFAULTS
    args = conversions.api_arguments(options)
    settings, unit = args['settings'], options.get('unit') or 'C'
    stripped = bool(options.get('strip_location'))
    max_pitch = options.get('max_pitch')
    max_pitch = DEFAULT_MAX_PITCH if max_pitch is None else max_pitch

    jpegs = dtc.scan(root).jpegs
    datasets.write_json(os.path.join(out_dir, VIEWER_DIR, PALETTES_FILE), dji_palettes(jpegs))

    state = {'stage': None}

    # Both mosaics are one run of stages (dji-thermal-cli's "mosaic" events), each step counting the same in the
    # progress; a cancel takes effect at the next write
    def progress(event):
        if event.kind == 'mosaic':
            key = conversions.stage_key(event)
            write_progress(stage_fraction(event.data), now=key != state['stage'], stage=conversions.mosaic_stage(event))
            state['stage'] = key

    write_progress(0, now=True)
    kind_dirs = {kind: os.path.join(out_dir, MOSAICS_DIR, kind) for kind, _ in KINDS}
    # The harmonized mosaic, and the as converted one from the same layout (aligned once). In a Celery worker, whose
    # processes cannot start processes, dji-thermal-cli reads the frames in this process
    harmonized = dtc.make_mosaic(root, kind_dirs['harmonized'], settings,
                                 dtc.MosaicOptions(max_pitch=max_pitch, normalize=True, units=(unit,)),
                                 compression=args['compression'], progress=progress,
                                 as_converted_dir=kind_dirs['as_converted'])
    reports = {'as_converted': harmonized.as_converted, 'harmonized': harmonized}
    kinds, frames = {}, []
    for kind, _ in KINDS:
        report, kind_dir = reports[kind], kind_dirs[kind]
        tif = report.files[0][0]
        if stripped:
            # The downloads stay as dji-thermal-cli strips them; the map reads a located copy the plugin serves only
            # to its viewer
            tif, _ = dtc.mosaic.write(report.mosaic, Path(out_dir, VIEWER_DIR, kind + '.tif'), args['compression'],
                                      unit, located=True)
        m = report.mosaic
        if not frames:
            frames = [row.get('file', '') for row in sorted(m.frames, key=lambda r: r.get('index', 0))]
        kinds[kind] = dict(raster_info(str(tif), unit),
                           raster=os.path.relpath(str(tif), out_dir), files=sorted(os.listdir(kind_dir)),
                           frames=report.frames, oblique=report.oblique, unusable=report.unusable,
                           not_thermal=report.not_thermal, gsd_m=m.grid.gsd, width=m.grid.width, height=m.grid.height,
                           palette=report.palette, preview_range_c=list(report.preview_range_c),
                           normalization=list(report.normalize_ambient_c) if report.normalize_ambient_c else None,
                           report=trimmed(m.report))
    return clean({'kinds': kinds, 'frames': frames, 'unit': unit, 'stripped': stripped,
                  'built_at': datasets.now()})


def make(task_id, run_id, cid):
    """
    Builds a conversion's mosaics (the dataset's task id), while its mosaic run is still run_id.
    :return: what the run did, for the job's result
    """
    from app.models import Task

    task = Task.objects.filter(pk=task_id).first()
    job_rel = rel(cid, JOB_FILE)
    if task is None or job(task, cid).get('run_id') != run_id:
        return {'canceled': True}
    state = {'written': time.time(), 'value': 0.0}

    def write_progress(value, now=False, stage=None):
        """The progress (at most every PROGRESS_INTERVAL, unless now) and the stage; stops when the run is gone. The
        progress only moves forward"""
        state['value'] = max(state['value'], value)
        t = time.time()
        if now or t - state['written'] >= PROGRESS_INTERVAL:
            state['written'] = t
            if not datasets.update_job(task, if_run=run_id, rel=job_rel, progress=min(0.99, state['value']),
                                       stage=stage or {}):
                raise Canceled()

    conversions = conversions_module()
    try:
        built = build(task, cid, write_progress)
    except Canceled:
        remove(task, cid)
        conversions.left_behind(task, cid)
        return {'canceled': True}
    except Exception as e:  # noqa: BLE001 - shown on the conversion
        # Nothing of a failed build is kept: it is not shown, and would only count toward the quota
        remove(task, cid)
        datasets.update_job(task, if_run=run_id, rel=job_rel, status='failed', error=str(e) or type(e).__name__,
                            progress=0, stage={}, run_id='', finished_at=datasets.now())
        conversions.left_behind(task, cid)
        return {'error': str(e)}
    if not datasets.finish_job(task, run_id, built, rel=job_rel, result_rel=rel(cid, RESULT_FILE), stage={}):
        remove(task, cid)
        conversions.left_behind(task, cid)
        return {'canceled': True}
    datasets.update_size(task)
    return {'mosaics': list(built['kinds'])}


def start(task, cid):
    """Builds (again) a conversion's mosaics in WebODM's worker"""
    with datasets.locked(task):
        datasets.write_json(path(task, cid, JOB_FILE), {'status': 'building'})
    datasets.start_job(task, 'mosaics', 'make', cid, rel=rel(cid, JOB_FILE), running='building', stage={})


def cancel(task, cid):
    """A build stops at its next progress write; nothing of it is kept"""
    try:
        with datasets.locked(task):
            state = job(task, cid)
            if state['status'] != 'building':
                return False
            datasets.write_json(path(task, cid, JOB_FILE), {'status': 'canceled', 'finished_at': datasets.now()})
    except datasets.Gone:
        return False
    datasets.revoke(state.get('celery_task_id'))
    return True


def check_stale(task, cid):
    return datasets.check_stale(task, rel(cid, JOB_FILE), 'building', 'mosaic')


# The viewer

def tab_raster(task, cid, tab):
    """(path of the GeoTIFF a viewer tab reads, its band), or None when that mosaic was not built"""
    kinds = result(task, cid).get('kinds') or {}
    for name, kind, band in TABS:
        if name == tab:
            m = kinds.get(kind)
            if not m or not m.get('raster'):
                return None
            return path(task, cid, m['raster']), band
    return None


@cache
def frame_colormap():
    """Distinct colours for neighbouring frames (hues a golden angle apart): {index: (r, g, b, 255)}"""
    out = {}
    for i in range(FRAME_COLORS):
        r, g, b = colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0, 0.65 + 0.3 * (i % 2), 0.95 - 0.25 * (i % 3 == 2))
        out[i] = (int(r * 255), int(g * 255), int(b * 255), 255)
    return out


def encoded(colors):
    """Colours as WebODM's tiler gives them (0xRRGGBBAA integers), for the colour scale"""
    return [(int(c[0]) << 24) | (int(c[1]) << 16) | (int(c[2]) << 8) | 255 for c in colors]


def palettes_of(task, cid):
    """DJI's palettes as the dataset's frames hold them: {name: [[r, g, b] x 256]}"""
    try:
        with open(path(task, cid, VIEWER_DIR, PALETTES_FILE)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def viewer_palettes(task, cid):
    """[{key, label, color_map (encoded)}]: DJI's, then WebODM's"""
    from app.api.tiler import get_colormap_encoded_values
    dji = [{'key': DJI_PREFIX + name, 'label': "DJI " + name, 'color_map': encoded(lut)}
           for name, lut in palettes_of(task, cid).items()]
    return dji + [{'key': name, 'label': name, 'color_map': get_colormap_encoded_values(name)}
                  for name in VIEWER_COLORMAPS]


def colormap(task, cid, name):
    """
    The colour map ({index: (r, g, b, a)}) of one of viewer_palettes
    :raises ValueError: not one of them
    """
    if name.startswith(DJI_PREFIX):
        lut = palettes_of(task, cid).get(name[len(DJI_PREFIX):])
        if lut is None:
            raise ValueError("Not a palette of this workset")
        return {i: (c[0], c[1], c[2], 255) for i, c in enumerate(lut)}
    if name not in VIEWER_COLORMAPS:
        raise ValueError("Not a valid color_map value")
    from app.api.tiler import colormap as webodm_colormaps
    return webodm_colormaps.get(name)


def default_palette(task, cid, settings, preferred=None):
    """The user's preferred palette, else the conversion's own, else the flight's (as dji-thermal-cli's preview used
    it), each when the frames hold it; else inferno"""
    dji = palettes_of(task, cid)
    kinds = result(task, cid).get('kinds') or {}
    for name in (preferred, settings.get('palette'), (kinds.get('as_converted') or {}).get('palette')):
        if name and name in dji:
            return DJI_PREFIX + name
    return 'inferno'


def tile(task, cid, tab, z, x, y, cmap, low, high):
    """
    A tile of a viewer tab as PNG bytes: temperatures and view angles over low..high in cmap, source frames each in
    their own colour; never interpolated (nearest pixel).
    :return: None when the tile is outside the mosaic
    """
    import numpy as np
    from rio_tiler.errors import TileOutsideBounds
    from rio_tiler.io import COGReader
    from rio_tiler.utils import render

    from app.api.tiler import get_zoom_safe
    from app.raster_utils import ZOOM_EXTRA_LEVELS

    raster, band = tab_raster(task, cid, tab)
    with COGReader(raster) as src:
        if not src.tile_exists(z, x, y):
            return None
        minzoom, maxzoom = get_zoom_safe(src)
        if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
            return None
        try:
            t = src.tile(x, y, z, indexes=(band,), tilesize=TILE_SIZE, resampling_method='nearest')
        except TileOutsideBounds:
            return None
    data = np.asarray(t.data[0], dtype=np.float64)
    valid = (t.mask > 0) & np.isfinite(data)
    if band == 1:
        valid &= data > low_value(result(task, cid).get('unit') or 'C')
    if tab == 'source_frame':
        levels = np.mod(np.rint(np.where(valid, data, 0)), FRAME_COLORS)
        cmap = frame_colormap()
    else:
        levels = np.clip(np.rint((np.where(valid, data, low) - low) / (high - low) * 255), 0, 255)
    mask = np.where(valid, 255, 0).astype(np.uint8)
    return render(levels.astype(np.uint8)[np.newaxis], mask, img_format='PNG', colormap=cmap)


def point(task, cid, tab, lon, lat):
    """A viewer tab's values at a point: {valid, temperature, frame, frame_index, view_angle, unit, reason}"""
    from rio_tiler.errors import PointOutsideBounds
    from rio_tiler.io import COGReader

    raster, _band = tab_raster(task, cid, tab)
    built = result(task, cid)
    unit = built.get('unit') or 'C'
    out = {'coordinates': [lon, lat], 'valid': False, 'unit': unit, 'temperature': None, 'frame': None,
           'frame_index': None, 'view_angle': None}
    try:
        with COGReader(raster) as src:
            # Checked first: far from the mosaic, a point may be outside its projection's domain too
            west, south, east, north = src.bounds
            if not (west <= lon <= east and south <= lat <= north):
                raise PointOutsideBounds()
            values = src.point(lon, lat, indexes=(1, 2, 3))
    except PointOutsideBounds:
        out['reason'] = 'outside_raster'
        return out
    finite = [v if math.isfinite(v) else None for v in (float(x) for x in values)]
    temperature, frame, angle = finite
    if temperature is not None and temperature > low_value(unit):
        out['temperature'] = temperature
    frames = built.get('frames') or []
    if frame is not None:
        out['frame_index'] = round(frame)
        out['frame'] = frames[out['frame_index']] if 0 <= out['frame_index'] < len(frames) else None
    out['view_angle'] = angle
    out['valid'] = out['temperature'] is not None or out['frame'] is not None
    if not out['valid']:
        out['reason'] = 'nodata'
    return out
