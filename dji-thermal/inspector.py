"""
The Thermal Inspector's reads of a task's thermal orthophoto, for the control on WebODM's 2D map: the temperature at a
point and the statistics of a region, in degrees Celsius (the orthophoto's first band, as WebODM's Celsius formula
reads it). Pixels outside the task's crop are left out, as WebODM's map draws them.
"""
import json
import math

THERMAL_BAND = 'lwir'
REGION_MAX_SIZE = 4096        # pixels along the longer side; a larger region is read downsampled
PERCENTILES = (2, 98)
HISTOGRAM_BINS = 64
MAX_HISTOGRAM_BINS = 255


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


def region(task, geometry, percentiles=PERCENTILES, bins=HISTOGRAM_BINS):
    """
    The statistics of the temperatures inside a polygon (GeoJSON geometry, lon/lat), within the task's crop: {valid,
    reason, statistics: {count, min, max, mean, std, median, percentiles, histogram, min_location, max_location},
    pixel_size (m), resampled}. Pixels the outline touches are included; read at the orthophoto's resolution up to
    REGION_MAX_SIZE pixels a side.
    :raises ValueError: not a polygon
    """
    import numpy as np
    import rasterio
    from django.contrib.gis.geos import GEOSGeometry
    from rasterio.features import geometry_mask
    from rasterio.warp import transform, transform_geom
    from rasterio.errors import WindowError
    from rasterio.windows import Window, from_bounds, intersection

    shape = GEOSGeometry(json.dumps(geometry), srid=4326)
    if shape.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError("Not a polygon")
    if not shape.valid:
        shape = shape.buffer(0)
    crop = _crop(task)
    if crop is not None:
        shape = shape.intersection(crop)
    out = {'valid': False, 'reason': None, 'statistics': None, 'pixel_size': None, 'resampled': False}
    polygons = _polygons(shape)
    if not polygons:
        out['reason'] = 'excluded'
        return out

    with rasterio.open(thermal_orthophoto(task)) as src:
        west, south, east, north = _lonlat_bounds(src)
        lons = [c[0] for polygon in polygons['coordinates'] for ring in polygon for c in ring]
        lats = [c[1] for polygon in polygons['coordinates'] for ring in polygon for c in ring]
        if max(lons) < west or min(lons) > east or max(lats) < south or min(lats) > north:
            out['reason'] = 'outside_raster'
            return out
        local = transform_geom('EPSG:4326', src.crs, polygons)
        coords = np.array([c for polygon in local['coordinates'] for ring in polygon for c in ring])
        # Every pixel the polygon reaches into
        bounds = from_bounds(coords[:, 0].min(), coords[:, 1].min(), coords[:, 0].max(), coords[:, 1].max(),
                             src.transform)
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
        valid = _valid(src, window, shape_out)
        wt = src.window_transform(window) * rasterio.Affine.scale(window.width / shape_out[1],
                                                                  window.height / shape_out[0])
        inside = geometry_mask([local], out_shape=shape_out, transform=wt, invert=True, all_touched=True)
        crs = src.crs
        out['pixel_size'] = abs(wt.a) * (crs.linear_units_factor[1] if crs.is_projected else 1.0)
        out['resampled'] = scale > 1.0

    keep = inside & valid & np.isfinite(data)
    values = data[keep]
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
    out['valid'] = True
    out['statistics'] = {
        'count': int(values.size), 'min': float(values.min()), 'max': float(values.max()),
        'mean': float(values.mean()), 'std': float(values.std()), 'median': float(np.median(values)),
        'percentiles': {'{:g}'.format(p): float(np.percentile(values, p)) for p in percentiles},
        'histogram': {'counts': counts.tolist(), 'edges': edges.tolist()},
        'min_location': location(int(np.nanargmin(masked))), 'max_location': location(int(np.nanargmax(masked))),
    }
    return out


def tile(task, z, x, y, lut, low, high, size=256, crop=False):
    """
    A tile of the thermal orthophoto as WebODM's map draws it (its first band, bilinear, over low..high °C, within the
    task's crop when crop), in a colour table (256 RGB colours), as PNG bytes; None outside the orthophoto. Where it
    has no data comes from its alpha band.
    """
    data = _tile_data(task, z, x, y, size, crop)
    if data is None:
        return None
    cmap = {i: (int(c[0]), int(c[1]), int(c[2]), 255) for i, c in enumerate(lut)}
    return data.post_process(in_range=((low, high),)).render(img_format='PNG', colormap=cmap)


def isotherm(task, z, x, y, low, high, rgb, size=256, crop=False):
    """
    A tile over the thermal orthophoto's (as tile reads it) painting in rgb the temperatures at or above low and at or
    below high (°C; either may be None), transparent elsewhere, as PNG bytes; None outside the orthophoto
    """
    import io

    import numpy as np
    from PIL import Image

    data = _tile_data(task, z, x, y, size, crop)
    if data is None:
        return None
    values = data.data[0].astype(np.float64)
    inside = (data.mask > 0) & np.isfinite(values)
    if low is not None:
        inside &= values >= low
    if high is not None:
        inside &= values <= high
    out = np.zeros(values.shape + (4,), dtype=np.uint8)
    out[inside] = tuple(rgb) + (255,)
    buf = io.BytesIO()
    Image.fromarray(out, 'RGBA').save(buf, 'PNG')
    return buf.getvalue()


def _tile_data(task, z, x, y, size, crop):
    """A tile of the thermal orthophoto's first band as WebODM's map reads it (rio-tiler's ImageData), None outside it"""
    from rio_tiler.errors import TileOutsideBounds
    from rio_tiler.io import COGReader

    from app.api.tiler import get_zoom_safe
    from app.geoutils import geom_transform_wkt_bbox
    from app.raster_utils import ZOOM_EXTRA_LEVELS

    if size == 512:     # as WebODM's map asks for them: a tile of the zoom level above
        z -= 1
    with COGReader(thermal_orthophoto(task)) as src:
        if not src.tile_exists(z, x, y):
            return None
        minzoom, maxzoom = get_zoom_safe(src)
        if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
            return None
        vrt_options = None
        if crop and _crop(task) is not None:
            cutline, _bounds = geom_transform_wkt_bbox(task.crop, src.dataset)
            vrt_options = {'cutline': cutline}
        try:
            return src.tile(x, y, z, indexes=(1,), tilesize=size, resampling_method="bilinear", vrt_options=vrt_options)
        except TileOutsideBounds:
            return None


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
