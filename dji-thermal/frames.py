"""
A workset's frames one at a time, for the Analyzer's frame page: the dataset's thermal frames, each measured by
dji-thermal-cli as the workset converted it (its settings, the flight's medians and each frame's offset when it
normalized), or again with some of its measurement parameters changed; its values, the statistics of a shape drawn
in its pixels, and its temperatures to download. Values are in the workset's unit.
"""
import functools
import io
import math
import os
import time

from . import conversions, converter, datasets, inspector, mosaics

# The parameters a frame can be measured again with (the temperatures in the workset's unit)
CHANGES = ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp')
# A shape's sizes in pixels: a line measures a strip LINE_HALF_WIDTH either side, the surroundings are a ring out to
# the shape's size, RING_MIN to RING_MAX (a band RING_MIN wide beside a line)
LINE_HALF_WIDTH = 1.0
RING_MIN = 3.0
RING_MAX = 10.0
DOWNLOADS = ('csv', 'tiff')
CSV_DIGITS = 3


class FrameError(ValueError):
    """What is asked can't be measured (the message is for the user)"""


def thermal_rows(task, cid=None):
    """The dataset's thermal frames as its analysis lists them; with a workset (cid), also those it converted that the
    analysis doesn't list, by their path alone: a workset converted before the dataset was analyzed, or of images added
    since"""
    rows = [r for r in datasets.analysis(task).get('files') or [] if r.get('kind') == 'thermal']
    if cid:
        known = {r.get('path') for r in rows}
        rows += [{'path': f['path'], 'kind': 'thermal'} for f in conversions.results(task, cid).get('files') or []
                 if f.get('ok') and f.get('path') and f['path'] not in known]
    return rows


def frame_list(task, cid):
    """
    The frames the page lists: [{path, time, pitch, converted (the workset converted it), mosaic (its place among the
    mosaics' frames, or None)}], in the order they were taken (those without a time last, by name)
    """
    converted = {f.get('path'): f for f in conversions.results(task, cid).get('files') or []}
    in_mosaic = {name: i for i, name in enumerate(mosaics.result(task, cid).get('frames') or [])}
    rows = [{'path': r['path'], 'time': r.get('time') or "", 'pitch': r.get('pitch'),
             'converted': bool((converted.get(r['path']) or {}).get('ok')), 'mosaic': in_mosaic.get(r['path'])}
            for r in thermal_rows(task, cid)]
    return sorted(rows, key=lambda r: (not r['time'], r['time'], r['path']))


RECORDED = ('distance', 'lrf', 'humidity', 'emissivity', 'reflection', 'ambient')


def recorded(task, rel, cid=None):
    """What the camera recorded of a frame's parameters (the analysis' row, else read from the frame; see thermal_rows):
    {distance, lrf, humidity, emissivity, reflection (°C), ambient (°C)}"""
    row = next((r for r in thermal_rows(task) if r.get('path') == rel), None)
    if row is None:
        try:
            found = converter.describe(frame_path(task, rel, cid))['recorded']
        except Exception:  # noqa: BLE001 - a frame it can't read records nothing
            found = {}
        row = {'distance': found.get('distance'), 'humidity': found.get('humidity'),
               'emissivity': found.get('emissivity'), 'reflection': found.get('reflected_temp'),
               'ambient': found.get('ambient_temp')}
    return {k: row.get(k) for k in RECORDED}


def frame_path(task, rel, cid=None):
    """The full path of one of the dataset's thermal frames (with a workset, those it converted too: thermal_rows)
    :raises FrameError: not one, or gone"""
    from django.core.exceptions import SuspiciousFileOperation

    from app.security import path_traversal_check
    if not rel or rel not in {r['path'] for r in thermal_rows(task, cid)}:
        raise FrameError("Not a thermal frame of this dataset")
    root = datasets.images_path(task)
    try:
        found = path_traversal_check(os.path.join(root, rel), root)
    except SuspiciousFileOperation:
        raise FrameError("Not a thermal frame of this dataset") from None
    if not os.path.isfile(found):
        raise FrameError("The frame is not on the server any more")
    return found


def parse_changes(raw):
    """
    The parameters asked to change ({field: value}, CHANGES only, blanks left out), checked as the workset form's
    :raises FrameError: one that isn't valid
    """
    asked = {f: (raw or {}).get(f) for f in CHANGES}
    asked = {f: v for f, v in asked.items() if not conversions.blank(v)}
    if not asked:
        return {}
    if asked.get('distance') in ('lrf', 'embedded'):
        raise FrameError("Distance: a number of metres")
    checked, errors = conversions.parse_settings(asked)
    errors = {k: v for k, v in errors.items() if k in CHANGES}
    if errors:
        field, message = next(iter(errors.items()))
        raise FrameError("{}: {}".format(field.replace('_', ' ').capitalize(), message))
    return {f: checked[f] for f in asked}


def unit_of(task, cid):
    return (conversions.record(task, cid).get('settings') or {}).get('unit') or 'C'


def frame_settings(task, cid, changes=None):
    """
    The settings a frame is measured with: the workset's, as it converted the frame (a normalized workset's frames
    take the flight's ambient and reflected temperatures where the settings give none), with the changes
    :raises FrameError: the changes don't go with the workset's settings (a range it replaces in, say)
    """
    from . import sdk
    dtc = converter.library()
    s = dict(conversions.record(task, cid).get('settings') or conversions.DEFAULTS)
    unit = s.get('unit') or 'C'
    norm = conversions.results(task, cid).get('normalization') or {}
    if s.get('normalize'):
        for field, key in (('ambient_temp', 'ambient_c'), ('reflected_temp', 'reflected_c')):
            if s.get(field) is None and norm.get(key) is not None:
                s[field] = round(float(dtc.units.from_celsius(norm[key], unit)), 4)
    s.update(changes or {})
    checked, errors = conversions.parse_settings(s)
    if errors:
        raise FrameError(next(iter(errors.values())))
    return dtc.Settings(sdk=sdk.current(), **{f: checked[f] for f in conversions.SETTINGS_FIELDS})


def frame_offset(task, cid, rel):
    """What a harmonized workset subtracted from a frame, in its unit: (offset, known: False for one it kept none of)"""
    s = conversions.record(task, cid).get('settings') or {}
    if not conversions.harmonized(s):
        return 0.0, True
    for f in conversions.results(task, cid).get('files') or []:
        if f.get('path') == rel and f.get('offset_c') is not None:
            return float(f['offset_c']) * (1.8 if unit_of(task, cid) == 'F' else 1.0), True
    return 0.0, False


@functools.lru_cache(maxsize=16)
def _measured(path, mtime_ns, settings, unit):
    """dji-thermal-cli's measurement of a frame (kept: the page asks for its values, figures and shapes in turn)"""
    import numpy as np
    m = converter.library().measure(path, settings, unit=unit)
    values = np.asarray(m.temperature, dtype=np.float64)
    values[~np.isfinite(values) | (values <= mosaics.low_value(unit))] = np.nan
    values.setflags(write=False)
    return values, dict(m.params), m.distance_source or "", list(m.notes or [])


def measure(task, cid, rel, changes=None):
    """
    A frame measured as the workset converted it, with the changes: {values (float, NaN where none, in the unit),
    params (what the SDK measured with, °C), distance_source, notes, offset, offset_known}
    :raises FrameError: not a frame, or one dji-thermal-cli can't measure
    """
    found = frame_path(task, rel, cid)
    settings, unit = frame_settings(task, cid, changes), unit_of(task, cid)
    try:
        values, params, source, notes = _measured(found, os.stat(found).st_mtime_ns, settings, unit)
    except Exception as e:
        raise FrameError("dji-thermal-cli could not measure the frame: {}".format(e)) from e
    offset, known = frame_offset(task, cid, rel)
    return {'values': values - offset if offset else values, 'params': params, 'distance_source': source,
            'notes': notes, 'offset': offset, 'offset_known': known}


def info(task, cid, rel, changes=None):
    """What the page shows of a frame (measure's, its values summed up): {frame, width, height, unit, params,
    recorded, distance_source, notes, offset, offset_known, changes, stats: {min, max, mean, percentiles, histogram
    (the equalization's, colouring.value_histogram)} or None without values}"""
    import numpy as np

    from . import colouring
    m = measure(task, cid, rel, changes)
    values = m.pop('values')
    found = values[np.isfinite(values)]
    stats = None
    if found.size:
        counts, edges = colouring.value_histogram(found)
        stats = {'min': float(found.min()), 'max': float(found.max()), 'mean': float(found.mean()),
                 'percentiles': [float(p) for p in np.percentile(found, mosaics.PERCENTILES)],
                 'histogram': {'counts': counts.tolist(), 'edges': edges.tolist()}}
    return dict(m, frame=rel, width=int(values.shape[1]), height=int(values.shape[0]), unit=unit_of(task, cid),
                recorded=recorded(task, rel, cid), changes=changes or {}, stats=stats)


def values_png(task, cid, rel, changes=None):
    """A frame's values as a value tile (colouring.value_png, no margin): (png, offset, step)"""
    from . import colouring
    return colouring.value_png(measure(task, cid, rel, changes)['values'])


def _shape(geometry):
    """A GeoJSON Point, LineString or Polygon in a frame's pixels (x right, y down) as a shape (shapes.Shape)
    :raises FrameError: none of those"""
    from . import shapes
    if not isinstance(geometry, dict) or geometry.get('type') not in ('Point', 'LineString', 'Polygon'):
        raise FrameError("Not a pin, a region or a line")
    try:
        shape = shapes.shape({'type': geometry['type'], 'coordinates': geometry.get('coordinates')})
    except Exception:  # noqa: BLE001 - OGR refuses what isn't a geometry
        raise FrameError("Invalid geometry") from None
    if shape.geom_type == 'LineString' and (len(shape.coords) < 2 or shape.length == 0):
        raise FrameError("A line needs two points")
    if shape.geom_type == 'Polygon' and not shape.is_valid:
        shape = shape.buffer(0)
    return shape


def _mask(shape, out_shape):
    """The pixels a polygon (shapes.Shape, in pixels) touches, outline pixels included as on the map"""
    import numpy as np
    from rasterio import Affine
    from rasterio.features import geometry_mask
    polygons = inspector._polygons(shape)
    if not polygons:
        return np.zeros(out_shape, dtype=bool)
    return geometry_mask([polygons], out_shape=out_shape, transform=Affine.identity(), invert=True, all_touched=True)


def point_value(values, x, y):
    """The value of the pixel at (x, y), or None outside the frame or where it has none"""
    import numpy as np
    row, col = math.floor(y), math.floor(x)
    if not (0 <= row < values.shape[0] and 0 <= col < values.shape[1]) or not np.isfinite(values[row, col]):
        return None
    return float(values[row, col])


def region(values, geometry, percentiles=inspector.PERCENTILES, bins=inspector.HISTOGRAM_BINS, isotherm=None):
    """
    What a shape drawn on a frame's values measures, as inspector.raster_region does on a map but in pixels: {valid,
    reason, statistics (inspector.statistics, the extremes' [x, y]), pixel_size: 1[, length, profile: {distance (px),
    values, points ([x, y])}]}; a pin's statistics are its pixel's (count 1). isotherm: (low, high) in the unit.
    :raises FrameError: not a shape
    """
    import numpy as np
    shape = _shape(geometry)
    kind = shape.geom_type
    out = {'valid': False, 'reason': None, 'statistics': None, 'pixel_size': 1.0, 'resampled': False}
    usable = np.isfinite(values)
    if kind == 'Point':
        within, ring = np.zeros(values.shape, dtype=bool), None
        row, col = math.floor(shape.y), math.floor(shape.x)
        if 0 <= row < values.shape[0] and 0 <= col < values.shape[1]:
            within[row, col] = True
    else:
        inside = shape.buffer(LINE_HALF_WIDTH) if kind == 'LineString' else shape
        width = RING_MIN if kind == 'LineString' else min(RING_MAX, max(RING_MIN, math.sqrt(inside.area)))
        ring = inside.buffer(width).difference(inside)
        within = _mask(inside, values.shape)
    around = (_mask(ring, values.shape) & ~within) if ring is not None else np.zeros(values.shape, dtype=bool)
    if kind == 'LineString':
        out['length'] = float(shape.length)
    keep = within & usable
    if not within.any():
        out['reason'] = 'outside_raster'
        return out
    if not keep.any():
        out['reason'] = 'nodata'
        return out

    def location(flat_index):
        r, c = np.unravel_index(flat_index, values.shape)
        return [float(c) + 0.5, float(r) + 0.5]

    out['valid'] = True
    out['statistics'] = inspector.statistics(values, keep, around & usable, location, percentiles, bins, isotherm)
    if kind == 'LineString':
        out['profile'] = _profile(shape, values)
    return out


def delta(values, geometry):
    """A ΔT drawn on a frame's values (a line of two points, in pixels): each spot its pixel's value, as a pin's
    (inspector.delta), its length in pixels
    :raises FrameError: not a line of two points"""
    import numpy as np
    ends = inspector.delta_ends(geometry)
    if ends is None:
        raise FrameError("A ΔT is a line of two spots")

    def read(x, y):
        row, col = math.floor(y), math.floor(x)
        if not (0 <= row < values.shape[0] and 0 <= col < values.shape[1]):
            return None, 'outside_raster'
        v = float(values[row, col])
        return (v, None) if np.isfinite(v) else (None, 'nodata')

    return dict(inspector.delta([read(*e) for e in ends], math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1])),
                pixel_size=1.0)


def _profile(line, values):
    """A line's values every pixel along it, at most inspector.MAX_SAMPLES of them"""
    import numpy as np
    coords = np.asarray(line.coords, dtype=np.float64)
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(coords[:, :2], axis=0).T))])
    n = max(2, min(inspector.MAX_SAMPLES, math.floor(along[-1]) + 1))
    distances = np.linspace(0.0, along[-1], n)
    xs, ys = np.interp(distances, along, coords[:, 0]), np.interp(distances, along, coords[:, 1])
    return {'distance': distances.tolist(), 'values': [point_value(values, x, y) for x, y in zip(xs, ys)],
            'points': [[float(x), float(y)] for x, y in zip(xs, ys)]}


def download(task, cid, rel, fmt, changes=None):
    """A frame's temperatures in the unit as a file: CSV (a row per pixel row, blank where there is none) or a 32-bit
    float TIFF (NaN where there is none, no location): (bytes, content type, extension)
    :raises FrameError: another format"""
    import numpy as np
    if fmt not in DOWNLOADS:
        raise FrameError("The download is csv or tiff")
    values = measure(task, cid, rel, changes)['values']
    if fmt == 'csv':
        text = io.StringIO()
        for row in values:
            text.write(",".join("" if not np.isfinite(v) else "{:.{}f}".format(v, CSV_DIGITS) for v in row) + "\r\n")
        return text.getvalue().encode(), 'text/csv', 'csv'
    from rasterio.io import MemoryFile
    with MemoryFile() as mem:
        with mem.open(driver='GTiff', width=values.shape[1], height=values.shape[0], count=1, dtype='float32',
                      nodata=float('nan'), compress='deflate') as dst:
            dst.write(values.astype(np.float32), 1)
            dst.update_tags(1, unit=unit_of(task, cid))
        return mem.read(), 'image/tiff', 'tif'


# Each frame's figures, for a workset's Files table: measured once in WebODM's worker after it converts (an older
# workset's the first time its Files are asked for), kept in its folder as {path: figures}

FIGURES_FILE = 'figures.json'
FIGURES_JOB_FILE = 'figures-job.json'


def figures(task, cid):
    """The figures measured of a workset's frames, {path: frame_figures}, or {} before"""
    return datasets.read_json(conversions.path(task, cid, FIGURES_FILE))


def figures_job(task, cid):
    return datasets.job(task, conversions.rel(cid, FIGURES_JOB_FILE))


def start_figures(task, cid):
    """Measures (again) a workset's frames in WebODM's worker"""
    with datasets.locked(task):
        datasets.write_json(conversions.path(task, cid, FIGURES_JOB_FILE), {'status': 'measuring'})
    datasets.start_job(task, 'frames', 'measure_all', cid, rel=conversions.rel(cid, FIGURES_JOB_FILE),
                       running='measuring')


def check_stale_figures(task, cid):
    return datasets.check_stale(task, conversions.rel(cid, FIGURES_JOB_FILE), 'measuring', 'measuring')


def frame_figures(path, settings, offset_c):
    """A frame's figures as a workset converted it (temperatures in °C, its offset subtracted): {min, max, mean,
    emissivity, reflected, ambient, humidity, distance, distance_source}, min/max/mean None without values"""
    import numpy as np
    m = converter.library().measure(path, settings, unit='C')
    values = np.asarray(m.temperature, dtype=np.float64)
    found = values[np.isfinite(values) & (values > mosaics.low_value('C'))] - (offset_c or 0.0)
    p = dict(m.params)
    stat = (lambda f: float(f(found))) if found.size else (lambda f: None)
    return {'min': stat(np.min), 'max': stat(np.max), 'mean': stat(np.mean), 'emissivity': p.get('emissivity'),
            'reflected': p.get('reflection'), 'ambient': p.get('ambient_temp'), 'humidity': p.get('humidity'),
            'distance': p.get('distance'), 'distance_source': m.distance_source or ""}


def measure_all(task_id, run_id, cid):
    """
    Measures the frames a workset converted (its task's id), while its run is still run_id; a frame dji-thermal-cli
    can't measure is left out.
    :return: what the run did, for the job's result
    """
    from app.models import Task

    task = Task.objects.filter(pk=task_id).first()
    job_rel = conversions.rel(cid, FIGURES_JOB_FILE)
    if task is None or figures_job(task, cid).get('run_id') != run_id:
        return {'canceled': True}
    try:
        settings = frame_settings(task, cid)
        harmonized = conversions.harmonized(conversions.record(task, cid).get('settings') or {})
        files = [f for f in conversions.results(task, cid).get('files') or [] if f.get('ok')]
        out, written = {}, time.time()
        for i, f in enumerate(files):
            try:
                # The results' own paths, so a workset converted before any analysis is measured too
                found = os.path.join(datasets.images_path(task), f['path'])
                out[f['path']] = frame_figures(found, settings, f.get('offset_c') if harmonized else None)
            except Exception:  # noqa: BLE001, S110 - a frame gone or unreadable has no figures
                pass
            if time.time() - written >= conversions.PROGRESS_INTERVAL:
                written = time.time()
                if not datasets.update_job(task, if_run=run_id, rel=job_rel, progress=(i + 1) / len(files)):
                    return {'canceled': True}
    except Exception as e:  # noqa: BLE001 - shown on the workset's Files
        datasets.update_job(task, if_run=run_id, rel=job_rel, status='failed', error=str(e) or type(e).__name__,
                            progress=0, run_id='', finished_at=datasets.now())
        return {'error': str(e)}
    if not datasets.finish_job(task, run_id, out, rel=job_rel, result_rel=conversions.rel(cid, FIGURES_FILE)):
        return {'canceled': True}
    return {'measured': len(out)}
