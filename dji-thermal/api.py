"""
The plugin's API, used by its Thermal task button (see public/): the browser creates a partial task with WebODM's
own API, sends each thermal photo here to be converted into the task's folder, then commits the task with
WebODM's API. Photos are converted one per request, so the browser can show each one's progress and reason. A task's
expanded panel on the dashboard (main.js) makes a DJI Thermal Analyzer dataset for it here, to hold its photos.
"""

import os
import shutil
import tempfile

from django.conf import settings as django_settings
from django.core.exceptions import ObjectDoesNotExist, SuspiciousFileOperation, ValidationError
from rest_framework import exceptions, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from app.api.common import check_project_perms
from app.api.tasks import flatten_files
from app.models import Task

from . import conversion_tasks, converter, datasets
from .analyzer_api import OVER_QUOTA

NOT_THERMAL = "not a DJI thermal image"


def work_folder():
    """A temporary folder on the same disk as the tasks' folders, for files moved there"""
    os.makedirs(django_settings.MEDIA_TMP, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=django_settings.MEDIA_TMP)


def save_upload(upload, folder):
    """The uploaded file written into folder (the library reads files), keeping its extension"""
    path = os.path.join(folder, 'source' + os.path.splitext(upload.name or '')[1].lower())
    if hasattr(upload, 'temporary_file_path'):
        # WebODM's upload handler closes an upload kept on disk (over 4.5 MB): it is read from its path
        shutil.copyfile(upload.temporary_file_path(), path)
    else:
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


def keep_in_dataset(dataset, upload):
    """The photo uploaded also kept in the dataset's images, under its name (JPEGs only, as the dataset's own
    upload); the dataset's size is counted when its analysis starts"""
    rel = datasets.upload_path(upload.name or '')
    if rel is None or not rel.lower().endswith(datasets.IMAGE_EXTENSIONS):
        return
    try:
        datasets.save_image(dataset, rel, upload)
    except SuspiciousFileOperation:
        return
    datasets.images_changed(dataset)


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
    thermal image: the RGB photos taken with them, another camera's) or 'failed', with the reason. With 'dataset',
    the id of the task's dataset (TaskDataset: the task itself), the photo is also kept in that dataset, whatever
    its status.
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

        dataset = None
        if request.data.get('dataset'):
            dataset = conversion_tasks.linked_dataset(task)
            if dataset is None or str(dataset.id) != str(request.data.get('dataset')):
                raise exceptions.ValidationError(detail="The task is not linked to that dataset")

        name = tiff_name(upload.name or 'image')
        try:
            dest = task.get_image_path(name)
        except SuspiciousFileOperation:
            raise exceptions.ValidationError(detail="Invalid image name") from None

        with work_folder() as folder:
            source = save_upload(upload, folder)
            if dataset is not None:
                keep_in_dataset(dataset, upload)
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


class TaskDataset(APIView):
    """
    The DJI Thermal Analyzer dataset of a task (see conversion_tasks.link_dataset): the task itself if it is one, the
    one it is linked to, or the task made one, kept in it. The answer is {id}, with status 201 when it was made.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, project_pk=None, pk=None):
        try:
            task = Task.objects.get(pk=pk, project=project_pk, project__deleting=False)
            check_project_perms(request, task.project, ('change_project',))
        except (ObjectDoesNotExist, ValidationError):
            raise exceptions.NotFound() from None
        found = conversion_tasks.linked_dataset(task)
        if found is None and datasets.over_quota(task):
            raise exceptions.ValidationError(detail=OVER_QUOTA)
        dataset, made = conversion_tasks.link_dataset(task, request.user)
        return Response({'id': str(dataset.id)}, status=status.HTTP_201_CREATED if made else status.HTTP_200_OK)
