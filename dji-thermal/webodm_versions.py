"""
What differs between the WebODM versions the plugin runs on, kept in one place: 3.3.2 (Python 3.9, Django 2.2,
PostGIS, rio-tiler installed) and 4.0.0 (Python 3.14, Django 5.2, no GIS: a task's crop is GeoJSON, rio-tiler is
WebODM's own trimmed copy, and its tiler has fewer colour maps).
"""
import json
import os
from functools import cache
from types import SimpleNamespace

COLORMAPS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'colormaps.json')


def tiler():
    """rio-tiler as WebODM reads its own rasters: its copy in app.vendor (4.0.0), else the installed package (3.3.2).
    A namespace of COGReader, TileOutsideBounds and render."""
    try:
        from app.vendor.rio_tiler import errors, utils
        from app.vendor.rio_tiler.io import COGReader
    except ImportError:
        from rio_tiler import errors, utils
        from rio_tiler.io import COGReader
    return SimpleNamespace(COGReader=COGReader, TileOutsideBounds=errors.TileOutsideBounds, render=utils.render)


def task_crop(task):
    """
    The task's crop as a shape (shapes.Shape, lon/lat), or None: a GeoJSON polygon in 4.0.0, a GEOS one in 3.3.2 (read
    from its WKT: GEOS's GeoJSON goes through GDAL, which swaps the axes of EPSG:4326 with GDAL 3)
    """
    crop = task.crop
    if crop is None:
        return None
    from . import shapes
    crop = shapes.shape(crop) if isinstance(crop, dict) else shapes.from_wkt(crop.wkt)
    return None if crop.is_empty else crop


def cutline(crop, dataset):
    """
    A crop's (a shapes.Shape polygon, lon/lat) outer ring in a raster's pixels as WKT, the cutline WebODM's tiles are read
    with: as app.geoutils.geom_transform_wkt_bbox makes it, which takes a GEOS geometry in 3.3.2 and GeoJSON in 4.0.0
    :raises ValueError: not a polygon
    """
    import numpy as np
    from rasterio.warp import transform

    if crop.geom_type != 'Polygon':
        raise ValueError("Cannot transform complex geometries to WKT")
    xs, ys = zip(*crop.exterior.coords)
    tx, ty = transform('EPSG:4326', dataset.crs, xs, ys)
    pixels = [dataset.index(x, y, op=np.round) for x, y in zip(tx, ty)]
    return "POLYGON (({}))".format(", ".join("{} {}".format(col, row) for row, col in pixels))


@cache
def _own_colormaps():
    with open(COLORMAPS_FILE) as f:
        return {name: tuple(int(c, 16) for c in colours) for name, colours in json.load(f)['colormaps'].items()}


def colormap_encoded(name):
    """
    A WebODM colour map's colours as its tiler gives them (0xRRGGBBAA integers): hot, rainbow and gray_r from the
    plugin's copy (colormaps.json: WebODM 4.0.0's tiler no longer has them), with the plugin's own bwr, the others from
    WebODM's tiler
    :raises Exception: a name it doesn't have (rio-tiler's InvalidColorMapName)
    """
    own = _own_colormaps().get(name)
    if own is not None:
        return list(own)
    from app.api.tiler import get_colormap_encoded_values
    return get_colormap_encoded_values(name)


def tiler_lacks(names):
    """Of names (WebODM's colour maps), those WebODM's own tiler doesn't have (4.0.0's: hot, rainbow, gray_r), in
    order: the Thermal Inspector draws a thermal orthophoto in those with the plugin's tiles"""
    return [name for name in names if not _tiler_has(name)]


@cache
def _tiler_has(name):
    from app.api.tiler import get_colormap_encoded_values
    try:
        get_colormap_encoded_values(name)
    except Exception:  # noqa: BLE001 - rio-tiler refuses a name it doesn't have
        return False
    return True


def colormap(name):
    """A WebODM colour map as rio-tiler's colormap.get gives it: {index: (r, g, b, a)} (colormap_encoded's)"""
    return {i: ((c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255) for i, c in enumerate(colormap_encoded(name))}
