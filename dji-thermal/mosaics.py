"""
A conversion's mosaics: dji-thermal-cli's make_mosaic over the dataset's nadir frames, as converted and harmonized
(normalized), with the conversion's settings. Built in WebODM's worker after the conversion's images (when its
settings ask for them) or later on their own, and shown on a map by the viewer, whose tiles and readout are read here.

Files, in the conversion's folder (see conversions):
    mosaics/<kind>/mosaic_temp_<unit>.tif (+ .json), mosaic_preview.png    as dji-thermal-cli writes them (downloads)
    viewer/<kind>.tif (+ .json)    a georeferenced copy for the map, only when the conversion strips the location (the
                                   downloads are then stripped); never downloaded
    viewer/palettes.json           DJI's palettes, read from one of the frames

The viewer's source frame window reads the mosaic's JSON sidecar: its frame table (each frame's measurement and
offset) and frame models (dji-thermal-cli's FrameModels: where each frame saw a point).
    mosaic-job.json                the build's status, progress, stage, error and run id
    mosaics.json                   what was built (see build)
"""

import dataclasses
import functools
import json
import math
import os
import shutil
import time
from pathlib import Path

from . import conversions, converter, datasets
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
VIEWER_COLORMAPS = conversions.COLORMAPS
DJI_PREFIX = 'dji_'
SEAM_COLORS = ((0, 0, 0), (255, 255, 255))   # the source frame tab's lines: a pixel of each, either side of a seam
TILE_SIZE = 256
EARTH_CIRCUMFERENCE_M = 40075016.686
HISTOGRAM_FILE = 'histogram-{}.json'    # a temperature mosaic's histogram, in VIEWER_DIR, for the equalization
NO_ADJUST = {'gamma': 1.0, 'equalize': False, 'sharpen': 0.0}


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
    args = conversions.api_arguments(options, conversions.normalized_medians(task, cid))
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
    # The harmonized mosaic, and the as converted one from the same layout (aligned once). jobs=1: dji-thermal-cli
    # reads the frames in this process. On Linux a Celery worker's processes cannot start processes of their own; on
    # Windows they can, but a process started there doesn't have the plugin's site-packages and fails to import it.
    harmonized = dtc.make_mosaic(root, kind_dirs['harmonized'], settings,
                                 dtc.MosaicOptions(max_pitch=max_pitch, normalize=True, units=(unit,)),
                                 compression=args['compression'], jobs=1, progress=progress,
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
    """The user's preferred palette (one of WebODM's, or DJI's when the frames hold it), else the conversion's own,
    else the flight's (as dji-thermal-cli's preview used it), each when the frames hold it; else inferno"""
    if preferred in VIEWER_COLORMAPS:
        return preferred
    dji = palettes_of(task, cid)
    kinds = result(task, cid).get('kinds') or {}
    for name in (preferred, settings.get('palette'), (kinds.get('as_converted') or {}).get('palette')):
        if name and name in dji:
            return DJI_PREFIX + name
    return 'inferno'


def seams(frames, valid):
    """The pixels either side of where neighbouring pixels come from different frames: (first side, second side) masks,
    the first left of or above the seam"""
    import numpy as np
    first, second = np.zeros(frames.shape, bool), np.zeros(frames.shape, bool)
    across = valid[:, :-1] & valid[:, 1:] & (frames[:, :-1] != frames[:, 1:])
    first[:, :-1] |= across
    second[:, 1:] |= across
    down = valid[:-1, :] & valid[1:, :] & (frames[:-1, :] != frames[1:, :])
    first[:-1, :] |= down
    second[1:, :] |= down
    return first, second


def tab_kind(tab):
    """The mosaic (kind) a viewer tab shows"""
    return {name: kind for name, kind, _band in TABS}[tab]


def is_temperature(tab):
    """Whether a viewer tab shows temperatures (its raster's first band; the source frames are drawn over them)"""
    return tab == 'source_frame' or any(name == tab and band == 1 for name, _kind, band in TABS)


def temperatures(raster, unit):
    """A mosaic's temperatures, NaN where it has none"""
    import numpy as np
    import rasterio
    with rasterio.open(raster) as src:
        values = src.read(1).astype(np.float64)
    values[~np.isfinite(values) | (values <= low_value(unit))] = np.nan
    return values


def histogram(task, cid, tab):
    """A temperature tab's histogram (colouring.value_histogram of its mosaic), kept beside the viewer's other files"""
    from . import colouring
    raster, _band = tab_raster(task, cid, tab)
    unit = result(task, cid).get('unit') or 'C'
    return colouring.kept_histogram(raster, lambda p: temperatures(p, unit),
                                    path(task, cid, VIEWER_DIR, HISTOGRAM_FILE.format(tab_kind(tab))))


def shares(task, cid, tab, low, high, adjust):
    """
    The palette's share at values evenly across low..high that a viewer tab is drawn with (colouring.curve_shares): its
    gamma, and with equalize its mosaic's histogram equalization; None when drawn linearly
    :raises ValueError: equalize asked on a tab of no temperatures
    """
    from . import colouring
    curve = None
    if adjust['equalize']:
        if not is_temperature(tab):
            raise ValueError("Only temperatures can be equalized")
        curve = colouring.equalization(histogram(task, cid, tab), low, high)
    elif adjust['gamma'] == 1.0:
        return None
    return colouring.curve_shares(low, high, adjust, curve)


def tile_pixel_m(z, y):
    """The ground width of a web mercator tile's pixel at the middle of its row y, in metres"""
    lat = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / 2 ** z)))
    return EARTH_CIRCUMFERENCE_M * math.cos(lat) / (TILE_SIZE * 2 ** z)


def png(rgba):
    """An RGBA image ((h, w, 4) uint8) as PNG bytes"""
    import numpy as np
    from rio_tiler.utils import render
    return render(np.moveaxis(rgba[..., :3], 2, 0), rgba[..., 3], img_format='PNG')


def tile(task, cid, tab, z, x, y, cmap, low, high, adjust=None, isotherm=None):
    """
    A tile of a viewer tab as PNG bytes: temperatures and view angles over low..high in cmap, drawn with the adjustments
    and the isotherm (colouring: its temperatures in the palette, the rest in grey); the source frames as the temperatures with black and white lines where one frame meets the next;
    never interpolated (nearest pixel).
    :return: None when the tile is outside the mosaic
    :raises ValueError: equalize asked on a tab of no temperatures
    """
    from . import colouring
    adjust = adjust or NO_ADJUST
    framed = tab == 'source_frame'
    tone = shares(task, cid, tab, low, high, adjust)
    # The source frames read a pixel around the tile to find the seams on its edges; the unsharp mask reads its margin
    buffer = max(1 if framed else 0, colouring.MARGIN if adjust['sharpen'] > 0 else 0)
    found = _tile_values(task, cid, tab, z, x, y, buffer)
    if found is None:
        return None
    values, frames, sigma = found
    rgba = colouring.colour(values, palette_colors(cmap), (low, high), tone, adjust['sharpen'],
                            colouring.isotherm_range(isotherm), sigma=sigma, margin=buffer)
    if framed:
        first, second = frames
        inner = (slice(buffer, -buffer), slice(buffer, -buffer))
        rgba[first[inner], :3], rgba[second[inner], :3] = SEAM_COLORS
    return png(rgba)


def values_tile(task, cid, tab, z, x, y):
    """
    The values a viewer tab's tile is drawn from (in its unit), with colouring.MARGIN more pixels on each side, as a
    value tile for the browser to colour (colouring.value_png; the source frames' seams flagged 1 and 2, for
    SEAM_COLORS), and the unsharp mask's sigma: (PNG bytes, offset, step, sigma); None outside the mosaic
    """
    import numpy as np

    from . import colouring
    found = _tile_values(task, cid, tab, z, x, y, colouring.MARGIN)
    if found is None:
        return None
    values, frames, sigma = found
    flags = None
    if frames is not None:
        # as tile draws them: the second's colour where both are
        flags = np.where(frames[0], 1, 0).astype(np.uint8)
        flags[frames[1]] = 2
    return colouring.value_png(values, flags) + (sigma,)


def _tile_values(task, cid, tab, z, x, y, buffer):
    """
    A viewer tab's tile read with buffer more pixels on each side (never interpolated: the nearest pixel): its values,
    NaN where there are none, the source frames' seams (first, second; see seams) or None on another tab, and the unsharp
    mask's sigma: (values, seams, sigma); None when the tile is outside the mosaic
    """
    import numpy as np
    from rio_tiler.errors import TileOutsideBounds
    from rio_tiler.io import COGReader

    from app.api.tiler import get_zoom_safe
    from app.raster_utils import ZOOM_EXTRA_LEVELS

    from . import colouring
    raster, band = tab_raster(task, cid, tab)
    framed = tab == 'source_frame'
    with COGReader(raster) as src:
        if not src.tile_exists(z, x, y):
            return None
        minzoom, maxzoom = get_zoom_safe(src)
        if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
            return None
        indexes = (1, band) if framed else (band,)
        try:
            t = src.tile(x, y, z, indexes=indexes, tilesize=TILE_SIZE, resampling_method='nearest',
                         tile_buffer=buffer or None)
            # The tile itself as it is read without a margin: with one, its pixels land on a slightly shifted grid
            inner = src.tile(x, y, z, indexes=indexes, tilesize=TILE_SIZE, resampling_method='nearest') if buffer else t
        except TileOutsideBounds:
            return None
    bands, mask = np.asarray(t.data, dtype=np.float64), t.mask.copy()
    if buffer:
        bands[:, buffer:-buffer, buffer:-buffer] = inner.data
        mask[buffer:-buffer, buffer:-buffer] = inner.mask
    data = bands[0]
    valid = (mask > 0) & np.isfinite(data)
    built = result(task, cid)
    if framed or band == 1:
        valid &= data > low_value(built.get('unit') or 'C')
    gsd = ((built.get('kinds') or {}).get(tab_kind(tab)) or {}).get('gsd_m')
    found_seams = None
    if framed:
        frames = bands[1]
        found_seams = seams(np.rint(np.where(np.isfinite(frames), frames, -1)), valid & np.isfinite(frames))
    return (np.where(valid, data, np.nan), found_seams,
            colouring.sharpen_sigma(gsd, tile_pixel_m(z, y)))


def palette_colors(cmap):
    """A colour map ({index: (r, g, b, a)}, 256 of them) as colouring takes it (0xRRGGBBAA integers)"""
    return encoded([cmap[i] for i in range(256)])


def point(task, cid, tab, lon, lat):
    """
    A viewer tab's values at a point: {valid, temperature, frame, frame_index, view_angle, frame_pixel, unit, reason};
    frame_pixel: the frame's pixel it was read from (column, row; none in a mosaic built before dji-thermal-cli 1.4.0)
    """
    from rio_tiler.errors import PointOutsideBounds
    from rio_tiler.io import COGReader

    raster, _band = tab_raster(task, cid, tab)
    built = result(task, cid)
    unit = built.get('unit') or 'C'
    out = {'coordinates': [lon, lat], 'valid': False, 'unit': unit, 'temperature': None, 'frame': None,
           'frame_index': None, 'view_angle': None, 'frame_pixel': None}
    try:
        with COGReader(raster) as src:
            # Checked first: far from the mosaic, a point may be outside its projection's domain too
            west, south, east, north = src.bounds
            if not (west <= lon <= east and south <= lat <= north):
                raise PointOutsideBounds()
            values = src.point(lon, lat, indexes=(1, 2, 3, 4, 5) if src.dataset.count >= 5 else (1, 2, 3))
    except PointOutsideBounds:
        out['reason'] = 'outside_raster'
        return out
    finite = [v if math.isfinite(v) else None for v in (float(x) for x in values)]
    temperature, frame, angle = finite[:3]
    if temperature is not None and temperature > low_value(unit):
        out['temperature'] = temperature
    frames = built.get('frames') or []
    if frame is not None:
        out['frame_index'] = round(frame)
        out['frame'] = frames[out['frame_index']] if 0 <= out['frame_index'] < len(frames) else None
        if len(finite) == 5 and None not in finite[3:]:
            out['frame_pixel'] = [int(finite[3]), int(finite[4])]
    out['view_angle'] = angle
    out['valid'] = out['temperature'] is not None or out['frame'] is not None
    if not out['valid']:
        out['reason'] = 'nodata'
    return out


# The source frame window

def sidecar_path(raster):
    return os.path.splitext(raster)[0] + '.json'


@functools.lru_cache(maxsize=4)
def _sidecar(path, mtime_ns):
    with open(path) as f:
        info = json.load(f)
    return info, converter.library().mosaic.FrameModels.from_sidecar(info)


def sidecar(raster):
    """(the contents of a mosaic's JSON sidecar, its FrameModels or None when it has none), read once while it is
    unchanged; ({}, None) without a sidecar"""
    path = sidecar_path(raster)
    try:
        return _sidecar(path, os.stat(path).st_mtime_ns)
    except (OSError, ValueError):
        return {}, None


def frames_at(task, cid, tab, lon, lat):
    """
    The frames that saw a point (lon, lat): [{index, file, x, y (the point's pixel in the frame, continuous, pixel
    centres at whole numbers), width, height, view_angle, footprint ([lon, lat] corners), source (the mosaic's pixel
    came from it)}], the mosaic's own first, then from the one that saw it closest to straight down; None when the
    mosaic has no frame models (built by a dji-thermal-cli before 1.5.0)
    """
    import numpy as np
    raster, _band = tab_raster(task, cid, tab)
    info, models = sidecar(raster)
    if models is None:
        return None
    pixels, angles = models.pixels(lon, lat)[:, 0], models.view_angles(lon, lat)[:, 0]
    own = point(task, cid, tab, lon, lat)['frame_index']
    sizes = {f['index']: (f['width'], f['height']) for f in info['frame_models']['frames']}
    seen = sorted((int(k) for k in np.flatnonzero(np.isfinite(pixels[:, 0]))), key=lambda k: (k != own, angles[k]))
    return [{'index': k, 'file': models.files[k], 'x': float(pixels[k, 0]), 'y': float(pixels[k, 1]),
             'width': sizes[k][0], 'height': sizes[k][1], 'view_angle': float(angles[k]),
             'footprint': models.footprints[k].tolist(), 'source': k == own} for k in seen]


def pixel_angles(model):
    """Each pixel's angle from straight down (degrees) of a frame as its frame model (a sidecar's frame_models entry)
    saw the ground; NaN for a pixel looking up"""
    import numpy as np
    w, h, f = model['width'], model['height'], model['focal_px']
    cx, cy = model['principal_point_px']
    u, v = np.meshgrid(np.arange(w, dtype=float), np.arange(h, dtype=float))
    # The pixels' rays: camera (forward, right, down) to north, east, down
    ned = np.tensordot(np.asarray(model['ned_to_camera'], float).T, np.stack([np.ones_like(u), (u - cx) / f, (v - cy) / f]),
                       axes=1)
    return np.where(ned[2] > 0, np.degrees(np.arctan2(np.hypot(ned[0], ned[1]), ned[2])), np.nan)


@functools.lru_cache(maxsize=8)
def _measured(path, settings, unit):
    import numpy as np
    return np.asarray(converter.library().measure(path, settings, unit=unit).temperature, dtype=np.float64)


def frame_values(task, cid, tab, index):
    """
    A frame as a viewer tab shows it: on View angle each pixel's angle from straight down, in degrees; otherwise its
    temperatures in the mosaic's unit as the tab's mosaic measured them (its recorded measurement, the workset's
    replacements), the harmonized less the frame's offset. A float array (height, width), NaN where there is no data.
    :raises LookupError: not a frame of the mosaic, or its file is gone
    :raises: the library's errors, for a frame it cannot measure
    """
    import numpy as np
    from django.core.exceptions import SuspiciousFileOperation

    from app.security import path_traversal_check
    conversions = conversions_module()
    dtc = converter.library()
    raster, _band = tab_raster(task, cid, tab)
    info, _models = sidecar(raster)
    models = (info.get('frame_models') or {}).get('frames') or []
    table = {f.get('index'): f for f in info.get('frames') or []}
    if not 0 <= index < len(models) or index not in table:
        raise LookupError("Not a frame of this mosaic")
    if tab == 'view_angle':
        return pixel_angles(models[index])
    row = table[index]
    root = datasets.images_path(task)
    try:
        path = path_traversal_check(os.path.join(root, row['file']), root)
    except SuspiciousFileOperation:
        raise LookupError("Not a frame of this mosaic") from None
    if not os.path.isfile(path):
        raise LookupError("The frame is not on the server any more")
    unit = result(task, cid).get('unit') or 'C'
    settings = conversions.api_arguments(conversions.record(task, cid).get('settings') or conversions.DEFAULTS,
                                         conversions.normalized_medians(task, cid))['settings']
    m, celsius = row.get('measurement') or {}, lambda v: None if v is None else dtc.units.from_celsius(v, settings.unit)
    # As the mosaic measured it: its own recorded parameters (the distance in metres), the workset's replacements
    recorded = dataclasses.replace(settings, distance=m.get('distance', settings.distance),
                                   humidity=m.get('humidity'), emissivity=m.get('emissivity'),
                                   reflected_temp=celsius(m.get('reflection')), ambient_temp=celsius(m.get('ambient_temp')))
    values = _measured(path, recorded, unit).copy()
    values[~np.isfinite(values) | (values <= low_value(unit))] = np.nan
    if ((info.get('report') or {}).get('frame_offsets') or {}).get('normalized'):
        offset = row.get('temperature_offset_c') or 0.0
        values -= offset * (1.8 if unit == 'F' else 1.0)
    return values


def frame_image(task, cid, tab, index, cmap, low, high, adjust=None, isotherm=None):
    """A frame as frame_values gives it, over low..high in cmap, drawn as the tab's tiles are (its mosaic's curve, the
    isotherm), as PNG bytes"""
    from . import colouring
    adjust = adjust or NO_ADJUST
    tone = shares(task, cid, tab, low, high, adjust)
    return png(colouring.colour(frame_values(task, cid, tab, index), palette_colors(cmap), (low, high), tone,
                                adjust['sharpen'], colouring.isotherm_range(isotherm)))
