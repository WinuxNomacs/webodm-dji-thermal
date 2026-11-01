"""The Thermal Inspector's API: a task's thermal orthophoto read at a point and over a region, drawn in a palette with
the mosaics' adjustments and as isotherms (see inspector.py), a palette's colours for its legend, and the workset mosaics of a project it can
lay on the map (their regions and isotherms: analyzer_api, with region_request and isotherm_request)"""
import math
import re

from django.http import HttpResponse
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from app.api.tasks import TaskNestedView
from app.models import Project

from . import colouring, conversion_tasks, conversions, converter, correction, datasets, inspector, measurements, mosaics

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


def tile_range(request):
    """A tile's ?rescale=low,high (°C)"""
    try:
        low, high = (float(v) for v in (request.query_params.get('rescale') or '0,255').split(','))
    except ValueError:
        raise ValidationError({'error': "Invalid rescale"}) from None
    if not (math.isfinite(low) and math.isfinite(high)) or low == high:
        raise ValidationError({'error': "Invalid rescale"})
    return low, high


def tile_adjust(request):
    """A tile's adjustments (?gamma=, ?equalize=1, ?sharpen=: colouring.parse_adjust)"""
    try:
        return colouring.parse_adjust(request.query_params)
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None


class InspectorTiles(InspectorView):
    def get(self, request, pk=None, project_pk=None, z="", x="", y=""):
        """A tile of the thermal orthophoto in a palette (?palette=: one of DJI's or of WebODM's colour maps), with the
        parameters of WebODM's tiles the map keeps (rescale (°C), size (256 or 512) and crop) and the adjustments the
        mosaics are drawn with (gamma, equalize, sharpen)"""
        task = self.thermal_task(request, pk)
        colors = palette_colors(request.query_params.get('palette') or '')
        if colors is None:
            raise ValidationError({'error': "Not a palette"})
        low, high = tile_range(request)
        size, crop = tile_params(request)
        return png(inspector.tile(task, int(z), int(x), int(y), colors, low, high, size, crop, tile_adjust(request)))


class InspectorCurve(InspectorView):
    def get(self, request, pk=None, project_pk=None):
        """The palette's share at values evenly across ?rescale= (°C) as the tiles are drawn with the adjustments (the
        equalization from the orthophoto's histogram), for the legend: {shares}"""
        task = self.thermal_task(request, pk)
        low, high = tile_range(request)
        adjust = tile_adjust(request)
        curve = colouring.equalization(inspector.histogram(task), low, high) if adjust['equalize'] else None
        return Response({'shares': colouring.curve_shares(low, high, adjust, curve)})


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


def palette_colors(name):
    """The colours of name (one of DJI's palettes or of WebODM's colour maps), encoded as WebODM's tiler gives colour
    maps (0xRRGGBBAA); None when it is neither"""
    lut = converter.palette_luts().get(name)
    if lut is not None:
        return mosaics.encoded(lut)
    from app.api.tiler import get_colormap_encoded_values
    if not re.fullmatch(r'[a-z0-9_]+', name):
        return None
    try:
        return get_colormap_encoded_values(name)
    except Exception:  # noqa: BLE001 - rio-tiler refuses a name it doesn't have
        return None


def palette_response(name):
    """The colours of name for the legend: {name, color_map} (palette_colors)"""
    colors = palette_colors(name)
    if colors is None:
        raise NotFound({'error': "Not a palette"})
    return Response({'name': name, 'color_map': colors})


class InspectorPalette(InspectorView):
    def get(self, request, pk=None, project_pk=None):
        """The colours of ?name= for the legend (palette_response)"""
        self.thermal_task(request, pk)
        return palette_response(request.query_params.get('name') or '')


def region_request(request):
    """What a region's statistics are asked with: {"geometry": a GeoJSON polygon or line (or a Feature of one), "bins",
    "percentiles", "isotherm": {"low", "high"} (°C, either null) or null, "correction": {"emissivity", "reflected"
    (°C)} or null}, as (geometry, percentiles, bins, isotherm: (low, high) or None, the correction wanted:
    (emissivity, reflected) or None)"""
    return region_data(request.data if isinstance(request.data, dict) else {})


def region_data(data):
    """region_request of a request's data"""
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
        wanted = correction.parse(data.get('correction'))
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    return geometry, percentiles, bins, region_isotherm(data.get('isotherm')), wanted


def layer_correction(wanted, baseline):
    """The correction wanted ((emissivity, reflected) or None) of a layer measured with baseline() (correction.py's
    baselines), as (wanted, baseline), or None
    :raises ValidationError: the layer doesn't say what it was measured with"""
    if wanted is None:
        return None
    base = baseline()
    if base is None:
        raise ValidationError({'error': "This layer doesn't record the emissivity and reflected temperature it was "
                                        "measured with, so it can't be corrected"})
    return wanted, base


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
        geometry, percentiles, bins, isotherm, wanted = region_request(request)
        fix = layer_correction(wanted, lambda: correction.task_baseline(task))
        return region_response(lambda: inspector.region(task, geometry, percentiles, bins, isotherm, fix))


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


# -- saved measurements (measurements.py) ---------------------------------------------------------------------------

def saved_list(path, baseline, can_change):
    """The measurements saved at path, with what the layer was measured with (for the correction) and whether the
    user may save, rename and delete them"""
    base = baseline()
    return Response({'measurements': measurements.listed(path), 'can_change': can_change,
                     'baseline': {'emissivity': base[0], 'reflected': base[1]} if base else None})


def saved_record(data, point, region, baseline):
    """A measurement to save from a request's data ({name, comment, shape, geometry, circle, isotherm, correction}),
    measured here: a pin with point(lon, lat) (its temperature in °C, or None, and why), a region or line with
    region(geometry, percentiles, bins, isotherm, correction)"""
    data = data if isinstance(data, dict) else {}
    try:
        name, comment = measurements.name_of(data.get('name')), measurements.comment_of(data.get('comment'))
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    shape = data.get('shape')
    if shape not in measurements.SHAPES:
        raise ValidationError({'error': "Not a pin, a region or a line"})
    geometry = data.get('geometry')
    if shape == 'pin':
        coordinates = geometry.get('coordinates') if isinstance(geometry, dict) and geometry.get('type') == 'Point' else None
        try:
            lon, lat = (float(c) for c in coordinates[:2])
        except (TypeError, ValueError):
            raise ValidationError({'error': "A pin is a point"}) from None
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValidationError({'error': "Coordinates out of range"})
        try:
            wanted = correction.parse(data.get('correction'))
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        fix = layer_correction(wanted, baseline)
        measured, reason = point(lon, lat)
        values = {'valid': measured is not None, 'measured': measured, 'reason': reason,
                  'temperature': correction.value(measured, *fix) if fix else measured}
        record = {'geometry': {'type': 'Point', 'coordinates': [lon, lat]}, 'isotherm': None}
    else:
        geometry, percentiles, bins, isotherm, wanted = region_data(data)
        fix = layer_correction(wanted, baseline)
        try:
            values = region(geometry, percentiles, bins, isotherm, fix)
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        except Exception:  # noqa: BLE001 - GEOS refuses what isn't a geometry
            raise ValidationError({'error': "Invalid geometry"}) from None
        record = {'geometry': geometry,
                  'isotherm': {'low': isotherm[0], 'high': isotherm[1]} if isotherm else None}
    circle = data.get('circle')
    if shape == 'circle' and isinstance(circle, dict):
        try:
            record['circle'] = {k: float(circle[k]) for k in ('lat', 'lng', 'radius')}
        except (KeyError, TypeError, ValueError):
            raise ValidationError({'error': "Invalid circle"}) from None
    return dict(record, name=name, comment=comment, shape=shape, values=values,
                correction=correction.described(*fix) if fix else None)


def saved_change(task, path, mid, data):
    """A saved measurement renamed or its comment changed, as the response"""
    data = data if isinstance(data, dict) else {}
    fields = {}
    try:
        if 'name' in data:
            fields['name'] = measurements.name_of(data.get('name'))
        if 'comment' in data:
            fields['comment'] = measurements.comment_of(data.get('comment'))
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    if not fields:
        raise ValidationError({'error': "Give a name or a comment"})
    changed = measurements.update(task, path, mid, **fields)
    if changed is None:
        raise NotFound()
    return Response(changed)


def saved_removal(task, path, mid):
    if not measurements.remove(task, path, mid):
        raise NotFound()
    return Response(status=204)


class InspectorMeasurementsView(InspectorView):
    def editable_task(self, request, pk):
        """The thermal task, when the user may change its project"""
        task = self.thermal_task(request, pk)
        if not request.user.has_perm('change_project', task.project):
            raise PermissionDenied({'error': "Only those who can change the project can save measurements"})
        return task


class InspectorMeasurements(InspectorMeasurementsView):
    def get(self, request, pk=None, project_pk=None):
        """The measurements saved on the task's thermal orthophoto (saved_list)"""
        task = self.thermal_task(request, pk)
        return saved_list(measurements.task_path(task), lambda: correction.task_baseline(task),
                          request.user.has_perm('change_project', task.project))

    def post(self, request, pk=None, project_pk=None):
        """A pin, region or line measured and saved (saved_record)"""
        task = self.editable_task(request, pk)

        def point(lon, lat):
            found = inspector.point(task, lon, lat)
            return (found['temperature'] if found['valid'] else None), found['reason']

        record = saved_record(request.data, point, lambda *a: inspector.region(task, *a),
                              lambda: correction.task_baseline(task))
        return Response(measurements.add(task, measurements.task_path(task), record, request.user), status=201)


class InspectorMeasurement(InspectorMeasurementsView):
    def patch(self, request, pk=None, project_pk=None, mid=""):
        """A saved measurement's name or comment changed"""
        task = self.editable_task(request, pk)
        return saved_change(task, measurements.task_path(task), mid, request.data)

    def delete(self, request, pk=None, project_pk=None, mid=""):
        task = self.editable_task(request, pk)
        return saved_removal(task, measurements.task_path(task), mid)
