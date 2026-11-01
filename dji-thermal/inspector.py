"""
The Thermal Inspector's reads of a task's thermal orthophoto, for the control on WebODM's 2D map: the temperature at a
point and the statistics of a region or a line (with its profile), in degrees Celsius (the orthophoto's first band, as WebODM's Celsius formula
reads it). Pixels outside the task's crop are left out, as WebODM's map draws them. The regions and isotherms of a
workset's mosaics laid on the map read them alike (raster_region, raster_isotherm), in °C from the mosaic's unit.
"""
import json
import math

from . import correction as correcting

THERMAL_BAND = 'lwir'
REGION_MAX_SIZE = 4096        # pixels along the longer side; a larger region is read downsampled
PERCENTILES = (2, 98)
HISTOGRAM_BINS = 64
MAX_HISTOGRAM_BINS = 255
HISTOGRAM_FILE = 'histogram.json'     # the orthophoto's histogram, in the task's thermal folder, for the equalization
# dji-thermal-cli's no-data marker: absolute zero, in each unit (a mosaic's pixels at or below it hold none)
ABSOLUTE_ZERO = {'C': -273.15, 'F': -459.67, 'K': 0.0}
# As dji-thermal-ui measures: a line's strip either side of it, a region's surroundings (m), a profile's samples
LINE_HALF_WIDTH = 0.25
RING_MIN = 1.0
RING_MAX = 3.0
MAX_SAMPLES = 1000
DEGREE_M = 111320.0           # metres per degree, about, for a raster in lon/lat


def thermal_orthophoto(task):
    """The path of the task's orthophoto when it holds temperatures (a single lwir band, as WebODM's map tells), else
    None"""
    bands = task.orthophoto_bands or []
    first = bands[0] if bands and isinstance(bands[0], dict) else {}
    if str(first.get('description') or '').lower() != THERMAL_BAND or 'orthophoto.tif' not in (task.available_assets or []):
        return None
    return task.get_asset_download_path('orthophoto.tif')


def _crop(task):
    return task.crop if task.crop is not None and not task.crop.empty else None


def to_celsius(values, unit):
    """Temperatures in unit (C, F or K) in °C"""
    if unit == 'F':
        return (values - 32.0) / 1.8
    if unit == 'K':
        return values - 273.15
    return values


def _measured(values, unit):
    """Where values (in unit) are temperatures, not dji-thermal-cli's no-data marker"""
    import numpy as np
    return np.isfinite(values) & (values > ABSOLUTE_ZERO.get(unit, ABSOLUTE_ZERO['C']) + 1)


def point(task, lon, lat):
    """The temperature at a point (lon/lat): {coordinates, valid, temperature, reason}, reason 'excluded' (outside the
    crop), 'outside_raster' or 'nodata' when there is none"""
    import rasterio
    from django.contrib.gis.geos import Point
    from rasterio.warp import transform
    from rasterio.windows import Window

    out = {'coordinates': [lon, lat], 'valid': False, 'temperature': None, 'reason': None}
    crop = _crop(task)
    if crop is not None and not crop.contains(Point(lon, lat, srid=4326)):
        out['reason'] = 'excluded'
        return out
    with rasterio.open(thermal_orthophoto(task)) as src:
        # Checked first: far from the orthophoto, a point is outside its projection's domain too
        west, south, east, north = _lonlat_bounds(src)
        if not (west <= lon <= east and south <= lat <= north):
            out['reason'] = 'outside_raster'
            return out
        xs, ys = transform('EPSG:4326', src.crs, [lon], [lat])
        row, col = src.index(xs[0], ys[0])
        if not (0 <= row < src.height and 0 <= col < src.width):
            out['reason'] = 'outside_raster'
            return out
        window = Window(col, row, 1, 1)
        value = float(src.read(1, window=window)[0, 0])
        valid = bool(_valid(src, window)[0, 0]) and math.isfinite(value)
    if not valid:
        out['reason'] = 'nodata'
        return out
    out.update(valid=True, temperature=value)
    return out


def region(task, geometry, percentiles=PERCENTILES, bins=HISTOGRAM_BINS, isotherm=None, correction=None):
    """
    The statistics of the temperatures inside a polygon or along a line (GeoJSON geometry, lon/lat), within the task's
    crop: {valid, reason, statistics: {count, min, max, mean, std, median, percentiles, histogram, min_location,
    max_location, surroundings, delta_t[, isotherm_share]}, pixel_size (m), resampled, correction[, length,
    profile]}. Pixels the
    outline touches are included; read at the orthophoto's resolution up to REGION_MAX_SIZE pixels a side.
    :raises ValueError: not a polygon or a line
    """
    return raster_region(thermal_orthophoto(task), geometry, _crop(task), percentiles=percentiles, bins=bins,
                         isotherm=isotherm, correction=correction)


def raster_region(raster, geometry, crop=None, unit=None, percentiles=PERCENTILES, bins=HISTOGRAM_BINS, isotherm=None,
                  frames=None, correction=None):
    """
    region of a raster's first band, within crop (a GEOS geometry) when given; with unit (a mosaic's), its no-data
    marker left out and the statistics in °C. A line measures a strip LINE_HALF_WIDTH either side of it, and adds its
    length (m) and profile: {distance (m), values (°C, None where there is none), points ([lon, lat])}, with frames
    ((raster, band, names): a mosaic's source frame band) the name of the frame each sample came from. The surroundings
    are the mean of a ring around a polygon (from its outline out to its size, RING_MIN to RING_MAX m) or of a band
    RING_MIN m beside a line's strip, and delta_t the mean's difference with them; isotherm ((low, high), °C, either
    None) adds the share of the pixels in it. With correction ((wanted, baseline): see correction.py) the temperatures
    are corrected before anything is found of them (the isotherm's limits are corrected temperatures too).
    :raises ValueError: not a polygon or a line
    """
    import numpy as np
    import rasterio
    from django.contrib.gis.geos import GEOSGeometry
    from rasterio.features import geometry_mask
    from rasterio.warp import transform, transform_geom
    from rasterio.errors import WindowError
    from rasterio.windows import Window, from_bounds, intersection

    shape = GEOSGeometry(json.dumps(geometry), srid=4326)
    if shape.geom_type not in ('Polygon', 'MultiPolygon', 'LineString'):
        raise ValueError("Not a polygon or a line")
    line = shape.geom_type == 'LineString'
    if line and (len(shape.coords) < 2 or shape.length == 0):
        raise ValueError("A line needs two points")
    if not line and not shape.valid:
        shape = shape.buffer(0)
    out = {'valid': False, 'reason': None, 'statistics': None, 'pixel_size': None, 'resampled': False,
           'correction': correcting.described(*correction) if correction else None}
    if line:
        measured = {'type': 'LineString', 'coordinates': [list(c) for c in shape.coords]}
        if crop is not None and not shape.intersects(crop):
            out['reason'] = 'excluded'
            return out
    else:
        measured = _polygons(shape.intersection(crop) if crop is not None else shape)
        if not measured:
            out['reason'] = 'excluded'
            return out

    with rasterio.open(raster) as src:
        west, south, east, north = _lonlat_bounds(src)
        lons, lats = zip(*_coordinates(measured))
        if max(lons) < west or min(lons) > east or max(lats) < south or min(lats) > north:
            out['reason'] = 'outside_raster'
            return out
        crs = src.crs
        metre = crs.linear_units_factor[1] if crs.is_projected else DEGREE_M      # metres per unit of the raster's CRS
        local = GEOSGeometry(json.dumps(transform_geom('EPSG:4326', crs, measured)))
        inside = local.buffer(LINE_HALF_WIDTH / metre) if line else local
        width = RING_MIN if line else min(RING_MAX, max(RING_MIN, math.sqrt(inside.area) * metre))
        ring = inside.buffer(width / metre).difference(inside)
        # Every pixel the region and its surroundings reach into
        xmin, ymin, xmax, ymax = (ring if not ring.empty else inside).extent
        bounds = from_bounds(xmin, ymin, xmax, ymax, src.transform)
        col0, row0 = math.floor(bounds.col_off), math.floor(bounds.row_off)
        window = Window(col0, row0, math.ceil(bounds.col_off + bounds.width) - col0 + 1,
                        math.ceil(bounds.row_off + bounds.height) - row0 + 1)
        try:
            window = intersection(window, Window(0, 0, src.width, src.height))
        except WindowError:
            window = None
        if window is None or window.width < 1 or window.height < 1:
            out['reason'] = 'outside_raster'
            return out
        scale = max(1.0, max(window.width, window.height) / REGION_MAX_SIZE)
        shape_out = (max(1, int(window.height / scale)), max(1, int(window.width / scale)))
        data = src.read(1, window=window, out_shape=shape_out).astype(np.float64)
        usable = _valid(src, window, shape_out) & np.isfinite(data)
        wt = src.window_transform(window) * rasterio.Affine.scale(window.width / shape_out[1],
                                                                  window.height / shape_out[0])

        def mask(g):
            polygons = _polygons(g)
            if not polygons:
                return np.zeros(shape_out, dtype=bool)
            return geometry_mask([polygons], out_shape=shape_out, transform=wt, invert=True, all_touched=True)

        if crop is not None:
            usable &= mask(GEOSGeometry(json.dumps(transform_geom('EPSG:4326', crs, _polygons(crop)))))
        within = mask(inside)
        around = mask(ring) & ~within
        out['pixel_size'] = abs(wt.a) * metre
        out['resampled'] = scale > 1.0

    if unit is not None:
        usable &= _measured(data, unit)
        data = to_celsius(data, unit)
    if correction:
        data = correcting.apply(data, *correction)
    keep = within & usable
    values = data[keep]
    if line:
        out['length'] = local.length * metre
    if values.size == 0:
        out['reason'] = 'nodata'
        return out

    def location(flat_index):
        r, c = np.unravel_index(flat_index, data.shape)
        x, y = wt * (c + 0.5, r + 0.5)
        lons, lats = transform(crs, 'EPSG:4326', [x], [y])
        return [lons[0], lats[0]]

    masked = np.where(keep, data, np.nan)
    counts, edges = np.histogram(values, bins=bins)
    mean = float(values.mean())
    ring_values = data[around & usable]
    surroundings = float(ring_values.mean()) if ring_values.size else None
    out['valid'] = True
    out['statistics'] = {
        'count': int(values.size), 'min': float(values.min()), 'max': float(values.max()),
        'mean': mean, 'std': float(values.std()), 'median': float(np.median(values)),
        'percentiles': {'{:g}'.format(p): float(np.percentile(values, p)) for p in percentiles},
        'histogram': {'counts': counts.tolist(), 'edges': edges.tolist()},
        'min_location': location(int(np.nanargmin(masked))), 'max_location': location(int(np.nanargmax(masked))),
        'surroundings': surroundings, 'delta_t': mean - surroundings if surroundings is not None else None,
    }
    if isotherm is not None:
        low, high = isotherm
        within_isotherm = np.ones(values.shape, dtype=bool)
        if low is not None:
            within_isotherm &= values >= low
        if high is not None:
            within_isotherm &= values <= high
        out['statistics']['isotherm_share'] = float(within_isotherm.mean())
    if line:
        out['profile'] = _profile(local, data, usable, wt, crs, metre, frames)
    return out


def _profile(line, data, usable, wt, crs, metre, frames=None):
    """A line's (GEOS, in the raster's CRS) temperatures every pixel along it, at most MAX_SAMPLES of them, from the
    grid read (data where usable, its transform wt); frames as raster_region's"""
    import numpy as np
    import rasterio
    from rasterio.warp import transform

    coords = np.asarray(line.coords, dtype=np.float64)
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(coords[:, :2], axis=0).T))])
    n = max(2, min(MAX_SAMPLES, math.floor(along[-1] / abs(wt.a)) + 1))
    distances = np.linspace(0.0, along[-1], n)
    xs, ys = np.interp(distances, along, coords[:, 0]), np.interp(distances, along, coords[:, 1])
    cols, rows = ~wt * (xs, ys)
    cols, rows = np.floor(cols).astype(np.int64), np.floor(rows).astype(np.int64)
    found = (rows >= 0) & (rows < data.shape[0]) & (cols >= 0) & (cols < data.shape[1])
    found[found] = usable[rows[found], cols[found]]
    values = [float(data[r, c]) if ok else None for r, c, ok in zip(rows, cols, found)]
    lons, lats = transform(crs, 'EPSG:4326', xs.tolist(), ys.tolist())
    out = {'distance': (distances * metre).tolist(), 'values': values,
           'points': [[float(a), float(b)] for a, b in zip(lons, lats)]}
    if frames is not None:
        path, band, names = frames
        with rasterio.open(path) as ds:
            sampled = [v[0] for v in ds.sample(zip(xs, ys), indexes=band)]
        out['frames'] = []
        for value, ok in zip(sampled, found):
            i = round(float(value)) if ok and np.isfinite(value) else -1
            out['frames'].append(names[i] if 0 <= i < len(names) else None)
    return out


def tile(task, z, x, y, colors, low, high, size=256, crop=False, adjust=None):
    """
    A tile of the thermal orthophoto as WebODM's map draws it (its first band, bilinear, over low..high °C, within the
    task's crop when crop), in a palette (encoded colours: colouring's), drawn with the adjustments as a workset's
    mosaics are (colouring.parse_adjust's; equalized from the whole orthophoto's histogram), as PNG bytes; None outside
    the orthophoto. Where it has no data comes from its alpha band.
    """
    import numpy as np

    from . import colouring, mosaics
    adjust = adjust or mosaics.NO_ADJUST
    curve = None
    if adjust['equalize']:
        curve = colouring.equalization(histogram(task), low, high)
    shares = colouring.curve_shares(low, high, adjust, curve) if adjust['equalize'] or adjust['gamma'] != 1.0 else None
    margin = colouring.MARGIN if adjust['sharpen'] > 0 else 0
    found = _raster_tile(thermal_orthophoto(task), z, x, y, size, _crop(task) if crop else None, buffer=margin,
                         pixel=True)
    if found is None:
        return None
    data, pixel = found
    values = np.asarray(data.data[0], dtype=np.float64)
    values[~(data.mask > 0)] = np.nan
    read_z = z - 1 if size == 512 else z
    drawn = mosaics.tile_pixel_m(read_z, y) * mosaics.TILE_SIZE / size
    rgba = colouring.colour(values, colors, (low, high), shares, adjust['sharpen'],
                            sigma=colouring.sharpen_sigma(pixel, drawn), margin=margin)
    return mosaics.png(rgba)


def histogram(task):
    """The thermal orthophoto's histogram (colouring.value_histogram), for the equalization: read once, at most
    REGION_MAX_SIZE pixels a side, and kept in the task's thermal folder"""
    from . import colouring, datasets
    return colouring.kept_histogram(thermal_orthophoto(task), _overview_values, datasets.data_path(task, HISTOGRAM_FILE))


def _overview_values(raster):
    """A raster's first band, NaN where it has no data, read at most REGION_MAX_SIZE pixels a side"""
    import numpy as np
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(raster) as src:
        scale = max(1.0, max(src.width, src.height) / REGION_MAX_SIZE)
        shape = (max(1, int(src.height / scale)), max(1, int(src.width / scale)))
        window = Window(0, 0, src.width, src.height)
        values = src.read(1, out_shape=shape).astype(np.float64)
        values[~_valid(src, window, shape)] = np.nan
    return values


def isotherm(task, z, x, y, low, high, rgb, size=256, crop=False):
    """
    A tile over the thermal orthophoto's (as tile reads it) painting in rgb the temperatures at or above low and at or
    below high (°C; either may be None), transparent elsewhere, as PNG bytes; None outside the orthophoto
    """
    return raster_isotherm(thermal_orthophoto(task), z, x, y, low, high, rgb, size, _crop(task) if crop else None)


def raster_isotherm(raster, z, x, y, low, high, rgb, size=256, crop=None, unit=None):
    """isotherm of a raster's first band, within crop (a GEOS geometry) when given; with unit (a mosaic's), low and
    high are still °C, its no-data marker is left out and it is read as its own tiles are (nearest pixel)"""
    import io

    import numpy as np
    from PIL import Image

    data = _raster_tile(raster, z, x, y, size, crop, 'bilinear' if unit is None else 'nearest')
    if data is None:
        return None
    values = data.data[0].astype(np.float64)
    inside = (data.mask > 0) & np.isfinite(values)
    if unit is not None:
        inside &= _measured(values, unit)
        values = to_celsius(values, unit)
    if low is not None:
        inside &= values >= low
    if high is not None:
        inside &= values <= high
    out = np.zeros(values.shape + (4,), dtype=np.uint8)
    out[inside] = tuple(rgb) + (255,)
    buf = io.BytesIO()
    Image.fromarray(out, 'RGBA').save(buf, 'PNG')
    return buf.getvalue()


def _raster_tile(raster, z, x, y, size, crop=None, resampling='bilinear', buffer=0, pixel=False):
    """A tile of a raster's first band as WebODM's map reads the thermal orthophoto (rio-tiler's ImageData), within crop
    (a GEOS geometry) when given, with buffer more pixels on each side; with pixel, (it, the raster's pixel width in
    metres); None outside it"""
    from rio_tiler.errors import TileOutsideBounds
    from rio_tiler.io import COGReader

    from app.api.tiler import get_zoom_safe
    from app.geoutils import geom_transform_wkt_bbox
    from app.raster_utils import ZOOM_EXTRA_LEVELS

    if size == 512:     # as WebODM's map asks for them: a tile of the zoom level above
        z -= 1
    with COGReader(raster) as src:
        if not src.tile_exists(z, x, y):
            return None
        minzoom, maxzoom = get_zoom_safe(src)
        if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
            return None
        vrt_options = None
        if crop is not None:
            cutline, _bounds = geom_transform_wkt_bbox(crop, src.dataset)
            vrt_options = {'cutline': cutline}
        try:
            data = src.tile(x, y, z, indexes=(1,), tilesize=size, resampling_method=resampling, vrt_options=vrt_options,
                            tile_buffer=buffer or None)
        except TileOutsideBounds:
            return None
        if not pixel:
            return data
        crs = src.dataset.crs
        metre = crs.linear_units_factor[1] if crs.is_projected else DEGREE_M
        return data, abs(src.dataset.res[0]) * metre


def _valid(src, window, out_shape=None):
    """Where the orthophoto has data in a window: its alpha band (as WebODM writes it), else GDAL's mask"""
    from rasterio.enums import ColorInterp
    kwargs = {'window': window} if out_shape is None else {'window': window, 'out_shape': out_shape}
    if ColorInterp.alpha in src.colorinterp:
        return src.read(src.colorinterp.index(ColorInterp.alpha) + 1, **kwargs) > 0
    return src.read_masks(1, **kwargs) > 0


def _lonlat_bounds(src):
    from rasterio.warp import transform_bounds
    return transform_bounds(src.crs, 'EPSG:4326', *src.bounds)


def _coordinates(geometry):
    """A GeoJSON LineString's or MultiPolygon's positions"""
    if geometry['type'] == 'LineString':
        return geometry['coordinates']
    return [c for polygon in geometry['coordinates'] for ring in polygon for c in ring]


def _polygons(geometry):
    """
    The polygonal parts of a GEOS geometry as a GeoJSON MultiPolygon (lon/lat), or None when it has none (an
    intersection along an edge). Built from the coordinates: GEOS's own GeoJSON goes through GDAL, which swaps the axes
    of EPSG:4326 with GDAL 3.
    """
    found = []

    def collect(g):
        if g.geom_type == 'Polygon':
            if not g.empty and g.area > 0:
                found.append([[list(c) for c in ring] for ring in g.coords])
        elif g.geom_type in ('MultiPolygon', 'GeometryCollection'):
            for part in g:
                collect(part)

    collect(geometry)
    return {'type': 'MultiPolygon', 'coordinates': found} if found else None
