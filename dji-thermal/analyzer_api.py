"""
The DJI Thermal Analyzer's API: a user's thermal datasets (those of every project they can view), creating one in a
project, uploading its images, its analysis in WebODM's worker, a thumbnail of each file, its conversions (several,
side by side, see conversions) with their downloads, their mosaics on a map (see mosaics: what the viewer shows, its
tiles and the values at a point), the WebODM tasks made from them (see conversion_tasks) and the user's saved
conversion settings. A dataset is its
holder task's id (see datasets).

A dataset is shared as its project is: viewing the project shows its datasets and conversions and downloads the
outputs, changing it allows uploading, renaming, analyzing and converting (and deleting conversions, making tasks
from them), and deleting a dataset needs the project's delete permission (as a task does).
"""

import glob
import hashlib
import io
import os

from django.core.exceptions import SuspiciousFileOperation
from django.db.models import Q
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from zipstream.ng import ZipStream

from app.api.tasks import download_file_response, download_file_stream
from app.models import Project, Task
from app.security import path_traversal_check
from nodeodm import status_codes

from . import (analysis, conversion_tasks, conversions, converter, correction, datasets, frames, inspector, inspector_api,
               measurements, mosaics, portable)

THUMBNAIL_SIZE = (96, 96)
LARGE_SIZE = (1280, 1280)      # the Files tab's detail pane (?size=large): a frame at its own size, up to this
THUMBNAILS_DIR = 'thumbnails'
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
    counts = analysis.severities(a)
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
        # 'summary' once the files are checked, while the coverage and the plan are worked out
        'stage': job.get('stage') or '',
        'error': job.get('error') or '',
        'file_count': len(images),
        'image_bytes': sum(size for _, size in images),
        # All the dataset's task holds: what counts toward the owner's quota
        'size': int((task.size or 0) * 1024 * 1024),
        'thermal': files.get('thermal', 0),
        'not_thermal': sum(n for k, n in files.items() if k != 'thermal'),
        'errors': counts['error'],
        'warnings': counts['warning'],
        'infos': counts['info'],
        'cameras': sorted({c.get('model') or "" for c in a.get('cameras') or []}),
        'analyzed': bool(a),
        'analyzed_at': a.get('analyzed_at'),
        'conversion_count': len(jobs),
        'task_count': sum(len(conversion_tasks.made(task, cid)) for cid in conversions.ids(task)),
        'conversions_ready': sum(1 for j in jobs if j['status'] == 'ready'),
        # The dataset's own task, as conversions are sent to it
        'parent': conversion_tasks.parent(task),
        'in_task': datasets.in_task(task),
        # A conversion of the dataset running, or its mosaics being built
        'busy': any(j['status'] == 'converting' for j in jobs) or
        any(mosaics.job(task, cid)['status'] == 'building' for cid in conversions.ids(task)),
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
    out['product_names'] = conversions.PRODUCT_NAMES
    if out['can_change']:
        out['sharing'] = datasets.sharing(task.project)
    return out


def has_map(project):
    """Whether WebODM shows a map of the project: one of its tasks has finished with an orthophoto or an elevation model
    (as Project.get_map_items; without one its map page says none is available, and no plugin runs there)"""
    return project.task_set.filter(status=status_codes.COMPLETED).filter(
        Q(orthophoto_extent__isnull=False) | Q(dsm_extent__isnull=False) | Q(dtm_extent__isnull=False)).exists()


def conversion_summary(task, cid):
    """A conversion as the dataset's Convert tab lists it"""
    record, job, r = conversions.record(task, cid), conversions.job(task, cid), conversions.results(task, cid)
    mosaic_job = mosaics.job(task, cid)
    settings = record.get('settings') or {}
    count, size = conversions.files_size(task, cid)
    built = mosaics.result(task, cid)
    return {
        'id': cid,
        'dataset': str(task.id),
        'project': task.project_id,
        'project_map': has_map(task.project),     # its mosaics can be laid on WebODM's map of the project
        'name': record.get('name') or cid,
        'settings': settings,
        'description': conversions.summary_text(settings),
        'status': job['status'],
        'progress': job.get('progress') or 0,
        'stage': job.get('stage') or {},
        'error': job.get('error') or '',
        # The images by result (worked out again for results kept before they were counted so)
        **conversions.counts(r.get('files') or []),
        # How many frames it converts, and has, while converting
        'frames': job.get('frames') or {},
        'removed': len(r.get('removed') or []),
        # '' before any build
        'mosaic_status': mosaic_job['status'] if mosaic_job['status'] != 'new' else '',
        'mosaic_progress': mosaic_job.get('progress') or 0,
        'mosaic_stage': mosaic_job.get('stage') or {},
        'mosaic_error': mosaic_job.get('error') or '',
        'mosaic_files': mosaics.files(task, cid),
        'mosaics': mosaics.summary(task, cid, built),
        # Built with frames removed from the workset since: to build again
        'mosaic_outdated': bool(conversions.removed_paths(task, cid) & set(built.get('frames') or [])),
        'tasks': [task_summary(t) for t in conversion_tasks.made(task, cid)],
        'file_count': count,
        'size': size,
        'created_at': record.get('created_at'),
        'finished_at': job.get('finished_at'),
        'created_by': record.get('created_by'),
    }


def task_summary(t):
    """A task made from a conversion, as the conversion lists it"""
    return {'id': str(t.id), 'name': t.name or "Task #{}".format(t.id), 'project': t.project_id, 'status': t.status,
            'processing_node': t.processing_node_id, 'last_error': t.last_error or '', 'images_count': t.images_count}


def conversion_detail(task, cid):
    out = conversion_summary(task, cid)
    out['results'] = conversions.results(task, cid)
    # Each frame's figures for its Files table, as far as they're measured ('' before they're asked for)
    figures_job = frames.figures_job(task, cid)
    out['figures'] = frames.figures(task, cid)
    out['figures_status'] = figures_job['status'] if figures_job['status'] != 'new' else ''
    out['figures_progress'] = figures_job.get('progress') or 0
    out['figures_error'] = figures_job.get('error') or ''
    return out


def get_conversion(request, pk, cid, perm='view_project'):
    task = get_dataset(request, pk, perm)
    if not conversions.record(task, cid):
        raise NotFound()
    return task


def conversion_name(request, task):
    name = str(request.data.get('name', '') or '').strip()
    return (name or "Workset {}".format(len(conversions.ids(task)) + 1))[:255]


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
        if task.scan_images() or datasets.in_task(task):
            # A conversion was sent to it, or it was a task before: kept as an ordinary task, with its images and
            # what it processed
            conversion_tasks.release(task)
        else:
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


class DatasetRemoveFiles(DatasetView):
    def post(self, request, pk):
        """Images deleted from the dataset ({files: [paths]}), and from its worksets (see conversions.remove_images)"""
        task = datasets.check_stale(get_dataset(request, pk, 'change_project'))
        asked = request.data.get('files') if isinstance(request.data, dict) else None
        if not isinstance(asked, list) or not asked or not all(isinstance(f, str) for f in asked):
            raise ValidationError({'error': "Which files? (files: a list of their paths)"})
        # The cached thumbnails are named by the images as they are: found before they are deleted
        root = datasets.images_path(task)
        keys = {}
        for rel in asked:
            try:
                keys[rel] = thumbnail_key(path_traversal_check(root + '/' + rel, root))
            except SuspiciousFileOperation:
                pass
        try:
            removed = conversions.remove_images(task, asked, request.user)
        except conversions.NotRemoved as e:
            raise ValidationError({'error': str(e)}) from None
        for rel in removed:
            if keys.get(rel):
                remove_thumbnails(task, keys[rel])
        return Response(dict(detail(task, request.user), files_removed=len(removed)))


class DatasetAnalyze(DatasetView):
    def post(self, request, pk):
        task = datasets.check_stale(get_dataset(request, pk, 'change_project'))
        if datasets.job(task)['status'] == 'analyzing':
            raise ValidationError({'error': "The dataset is already being analyzed"})
        if not datasets.image_files(task):
            raise ValidationError({'error': "Add images to the dataset first"})
        datasets.update_size(task)      # images kept by DJI Thermal Task's conversions (api.keep_in_dataset) uncounted
        datasets.start_analysis(task)
        return Response(detail(task, request.user))


class DatasetCancel(DatasetView):
    def post(self, request, pk):
        task = get_dataset(request, pk, 'change_project')
        datasets.cancel_analysis(task)
        return Response(detail(task, request.user))


def file_kinds(task):
    """{path: kind} of the files a dataset's analysis lists"""
    return {r.get('path'): r.get('kind') for r in datasets.analysis(task).get('files') or []}


def dataset_file(task, rel, kinds):
    """
    The path of one of the files a dataset's analysis lists (kinds: file_kinds)
    :raises NotFound: not one of them
    """
    if not rel or rel not in kinds:
        raise NotFound({'error': "Not a file of this dataset"})
    root = datasets.images_path(task)
    try:
        return path_traversal_check(root + '/' + rel, root)
    except SuspiciousFileOperation:
        raise NotFound({'error': "Not a file of this dataset"}) from None


class DatasetFiles(DatasetView):
    def get(self, request, pk):
        """One of the dataset's files as uploaded (?file=), shown in the page, or downloaded with ?download=1"""
        task = get_dataset(request, pk)
        path = dataset_file(task, request.query_params.get('file') or "", file_kinds(task))
        if not os.path.isfile(path):
            raise NotFound({'error': "The file is not on the server any more"})
        return download_file_response(request, path, 'attachment' if request.query_params.get('download') else 'inline')

    def post(self, request, pk):
        """Several of the dataset's files as uploaded (file=, repeated: a form the page submits), as a zip streamed as
        it is made, each at its path in the dataset"""
        task = get_dataset(request, pk)
        rels = request.data.getlist('file') if hasattr(request.data, 'getlist') else request.data.get('file') or []
        rels = list(dict.fromkeys(rels if isinstance(rels, list) else [rels]))
        if not rels:
            raise ValidationError({'error': "No files chosen"})
        kinds = file_kinds(task)
        paths = [(dataset_file(task, rel, kinds), rel) for rel in rels]
        zs = ZipStream(sized=True)
        for path, rel in paths:
            if os.path.isfile(path):
                zs.add_path(path, rel)
        name = download_name("{}-images".format(datasets.name_of(task)))
        return download_file_stream(request, zs, 'attachment', download_filename=name + ".zip")


class DatasetThumbnail(DatasetView):
    def get(self, request, pk):
        """A small JPEG of one of the files its analysis lists (?file=), for the Files tab: its embedded picture, or a
        thermal frame's temperatures in one of DJI's palettes (?palette=, the user's preferred), cached in the dataset;
        with ?size=large, at the file's own size (up to LARGE_SIZE), for the detail pane; with ?workset=, also a frame
        that workset converted (a dataset never analyzed has its frames' thumbnails in the workset's Files)"""
        from PIL import Image
        task = get_dataset(request, pk)
        rel = request.query_params.get('file') or ""
        kinds = file_kinds(task)
        cid = request.query_params.get('workset') or ""
        converted = conversions.results(task, cid).get('files') or [] if conversions.valid_id(cid) else []
        if rel not in kinds and any(f.get('ok') and f.get('path') == rel for f in converted):
            kinds[rel] = 'thermal'
        path = dataset_file(task, rel, kinds)
        palette = request.query_params.get('palette') or ""
        size = LARGE_SIZE if request.query_params.get('size') == 'large' else THUMBNAIL_SIZE
        if size == LARGE_SIZE and palette not in conversions.palettes():
            # The detail pane draws a frame in the palette it was shot in when the user's isn't one of DJI's
            palette = next((r.get('palette') for r in datasets.analysis(task).get('files') or [] if r.get('path') == rel), "") or ""
        if kinds[rel] == 'thermal' and palette in conversions.palettes():
            data = palette_thumbnail(task, path, palette, size)
            if data:
                return thumbnail_response(data)
        out = io.BytesIO()
        try:
            with Image.open(path) as im:
                # The JPEG decoder scales down while reading: a few milliseconds a frame
                im.draft('RGB', size)
                im = im.convert('RGB')
                im.thumbnail(size)
                im.save(out, 'JPEG', quality=75)
        except FileNotFoundError:
            raise NotFound({'error': "The file is not on the server any more"}) from None
        except (OSError, ValueError):
            raise NotFound({'error': "The file is not an image"}) from None
        return thumbnail_response(out.getvalue())


def thumbnail_response(data):
    response = HttpResponse(data, content_type="image/jpeg")
    response['Cache-Control'] = 'private, max-age=86400'
    return response


def thumbnail_key(path):
    """What a frame's cached thumbnails are named by (its path, size and time), or None when it isn't there"""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return hashlib.sha1("{}|{}|{}".format(path, st.st_size, st.st_mtime_ns).encode()).hexdigest()


def remove_thumbnails(task, key):
    """A frame's cached thumbnails deleted, in every palette and size (key: its thumbnail_key)"""
    for cached in glob.glob(os.path.join(glob.escape(datasets.data_path(task, THUMBNAILS_DIR)), '*', key + '*.jpg')):
        try:
            os.remove(cached)
        except OSError:
            pass


def palette_thumbnail(task, path, palette, size=THUMBNAIL_SIZE):
    """A thermal frame's thumbnail (up to size) in a DJI palette, as JPEG bytes, kept in the dataset's
    thumbnails/<palette>/ by the file's path, size and time; None when the frame cannot be drawn (its embedded picture
    is shown instead)"""
    key = thumbnail_key(path)
    if key is None:
        return None
    if size != THUMBNAIL_SIZE:
        key += "-{}x{}".format(*size)
    cached = datasets.data_path(task, THUMBNAILS_DIR, palette, key + '.jpg')
    try:
        with open(cached, 'rb') as f:
            return f.read()
    except OSError:
        pass
    try:
        im = converter.palette_picture(path, palette)
    except Exception:  # noqa: BLE001 - any frame the library cannot draw falls back to its embedded picture
        return None
    im.thumbnail(size)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=75 if size == THUMBNAIL_SIZE else 90)
    os.makedirs(os.path.dirname(cached), exist_ok=True)
    with open(cached + '.part', 'wb') as f:
        f.write(out.getvalue())
    try:
        portable.replace(cached + '.part', cached)
    except OSError:     # the cached copy is held open: it is the same picture
        os.remove(cached + '.part')
    return out.getvalue()


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
        conversions.check_stale(task, cid)
        frames.check_stale_figures(task, cid)
        # A workset converted before its frames' figures were measured has them measured, once
        if (conversions.job(task, cid)['status'] == 'ready' and frames.figures_job(task, cid)['status'] == 'new'
                and conversions.results(task, cid).get('converted')):
            frames.start_figures(task, cid)
        return Response(conversion_detail(task, cid))

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


class ConversionFigures(DatasetView):
    def post(self, request, pk, cid):
        """Measures the frames' figures again (after it failed): as opening the Files does, for whoever can see them"""
        task = get_conversion(request, pk, cid)
        frames.check_stale_figures(task, cid)
        if conversions.job(task, cid)['status'] != 'ready' or not conversions.results(task, cid).get('converted'):
            raise ValidationError({'figures': "The workset has no converted frames to measure"})
        if frames.figures_job(task, cid)['status'] != 'measuring':
            frames.start_figures(task, cid)
        return Response(conversion_detail(task, cid))


class ConversionRemoveFrames(DatasetView):
    def post(self, request, pk, cid):
        """Frames removed from a converted workset ({frames: [paths]}, see conversions.remove_frames)"""
        task = conversions.check_stale(get_conversion(request, pk, cid, 'change_project'), cid)
        asked = request.data.get('frames') if isinstance(request.data, dict) else None
        if not isinstance(asked, list) or not asked or not all(isinstance(f, str) for f in asked):
            raise ValidationError({'error': "Which frames? (frames: a list of their paths)"})
        try:
            removed = conversions.remove_frames(task, cid, asked, request.user)
        except conversions.NotRemoved as e:
            raise ValidationError({'error': str(e)}) from None
        return Response(dict(conversion_detail(task, cid), frames_removed=removed))


class ConversionCancel(DatasetView):
    def post(self, request, pk, cid):
        task = get_conversion(request, pk, cid, 'change_project')
        conversions.cancel(task, cid)
        return Response(conversion_detail(task, cid))


def task_options(data):
    """The ODM options asked for, [{name, value}]: WebODM's own serializer checks them further"""
    if not isinstance(data, list):
        raise ValidationError({'options': "A list of options is expected"})
    out = []
    for o in data:
        name = str(o.get('name', '') or '').strip() if isinstance(o, dict) else ''
        value = o.get('value') if isinstance(o, dict) else None
        if not name or value is None or value == '' or isinstance(value, (list, dict)):
            raise ValidationError({'options': "Each option needs a name and a value"})
        out.append({'name': name, 'value': value})
    return out


class ConversionTask(DatasetView):
    def get(self, request, pk, cid):
        """What a task from the conversion would be: its name, the plan's options, and what stops or warns against it"""
        task = get_conversion(request, pk, cid)
        problems, warnings = conversion_tasks.checks(task, cid)
        record = conversions.record(task, cid)
        return Response({'options': conversion_tasks.plan_options(task), 'problems': problems, 'warnings': warnings,
                         'frames': len(conversion_tasks.tiffs(task, cid)),
                         'project': {'id': task.project.id, 'name': task.project.name},
                         'name': "{} - {}".format(datasets.name_of(task), record.get('name') or cid)[:255],
                         'process_args': conversion_tasks.plan_of(task).get('process_args') or [],
                         'can_create': request.user.has_perm('change_project', task.project)})

    def post(self, request, pk, cid):
        """Makes a task in the dataset's project from the conversion's TIFFs (linked, not uploaded again), with the name
        and options given, waiting for a processing node to be set in WebODM"""
        task = get_conversion(request, pk, cid, 'change_project')
        problems, _ = conversion_tasks.checks(task, cid)
        if problems:
            raise ValidationError({'error': " ".join(problems)})
        if datasets.over_quota(task):
            raise ValidationError({'error': OVER_QUOTA})
        name = (str(request.data.get('name', '') or '').strip() or conversions.record(task, cid).get('name') or cid)
        options = task_options(request.data.get('options', []))
        try:
            new_task = conversion_tasks.create(task, cid, name[:255], options)
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        return Response(task_summary(new_task), status=status.HTTP_201_CREATED)


class ConversionParent(DatasetView):
    def post(self, request, pk, cid):
        """Sends the conversion's TIFFs to the dataset's own task, in place of the images sent there before and what it
        processed from them; it then waits for a processing node to be set in WebODM"""
        task = get_conversion(request, pk, cid, 'change_project')
        problems, _ = conversion_tasks.checks(task, cid)
        if problems:
            raise ValidationError({'error': " ".join(problems)})
        if datasets.over_quota(task):
            raise ValidationError({'error': OVER_QUOTA})
        try:
            conversion_tasks.use_for_parent(task, cid, request.user)
        except ValueError as e:
            raise ValidationError({'error': str(e)}) from None
        task.refresh_from_db()
        return Response(conversion_tasks.parent(task))


class ConversionDownload(DatasetView):
    def get(self, request, pk, cid):
        """The conversion's outputs and mosaics as a zip (streamed as it is made, the mosaics in mosaics/), or one of
        them (?file=<path in the outputs>, ?mosaic=<kind>/<file>)"""
        task = get_conversion(request, pk, cid)
        out_dir = conversions.output_path(task, cid)
        mosaic_dir = conversions.path(task, cid, mosaics.MOSAICS_DIR)
        rel, mosaic = request.query_params.get('file'), request.query_params.get('mosaic')
        if rel or mosaic:
            if mosaic and mosaic not in mosaics.files(task, cid):
                raise NotFound()
            root = mosaic_dir if mosaic else out_dir
            try:
                path = path_traversal_check(os.path.join(root, mosaic or rel), root + os.sep)
            except SuspiciousFileOperation:
                raise NotFound() from None
            if not os.path.isfile(path):
                raise NotFound()
            return download_file_response(request, path, 'attachment')

        zs = ZipStream(sized=True)
        for f in conversions.output_files(task, cid):
            zs.add_path(os.path.join(out_dir, f), f)
        for f in mosaics.files(task, cid):
            zs.add_path(os.path.join(mosaic_dir, f), mosaics.MOSAICS_DIR + '/' + f)
        name = download_name("{}-{}".format(datasets.name_of(task), conversions.record(task, cid).get('name', '')))
        return download_file_stream(request, zs, 'attachment', download_filename=name + ".zip")

    def post(self, request, pk, cid):
        """Some of the conversion's outputs and mosaics' files as a zip (file=<path in the outputs>, mosaic=<kind>/<file>,
        each several times: a form posted), the mosaics' in mosaics/"""
        task = get_conversion(request, pk, cid)
        out_dir = conversions.output_path(task, cid)
        mosaic_dir = conversions.path(task, cid, mosaics.MOSAICS_DIR)

        def wanted(key):
            return set(request.data.getlist(key) if hasattr(request.data, 'getlist') else request.data.get(key) or [])
        files = [f for f in conversions.output_files(task, cid) if f in wanted('file')]
        mosaic_files = [f for f in mosaics.files(task, cid) if f in wanted('mosaic')]
        if not files and not mosaic_files:
            raise ValidationError({'file': "None of these files is in the workset"})
        zs = ZipStream(sized=True)
        for f in files:
            zs.add_path(os.path.join(out_dir, f), f)
        for f in mosaic_files:
            zs.add_path(os.path.join(mosaic_dir, f), mosaics.MOSAICS_DIR + '/' + f)
        name = download_name("{}-{}-{}".format(datasets.name_of(task), conversions.record(task, cid).get('name', ''),
                                               len(files) + len(mosaic_files)))
        return download_file_stream(request, zs, 'attachment', download_filename=name + ".zip")


class Preferences(DatasetView):
    def get(self, request):
        """The user's saved conversion settings (or the defaults), and what can be chosen"""
        saved = conversions.preferences(request.user)
        settings = dict(saved if saved is not None else conversions.DEFAULTS)
        # New conversions start with the preferred palette when the saved defaults keep each image's own
        preferred = conversions.display(request.user)['palette']
        settings['palette'] = settings.get('palette') or (preferred if preferred in conversions.palettes() else None)
        return Response({
            'settings': settings,
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


class Display(DatasetView):
    def get(self, request):
        """The user's display preferences (see conversions.display), DJI's palettes and WebODM's colour maps"""
        return Response(dict(conversions.display(request.user), palettes=conversions.palettes(),
                             colormaps=conversions.COLORMAPS))

    def put(self, request):
        value, errors = conversions.parse_display(request.data)
        if errors:
            raise ValidationError(errors)
        conversions.save_display(request.user, value)
        return Response(dict(conversions.display(request.user), palettes=conversions.palettes(),
                             colormaps=conversions.COLORMAPS))


def viewer(task, cid, user):
    """What the viewer shows of a conversion's mosaics: the tabs, palettes, frames (and when the first and last were
    taken, as recorded), and dji-thermal-cli's reports"""
    built = mosaics.result(task, cid)
    kinds = built.get('kinds') or {}
    settings = conversions.record(task, cid).get('settings') or {}
    palettes = mosaics.viewer_palettes(task, cid) if kinds else []
    tabs = []
    for tab, kind, _band in mosaics.TABS:
        k = kinds.get(kind)
        if not k:
            continue
        stats = k.get('view_angle') if tab == 'view_angle' else k.get('temperature')
        tabs.append({'tab': tab, 'kind': kind, 'bounds': k.get('bounds'), 'minzoom': k.get('minzoom'),
                     'maxzoom': k.get('maxzoom'), 'stats': stats})
    in_mosaic = set(built.get('frames') or [])
    times = sorted(f['time'] for f in datasets.analysis(task).get('files') or []
                   if f.get('path') in in_mosaic and f.get('time'))
    out = conversion_summary(task, cid)
    out.update({
        'dataset_name': datasets.name_of(task), 'unit': built.get('unit') or settings.get('unit') or 'C',
        'flown': [times[0], times[-1]] if times else [], 'built_at': built.get('built_at'),
        'stripped': bool(built.get('stripped')), 'frames': built.get('frames') or [], 'tabs': tabs,
        'kinds': {kind: {key: v for key, v in k.items() if key != 'raster'} for kind, k in kinds.items()},
        'palettes': palettes,
        'default_palette': mosaics.default_palette(task, cid, settings, conversions.display(user)['palette']) if kinds else None,
        'can_change': user.has_perm('change_project', task.project),
    })
    return out


def tab_raster(task, cid, tab):
    found = mosaics.tab_raster(task, cid, tab)
    if found is None or not os.path.isfile(found[0]):
        raise NotFound()
    return found


class Mosaics(DatasetView):
    def get(self, request, pk, cid):
        """The conversion's mosaics as the viewer shows them"""
        task = get_conversion(request, pk, cid)
        return Response(viewer(conversions.check_stale(task, cid), cid, request.user))

    def post(self, request, pk, cid):
        """Builds (again) the mosaics of a converted conversion"""
        task = conversions.check_stale(get_conversion(request, pk, cid, 'change_project'), cid)
        if conversions.job(task, cid)['status'] != 'ready':
            raise ValidationError({'error': "The images must be converted first"})
        if mosaics.job(task, cid)['status'] == 'building':
            raise ValidationError({'error': "The mosaics are already being built"})
        if datasets.over_quota(task):
            raise ValidationError({'error': OVER_QUOTA})
        mosaics.start(task, cid)
        return Response(conversion_detail(task, cid))


class MosaicPreview(DatasetView):
    def get(self, request, pk, cid, kind):
        """A mosaic's preview as a small PNG, for the workset's Mosaics table; with ?size=large, up to LARGE_SIZE, for
        its detail pane"""
        task = get_conversion(request, pk, cid)
        data = mosaics.preview(task, cid, kind, LARGE_SIZE if request.query_params.get('size') == 'large' else THUMBNAIL_SIZE)
        if data is None:
            raise NotFound({'error': "The mosaic has no preview"})
        response = HttpResponse(data, content_type="image/png")
        response['Cache-Control'] = 'private, max-age=86400'
        return response


class MosaicTile(DatasetView):
    def get(self, request, pk, cid, tab, z, x, y):
        """
        A PNG tile of a viewer tab: temperatures and view angles over rescale=min,max with color_map (one of the
        viewer's palettes), the adjustments (gamma, equalize=1 on temperatures, sharpen) and on temperatures an isotherm
        (above,T, below,T or between,A,B: its temperatures in the palette, the rest in grey), the source frames as the
        temperatures with lines between the frames. The viewer's URL carries the mosaics' build time, so a tile is
        cached until they are built again.
        """
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        content = mosaics.tile(task, cid, tab, int(z), int(x), int(y), *mosaic_style(request, task, cid, tab))
        if content is None:
            raise NotFound()
        return png_response(content)


def mosaic_style(request, task, cid, tab):
    """A viewer image's colour map, range, adjustments and isotherm from its query: (cmap, low, high, adjust, isotherm)"""
    settings = conversions.record(task, cid).get('settings') or {}
    try:
        cmap = mosaics.colormap(task, cid, request.query_params.get('color_map') or
                                mosaics.default_palette(task, cid, settings, conversions.display(request.user)['palette']))
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    low, high = mosaic_range(request)
    return cmap, low, high, mosaic_adjust(request, tab), mosaic_isotherm(request, tab)


def mosaic_isotherm(request, tab):
    """A viewer request's isotherm (colouring.parse_isotherm), only on temperatures"""
    from . import colouring
    try:
        isotherm = colouring.parse_isotherm(request.query_params.get('isotherm'))
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    if isotherm and not mosaics.is_temperature(tab):
        raise ValidationError({'isotherm': "Only temperatures have an isotherm"})
    return isotherm


def mosaic_range(request):
    """A viewer request's rescale=min,max: (low, high)"""
    try:
        low, high = (float(v) for v in (request.query_params.get('rescale') or '0,1').split(','))
    except ValueError:
        raise ValidationError({'error': "Invalid rescale value"}) from None
    if not high > low:
        raise ValidationError({'rescale': "The range's maximum must be above its minimum"})
    return low, high


def mosaic_adjust(request, tab):
    """A viewer request's adjustments (colouring.parse_adjust), equalize only on temperatures"""
    from . import colouring
    try:
        adjust = colouring.parse_adjust(request.query_params)
    except ValueError as e:
        raise ValidationError({'error': str(e)}) from None
    if adjust['equalize'] and not mosaics.is_temperature(tab):
        raise ValidationError({'equalize': "Only temperatures can be equalized"})
    return adjust


class MosaicValues(DatasetView):
    def get(self, request, pk, cid, tab, z, x, y):
        """
        The values (in the tab's unit) a viewer tab's tile is drawn from, as a value tile for the browser to colour
        (inspector_api.values_response; the source frames' seams flagged). The viewer's URL carries the mosaics' build
        time, so a tile is cached until they are built again.
        """
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        return inspector_api.values_response(mosaics.values_tile(task, cid, tab, int(z), int(x), int(y)),
                                             'private, max-age=86400')


class MosaicHistogram(DatasetView):
    def get(self, request, pk, cid, tab):
        """A temperature tab's histogram (in its unit), for the browser's equalization (inspector_api.histogram_response)"""
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        if not mosaics.is_temperature(tab):
            raise ValidationError({'equalize': "Only temperatures can be equalized"})
        return inspector_api.histogram_response(mosaics.histogram(task, cid, tab))


class MosaicCurve(DatasetView):
    def get(self, request, pk, cid, tab):
        """How a viewer tab's images are drawn over rescale=min,max with gamma and equalize=1, for the legend: the
        palette's share at colouring.CURVE_SAMPLES values evenly across the range"""
        from . import colouring
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        low, high = mosaic_range(request)
        adjust = mosaic_adjust(request, tab)
        tone = mosaics.shares(task, cid, tab, low, high, adjust)
        return Response({'shares': tone if tone is not None else colouring.curve_shares(low, high)})


def png_response(content):
    response = HttpResponse(content, content_type="image/png")
    response['Cache-Control'] = 'private, max-age=86400'
    return response


def point_query(request):
    """The lon and lat of a viewer request's query"""
    try:
        lon, lat = float(request.query_params.get('lon')), float(request.query_params.get('lat'))
    except (TypeError, ValueError):
        raise ValidationError({'error': "lon and lat are required"}) from None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValidationError({'error': "Coordinates out of range"})
    return lon, lat


class MosaicPoint(DatasetView):
    def get(self, request, pk, cid, tab):
        """A viewer tab's values at a point (lon, lat): temperature, source frame and view angle"""
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        return Response(mosaics.point(task, cid, tab, *point_query(request)))


def temperature_raster(task, cid, tab):
    """The path of a temperature tab's mosaic (the Thermal Inspector's regions and isotherms read them)"""
    if not mosaics.is_temperature(tab):
        raise ValidationError({'error': "Not a tab of temperatures"})
    return tab_raster(task, cid, tab)[0]


class MosaicRegion(DatasetView):
    def post(self, request, pk, cid, tab):
        """The statistics of a temperature tab's values (°C) inside a polygon or along a line, as the Thermal
        Inspector's regions of an orthophoto (inspector_api.region_request); a line's profile names each sample's
        source frame"""
        task = get_conversion(request, pk, cid)
        temperature_raster(task, cid, tab)
        geometry, percentiles, bins, isotherm, wanted = inspector_api.region_request(request)
        fix = inspector_api.layer_correction(wanted, lambda: correction.workset_baseline(task, cid))
        return inspector_api.region_response(
            lambda: mosaic_region(task, cid, tab, geometry, percentiles, bins, isotherm, fix))


def mosaic_region(task, cid, tab, geometry, percentiles, bins, isotherm, fix):
    """inspector.raster_region of a temperature tab, a line's profile naming each sample's source frame"""
    built = mosaics.result(task, cid)
    source = mosaics.tab_raster(task, cid, 'source_frame')
    frames = source + (built.get('frames') or [],) if source else None
    return inspector.raster_region(temperature_raster(task, cid, tab), geometry, unit=built.get('unit') or 'C',
                                   percentiles=percentiles, bins=bins, isotherm=isotherm, frames=frames, correction=fix)


class MosaicIsotherm(DatasetView):
    def get(self, request, pk, cid, tab, z, x, y):
        """A tile of a temperature tab painting its temperatures at or above ?low= and at or below ?high= (°C) in
        ?color=, transparent elsewhere, as the Thermal Inspector's isotherms of an orthophoto"""
        task = get_conversion(request, pk, cid)
        raster = temperature_raster(task, cid, tab)
        low, high, rgb = inspector_api.isotherm_request(request)
        unit = mosaics.result(task, cid).get('unit') or 'C'
        content = inspector.raster_isotherm(raster, int(z), int(x), int(y), low, high, rgb, mosaics.TILE_SIZE, unit=unit)
        if content is None:
            raise NotFound()
        return png_response(content)


class MosaicFrames(DatasetView):
    def get(self, request, pk, cid, tab):
        """The frames that saw a point (lon, lat), for the viewer's source frame window: the mosaic's own first; models
        false for mosaics built without the frames' models (built again, they have them)"""
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        frames = mosaics.frames_at(task, cid, tab, *point_query(request))
        return Response({'frames': frames or [], 'models': frames is not None})


class MosaicFrame(DatasetView):
    def get(self, request, pk, cid, tab, index):
        """
        A PNG of one of the mosaic's frames as the tab shows it (its temperatures, or on View angle each pixel's angle
        from straight down), over rescale=min,max with color_map, as the tiles; cached as they are
        """
        task = get_conversion(request, pk, cid)
        tab_raster(task, cid, tab)
        style = mosaic_style(request, task, cid, tab)
        try:
            content = mosaics.frame_image(task, cid, tab, int(index), *style)
        except LookupError as e:
            raise NotFound({'error': str(e)}) from None
        except Exception as e:  # noqa: BLE001 - a frame the library cannot measure (or the SDK gone) is reported
            raise NotFound({'error': "The frame could not be measured: {}".format(e)}) from None
        return png_response(content)


class MosaicMeasurements(DatasetView):
    def get(self, request, pk, cid):
        """The measurements saved on the workset's mosaics (inspector_api.saved_list)"""
        task = get_conversion(request, pk, cid)
        return inspector_api.saved_list(measurements.workset_path(task, cid),
                                        lambda: correction.workset_baseline(task, cid),
                                        request.user.has_perm('change_project', task.project))

    def post(self, request, pk, cid):
        """A pin, region or line measured on a tab of temperatures ({tab, ...}) and saved (inspector_api.saved_record)"""
        task = get_conversion(request, pk, cid, 'change_project')
        tab = request.data.get('tab') if isinstance(request.data, dict) else None
        temperature_raster(task, cid, tab)
        unit = mosaics.result(task, cid).get('unit') or 'C'

        def point(lon, lat):
            found = mosaics.point(task, cid, tab, lon, lat)
            t = found.get('temperature')
            return (None, found.get('reason') or 'nodata') if t is None else (float(inspector.to_celsius(t, unit)), None)

        record = inspector_api.saved_record(
            request.data, point, lambda *a: mosaic_region(task, cid, tab, *a),
            lambda: correction.workset_baseline(task, cid))
        record['tab'] = tab
        return Response(measurements.add(task, measurements.workset_path(task, cid), record, request.user),
                        status=status.HTTP_201_CREATED)


class MosaicMeasurement(DatasetView):
    def patch(self, request, pk, cid, mid):
        """A saved measurement's name or comment changed"""
        task = get_conversion(request, pk, cid, 'change_project')
        return inspector_api.saved_change(task, measurements.workset_path(task, cid), mid, request.data)

    def delete(self, request, pk, cid, mid):
        task = get_conversion(request, pk, cid, 'change_project')
        return inspector_api.saved_removal(task, measurements.workset_path(task, cid), mid)
