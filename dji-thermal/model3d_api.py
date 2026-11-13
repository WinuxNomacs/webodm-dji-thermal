"""The 3D Thermal Inspector's API: a task's textured 3D model as temperatures (model3d.py), and the photos that saw a
point of it (frames3d.py), for those who can view the task, or anyone when it is public, as the 2D Inspector's
(inspector_api.InspectorView)"""
import hashlib
import math

from django.http import HttpResponseNotModified
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from . import conversion_tasks, correction, frames3d, inspector_api, model3d


class Model3DView(inspector_api.InspectorView):
    def described(self, request, pk):
        """The thermal task and its model's description (model3d.describe)"""
        task = self.thermal_task(request, pk)
        try:
            return task, model3d.describe(task)
        except model3d.NotThermalModel as e:
            raise NotFound({'error': str(e)}) from None


class Model3D(Model3DView):
    def get(self, request, pk=None, project_pk=None):
        """The model's description (model3d.describe), what the task was measured with, for Manual Corrections, and
        its palette (chosen in DJI Thermal Task, or ''): {..., baseline: {emissivity, reflected} or null, palette}"""
        task, found = self.described(request, pk)
        base = correction.task_baseline(task)
        return Response(dict(found, baseline={'emissivity': base[0], 'reflected': base[1]} if base else None,
                             palette=conversion_tasks.task_palette(task)))


class Model3DValues(Model3DView):
    def get(self, request, pk=None, project_pk=None, index=""):
        """
        One material's temperatures (°C), as a value tile for the browser to colour (inspector_api.values_response, no
        margin). Its ETag is the model's version, so a browser asks again only to check it.
        """
        task, found = self.described(request, pk)
        version = [inspector_api.VALUES_VERSION, found['version'], int(index)]
        etag = '"{}"'.format(hashlib.sha1(repr(version).encode()).hexdigest()[:20])
        if etag in [t.strip() for t in request.META.get('HTTP_IF_NONE_MATCH', '').split(',')]:
            response = HttpResponseNotModified()
        else:
            try:
                data, offset, step = model3d.material_values(task, int(index))
            except IndexError:
                raise NotFound({'error': "No such material"}) from None
            except model3d.NotThermalModel as e:
                raise NotFound({'error': str(e)}) from None
            response = inspector_api.values_response((data, offset, step, 1.0), 'private, no-cache', margin=0)
        response['ETag'] = etag
        response['Cache-Control'] = 'private, no-cache'
        return response


class Model3DSaved(Model3DView):
    def get(self, request, pk=None, project_pk=None):
        """The pins saved on the task's thermal orthophoto, where they are in the model's coordinates
        (model3d.saved_pins), to be shown on it, read only: {pins}"""
        task = self.thermal_task(request, pk)
        return Response({'pins': model3d.saved_pins(task)})


def numbers(params, names, required=True):
    """The query's numbers named, as floats; None when they're optional and all missing
    :raises ValidationError: one missing or not a finite number"""
    raw = [params.get(n) for n in names]
    if not required and all(v in (None, '') for v in raw):
        return None
    try:
        out = [float(v) for v in raw]
    except (TypeError, ValueError):
        raise ValidationError({'error': "{} are required numbers".format(", ".join(names))}) from None
    if not all(math.isfinite(v) for v in out):
        raise ValidationError({'error': "{} are required numbers".format(", ".join(names))})
    return out


class Model3DFrames(Model3DView):
    def get(self, request, pk=None, project_pk=None):
        """
        The photos that saw the point ?x=&y=&z= of the model (its coordinates), ranked by how squarely they saw it, from
        the surface's normal ?nx=&ny=&nz= when it's given (frames3d.frames_at): {frames (each with its frame: its path in
        the dataset, or null), workset ({dataset, workset} when the task was processed from a workset's TIFFs, for the
        Analyzer's frame page, else null)}
        """
        task, _found = self.described(request, pk)
        point = numbers(request.query_params, ('x', 'y', 'z'))
        normal = numbers(request.query_params, ('nx', 'ny', 'nz'), required=False)
        try:
            frames = frames3d.frames_at(task, point, normal)
        except frames3d.NoCameras as e:
            raise NotFound({'error': str(e)}) from None
        source = frames3d.workset_frames(task, request.user) if request.user.is_authenticated else None
        for f in frames:
            f['frame'] = source['frames'].get(f['file']) if source else None
        return Response({'frames': frames, 'workset': {'dataset': source['dataset'], 'workset': source['workset']} if source else None})


class Model3DFrameValues(Model3DView):
    def get(self, request, pk=None, project_pk=None, index=""):
        """One photo's temperatures (°C) as a value tile for the browser to colour (inspector_api.values_response, no
        margin); its ETag from the photo's file and the cameras"""
        task, _found = self.described(request, pk)
        version = [inspector_api.VALUES_VERSION, frames3d.version(task, int(index)), int(index)]
        etag = '"{}"'.format(hashlib.sha1(repr(version).encode()).hexdigest()[:20])
        if etag in [t.strip() for t in request.META.get('HTTP_IF_NONE_MATCH', '').split(',')]:
            response = HttpResponseNotModified()
        else:
            try:
                data, offset, step = frames3d.frame_values(task, int(index))
            except (LookupError, frames3d.NoCameras) as e:
                raise NotFound({'error': str(e)}) from None
            response = inspector_api.values_response((data, offset, step, 1.0), 'private, no-cache', margin=0)
        response['ETag'] = etag
        response['Cache-Control'] = 'private, no-cache'
        return response
