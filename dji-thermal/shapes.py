"""
The shapes the plugin measures (the Thermal Inspector's regions and lines, a task's crop, the frame page's figures):
GDAL's OGR geometries, with GEOS underneath, from WebODM's own GDAL (3.3.2 and 4.0.0, Docker and native Windows).
The plugin installs no geometry package of its own: a compiled one, loaded by WebODM, can't be deleted on Windows
while WebODM runs, which stops the plugin from being removed. Shape wraps a geometry with what the plugin reads of it.
"""
import json

QUADRANT_SEGMENTS = 8       # a buffer's arcs, as GEOS draws them by default


class ShapeError(ValueError):
    """Not a geometry OGR can read"""


def _ogr():
    from osgeo import ogr
    return ogr


class Shape:
    def __init__(self, geometry):
        if geometry is None:
            raise ShapeError("Invalid geometry")
        self.g = geometry

    @property
    def geom_type(self):
        """Point, LineString, Polygon, MultiPolygon, GeometryCollection, ... (as GeoJSON names them)"""
        name = self.g.GetGeometryName()
        return {'POINT': 'Point', 'LINESTRING': 'LineString', 'POLYGON': 'Polygon', 'MULTIPOINT': 'MultiPoint',
                'MULTILINESTRING': 'MultiLineString', 'MULTIPOLYGON': 'MultiPolygon',
                'GEOMETRYCOLLECTION': 'GeometryCollection', 'LINEARRING': 'LinearRing'}.get(name, name)

    @property
    def coords(self):
        """A point's, a line's or a ring's positions [(x, y), ...]"""
        return [tuple(p[:2]) for p in (self.g.GetPoints() or [])]

    @property
    def x(self):
        return self.g.GetX()

    @property
    def y(self):
        return self.g.GetY()

    @property
    def length(self):
        return self.g.Length()

    @property
    def area(self):
        return self.g.Area()

    @property
    def is_valid(self):
        return bool(self.g.IsValid())

    @property
    def is_empty(self):
        return bool(self.g.IsEmpty())

    @property
    def bounds(self):
        """(xmin, ymin, xmax, ymax)"""
        xmin, xmax, ymin, ymax = self.g.GetEnvelope()
        return xmin, ymin, xmax, ymax

    @property
    def wkt(self):
        return self.g.ExportToWkt()

    @property
    def geoms(self):
        """A collection's parts (a polygon's rings: exterior and interiors)"""
        return [Shape(self.g.GetGeometryRef(i).Clone()) for i in range(self.g.GetGeometryCount())]

    @property
    def exterior(self):
        return self.geoms[0]

    @property
    def interiors(self):
        return self.geoms[1:]

    def buffer(self, distance):
        return Shape(self.g.Buffer(distance, QUADRANT_SEGMENTS))

    def difference(self, other):
        return Shape(self.g.Difference(other.g))

    def intersection(self, other):
        return Shape(self.g.Intersection(other.g))

    def intersects(self, other):
        return bool(self.g.Intersects(other.g))

    def contains(self, other):
        return bool(self.g.Contains(other.g))


def shape(geojson):
    """A GeoJSON geometry (a dict) as a Shape
    :raises ShapeError: not one"""
    try:
        return Shape(_ogr().CreateGeometryFromJson(json.dumps(geojson)))
    except (TypeError, ValueError, RuntimeError):      # RuntimeError: GDAL's exceptions, when something turned them on
        raise ShapeError("Invalid geometry") from None


def from_wkt(wkt):
    """A WKT geometry as a Shape
    :raises ShapeError: not one"""
    try:
        return Shape(_ogr().CreateGeometryFromWkt(wkt))
    except (TypeError, ValueError, RuntimeError):
        raise ShapeError("Invalid geometry") from None


def point(x, y):
    g = _ogr().Geometry(_ogr().wkbPoint)
    g.AddPoint_2D(float(x), float(y))
    return Shape(g)
