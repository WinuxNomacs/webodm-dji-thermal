"""
The Thermal Inspector's saved measurements: pins, regions and lines kept with a name and a comment, with the values
found when they were saved (°C), for everyone who can view the project. They are kept with what they measure, as a
list replaced whole under the folder's lock:

    <task>/thermal/measurements.json                            a task's thermal orthophoto's
    <dataset>/thermal/conversions/<id>/viewer/measurements.json   a workset's mosaics' (each records its tab)
    <dataset>/thermal/conversions/<id>/viewer/frame-measurements.json   a workset's frames' (each records its frame,
                                                                     in its pixels; see frames_api)

so they are shared and deleted with the task or the workset (a frame's with the frame, removed from the workset). Each is {id, name, comment, shape (pin, rectangle,
circle, polygon or line), geometry (GeoJSON, lon/lat: a point for a pin), circle ({lat, lng, radius}) for a circle,
tab (a mosaic's), values (a pin's {valid, temperature, measured, reason}; a region's as inspector.raster_region finds
them), isotherm ({low, high} °C, or null), correction (correction.described, or null), created_at, created_by}.
"""
import os
import uuid

from . import conversions, datasets

FILE = 'measurements.json'
FRAMES_FILE = 'frame-measurements.json'
SHAPES = ('pin', 'rectangle', 'circle', 'polygon', 'line')
MAX_NAME = 255
MAX_COMMENT = 2000


def task_path(task):
    return datasets.data_path(task, FILE)


def workset_path(task, cid):
    return conversions.path(task, cid, 'viewer', FILE)


def frames_path(task, cid):
    """The measurements saved on a workset's frames: beside its mosaics' (the Inspector lists those on the map)"""
    return conversions.path(task, cid, 'viewer', FRAMES_FILE)


def listed(path):
    found = datasets.read_json(path, [])
    return found if isinstance(found, list) else []


def name_of(value):
    """A name as given: 1 to MAX_NAME characters
    :raises ValueError: none, or too long"""
    name = str(value or '').strip()
    if not name or len(name) > MAX_NAME:
        raise ValueError("A name of 1 to {} characters is required".format(MAX_NAME))
    return name


def comment_of(value):
    """A comment as given: text of MAX_COMMENT characters at most
    :raises ValueError: not text, or too long"""
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > MAX_COMMENT:
        raise ValueError("A comment is text of {} characters at most".format(MAX_COMMENT))
    return value.strip()


def _changed(task, path, change):
    """change(list) applied to the measurements at path under the folder's lock; returns what change returns"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    os.makedirs(datasets.data_path(task), exist_ok=True)
    with datasets.locked(task):
        items = listed(path)
        out = change(items)
        datasets.write_json(path, items)
    return out


def add(task, path, record, user):
    """record saved, with its id, created_at and created_by added; returns it"""
    record = dict(record, id=uuid.uuid4().hex[:12], created_at=datasets.now(), created_by=user.username)
    return _changed(task, path, lambda items: items.append(record) or record)


def update(task, path, mid, **fields):
    """A measurement's fields changed (name, comment); returns it, or None when there is none with that id"""
    def change(items):
        for m in items:
            if m.get('id') == mid:
                m.update(fields)
                return m
        return None
    return _changed(task, path, change)


def remove(task, path, mid):
    """A measurement removed; whether there was one with that id"""
    def change(items):
        kept = [m for m in items if m.get('id') != mid]
        gone = len(kept) != len(items)
        items[:] = kept
        return gone
    return _changed(task, path, change)


def remove_frames(task, path, frames):
    """The measurements saved on some frames removed; how many were"""
    if not os.path.exists(path):
        return 0

    def change(items):
        kept = [m for m in items if m.get('frame') not in frames]
        gone = len(items) - len(kept)
        items[:] = kept
        return gone
    return _changed(task, path, change)
