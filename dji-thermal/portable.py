"""
Files the web app and the worker share, handled the same on Linux, macOS and Windows (WebODM's native Windows
install runs the plugin's Python on Windows). Kept free of Django, so that its tests run with any Python.
"""

import os
import time
from contextlib import contextmanager

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt

# How long replace() waits for another process to close the file it replaces (Windows)
REPLACE_TRIES = 20
REPLACE_WAIT = 0.05
# Whether WebODM's worker answers while it runs a job: its Linux workers (Docker) are processes whose parent answers;
# its native Windows install runs them as eventlet green threads, which a job busy computing holds up, heartbeat and
# answers alike (see datasets.check_stale)
BUSY_WORKER_ANSWERS = os.name != 'nt'


@contextmanager
def exclusive(f):
    """
    Holds the exclusive lock on the open file f (opened with 'a+') while in the block, waiting as long as another
    process holds it.
    """
    if fcntl:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
        return

    # Windows: the file's first byte locked; LK_LOCK tries for 10 seconds, then raises
    f.seek(0)
    while True:
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            break
        except OSError:
            pass
    try:
        yield
    finally:
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def replace(src, dst):
    """
    os.replace, tried again for about a second where Windows refuses it while another process has dst open (a
    record being read, a cached picture being sent).
    """
    for _ in range(REPLACE_TRIES - 1):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if os.name != 'nt':
                raise
            time.sleep(REPLACE_WAIT)
    os.replace(src, dst)
