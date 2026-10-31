"""The Thermal Inspector's API: a task's thermal orthophoto read at a point and over a region, drawn in DJI's palettes
and as isotherms (see inspector.py), and a palette's colours for its legend"""
import math
import re

from django.http import HttpResponse
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from app.api.tasks import TaskNestedView

from . import converter, inspector, mosaics


class InspectorView(TaskNestedView):
    def thermal_task(self, request, pk):
        """The task (the user may view it, or it is public) when its orthophoto holds temperatures"""
        task = self.get_and_check_task(request, pk)
        if inspector.thermal_orthophoto(task) is None:
            raise NotFound({'error': "This task has no thermal orthophoto"})
        return task


class InspectorPoint(InspectorView):
    def get(self, request, pk=None, project_pk=None):
        """The temperature (°C) at ?lon=&lat="""
        task = self.thermal_task(request, pk)
        try:
            lon, lat = float(request.query_params.get('lon')), float(request.query_params.get('lat'))
        except (TypeError, ValueError):
            raise ValidationError({'error': "lon and lat are required"}) from None
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValidationError({'error': "Coordinates out of range"})
        return Response(inspector.point(task, lon, lat))


def tile_params(request):
    """The parameters of WebODM's tiles the map keeps: size (256 or 512) and crop"""
    try:
        size = int(request.query_params.get('size') or 256)
    except ValueError:
        size = None
    if size not in (256, 512):
        raise ValidationError({'error': "Invalid size"})
    return size, request.query_params.get('crop') == '1'


def png(data):
    if data is None:
        raise NotFound({'error': "Outside of bounds"})
    return HttpResponse(data, content_type='image/png')


class InspectorTiles(InspectorView):
    def get(self, request, pk=None, project_pk=None, z="", x="", y=""):
        """A tile of the thermal orthophoto in one of DJI's palettes (?palette=), with the parameters of WebODM's
        tiles the map keeps: rescale (°C), size (256 or 512) and crop"""
        task = self.thermal_task(request, pk)
        lut = converter.palette_luts().get(request.query_params.get('palette') or '')
        if lut is None:
            raise ValidationError({'error': "Not one of DJI's palettes"})
        try:
            low, high = (float(v) for v in (request.query_params.get('rescale') or '0,255').split(','))
        except ValueError:
            raise ValidationError({'error': "Invalid rescale"}) from None
        if not (math.isfinite(low) and math.isfinite(high)) or low == high:
            raise ValidationError({'error': "Invalid rescale"})
        size, crop = tile_params(request)
        return png(inspector.tile(task, int(z), int(x), int(y), lut, low, high, size, crop))


class InspectorIsotherm(InspectorView):
    def get(self, request, pk=None, project_pk=None, z="", x="", y=""):
        """A tile painting the temperatures at or above ?low= and at or below ?high= (°C, one or both) in ?color=
        (RRGGBB), transparent elsewhere; size and crop as the thermal layer's"""
        task = self.thermal_task(request, pk)
        limits = []
        for key in ('low', 'high'):
            raw = request.query_params.get(key)
            try:
                value = None if raw in (None, '') else float(raw)
            except ValueError:
                value = math.nan
            if value is not None and not math.isfinite(value):
                raise ValidationError({'error': "Invalid limits"})
            limits.append(value)
        low, high = limits
        if (low is None and high is None) or (low is not None and high is not None and low > high):
            raise ValidationError({'error': "Invalid limits"})
        color = request.query_params.get('color') or ''
        if not re.fullmatch(r'[0-9a-fA-F]{6}', color):
            raise ValidationError({'error': "Invalid color"})
        size, crop = tile_params(request)
        rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
        return png(inspector.isotherm(task, int(z), int(x), int(y), low, high, rgb, size, crop))


class InspectorPalette(InspectorView):
    def get(self, request, pk=None, project_pk=None):
        """The colours of ?name= (one of DJI's palettes or of WebODM's colour maps) for the legend: {name, color_map},
        encoded as WebODM's tiler gives colour maps (0xRRGGBBAA)"""
        self.thermal_task(request, pk)
        name = request.query_params.get('name') or ''
        lut = converter.palette_luts().get(name)
        if lut is not None:
            return Response({'name': name, 'color_map': mosaics.encoded(lut)})
        from app.api.tiler import get_colormap_encoded_values
        try:
            if not re.fullmatch(r'[a-z0-9_]+', name):
                raise ValueError(name)
            return Response({'name': name, 'color_map': get_colormap_encoded_values(name)})
        except Exception:  # noqa: BLE001 - rio-tiler refuses a name it doesn't have
            raise NotFound({'error': "Not a palette"}) from None


class InspectorRegion(InspectorView):
    def post(self, request, pk=None, project_pk=None):
        """The statistics of the temperatures (°C) inside {"geometry": a GeoJSON polygon, "bins", "percentiles"}"""
        task = self.thermal_task(request, pk)
        data = request.data if isinstance(request.data, dict) else {}
        geometry = data.get('geometry')
        if isinstance(geometry, dict) and geometry.get('type') == 'Feature':
            geometry = geometry.get('geometry')
        if not isinstance(geometry, dict):
            raise ValidationError({'error': "A geometry is required"})
        try:
            bins = int(data.get('bins', inspector.HISTOGRAM_BINS))
            percentiles = [float(p) for p in data.get('percentiles', inspector.PERCENTILES)]
        except (TypeError, ValueError):
            raise ValidationError({'error': "Invalid bins or percentiles"}) from None
        if not (1 <= bins <= inspector.MAX_HISTOGRAM_BINS) or not all(0 <= p <= 100 for p in percentiles):
            raise ValidationError({'error': "Invalid bins or percentiles"})
        try:
            return Response(inspector.region(task, geometry, percentiles, bins))
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        except Exception:  # noqa: BLE001 - GEOS refuses what isn't a geometry
            raise ValidationError({'error': "Invalid geometry"}) from None
