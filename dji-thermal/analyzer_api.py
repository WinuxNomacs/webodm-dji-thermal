"""
The Thermal Analyzer's API: a user's thermal datasets (those of every project they can view), creating one in a
project, uploading its images, its analysis in WebODM's worker, and a thumbnail of each file. A dataset is its holder
task's id (see datasets).

A dataset is shared as its project is: viewing the project shows its datasets, changing it allows uploading,
renaming and analyzing, and deleting a dataset needs the project's delete permission (as a task does).
"""

import io

from django.core.exceptions import SuspiciousFileOperation
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from app.models import Project, Task
from app.security import path_traversal_check

from . import datasets

THUMBNAIL_SIZE = (96, 96)
OVER_QUOTA = "The project's owner is over their storage quota: free some space before adding images"


def get_dataset(request, pk, perm='view_project'):
    try:
        return datasets.get(request.user, pk, perm)
    except Task.DoesNotExist:
        raise NotFound() from None


def summary(task, user):
    """A dataset as the list shows it"""
    a = datasets.analysis(task)
    s = a.get('summary') or {}
    files = s.get('files') or {}
    job = datasets.job(task)
    created = datasets.info(task)
    images = datasets.image_files(task)
    return {
        'id': str(task.id),
        'name': datasets.name_of(task),
        'project': {'id': task.project.id, 'name': task.project.name},
        'status': job['status'],
        'progress': job.get('progress') or 0,
        'error': job.get('error') or '',
        'file_count': len(images),
        'image_bytes': sum(size for _, size in images),
        # All the dataset's task holds: what counts toward the owner's quota
        'size': int((task.size or 0) * 1024 * 1024),
        'thermal': files.get('thermal', 0),
        'not_thermal': sum(n for k, n in files.items() if k != 'thermal'),
        'errors': s.get('error', 0),
        'warnings': s.get('warning', 0),
        'infos': s.get('info', 0),
        'cameras': sorted({c.get('model') or "" for c in a.get('cameras') or []}),
        'analyzed': bool(a),
        'analyzed_at': a.get('analyzed_at'),
        'created_at': task.created_at,
        'last_activity': max(t for t in (task.created_at.isoformat(), a.get('analyzed_at'), job.get('finished_at'))
                             if t),
        'created_by': created.get('created_by'),
        'can_change': user.has_perm('change_project', task.project),
        'can_delete': user.has_perm('delete_project', task.project),
    }


def detail(task, user):
    out = summary(task, user)
    out['analysis'] = datasets.analysis(task)
    if out['can_change']:
        out['sharing'] = datasets.sharing(task.project)
    return out


def dataset_name(request):
    name = str(request.data.get('name', '')).strip()
    if not name:
        raise ValidationError({'name': "A name is required"})
    return name[:255 - len(datasets.NAME_PREFIX)]


class DatasetView(APIView):
    permission_classes = (permissions.IsAuthenticated,)


class DatasetListCreate(DatasetView):
    def get(self, request):
        """The datasets of every project the user can view, newest first, and the projects they can add one to"""
        found = [summary(datasets.check_stale(t), request.user) for t in datasets.visible(request.user)]
        projects = [{'id': p.id, 'name': p.name} for p in datasets.viewable_projects(request.user).order_by('name')
                    if request.user.has_perm('change_project', p)]
        return Response({'datasets': found, 'projects': projects})

    def post(self, request):
        name = dataset_name(request)
        try:
            project = datasets.viewable_projects(request.user).get(pk=int(request.data.get('project')))
        except (Project.DoesNotExist, TypeError, ValueError):
            raise ValidationError({'project': "Choose a project you can add to"}) from None
        if not request.user.has_perm('change_project', project):
            raise ValidationError({'project': "Choose a project you can add to"})
        if project.owner.profile.has_exceeded_quota():
            raise ValidationError({'project': OVER_QUOTA})
        task = datasets.create(project, name, request.user)
        return Response(detail(task, request.user), status=status.HTTP_201_CREATED)


class DatasetDetail(DatasetView):
    def get(self, request, pk):
        return Response(detail(datasets.check_stale(get_dataset(request, pk)), request.user))

    def patch(self, request, pk):
        task = get_dataset(request, pk, 'change_project')
        datasets.rename(task, dataset_name(request))
        return Response(detail(task, request.user))

    def delete(self, request, pk):
        task = get_dataset(request, pk, 'delete_project')
        task.delete()       # its folder with it; a running analysis is canceled (see task_removing)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DatasetUpload(DatasetView):
    def post(self, request, pk):
        """Images added to the dataset (JPEGs only, others skipped), in the subfolders they came from: Django keeps
        only an uploaded file's name, so its place in the folder chosen comes as 'paths', in the same order"""
        task = get_dataset(request, pk, 'change_project')
        if datasets.job(task)['status'] == 'analyzing':
            raise ValidationError({'error': "Wait for the analysis to finish, or cancel it, before adding images"})
        if datasets.over_quota(task):
            raise ValidationError({'error': OVER_QUOTA})

        files = request.FILES.getlist('images')
        paths = request.data.getlist('paths') if hasattr(request.data, 'getlist') else []
        if len(paths) != len(files):
            paths = [f.name for f in files]
        saved, skipped = 0, []
        for f, name in zip(files, paths):
            rel = datasets.upload_path(name or "")
            if rel is None or not rel.lower().endswith(datasets.IMAGE_EXTENSIONS):
                skipped.append(name)
                continue
            try:
                datasets.save_image(task, rel, f)
            except SuspiciousFileOperation:
                skipped.append(name)
                continue
            saved += 1

        if saved:
            datasets.images_changed(task)
        datasets.update_size(task)
        images = datasets.image_files(task)
        return Response({'saved': saved, 'skipped': skipped, 'file_count': len(images),
                         'image_bytes': sum(size for _, size in images)})


class DatasetAnalyze(DatasetView):
    def post(self, request, pk):
        task = datasets.check_stale(get_dataset(request, pk, 'change_project'))
        if datasets.job(task)['status'] == 'analyzing':
            raise ValidationError({'error': "The dataset is already being analyzed"})
        if not datasets.image_files(task):
            raise ValidationError({'error': "Add images to the dataset first"})
        datasets.start_analysis(task)
        return Response(detail(task, request.user))


class DatasetCancel(DatasetView):
    def post(self, request, pk):
        task = get_dataset(request, pk, 'change_project')
        datasets.cancel_analysis(task)
        return Response(detail(task, request.user))


class DatasetThumbnail(DatasetView):
    def get(self, request, pk):
        """A small JPEG of one of the files its analysis lists (?file=), for the Files tab"""
        from PIL import Image
        task = get_dataset(request, pk)
        rel = request.query_params.get('file') or ""
        if not rel or rel not in {r.get('path') for r in datasets.analysis(task).get('files') or []}:
            raise NotFound({'error': "Not a file of this dataset"})
        root = datasets.images_path(task)
        try:
            path = path_traversal_check(root + '/' + rel, root)
        except SuspiciousFileOperation:
            raise NotFound({'error': "Not a file of this dataset"}) from None
        out = io.BytesIO()
        try:
            with Image.open(path) as im:
                # The JPEG decoder scales down while reading: a few milliseconds a frame
                im.draft('RGB', THUMBNAIL_SIZE)
                im = im.convert('RGB')
                im.thumbnail(THUMBNAIL_SIZE)
                im.save(out, 'JPEG', quality=75)
        except FileNotFoundError:
            raise NotFound({'error': "The file is not on the server any more"}) from None
        except (OSError, ValueError):
            raise NotFound({'error': "The file is not an image"}) from None
        response = HttpResponse(out.getvalue(), content_type="image/jpeg")
        response['Cache-Control'] = 'private, max-age=86400'
        return response
