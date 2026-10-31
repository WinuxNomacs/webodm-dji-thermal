"""
Tests of the file handling that differs between Linux, macOS and Windows (portable.py): the records' lock between
processes, and replacing a file another process has open. They import nothing of WebODM, so that they also run
with WebODM's native Windows Python, from this folder:

    python -m unittest test_portable
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "portable.py")
_spec = importlib.util.spec_from_file_location("portable", PATH)
portable = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(portable)

# A process that says it is ready, takes the lock and says how long it waited for it
TAKE_LOCK = """
import importlib.util, sys, time
spec = importlib.util.spec_from_file_location("portable", sys.argv[1])
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)
print("ready", flush=True)
start = time.monotonic()
with open(sys.argv[2], "a+") as f, portable.exclusive(f):
    print(time.monotonic() - start, flush=True)
"""


class TestPortable(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.lock_path = os.path.join(self.dir, ".lock")

    def take_lock(self):
        return subprocess.Popen([sys.executable, "-c", TAKE_LOCK, PATH, self.lock_path], stdout=subprocess.PIPE,
                                text=True)

    def test_a_second_process_waits_for_the_lock_until_the_first_releases_it(self):
        with open(self.lock_path, "a+") as f, portable.exclusive(f):
            other = self.take_lock()
            self.assertEqual(other.stdout.readline().strip(), "ready")
            time.sleep(0.5)
        with other:
            self.assertGreater(float(other.stdout.readline()), 0.3)

    def test_the_lock_is_free_once_the_block_ends(self):
        with open(self.lock_path, "a+") as f:
            with portable.exclusive(f):
                pass
            with self.take_lock() as other:
                other.stdout.readline()
                self.assertLess(float(other.stdout.readline()), 0.3)

    def test_a_file_being_read_is_replaced_once_it_is_closed(self):
        src, dst = os.path.join(self.dir, "new.part"), os.path.join(self.dir, "record.json")
        for path, text in ((src, "new"), (dst, "old")):
            with open(path, "w") as f:
                f.write(text)
        reader = open(dst)       # noqa: SIM115 - closed by the timer
        threading.Timer(0.2, reader.close).start()
        portable.replace(src, dst)
        with open(dst) as f:
            self.assertEqual(f.read(), "new")

    @unittest.skipUnless(os.name == "nt", "Linux and macOS replace a file that is open")
    def test_a_file_held_open_is_not_replaced_and_says_why(self):
        src, dst = os.path.join(self.dir, "new.part"), os.path.join(self.dir, "record.json")
        for path in (src, dst):
            open(path, "w").close()
        with open(dst), self.assertRaises(PermissionError):
            portable.replace(src, dst)


if __name__ == "__main__":
    unittest.main()
