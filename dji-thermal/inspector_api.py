"""The Thermal Inspector's API: a task's thermal orthophoto read at a point and over a region (see inspector.py)"""
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from app.api.tasks import TaskNestedView

from . import inspector


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
