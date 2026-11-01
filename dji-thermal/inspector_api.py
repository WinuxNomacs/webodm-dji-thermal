"""The Thermal Inspector's API: a task's thermal orthophoto read at a point and over a region, drawn in DJI's palettes
and as isotherms (see inspector.py), a palette's colours for its legend, and the workset mosaics of a project it can
lay on the map (their regions and isotherms: analyzer_api, with region_request and isotherm_request)"""
import math
import re

from django.http import HttpResponse
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from app.api.tasks import TaskNestedView
from app.models import Project

from . import conversion_tasks, conversions, converter, datasets, inspector, mosaics

# The mosaics' tabs laid on the map: those of temperatures (View angle stays in the Analyzer's viewer)
MAP_TABS = ('as_converted', 'harmonized', 'source_frame')


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


def isotherm_request(request):
    """An isotherm tile's ?low=, ?high= (°C, one or both) and ?color= (RRGGBB): (low, high, rgb)"""
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
    return low, high, tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


class InspectorIsotherm(InspectorView):
    def get(self, request, pk=None, project_pk=None, z="", x="", y=""):
        """A tile painting the temperatures at or above ?low= and at or below ?high= (°C, one or both) in ?color=
        (RRGGBB), transparent elsewhere; size and crop as the thermal layer's"""
        task = self.thermal_task(request, pk)
        low, high, rgb = isotherm_request(request)
        size, crop = tile_params(request)
        return png(inspector.isotherm(task, int(z), int(x), int(y), low, high, rgb, size, crop))


def palette_response(name):
    """The colours of name (one of DJI's palettes or of WebODM's colour maps) for the legend: {name, color_map},
    encoded as WebODM's tiler gives colour maps (0xRRGGBBAA)"""
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


class InspectorPalette(InspectorView):
    def get(self, request, pk=None, project_pk=None):
        """The colours of ?name= for the legend (palette_response)"""
        self.thermal_task(request, pk)
        return palette_response(request.query_params.get('name') or '')


def region_request(request):
    """What a region's statistics are asked with: {"geometry": a GeoJSON polygon or line (or a Feature of one), "bins",
    "percentiles", "isotherm": {"low", "high"} (°C, either null) or null}, as (geometry, percentiles, bins, isotherm:
    (low, high) or None)"""
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
    return geometry, percentiles, bins, region_isotherm(data.get('isotherm'))


def region_isotherm(value):
    """A region request's isotherm as (low, high), °C, either None; None for none"""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValidationError({'error': "Invalid isotherm"})
    limits = []
    for key in ('low', 'high'):
        v = value.get(key)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)):
            raise ValidationError({'error': "Invalid isotherm"})
        limits.append(None if v is None else float(v))
    if limits == [None, None]:
        return None
    if None not in limits and limits[0] > limits[1]:
        raise ValidationError({'error': "The isotherm's lower limit is above its upper one"})
    return tuple(limits)


def region_response(read):
    """read() (a region's statistics) as the response, its refusals as errors"""
    try:
        return Response(read())
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    except Exception:  # noqa: BLE001 - GEOS refuses what isn't a geometry
        raise ValidationError({'error': "Invalid geometry"}) from None


class InspectorRegion(InspectorView):
    def post(self, request, pk=None, project_pk=None):
        """The statistics of the temperatures (°C) inside a polygon or along a line (region_request)"""
        task = self.thermal_task(request, pk)
        geometry, percentiles, bins, isotherm = region_request(request)
        return region_response(lambda: inspector.region(task, geometry, percentiles, bins, isotherm))


def map_mosaics(task, user):
    """The worksets of a dataset whose mosaics can be laid on the map: [{dataset, workset, unit, built_at, palettes
    (the viewer's palette keys), default_palette, tabs: [{tab, bounds, minzoom, maxzoom, stats}], tasks (the ids of
    the WebODM tasks processed from the workset's TIFFs, whose orthophotos show its source frames)}]"""
    found = []
    preferred = conversions.display(user)['palette']
    for cid in conversions.ids(task):
        built = mosaics.result(task, cid)
        kinds = built.get('kinds') or {}
        tabs = []
        for tab, kind, _band in mosaics.TABS:
            k = kinds.get(kind)
            if tab in MAP_TABS and k and k.get('raster'):
                tabs.append({'tab': tab, 'bounds': k.get('bounds'), 'minzoom': k.get('minzoom'),
                             'maxzoom': k.get('maxzoom'), 'stats': k.get('temperature')})
        if not tabs:
            continue
        settings = conversions.record(task, cid).get('settings') or {}
        found.append({
            'dataset': {'id': str(task.id), 'name': datasets.name_of(task)},
            'workset': {'id': cid, 'name': conversions.record(task, cid).get('name') or cid},
            'unit': built.get('unit') or settings.get('unit') or 'C', 'built_at': built.get('built_at'),
            'palettes': [mosaics.DJI_PREFIX + name for name in mosaics.palettes_of(task, cid)] +
                        list(mosaics.VIEWER_COLORMAPS),
            'default_palette': mosaics.default_palette(task, cid, settings, preferred),
            'tabs': tabs,
            'tasks': conversion_tasks.holding(task, cid),
        })
    return found


class InspectorProjectView(TaskNestedView):
    def project(self, request, project_pk):
        """The project, when the user may view it (WebODM's public maps have no workset mosaics)"""
        try:
            project = Project.objects.get(pk=project_pk, deleting=False)
        except (Project.DoesNotExist, ValueError):
            raise NotFound() from None
        if not request.user.is_authenticated or not request.user.has_perm('app.view_project', project):
            raise NotFound()
        return project


class InspectorMosaics(InspectorProjectView):
    def get(self, request, project_pk=None):
        """The workset mosaics of the project's datasets the Inspector can lay on the map (map_mosaics), by dataset
        name, then as each dataset lists its worksets"""
        project = self.project(request, project_pk)
        found = []
        for task in sorted((t for t in datasets.visible(request.user) if t.project_id == project.id),
                           key=lambda t: datasets.name_of(t).lower()):
            found.extend(map_mosaics(task, request.user))
        return Response({'mosaics': found})


class InspectorProjectPalette(InspectorProjectView):
    def get(self, request, project_pk=None):
        """The colours of ?name= for the legend of a workset mosaic (palette_response)"""
        self.project(request, project_pk)
        return palette_response(request.query_params.get('name') or '')
