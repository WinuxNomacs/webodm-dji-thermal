"""
The plugin's API, used by its Thermal task button (see public/): the browser creates a partial task with WebODM's
own API, sends each thermal photo here to be converted into the task's folder, then commits the task with
WebODM's API. Photos are converted one per request, so the browser can show each one's progress and reason.
"""

import os
import shutil
import tempfile

from django.conf import settings as django_settings
from django.core.exceptions import ObjectDoesNotExist, SuspiciousFileOperation, ValidationError
from rest_framework import exceptions, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from app.api.common import check_project_perms
from app.api.tasks import flatten_files
from app.models import Task

from . import converter

NOT_THERMAL = "not a DJI thermal image"


def work_folder():
    """A temporary folder on the same disk as the tasks' folders, for files moved there"""
    os.makedirs(django_settings.MEDIA_TMP, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=django_settings.MEDIA_TMP)


def save_upload(upload, folder):
    """The uploaded file written into folder (the library reads files), keeping its extension"""
    path = os.path.join(folder, 'source' + os.path.splitext(upload.name or '')[1].lower())
    with open(path, 'wb') as f:
        f.writelines(upload.chunks())
    return path


def single_file(request):
    files = flatten_files(request.FILES)
    if len(files) != 1:
        raise exceptions.ValidationError(detail="Send one image per request, not {}".format(len(files)))
    return files[0]


def tiff_name(image_name):
    """The converted image's name in the task: the photo's, as a .tif"""
    return os.path.splitext(os.path.basename(image_name))[0] + '.tif'


class Describe(APIView):
    """
    The camera of one thermal photo, the measurement parameters it recorded and the range of each (see
    converter.describe), for the upload form. Nothing is kept.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        upload = single_file(request)
        with work_folder() as folder:
            source = save_upload(upload, folder)
            if not converter.is_thermal_rjpeg(source):
                return Response({'thermal': False, 'reason': NOT_THERMAL})
            try:
                info = converter.describe(source)
            except Exception as e:  # noqa: BLE001 - reported to the form as the photo's problem
                return Response({'thermal': False, 'reason': str(e)})
        return Response(dict(info, thermal=True))


class TaskConvert(APIView):
    """
    Converts one photo into a partial task's images, with the measurement values sent with it (see
    converter.settings). The answer's status is 'converted' (with the task's image name), 'ignored' (not a DJI
    thermal image: the RGB photos taken with them, another camera's) or 'failed', with the reason.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, project_pk=None, pk=None):
        try:
            task = Task.objects.get(pk=pk, project=project_pk)
            check_project_perms(request, task.project, ('change_project',))
        except (ObjectDoesNotExist, ValidationError):
            raise exceptions.NotFound() from None
        if not task.partial:
            raise exceptions.ValidationError(detail="The task's images have already been committed")

        upload = single_file(request)
        try:
            measurement_settings = converter.settings(request.data)
        except ValueError as e:
            raise exceptions.ValidationError(detail=str(e)) from None

        name = tiff_name(upload.name or 'image')
        try:
            dest = task.get_image_path(name)
        except SuspiciousFileOperation:
            raise exceptions.ValidationError(detail="Invalid image name") from None

        with work_folder() as folder:
            source = save_upload(upload, folder)
            if not converter.is_thermal_rjpeg(source):
                return Response({'status': 'ignored', 'reason': NOT_THERMAL})
            # Converted outside the task's folder: WebODM counts every file there as an image
            converted = os.path.join(folder, name)
            problem = converter.convert(source, converted, measurement_settings)
            if problem:
                return Response({'status': 'failed', 'reason': problem})
            os.makedirs(task.task_path(), exist_ok=True)
            shutil.move(converted, dest)
        return Response({'status': 'converted', 'image': name})
