"""
The Thermal Analyzer's API: a user's thermal datasets (those of every project they can view), creating one in a
project, uploading its images, its analysis in WebODM's worker, a thumbnail of each file, its conversions (several,
side by side, see conversions) with their downloads, and the user's saved conversion settings. A dataset is its
holder task's id (see datasets).

A dataset is shared as its project is: viewing the project shows its datasets and conversions and downloads the
outputs, changing it allows uploading, renaming, analyzing and converting (and deleting conversions), and deleting a
dataset needs the project's delete permission (as a task does).
"""

import io
import os

from django.core.exceptions import SuspiciousFileOperation
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from zipstream.ng import ZipStream

from app.api.tasks import download_file_response, download_file_stream
from app.models import Project, Task
from app.security import path_traversal_check

from . import conversions, datasets

THUMBNAIL_SIZE = (96, 96)
OVER_QUOTA = "The project's owner is over their storage quota: free some space first"


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
    jobs = [conversions.job(conversions.check_stale(task, cid), cid) for cid in conversions.ids(task)]
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
        'conversion_count': len(jobs),
        'conversions_ready': sum(1 for j in jobs if j['status'] == 'ready'),
        # A conversion of the dataset running
        'busy': any(j['status'] == 'converting' for j in jobs),
        'created_at': task.created_at,
        # The latest of its creation, its analysis and its conversions' starts and finishes
        'last_activity': max(t for t in [task.created_at.isoformat(), a.get('analyzed_at'), job.get('finished_at')]
                             + [t for j in jobs for t in (j.get('started_at'), j.get('finished_at'))] if t),
        'created_by': created.get('created_by'),
        'can_change': user.has_perm('change_project', task.project),
        'can_delete': user.has_perm('delete_project', task.project),
    }


def detail(task, user):
    out = summary(task, user)
    out['analysis'] = datasets.analysis(task)
    # Newest first
    out['conversions'] = [conversion_summary(task, cid) for cid in reversed(conversions.ids(task))]
    # What the conversions' settings are compared against, to list what each one changed
    out['defaults'] = conversions.DEFAULTS
    if out['can_change']:
        out['sharing'] = datasets.sharing(task.project)
    return out


def conversion_summary(task, cid):
    """A conversion as the dataset's Convert tab lists it"""
    record, job, r = conversions.record(task, cid), conversions.job(task, cid), conversions.results(task, cid)
    settings = record.get('settings') or {}
    count, size = conversions.files_size(task, cid)
    return {
        'id': cid,
        'dataset': str(task.id),
        'name': record.get('name') or cid,
        'settings': settings,
        'description': conversions.summary_text(settings),
        'status': job['status'],
        'progress': job.get('progress') or 0,
        'stage': job.get('stage') or {},
        'error': job.get('error') or '',
        'converted': r.get('converted', 0),
        'skipped': r.get('skipped', 0),
        'file_count': count,
        'size': size,
        'created_at': record.get('created_at'),
        'finished_at': job.get('finished_at'),
        'created_by': record.get('created_by'),
    }


def conversion_detail(task, cid):
    out = conversion_summary(task, cid)
    out['results'] = conversions.results(task, cid)
    return out


def get_conversion(request, pk, cid, perm='view_project'):
    task = get_dataset(request, pk, perm)
    if not conversions.record(task, cid):
        raise NotFound()
    return task


def conversion_name(request, task):
    name = str(request.data.get('name', '') or '').strip()
    return (name or "Conversion {}".format(len(conversions.ids(task)) + 1))[:255]


def download_name(text):
    """A file name from a dataset or conversion name: letters, digits, dots, dashes and underscores (the header that
    carries it is not quoted, and some browsers cut an unquoted name at its first space)"""
    name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in text).strip("._")
    return name or "conversion"


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


class ConversionListCreate(DatasetView):
    def get(self, request, pk):
        task = get_dataset(request, pk)
        return Response([conversion_summary(conversions.check_stale(task, cid), cid)
                         for cid in reversed(conversions.ids(task))])

    def post(self, request, pk):
        """Converts the dataset's images with the settings given, as a new conversion kept beside the others"""
        task = get_dataset(request, pk, 'change_project')
        if not datasets.image_files(task):
            raise ValidationError({'error': "Add images to the dataset first"})
        if datasets.over_quota(task):
            raise ValidationError({'error': OVER_QUOTA})
        settings, errors = conversions.parse_settings(request.data.get('settings'))
        if errors:
            raise ValidationError(errors)
        cid = conversions.create(task, conversion_name(request, task), settings, request.user)
        return Response(conversion_detail(task, cid), status=status.HTTP_201_CREATED)


class ConversionDetail(DatasetView):
    def get(self, request, pk, cid):
        task = get_conversion(request, pk, cid)
        return Response(conversion_detail(conversions.check_stale(task, cid), cid))

    def patch(self, request, pk, cid):
        task = get_conversion(request, pk, cid, 'change_project')
        name = str(request.data.get('name', '')).strip()
        if not name:
            raise ValidationError({'name': "A name is required"})
        conversions.rename(task, cid, name[:255])
        return Response(conversion_detail(task, cid))

    def delete(self, request, pk, cid):
        task = get_conversion(request, pk, cid, 'change_project')
        conversions.delete(task, cid)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversionCancel(DatasetView):
    def post(self, request, pk, cid):
        task = get_conversion(request, pk, cid, 'change_project')
        conversions.cancel(task, cid)
        return Response(conversion_detail(task, cid))


class ConversionDownload(DatasetView):
    def get(self, request, pk, cid):
        """The conversion's outputs as a zip (streamed as it is made), or one of them (?file=<path in the outputs>)"""
        task = get_conversion(request, pk, cid)
        out_dir = conversions.output_path(task, cid)
        rel = request.query_params.get('file')
        if rel:
            try:
                path = path_traversal_check(os.path.join(out_dir, rel), out_dir + os.sep)
            except SuspiciousFileOperation:
                raise NotFound() from None
            if not os.path.isfile(path):
                raise NotFound()
            return download_file_response(request, path, 'attachment')

        zs = ZipStream(sized=True)
        for f in conversions.output_files(task, cid):
            zs.add_path(os.path.join(out_dir, f), f)
        name = download_name("{}-{}".format(datasets.name_of(task), conversions.record(task, cid).get('name', '')))
        return download_file_stream(request, zs, 'attachment', download_filename=name + ".zip")


class Preferences(DatasetView):
    def get(self, request):
        """The user's saved conversion settings (or the defaults), and what can be chosen"""
        saved = conversions.preferences(request.user)
        return Response({
            'settings': saved if saved is not None else conversions.DEFAULTS,
            'saved': saved is not None,
            'defaults': conversions.DEFAULTS,
            'products': conversions.products(),
            'palettes': conversions.palettes(),
            'limits': conversions.LIMITS,
        })

    def put(self, request):
        """Saves settings as the user's defaults for new conversions"""
        settings, errors = conversions.parse_settings(request.data.get('settings'))
        if errors:
            raise ValidationError(errors)
        conversions.save_preferences(request.user, settings)
        return Response({'settings': settings, 'saved': True})

    def delete(self, request):
        """Back to dji-thermal-cli's defaults"""
        conversions.forget_preferences(request.user)
        return Response({'settings': conversions.DEFAULTS, 'saved': False})
