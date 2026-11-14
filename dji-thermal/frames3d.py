"""
The photos that saw a point of a task's 3D model, for the 3D Thermal Inspector's frames window (frames3d.js).

ODX keeps the cameras it refined for the task's photos (assets/odm_report/shots.geojson: each photo's centre in the
task's projection, the model's coordinates, and its rotation, OpenSfM's axis-angle from the world to the camera;
assets/cameras.json: each lens). A point of the model (x, y, z) projected with them lands on the pixel that saw it in
each photo, and the task's own photos (its one-band temperature TIFFs) read the temperature there. Measured on a flight,
the projected pixel is the right one: offsetting it by a pixel either way only agrees worse with the model.

On WebODM's map (the 2D Thermal Inspector) a point of the orthophoto is placed the same way, at the height the task's
surface model (assets/odm_dem/dsm.tif, in the cameras' coordinates) has there, and a photo is left out when the surface
comes between the point and its camera (frames_on_map). Measured on a flight: the photo closest to straight down reads
a median 0.13 °C from the orthophoto, a pixel either way agreeing worse; the photos the surface hides read a median
4.9 °C from it, the others 0.6 °C.

Which photo ODX textured a spot from isn't kept (its texturing runs without intermediate results) and can't be told
from the textures (seam levelling shifts them, and the photos of a surface agree with each other about as well), so
every photo that saw the point is answered, with its own temperature there; the browser leaves out those the model
hides the point from and ranks the rest by how squarely they faced the surface.
"""
import functools
import json
import math
import os

SHOTS_ASSET = ('odm_report', 'shots.geojson')
CAMERAS_ASSET = ('cameras.json',)
DSM_ASSET = ('odm_dem', 'dsm.tif')
# OpenSfM's projections the plugin follows: the lenses ODX gives DJI's thermal cameras ('brown') and the simplest
PROJECTIONS = ('brown', 'perspective')
# A photo's line of sight over the DSM: the surface hides the point when it stands more than SIGHT_CLEARANCE (m) above
# the line, from SIGHT_START (m, along the ground) off the point, read two samples a cell; only the DSM within
# SIGHT_REACH cells of the point is read (beyond it a line of sight is far above the surface)
SIGHT_CLEARANCE = 0.10
SIGHT_START = 0.10
SIGHT_REACH = 1024


class NoCameras(Exception):
    """The task has no cameras ODX refined, or none the plugin can project with; the message says why"""


class NoHeight(Exception):
    """The task's surface model has no height at the point"""


def asset(task, parts):
    return task.assets_path(*parts)


@functools.lru_cache(maxsize=8)
def _shots(shots_path, shots_mtime, cameras_path, cameras_mtime):
    with open(shots_path) as f:
        features = json.load(f).get('features') or []
    with open(cameras_path) as f:
        cameras = json.load(f)
    out = []
    for feature in sorted(features, key=lambda x: (x.get('properties') or {}).get('filename') or ''):
        p = feature.get('properties') or {}
        name = p.get('camera') or ''
        camera = cameras.get(name) or cameras.get(name.removeprefix('v2 '))
        if not camera or camera.get('projection_type') not in PROJECTIONS or not p.get('filename'):
            continue
        try:
            out.append({'file': os.path.basename(p['filename']), 'centre': [float(v) for v in p['translation']],
                        'rotation': rotation_matrix([float(v) for v in p['rotation']]), 'camera': camera})
        except (KeyError, TypeError, ValueError):
            continue
    return tuple(out)


def shots(task):
    """
    The task's photos as ODX placed them, sorted by file: ({file, centre [x, y, z] in the model's coordinates,
    rotation (3x3, world to camera), camera (cameras.json's lens)}, ...); a photo whose lens isn't one of PROJECTIONS
    is left out
    :raises NoCameras: no shots.geojson or cameras.json, or they can't be read
    """
    s, c = asset(task, SHOTS_ASSET), asset(task, CAMERAS_ASSET)
    try:
        return _shots(s, os.stat(s).st_mtime_ns, c, os.stat(c).st_mtime_ns)
    except (OSError, ValueError, AttributeError) as e:
        raise NoCameras("This task has no cameras ODM placed its photos with") from e


def rotation_matrix(v):
    """An axis-angle rotation (Rodrigues' vector) as a 3x3 matrix, rows of lists"""
    theta = math.sqrt(sum(x * x for x in v))
    if theta < 1e-12:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    kx, ky, kz = (x / theta for x in v)
    c, s, t = math.cos(theta), math.sin(theta), 1 - math.cos(theta)
    return [[c + kx * kx * t, kx * ky * t - kz * s, kx * kz * t + ky * s],
            [ky * kx * t + kz * s, c + ky * ky * t, ky * kz * t - kx * s],
            [kz * kx * t - ky * s, kz * ky * t + kx * s, c + kz * kz * t]]


def project(shot, point):
    """Where a point (x, y, z, the model's coordinates) is in a photo: (column, row), continuous, pixel centres at whole
    numbers, as OpenSfM projects; None when it's behind the camera"""
    r, c = shot['rotation'], shot['centre']
    d = [point[i] - c[i] for i in range(3)]
    x, y, z = (sum(r[k][i] * d[i] for i in range(3)) for k in range(3))
    if z <= 0:
        return None
    x, y = x / z, y / z
    cam = shot['camera']
    r2 = x * x + y * y
    k1, k2 = cam.get('k1', 0.0), cam.get('k2', 0.0)
    if cam.get('projection_type') == 'brown':
        k3, p1, p2 = cam.get('k3', 0.0), cam.get('p1', 0.0), cam.get('p2', 0.0)
        radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2
        xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
        yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
        u, v = cam['focal_x'] * xd + cam.get('c_x', 0.0), cam['focal_y'] * yd + cam.get('c_y', 0.0)
    else:
        radial = 1 + k1 * r2 + k2 * r2 * r2
        u, v = cam['focal'] * x * radial, cam['focal'] * y * radial
    w, h = cam['width'], cam['height']
    size = max(w, h)
    return u * size + (w - 1) / 2, v * size + (h - 1) / 2


def view_angle(shot, point, normal=None):
    """The angle (degrees) a photo saw a point at: from the surface's normal (either side) when it's given, else from
    straight down"""
    d = [shot['centre'][i] - point[i] for i in range(3)]
    length = math.sqrt(sum(x * x for x in d)) or 1.0
    if normal:
        n = math.sqrt(sum(x * x for x in normal)) or 1.0
        cos = abs(sum(d[i] * normal[i] for i in range(3))) / (length * n)
    else:
        cos = d[2] / length
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def photo_path(task, file):
    """A photo of the task, in its folder, or None when it isn't there"""
    from django.core.exceptions import SuspiciousFileOperation

    from app.security import path_traversal_check
    root = task.task_path()
    try:
        path = path_traversal_check(os.path.join(root, os.path.basename(file)), root)
    except SuspiciousFileOperation:
        return None
    return path if os.path.isfile(path) else None


@functools.lru_cache(maxsize=48)
def _photo(path, mtime_ns):
    import warnings

    import numpy as np
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    with warnings.catch_warnings():
        warnings.simplefilter('ignore', NotGeoreferencedWarning)
        with rasterio.open(path) as src:
            if src.count != 1 or not np.issubdtype(np.dtype(src.dtypes[0]), np.floating):
                return None
            values = src.read(1).astype(np.float32)
            if src.nodata is not None:
                values[values == src.nodata] = np.nan
    values[~np.isfinite(values)] = np.nan
    values.flags.writeable = False
    return values


def photo_values(path):
    """A photo's temperatures (°C, float32, read only), NaN where it has none; None when it isn't a one-band float
    TIFF (not a temperature photo)"""
    from rasterio.errors import RasterioError
    try:
        return _photo(path, os.stat(path).st_mtime_ns)
    except (OSError, RasterioError):       # gone, or a file rasterio can't read: not a photo of temperatures
        return None


def frames_at(task, point, normal=None):
    """
    The photos that saw a point (x, y, z, the model's coordinates): [{index (of shots), file, x, y (its pixel there,
    continuous, pixel centres at whole numbers), width, height, camera ([x, y, z]: where the photo was taken from),
    view_angle (from the surface's normal when it's given, else from straight down), distance (m), temperature (°C at
    its nearest pixel, or None), available (its file is on the server)}], most squarely first, then nearest. A photo
    that isn't of temperatures is left out.
    :raises NoCameras: as shots
    """
    import numpy as np
    out = []
    for i, shot in enumerate(shots(task)):
        at = project(shot, point)
        if at is None:
            continue
        cam = shot['camera']
        w, h = cam['width'], cam['height']
        col, row = math.floor(at[0] + 0.5), math.floor(at[1] + 0.5)
        if not (0 <= col < w and 0 <= row < h):
            continue
        path = photo_path(task, shot['file'])
        values = photo_values(path) if path else None
        if path and values is None:
            continue            # not a temperature photo (another camera's)
        temperature = None
        if values is not None and values.shape == (h, w):
            v = float(values[row, col])
            temperature = v if np.isfinite(v) else None
        c = shot['centre']
        out.append({'index': i, 'file': shot['file'], 'x': at[0], 'y': at[1], 'width': w, 'height': h, 'camera': list(c),
                    'view_angle': view_angle(shot, point, normal),
                    'distance': math.sqrt(sum((c[k] - point[k]) ** 2 for k in range(3))),
                    'temperature': temperature, 'available': path is not None})
    return sorted(out, key=lambda f: (round(f['view_angle'], 6), f['distance']))


def on_map(task):
    """Whether the photos that saw a point of the task's map can be told (frames_on_map): it has the cameras ODX
    refined, a surface model, and its photos still (WebODM's Compact removes them: nothing to show then)"""
    if not all(os.path.isfile(asset(task, a)) for a in (SHOTS_ASSET, CAMERAS_ASSET, DSM_ASSET)):
        return False
    try:
        return any(photo_path(task, s['file']) for s in shots(task))
    except NoCameras:
        return False


def sight_blocked(heights, origin, inverse, point, camera):
    """
    Whether the surface comes between a point on it and a camera (both [x, y, z]). heights: a window of the DSM (NaN
    where it has none), origin: the window's first (column, row), inverse: the DSM's transform from coordinates to
    columns and rows
    """
    import numpy as np
    (pc, pr), (cc, cr) = inverse * (point[0], point[1]), inverse * (camera[0], camera[1])
    cells, along = math.hypot(cc - pc, cr - pr), math.hypot(camera[0] - point[0], camera[1] - point[1])
    if cells < 1 or along <= SIGHT_START:
        return False                # straight above: nothing between
    reach = min(1.0, SIGHT_REACH * 1.5 / cells)      # the part of the line over the window
    n = int(cells * reach * 2) + 1
    t = np.arange(1, n + 1) / n * reach
    t = t[t * along >= SIGHT_START]
    cols = np.floor(pc + t * (cc - pc)).astype(np.int64) - origin[0]
    rows = np.floor(pr + t * (cr - pr)).astype(np.int64) - origin[1]
    inside = (rows >= 0) & (rows < heights.shape[0]) & (cols >= 0) & (cols < heights.shape[1])
    if not inside.any():
        return False
    line = point[2] + t[inside] * (camera[2] - point[2])
    with np.errstate(invalid='ignore'):     # NaN: no surface there
        return bool(np.any(heights[rows[inside], cols[inside]] - line > SIGHT_CLEARANCE))


def frames_on_map(task, lon, lat):
    """
    The photos that saw a point of the task's map (lon, lat), at the height its surface model has there: {point ([x, y,
    z], the cameras' coordinates), frames (frames_at's, from straight down, each with lonlat: where its photo was taken
    from, [lon, lat]), hidden (how many more had the point in view, the surface between them and it)}
    :raises NoCameras: as shots, or the task has no surface model; NoHeight: it has no height there
    """
    import numpy as np
    import rasterio
    from rasterio.errors import RasterioError
    from rasterio.warp import transform
    from rasterio.windows import Window

    path = asset(task, DSM_ASSET)
    try:
        with rasterio.open(path) as src:
            xs, ys = transform('EPSG:4326', src.crs, [lon], [lat])
            inverse, crs = ~src.transform, src.crs
            col, row = (math.floor(v) for v in inverse * (xs[0], ys[0]))
            if not (0 <= row < src.height and 0 <= col < src.width):
                raise NoHeight()
            origin = max(0, col - SIGHT_REACH), max(0, row - SIGHT_REACH)
            window = Window(origin[0], origin[1], min(src.width, col + SIGHT_REACH + 1) - origin[0],
                            min(src.height, row + SIGHT_REACH + 1) - origin[1])
            heights = src.read(1, window=window).astype(np.float32)
            if src.nodata is not None:
                heights[heights == src.nodata] = np.nan
    except (OSError, RasterioError) as e:
        raise NoCameras("This task has no surface model (DSM) to place the point with") from e
    heights[~np.isfinite(heights)] = np.nan
    z = float(heights[row - origin[1], col - origin[0]])
    if not math.isfinite(z):
        raise NoHeight()
    point = [xs[0], ys[0], z]
    seen, hidden = [], 0
    for f in frames_at(task, point):
        if sight_blocked(heights, origin, inverse, point, f['camera']):
            hidden += 1
        else:
            seen.append(f)
    if seen:
        lons, lats = transform(crs, 'EPSG:4326', [f['camera'][0] for f in seen], [f['camera'][1] for f in seen])
        for f, a, b in zip(seen, lons, lats):
            f['lonlat'] = [a, b]
    return {'point': point, 'frames': seen, 'hidden': hidden}


def frame_values(task, index):
    """
    One photo's temperatures as a value tile for the browser (colouring.value_png): (PNG bytes, offset, step), rows from
    the top
    :raises NoCameras: as shots; LookupError: no such photo, or its file is gone or not of temperatures
    """
    from . import colouring
    found = shots(task)
    if not 0 <= index < len(found):
        raise LookupError("No such photo")
    path = photo_path(task, found[index]['file'])
    values = photo_values(path) if path else None
    if values is None:
        raise LookupError("The photo isn't on the server" if path is None else "The photo holds no temperatures")
    return colouring.value_png(values.astype('float64'))


def version(task, index):
    """What a photo's values depend on (its file, the cameras), for its ETag"""
    parts = []
    for p in (asset(task, SHOTS_ASSET), asset(task, CAMERAS_ASSET)):
        try:
            st = os.stat(p)
            parts.append((st.st_size, st.st_mtime_ns))
        except OSError:
            parts.append(None)
    try:
        path = photo_path(task, shots(task)[index]['file'])
        st = os.stat(path) if path else None
        parts.append((st.st_size, st.st_mtime_ns) if st else None)
    except (NoCameras, IndexError, OSError):
        parts.append(None)
    return parts


def workset_frames(task, user):
    """
    Where the task's photos came from, when it was processed from a workset's TIFFs: {dataset, workset, frames: {photo
    file: the frame's path in the dataset}}, for the Analyzer's frame page; None otherwise (or the dataset can't be
    viewed)
    """
    from . import conversion_tasks, conversions, datasets
    for d in datasets.visible(user, task.project):
        for cid in conversions.ids(d):
            if str(task.id) not in conversion_tasks.holding(d, cid):
                continue
            names = dict(conversion_tasks.frames(d, cid))       # path in the output folder: name in the task
            frames = {}
            for f in conversions.results(d, cid).get('files') or []:
                for o in f.get('outputs') or []:
                    if o in names and f.get('path'):
                        frames[names[o]] = f['path']
            return {'dataset': str(d.id), 'workset': cid, 'frames': frames}
    return None
