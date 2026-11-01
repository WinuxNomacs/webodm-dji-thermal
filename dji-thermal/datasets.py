"""
The DJI Thermal Analyzer's datasets. A dataset is kept in a holder task of its project: a task WebODM never processes
(no processing node, none to be assigned, not partial, so neither processing nor the cleanup of partial tasks ever
takes it), marked with a hidden tag. Everything the dataset has is in that task's folder, under thermal/ (the
folder's root holds no image), so it counts toward the project owner's quota, is shared as the project is and goes
when the task or the project is deleted. Its name is the task's, after NAME_PREFIX.

A dataset made for an existing task (the Create thermal dataset button, or DJI Thermal Task keeping its photos) is kept
in that task instead (adopt): the same tag and thermal/ folder, the task's name as it is, and no holder task beside it.
Deleting such a dataset keeps its task (conversion_tasks.release).

Its records are JSON files there, each replaced whole (written aside, then renamed) under a lock the web app and
the worker share, so a job's progress never overwrites a user's change:

    thermal/dataset.json    who created it
    thermal/job.json        the analysis: its status, progress, error, run id and Celery job
    thermal/analysis.json   what the analysis found (see analysis.compact)
    thermal/images/         the uploads, in the subfolders they came from

A job writes only while the job file still has its run id: canceling, deleting or starting again changes it, and the
job stops at its next progress write.
"""

import datetime
import json
import logging
import os
import shutil
import uuid
from contextlib import contextmanager

from django.core.exceptions import ValidationError
from guardian.shortcuts import get_groups_with_perms, get_objects_for_user, get_users_with_perms

from app.models import Project, Task
from app.security import path_traversal_check

from . import portable

TAG = '.dji-thermal-dataset'        # WebODM's task list hides tags starting with "."
NAME_PREFIX = 'Thermal dataset: '
DATA_DIR = 'thermal'
IMAGES_DIR = 'images'
DATASET_FILE = 'dataset.json'
JOB_FILE = 'job.json'
ANALYSIS_FILE = 'analysis.json'
LOCK_FILE = '.lock'
IMAGE_EXTENSIONS = ('.jpg', '.jpeg')
MAX_FOLDER_DEPTH = 4                # subfolders kept from an uploaded folder (e.g. thermal/, 100MEDIA/)

STATUSES = ('new', 'analyzing', 'ready', 'failed', 'canceled')

logger = logging.getLogger('app.logger')


class Gone(Exception):
    """The dataset's task, or its folder, was deleted"""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def is_dataset(task):
    return TAG in (task.tags or '').split()


def name_of(task):
    name = task.name or ''
    return name.removeprefix(NAME_PREFIX)


def task_name(name):
    return (NAME_PREFIX + name)[:255]


def data_path(task, *parts):
    return task.task_path(DATA_DIR, *parts)


def images_path(task):
    return data_path(task, IMAGES_DIR)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {} if default is None else default


def write_json(path, value):
    part = '{}.{}.part'.format(path, uuid.uuid4().hex[:8])
    with open(part, 'w') as f:
        json.dump(value, f)
    portable.replace(part, path)


@contextmanager
def locked(task):
    """
    The dataset's records, held against the web app's and the worker's other changes.
    :raises Gone: the dataset's folder is not there (its task was deleted)
    """
    try:
        lock = open(data_path(task, LOCK_FILE), 'a+')       # noqa: SIM115 - closed below
    except FileNotFoundError:
        raise Gone() from None
    with lock, portable.exclusive(lock):
        yield


# Who sees what: as the projects API lists them (rest_framework_guardian's ObjectPermissionsFilter), viewing a
# project shows its datasets, changing it allows uploading, renaming and analyzing, and deleting a dataset needs the
# project's delete permission (as a task does)

def viewable_projects(user):
    return get_objects_for_user(user, 'app.view_project', Project.objects.filter(deleting=False),
                                accept_global_perms=False)


def visible(user):
    """The datasets of every project user can view, newest first"""
    tasks = Task.objects.filter(project__in=viewable_projects(user), tags__contains=TAG).select_related('project')
    return [t for t in tasks.order_by('-created_at') if is_dataset(t)]


def get(user, pk, perm='view_project'):
    """
    :return: the dataset (its task) pk, if user can see it and has perm on its project
    :raises Task.DoesNotExist: not a dataset user can see, or perm is missing
    """
    try:
        task = Task.objects.select_related('project').get(pk=pk, tags__contains=TAG, project__deleting=False)
    except (ValueError, ValidationError):
        raise Task.DoesNotExist() from None
    if not is_dataset(task) or not user.has_perm('view_project', task.project) or \
            (perm != 'view_project' and not user.has_perm(perm, task.project)):
        raise Task.DoesNotExist()
    return task


def sharing(project):
    """Who can view a project's datasets: its owner, the users and the groups with view permission"""
    users = sorted(u.username for u, perms in get_users_with_perms(project, attach_perms=True).items()
                   if 'view_project' in perms)
    groups = sorted(g.name for g, perms in get_groups_with_perms(project, attach_perms=True).items()
                    if 'view_project' in perms)
    return {'owner': project.owner.username, 'users': users, 'groups': groups, 'everyone': 'Default' in groups}


def create(project, name, user):
    """A new, empty dataset in project: its holder task and records"""
    task = Task.objects.create(project=project, name=task_name(name), tags=TAG, partial=False,
                               auto_processing_node=False, processing_node=None)
    os.makedirs(images_path(task), exist_ok=True)
    write_json(data_path(task, DATASET_FILE), {'created_by': user.username, 'created_at': now()})
    write_json(data_path(task, JOB_FILE), {'status': 'new'})
    update_size(task)
    return task


def adopt(task, user):
    """An existing task made a dataset: its records in its thermal/ folder, its name kept"""
    os.makedirs(images_path(task), exist_ok=True)
    write_json(data_path(task, DATASET_FILE), {'created_by': user.username, 'created_at': now(), 'in_task': True})
    write_json(data_path(task, JOB_FILE), {'status': 'new'})
    task.tags = " ".join((task.tags or '').split() + [TAG])
    Task.objects.filter(pk=task.pk).update(tags=task.tags)
    update_size(task)
    return task


def in_task(task):
    """Whether the dataset is kept in a task of its own making (adopt), not a holder task"""
    return bool(info(task).get('in_task'))


def rename(task, name):
    name = name[:255] if in_task(task) else task_name(name)
    Task.objects.filter(pk=task.pk).update(name=name)
    task.name = name


def update_size(task):
    """The task's size (what WebODM's quota counts) from its folder, and the owner's quota figure refreshed"""
    task.update_size()
    Task.objects.filter(pk=task.pk).update(size=task.size)


def over_quota(task):
    return task.project.owner.profile.has_exceeded_quota()


def info(task):
    return read_json(data_path(task, DATASET_FILE))


def job(task, rel=JOB_FILE):
    """
    A job's state: {'status', 'progress', 'error', 'run_id', 'celery_task_id', 'started_at', 'finished_at'}
    :param rel: its job file in the dataset's folder: the analysis's, or a conversion's (see conversions)
    """
    state = read_json(data_path(task, rel))
    state.setdefault('status', 'new')
    return state


def analysis(task):
    """What the last analysis found, or {}"""
    return read_json(data_path(task, ANALYSIS_FILE))


def update_job(task, if_run=None, rel=JOB_FILE, **fields):
    """
    Changes a job's state (see job), if its file is still there (a deleted conversion's is not).
    :param if_run: only while it is the job's run id (a job's own writes)
    :return: whether it was changed
    """
    try:
        with locked(task):
            path = data_path(task, rel)
            if not os.path.exists(path) and rel != JOB_FILE:
                return False
            state = job(task, rel)
            if if_run is not None and state.get('run_id') != if_run:
                return False
            state.update(fields)
            write_json(path, state)
    except Gone:
        return False
    return True


def finish_job(task, run_id, result, rel=JOB_FILE, result_rel=ANALYSIS_FILE, **fields):
    """
    A job's result kept (in result_rel), and its state ready with fields, if it is still the job's run.
    :return: whether it was
    """
    try:
        with locked(task):
            if job(task, rel).get('run_id') != run_id or not os.path.exists(data_path(task, rel)):
                return False
            write_json(data_path(task, result_rel), result)
            write_json(data_path(task, rel), dict({'status': 'ready', 'progress': 1.0, 'error': '',
                                                   'finished_at': now()}, **fields))
    except Gone:
        return False
    return True


def job_gone(celery_task_id):
    if not celery_task_id:
        return False
    try:
        from worker.tasks import TestSafeAsyncResult
        return TestSafeAsyncResult(celery_task_id).state in ('FAILURE', 'REVOKED')
    except Exception:  # noqa: BLE001 - the broker unreachable: the job is not known to be gone
        return False


def check_stale(task, rel=JOB_FILE, running='analyzing', what='analysis'):
    """A job that is gone (the worker stopped, or the job failed) is not left running forever"""
    state = job(task, rel)
    if state['status'] == running and job_gone(state.get('celery_task_id')):
        update_job(task, if_run=state.get('run_id'), rel=rel, status='failed', progress=0, run_id='',
                   error="The {} job stopped before it finished".format(what))
    return task


def image_files(task):
    """The dataset's images: [(path within the dataset, bytes)]"""
    root = images_path(task)
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                try:
                    out.append((os.path.relpath(fp, root), os.path.getsize(fp)))
                except OSError:
                    pass
    return out


def upload_path(name):
    """Where an uploaded file goes within the images folder: its name, under the subfolders it came from (if any),
    or None for a name with nothing left"""
    parts = [p for p in name.replace('\\', '/').split('/') if p not in ('', '.', '..')]
    if not parts:
        return None
    return os.path.join(*parts[-(MAX_FOLDER_DEPTH + 1):])


def save_image(task, rel, upload):
    """An uploaded image written at rel within the images folder (see upload_path)"""
    root = images_path(task)
    dest = path_traversal_check(os.path.join(root, rel), root)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if hasattr(upload, 'temporary_file_path'):
        # WebODM's upload handler closes an upload kept on disk (over 4.5 MB): it is read from its path
        shutil.copyfile(upload.temporary_file_path(), dest)
    else:
        with open(dest, 'wb') as f:
            f.writelines(upload.chunks())


def images_changed(task):
    """After images were added: an analysis no longer matches them (it is kept until the next one)"""
    try:
        with locked(task):
            state = job(task)
            if state['status'] != 'new':
                write_json(data_path(task, JOB_FILE), {'status': 'new'})
    except Gone:
        pass


def run_job(module, function, *args):
    """
    Runs in WebODM's worker: run_function_async ships this function's source, so it imports what it needs.
    :return: {'output': what the run did}
    """
    import importlib
    return {'output': getattr(importlib.import_module(module), function)(*args)}


def start_job(task, module, function, *args, rel=JOB_FILE, running='analyzing', **fields):
    """
    Starts module.function(task id, run id, *args) (a module of this plugin) in WebODM's worker, with a new run id
    in its job file.
    """
    from app.plugins.worker import run_function_async
    run_id = uuid.uuid4().hex
    update_job(task, rel=rel, status=running, progress=0, error='', run_id=run_id, started_at=now(),
               celery_task_id='', **fields)
    module = __name__.rsplit('.', 1)[0] + '.' + module
    celery_task_id = run_function_async(run_job, module, function, str(task.pk), run_id, *args).task_id
    update_job(task, if_run=run_id, rel=rel, celery_task_id=celery_task_id or '')


def start_analysis(task):
    start_job(task, 'analysis', 'analyze')


def cancel_analysis(task):
    """The running analysis stops at its next progress write, finding its run gone"""
    try:
        with locked(task):
            state = job(task)
            if state['status'] == 'analyzing':
                write_json(data_path(task, JOB_FILE), {'status': 'canceled', 'finished_at': now()})
                revoke(state.get('celery_task_id'))
    except Gone:
        pass


def revoke(celery_task_id):
    """A job not started yet never starts"""
    if not celery_task_id:
        return
    try:
        from worker.celery import app
        app.control.revoke(celery_task_id)
    except Exception as e:  # noqa: BLE001 - it then stops at its first progress write
        logger.info("Cannot revoke the job {}: {}".format(celery_task_id, e))


def task_removing(task_id):
    """The task being deleted: its jobs canceled (they would stop anyway, its folder gone), and the tasks made from
    its conversions no longer linked to it"""
    from . import conversion_tasks, conversions
    task = Task.objects.filter(pk=task_id).first()
    if task is not None and is_dataset(task):
        cancel_analysis(task)
        for c in conversions.ids(task):
            conversions.cancel(task, c)
        conversion_tasks.unlink_made(task)
