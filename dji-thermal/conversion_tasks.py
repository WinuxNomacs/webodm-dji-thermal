"""
A WebODM task from a conversion: its temperature TIFFs in degrees C (one per frame it kept) in a normal task of the
dataset's project, with a name and the ODM options of the dataset's WebODM plan (dji-thermal-cli's check, see
analysis) as the user ticks them. The task is made without a processing node: WebODM lists it with "Set a processing
node", whose Edit panel (WebODM's own) sets the node and the options, and processing starts once it is saved.

The TIFFs are hard links where the storage allows (copies otherwise), so a task keeps its images when the conversion
is deleted; WebODM's size count counts them in each task, so the quota shows what each task holds. The tasks made
from a conversion are kept as a list of ids in its folder:

    thermal/conversions/<id>/tasks.json   [task id, ...], those since deleted dropped when read
"""

import os
import shutil

from django.core.exceptions import SuspiciousFileOperation
from django.db import transaction

from app.models import Task
from app.security import path_traversal_check

from . import conversions, datasets

TASKS_FILE = 'tasks.json'
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
