"""
The Analyzer's frame page API (see frames.py): a workset's frames, one measured as the workset converted it or with
some of its parameters changed (?distance=, ?humidity=, ?emissivity=, ?reflected_temp=, ?ambient_temp=, the
temperatures in the workset's unit), its values for the browser to colour, a shape's statistics in its pixels, its
temperatures to download, and the measurements saved on the workset's frames. Shared as the workset's dataset is.
"""
import hashlib
import os

from django.http import HttpResponse, HttpResponseNotModified
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from . import conversions, converter, datasets, frames, inspector, inspector_api, measurements, mosaics
from .analyzer_api import DatasetView, download_name, get_conversion

# What a frame's values tile is made of, in its ETag
VALUES_VERSION = 1
measurements_path = measurements.frames_path


def frame_palettes():
    """[{key, label, color_map (encoded)}]: DJI's palettes, then WebODM's colour maps (the mosaic viewer's keys)"""
    from app.api.tiler import get_colormap_encoded_values
    dji = [{'key': mosaics.DJI_PREFIX + name, 'label': "DJI " + name, 'color_map': mosaics.encoded(lut)}
           for name, lut in converter.palette_luts().items()]
    return dji + [{'key': name, 'label': name, 'color_map': get_colormap_encoded_values(name)}
                  for name in mosaics.VIEWER_COLORMAPS]


def default_palette(settings, preferred):
    """The user's preferred palette, else the workset's own, else the mosaic's (as the viewer), else inferno"""
    if preferred in mosaics.VIEWER_COLORMAPS:
        return preferred
    dji = converter.palette_luts()
    for name in (preferred, settings.get('palette')):
        if name and name in dji:
            return mosaics.DJI_PREFIX + name
    return 'inferno'


def query(params):
    """A request's frame and changes (frames.parse_changes): (rel, changes)
    :raises ValidationError: no frame, or a change that isn't valid"""
    rel = params.get('frame')
    if not rel:
        raise ValidationError({'error': "Which frame? (?frame=)"})
    try:
        return rel, frames.parse_changes(params)
    except frames.FrameError as e:
        raise ValidationError({'error': str(e)}) from None


def measured(read):
    """read() of a frame, its refusals (frames.FrameError) as errors"""
    try:
        return read()
    except frames.FrameError as e:
        raise ValidationError({'error': str(e)}) from None


class WorksetFrames(DatasetView):
    def get(self, request, pk, cid):
        """What the frame page shows of a workset: its frames (frames.frame_list), unit, whether it normalized or
        harmonized, the mosaics' pitch limit and whether they are built, the palettes and the user's default"""
        task = get_conversion(request, pk, cid)
        record = conversions.record(task, cid)
        settings = record.get('settings') or {}
        return Response({
            'name': record.get('name') or cid, 'dataset_name': datasets.name_of(task), 'unit': frames.unit_of(task, cid),
            'normalized': bool(settings.get('normalize')), 'harmonized': conversions.harmonized(settings),
            'max_pitch': settings.get('max_pitch') if settings.get('max_pitch') is not None else mosaics.DEFAULT_MAX_PITCH,
            'built': bool(mosaics.result(task, cid).get('frames')), 'frames': frames.frame_list(task, cid),
            'palettes': frame_palettes(),
            'default_palette': default_palette(settings, conversions.display(request.user)['palette']),
            'can_change': request.user.has_perm('change_project', task.project),
        })


class WorksetFrame(DatasetView):
    def get(self, request, pk, cid):
        """A frame (?frame=) measured, with the changes (frames.info)"""
        task = get_conversion(request, pk, cid)
        rel, changes = query(request.query_params)
        return Response(measured(lambda: frames.info(task, cid, rel, changes)))


class WorksetFrameValues(DatasetView):
    def get(self, request, pk, cid):
        """
        A frame's values (with the changes), as a value tile for the browser to colour (inspector_api.values_response,
        no margin). Its ETag is the frame's and the workset's versions with what was asked, so a browser asks again
        only to check it.
        """
        task = get_conversion(request, pk, cid)
        rel, changes = query(request.query_params)
        found = measured(lambda: frames.frame_path(task, rel))
        version = [VALUES_VERSION, sorted(changes.items()), rel]
        for p in (found, conversions.path(task, cid, conversions.RECORD_FILE),
                  conversions.path(task, cid, conversions.RESULTS_FILE)):
            try:
                st = os.stat(p)
                version.append((st.st_size, st.st_mtime_ns))
            except OSError:
                version.append(None)
        etag = '"{}"'.format(hashlib.sha1(repr(version).encode()).hexdigest()[:20])
        if request.META.get('HTTP_IF_NONE_MATCH') == etag:
            response = HttpResponseNotModified()
        else:
            response = inspector_api.values_response(measured(lambda: frames.values_png(task, cid, rel, changes)) +
                                                     (1.0,), 'private, no-cache', margin=0)
        response['ETag'] = etag
        return response


def frame_region(task, cid, data):
    """A shape's statistics on a frame (°C, as the map's regions) from a request's data ({frame, changes: {...},
    geometry (pixels), bins, percentiles, isotherm: {low, high} (°C)}), and what it was measured with: (result, rel,
    changes)"""
    data = data if isinstance(data, dict) else {}
    rel, changes = query(dict(data.get('changes') or {}, frame=data.get('frame')))
    geometry, percentiles, bins, isotherm, _wanted = inspector_api.region_data(
        {k: v for k, v in data.items() if k != 'correction'})
    m = measured(lambda: frames.measure(task, cid, rel, changes))
    celsius = inspector.to_celsius(m['values'], frames.unit_of(task, cid))
    return measured(lambda: frames.region(celsius, geometry, percentiles, bins, isotherm)), rel, changes


class WorksetFrameRegion(DatasetView):
    def post(self, request, pk, cid):
        """What a pin, line or region drawn in a frame's pixels measures (frames.region)"""
        task = get_conversion(request, pk, cid)
        return Response(frame_region(task, cid, request.data)[0])


class WorksetFrameDownload(DatasetView):
    def get(self, request, pk, cid):
        """A frame's temperatures (with the changes) as ?kind=csv or tiff (frames.download)"""
        task = get_conversion(request, pk, cid)
        rel, changes = query(request.query_params)
        content, content_type, ext = measured(lambda: frames.download(task, cid, rel, request.query_params.get("kind"),
                                                                      changes))
        stem = os.path.splitext(os.path.basename(rel))[0] + ("-changed" if changes else "")
        response = HttpResponse(content, content_type=content_type)
        response['Content-Disposition'] = 'attachment; filename={}.{}'.format(download_name(stem), ext)
        return response


class WorksetFrameMeasurements(DatasetView):
    def get(self, request, pk, cid):
        """The measurements saved on the workset's frames (?frame= those of one), and whether the user may change them"""
        task = get_conversion(request, pk, cid)
        found = measurements.listed(measurements_path(task, cid))
        rel = request.query_params.get('frame')
        return Response({'measurements': [m for m in found if not rel or m.get('frame') == rel],
                         'can_change': request.user.has_perm('change_project', task.project)})

    def post(self, request, pk, cid):
        """A pin, line or region drawn on a frame measured and saved: {name, comment, shape, frame, changes,
        geometry (pixels), isotherm}"""
        task = get_conversion(request, pk, cid, 'change_project')
        data = request.data if isinstance(request.data, dict) else {}
        try:
            name, comment = measurements.name_of(data.get('name')), measurements.comment_of(data.get('comment'))
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        shape = data.get('shape')
        if shape not in measurements.SHAPES:
            raise ValidationError({'error': "Not a pin, a region or a line"})
        values, rel, changes = frame_region(task, cid, data)
        isotherm = inspector_api.region_isotherm(data.get('isotherm'))
        record = {'name': name, 'comment': comment, 'shape': shape, 'frame': rel, 'changes': changes,
                  'geometry': data.get('geometry'), 'values': values,
                  'isotherm': {'low': isotherm[0], 'high': isotherm[1]} if isotherm else None}
        return Response(measurements.add(task, measurements_path(task, cid), record, request.user),
                        status=status.HTTP_201_CREATED)


class WorksetFrameMeasurement(DatasetView):
    def patch(self, request, pk, cid, mid):
        """A saved measurement's name or comment changed"""
        task = get_conversion(request, pk, cid, 'change_project')
        return inspector_api.saved_change(task, measurements_path(task, cid), mid, request.data)

    def delete(self, request, pk, cid, mid):
        task = get_conversion(request, pk, cid, 'change_project')
        return inspector_api.saved_removal(task, measurements_path(task, cid), mid)
