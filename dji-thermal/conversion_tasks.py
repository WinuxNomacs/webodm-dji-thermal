"""
A WebODM task from a conversion: its temperature TIFFs in degrees C (one per frame it kept) in a normal task of the
dataset's project, with a name and the ODM options of the dataset's WebODM plan (dji-thermal-cli's check, see
analysis) as the user ticks them. The task is made without a processing node: WebODM lists it with "Set a processing
node", whose Edit panel (WebODM's own) sets the node and the options, and processing starts once it is saved.

The TIFFs are hard links where the storage allows (copies otherwise), so a task keeps its images when the conversion
is deleted; WebODM's size count counts them in each task, so the quota shows what each task holds. The tasks made
from a conversion are kept as a list of ids in its folder:

    thermal/conversions/<id>/tasks.json   [task id, ...], those since deleted dropped when read

A conversion can also be sent to the dataset's own task, its "parent task" (use_for_parent): its TIFFs replace the
images sent there before (the folder's root holds no other image: the dataset is under thermal/, which WebODM's
processing never reads) and what the task processed from them, and it waits for a processing node as a task made
from a conversion does. One task is processed again and again, rather than a new one for each conversion:

    thermal/parent.json                   {conversion, sent_at, sent_by}: what the dataset's task holds
"""

import os
import shutil

from django.core.exceptions import SuspiciousFileOperation
from django.db import transaction

from app.models import Task
from app.security import path_traversal_check
from nodeodm import status_codes
from pyodx.exceptions import GenericError

from . import conversions, datasets

TASKS_FILE = 'tasks.json'
PARENT_FILE = 'parent.json'
TIFF_SUFFIX = '_temp_c.tiff'
MIN_FRAMES = 2      # as WebODM's own task creation


def plan_of(task):
    return datasets.analysis(task).get('webodm') or {}


def plan_settings(process_args):
    """The settings the plan's process command sets (as dji-thermal-cli's CLI takes them) that change the
    temperatures a task gets: {normalize, max_pitch, emissivity, humidity}, None for those it leaves out"""
    args = [str(a) for a in (process_args or [])]
    out = {'normalize': '--normalize' in args, 'max_pitch': None, 'emissivity': None, 'humidity': None}
    for i, a in enumerate(args[:-1]):
        key = a[2:].replace('-', '_')
        if a.startswith('--') and key in out and key != 'normalize':
            try:
                out[key] = float(args[i + 1])
            except ValueError:
                pass
    return out


def tiffs(task, cid):
    """The conversion's temperature TIFFs in degrees C, as paths in its output folder, one per frame it kept"""
    found = []
    for f in conversions.results(task, cid).get('files') or []:
        if f.get('ok'):
            found += [o for o in f.get('outputs') or [] if o.endswith(TIFF_SUFFIX)]
    return found


def frames(task, cid):
    """[(path in the output folder, name in the task)]: a task's images folder is flat, so a name that two subfolders
    share keeps its folders in its name"""
    paths = tiffs(task, cid)
    counts = {}
    for p in paths:
        counts[os.path.basename(p)] = counts.get(os.path.basename(p), 0) + 1
    return [(p, os.path.basename(p) if counts[os.path.basename(p)] == 1 else p.replace('\\', '/').replace('/', '_'))
            for p in paths]


def checks(task, cid):
    """(problems, warnings): what stops a task being made from the conversion, and where its settings differ from the
    plan's process command"""
    problems, warnings = [], []
    settings = conversions.record(task, cid).get('settings') or {}
    if conversions.job(task, cid)['status'] != 'ready':
        problems.append("The conversion is not finished")
    if settings.get('strip_location'):
        problems.append("The conversion stripped the frames' location: ODM needs it to place them")
    count = len(tiffs(task, cid))
    if not count:
        problems.append("The conversion wrote no temperature TIFFs in °C (temp_c, TIFF)")
    elif count < MIN_FRAMES:
        problems.append("A task needs at least {} frames".format(MIN_FRAMES))

    plan = plan_settings(plan_of(task).get('process_args'))
    if plan['normalize'] and not settings.get('normalize'):
        warnings.append("Not normalized: the frames' offsets show as seams where ODM blends them")
    if plan['max_pitch'] is not None and settings.get('max_pitch') != plan['max_pitch']:
        if settings.get('max_pitch') is None:
            warnings.append("Oblique frames kept: the plan leaves out frames above {:g}° pitch".format(plan['max_pitch']))
        else:
            warnings.append("Pitch limit {:g}°, the plan's is {:g}°".format(settings['max_pitch'], plan['max_pitch']))
    for key, label in (('emissivity', "Emissivity"), ('humidity', "Humidity")):
        if plan[key] is not None and settings.get(key) != plan[key]:
            warnings.append("{} {}, the plan's is {:g}".format(
                label, "as recorded" if settings.get(key) is None else "{:g}".format(settings[key]), plan[key]))
    return problems, warnings


def plan_options(task):
    """The plan's ODM options, [{name, value, reason, recommended}]: the recommended ones first"""
    plan = plan_of(task)
    out = []
    for group, recommended in (('recommended', True), ('consider', False)):
        for name, o in (plan.get(group) or {}).items():
            out.append({'name': name, 'value': o.get('value'), 'reason': o.get('reason', ""), 'recommended': recommended})
    return out


def link_frames(task, cid, new_task):
    """Puts the conversion's TIFFs in the new task's images folder: hard links where the storage allows, copies
    otherwise. :return: how many"""
    src_dir = conversions.output_path(task, cid)
    os.makedirs(new_task.task_path(), exist_ok=True)
    count = 0
    for rel, name in frames(task, cid):
        try:
            src = path_traversal_check(os.path.join(src_dir, rel), src_dir)
        except SuspiciousFileOperation:
            continue
        if not os.path.isfile(src):
            continue
        dst = new_task.get_image_path(name)
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)
        count += 1
    return count


def create(task, cid, name, options):
    """
    A task in the dataset's project with the conversion's TIFFs, name and options ([{name, value}]), waiting for a
    processing node. WebODM's own serializer checks the name and options; the worker never sees the task before its
    images are in (it is made in one transaction).
    :return: the new task
    :raises ValueError: the TIFFs are no longer on the server
    """
    from app.api.tasks import TaskSerializer
    new_task = None
    try:
        with transaction.atomic():
            new_task = Task.objects.create(project=task.project, auto_processing_node=False, processing_node=None)
            if link_frames(task, cid, new_task) < MIN_FRAMES:
                raise ValueError("The conversion's TIFFs are no longer on the server")
            new_task.images_count = len(new_task.scan_images())
            serializer = TaskSerializer(new_task, data={'name': name, 'options': options}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            new_task.update_size(commit=True)
    except Exception:
        if new_task is not None:
            shutil.rmtree(new_task.task_path(), ignore_errors=True)
        raise
    with datasets.locked(task):
        ids = datasets.read_json(conversions.path(task, cid, TASKS_FILE), [])
        datasets.write_json(conversions.path(task, cid, TASKS_FILE), ids + [str(new_task.id)])
    return new_task


def made(task, cid):
    """The tasks made from the conversion that are still in its project, oldest first"""
    ids = datasets.read_json(conversions.path(task, cid, TASKS_FILE), [])
    if not ids:
        return []
    found = {str(t.id): t for t in Task.objects.filter(pk__in=ids, project=task.project)}
    return [found[i] for i in ids if i in found]


def parent_busy(task):
    """The dataset's task is queued, processing or has an action pending in WebODM: its images are in use"""
    return task.status in (status_codes.QUEUED, status_codes.RUNNING) or task.pending_action is not None or \
        (task.processing_node_id is not None and task.status is None)


def parent(task):
    """What the dataset's task holds: {images_count, status, processing_node, last_error, processed, conversion,
    sent_at, sent_by} (conversion: the one last sent to it, '' if none or since deleted)"""
    record = datasets.read_json(datasets.data_path(task, PARENT_FILE))
    from . import conversions as conversions_
    cid = record.get('conversion') or ''
    return {'id': str(task.id), 'project': task.project_id, 'name': task.name, 'images_count': len(task.scan_images()),
            'status': task.status, 'processing_node': task.processing_node_id, 'last_error': task.last_error or '',
            'processed': bool(task.available_assets), 'busy': parent_busy(task),
            'conversion': cid if cid in conversions_.ids(task) else '',
            'sent_at': record.get('sent_at'), 'sent_by': record.get('sent_by')}


def clear_parent(task):
    """The dataset's task without the images sent to it and what it processed from them, waiting for a processing
    node: as WebODM itself starts a task again (no node task, no status), the old one removed from its node"""
    node, uuid = task.processing_node, task.uuid
    for name in task.scan_images():
        try:
            os.remove(task.get_image_path(name))
        except (OSError, SuspiciousFileOperation):
            pass
    shutil.rmtree(task.assets_path(""), ignore_errors=True)
    task.clear_task_assets_cache()
    task.console.reset()
    task.uuid = ''
    task.status = None
    task.last_error = None
    task.pending_action = None
    task.processing_node = None
    task.auto_processing_node = False
    task.processing_time = -1
    task.running_progress = 0
    task.upload_progress = 0
    task.available_assets = []
    task.orthophoto_extent = task.dsm_extent = task.dtm_extent = None
    task.epsg = None
    task.images_count = 0
    task.options = [o for o in task.options or [] if o.get('name') != 'rerun-from']
    if node is not None and uuid:
        try:
            node.remove_task(uuid)
        except (GenericError, OSError) as e:     # the node purges its tasks itself in time
            datasets.logger.warning("Could not remove {} from its processing node: {}".format(uuid, e))


def use_for_parent(task, cid, user=None):
    """
    The conversion's TIFFs in the dataset's own task, in place of the images sent there before and what it processed
    from them, waiting for a processing node. Its options are kept; a task without any gets the plan's recommended ones.
    :return: the task
    :raises ValueError: the task is processing, or the TIFFs are no longer on the server
    """
    from app.api.tasks import TaskSerializer
    with transaction.atomic():
        t = Task.objects.select_for_update().get(pk=task.pk)
        if parent_busy(t):
            raise ValueError("The dataset's task is processing in WebODM: cancel it there first")
        clear_parent(t)
        count = link_frames(task, cid, t)
        if count < MIN_FRAMES:
            for name in t.scan_images():
                os.remove(t.get_image_path(name))
            t.save()
            raise ValueError("The conversion's TIFFs are no longer on the server")
        t.images_count = count
        if not t.options:
            options = [{'name': o['name'], 'value': o['value']} for o in plan_options(task) if o['recommended']]
            serializer = TaskSerializer(t, data={'options': options}, partial=True)
            serializer.is_valid(raise_exception=True)
            t.options = serializer.validated_data['options']
        t.save()
    t.update_size(commit=True)
    with datasets.locked(task):
        datasets.write_json(datasets.data_path(task, PARENT_FILE), {
            'conversion': cid, 'sent_at': datasets.now(), 'sent_by': getattr(user, 'username', None)})
    return t


def release(task):
    """The dataset deleted, its task kept as an ordinary WebODM task with the images sent to it and what it processed:
    the dataset's jobs canceled, its folder removed, its tag and name prefix dropped"""
    from . import conversions as conversions_
    datasets.cancel_analysis(task)
    for c in conversions_.ids(task):
        conversions_.cancel(task, c)
    shutil.rmtree(datasets.data_path(task), ignore_errors=True)
    task.tags = " ".join(t for t in (task.tags or "").split() if t != datasets.TAG)
    task.name = datasets.name_of(task)[:255]
    task.save()
    task.update_size(commit=True)
