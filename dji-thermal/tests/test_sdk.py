"""
Tests of DJI's own Thermal SDK in place of the built-in port: which SDK is used, installing DJI's zip, and the
plugin's DJI Thermal page.

The zips made here hold empty stand-ins for DJI's files. The tests with DJI's real SDK read its zip, as DJI's site
gives it, from DJI_THERMAL_SDK_ZIP (DT_SDK_ZIP in .env) and are skipped without it: DJI's files are never in this
repository.
"""
import importlib
import os
import shutil
import tempfile
import unittest
import zipfile
from unittest import mock

import numpy as np
from django.test import Client
from app.plugins.functions import get_plugin_by_name
from PIL import Image

from .test_converter import ConverterTestCase, jpegs_in, read_tags

converter = importlib.import_module("coreplugins.dji-thermal.converter")
sdk = importlib.import_module("coreplugins.dji-thermal.sdk")

PAGE_URL = "/plugins/dji-thermal/sdk/"
LIBS = "tsdk-core/lib/linux/release_x64/"


def sdk_zip_path():
    path = os.environ.get("DJI_THERMAL_SDK_ZIP", "")
    return path if path and zipfile.is_zipfile(path) else ""


def skip_without_sdk_zip():
    return unittest.skipUnless(sdk_zip_path(), "DJI_THERMAL_SDK_ZIP has no DJI Thermal SDK zip (see the README)")


def fake_sdk(folder):
    """A folder laid out as an unpacked SDK, with an empty libdirp: enough to be found, not to be loaded"""
    os.makedirs(os.path.join(folder, LIBS), exist_ok=True)
    open(os.path.join(folder, LIBS, "libdirp.so"), "w").close()
    return folder


class SdkTestCase(ConverterTestCase):
    def setUp(self):
        super().setUp()
        self.uploaded = self.path("uploaded-sdk")
        patcher = mock.patch.object(sdk, "uploaded_dir", return_value=self.uploaded)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop(sdk.ENV, None)

    def make_zip(self, members, name="sdk.zip"):
        path = self.path(name)
        with zipfile.ZipFile(path, "w") as z:
            for member in members:
                z.writestr(member, b"")
        return path


class TestWhichSdk(SdkTestCase):
    def test_without_an_sdk_the_built_in_port_is_used(self):
        self.assertIsNone(sdk.current())
        self.assertEqual(sdk.status()["source"], "builtin")
        self.assertIsNone(converter.settings({}).sdk)

    def test_an_uploaded_sdk_is_used(self):
        fake_sdk(self.uploaded)
        self.assertEqual(sdk.current(), self.uploaded)
        self.assertEqual(sdk.status()["source"], "upload")

    def test_the_sdk_set_at_deployment_wins_over_an_uploaded_one(self):
        fake_sdk(self.uploaded)
        os.environ[sdk.ENV] = fake_sdk(self.path("deployed"))
        self.assertEqual(sdk.current(), self.path("deployed"))
        self.assertEqual(sdk.status()["source"], "deployment")

    def test_a_deployment_folder_without_the_sdk_fails_rather_than_using_another(self):
        fake_sdk(self.uploaded)
        os.environ[sdk.ENV] = self.path("empty")
        with self.assertRaisesRegex(sdk.SdkError, "has no DJI Thermal SDK: upload one"):
            sdk.current()
        with self.assertRaisesRegex(ValueError, "has no DJI Thermal SDK"):
            converter.settings({})

    def test_conversions_measure_with_the_sdk_in_use(self):
        fake_sdk(self.uploaded)
        self.assertEqual(converter.settings({"emissivity": "0.9"}).sdk, self.uploaded)

    def test_removing_takes_the_uploaded_sdk_away(self):
        fake_sdk(self.uploaded)
        sdk.remove()
        self.assertFalse(os.path.exists(self.uploaded))
        self.assertIsNone(sdk.current())

    def test_the_sdk_set_at_deployment_is_not_removed_here(self):
        os.environ[sdk.ENV] = fake_sdk(self.path("deployed"))
        with self.assertRaisesRegex(sdk.SdkError, "removed by unsetting it there"):
            sdk.remove()
        self.assertTrue(os.path.exists(os.path.join(self.path("deployed"), LIBS, "libdirp.so")))


class TestInstall(SdkTestCase):
    def setUp(self):
        super().setUp()
        fake_sdk(self.uploaded)
        with open(os.path.join(self.uploaded, "old-marker"), "w") as f:
            f.write("the SDK in place")

    def assertOldSdkInPlace(self):
        self.assertTrue(os.path.exists(os.path.join(self.uploaded, "old-marker")))
        self.assertEqual([n for n in os.listdir(self.uploaded) if n.startswith(".")], [])

    def test_a_file_that_is_not_a_zip_is_refused_and_the_old_sdk_kept(self):
        path = self.path("sdk.zip")
        with open(path, "w") as f:
            f.write("not a zip")
        with self.assertRaisesRegex(sdk.SdkError, "Not a zip file"):
            sdk.install(path)
        self.assertOldSdkInPlace()

    def test_a_zip_that_is_not_djis_sdk_is_refused(self):
        with self.assertRaisesRegex(sdk.SdkError, "not DJI's Thermal SDK"):
            sdk.install(self.make_zip(["readme.txt", "photos/DJI_0001.JPG"]))
        self.assertOldSdkInPlace()

    def test_an_sdk_without_libraries_for_this_server_is_refused(self):
        with self.assertRaisesRegex(sdk.SdkError, "no DJI Thermal SDK libraries for this server"):
            sdk.install(self.make_zip(["tsdk-core/lib/windows/release_x64/libdirp.dll"]))
        self.assertOldSdkInPlace()

    def test_a_zip_member_outside_the_folder_is_refused(self):
        outside = os.path.join(self.dir, "escaped")
        member = LIBS + "../../../../../" + os.path.relpath(outside, self.uploaded)
        with mock.patch.object(sdk, "check"), self.assertRaisesRegex(sdk.SdkError, "outside its folder"):
            sdk.install(self.make_zip([LIBS + "libdirp.so", member]))
        self.assertFalse(os.path.exists(outside))
        self.assertOldSdkInPlace()

    def test_an_sdk_that_fails_its_check_leaves_the_old_one_in_place(self):
        refused = mock.patch.object(sdk, "check", side_effect=sdk.SdkError("API revision 21"))
        with refused, self.assertRaisesRegex(sdk.SdkError, "API revision 21"):
            sdk.install(self.make_zip([LIBS + "libdirp.so"]))
        self.assertOldSdkInPlace()

    def test_only_the_libraries_license_and_one_sample_per_camera_are_kept(self):
        found = {"sdk_version": "1.8", "api_revisions": [19, 20], "measured": ["M4T.jpg"]}
        members = ["dji_thermal_sdk/" + m for m in (
            LIBS + "libdirp.so", LIBS + "libv_list.ini", "tsdk-core/lib/linux/release_x86/libdirp.so",
            "tsdk-core/lib/windows/release_x64/libdirp.dll", "License.txt", "Readme.md", "sample/main.cpp",
            "dataset/M4T/DJI_0001_R.JPG", "dataset/M4T/DJI_0002_R.JPG", "dataset/H20T/DJI_0001_R.JPG")]
        with mock.patch.object(sdk, "check", return_value=found):
            info = sdk.install(self.make_zip(members), zip_name="dji_thermal_sdk_v1.8.zip", user="admin")
        kept = sorted(os.path.relpath(os.path.join(d, f), self.uploaded)
                      for d, _, files in os.walk(self.uploaded) for f in files)
        self.assertEqual(kept, ["License.txt", sdk.INFO_FILE, "samples/H20T.jpg", "samples/M4T.jpg",
                                LIBS + "libdirp.so", LIBS + "libv_list.ini"])
        self.assertEqual(info["zip"], "dji_thermal_sdk_v1.8.zip")
        self.assertEqual(sdk.read_info(self.uploaded)["installed_by"], "admin")

    def test_an_update_goes_into_the_folder_set_at_deployment(self):
        os.environ[sdk.ENV] = fake_sdk(self.path("deployed"))
        found = {"sdk_version": "1.8", "api_revisions": [20], "measured": ["M4T.jpg"]}
        with mock.patch.object(sdk, "check", return_value=found):
            sdk.install(self.make_zip([LIBS + "libdirp.so", "dataset/M4T/DJI_0001_R.JPG"]))
        self.assertTrue(os.path.exists(os.path.join(self.path("deployed"), "samples", "M4T.jpg")))
        self.assertOldSdkInPlace()                       # the uploaded one is untouched


class TestPage(SdkTestCase):
    def client_for(self, username):
        client = Client()
        self.assertTrue(client.login(username=username, password="test1234"))
        return client

    def test_only_superusers_can_see_or_change_the_sdk(self):
        client = self.client_for("testuser")
        self.assertEqual(client.get(PAGE_URL).status_code, 403)
        self.assertEqual(client.post(PAGE_URL, {"action": "remove"}).status_code, 403)
        res = self.client_for("testsuperuser").get(PAGE_URL)
        self.assertContains(res, "The built-in port of DJI")
        self.assertContains(res, 'name="sdk_zip"')

    def test_the_page_is_not_in_the_menu_every_user_sees(self):
        menu = get_plugin_by_name("dji-thermal", only_active=False).main_menu()
        self.assertEqual([m.link for m in menu], ["/plugins/dji-thermal/"])

    def test_a_refused_upload_is_reported_on_the_page(self):
        client = self.client_for("testsuperuser")
        with open(self.make_zip(["readme.txt"]), "rb") as f:
            res = client.post(PAGE_URL, {"action": "upload", "sdk_zip": f}, follow=True)
        self.assertContains(res, "the zip has no tsdk-core/lib/")

    def test_the_page_needs_a_login(self):
        self.assertEqual(Client().get(PAGE_URL).status_code, 302)


@skip_without_sdk_zip()
class TestDjisSdk(SdkTestCase):
    def test_djis_zip_installs_from_the_page_and_converts_as_the_port_does(self):
        client = Client()
        client.login(username="testsuperuser", password="test1234")
        with open(sdk_zip_path(), "rb") as f:
            res = client.post(PAGE_URL, {"action": "upload", "sdk_zip": f}, follow=True)
        self.assertContains(res, "is installed (API revisions 19, 20)")
        self.assertEqual(sdk.status()["source"], "upload")
        self.assertEqual(len(sdk.check()["measured"]), len(sdk.samples(self.uploaded)))

        source = sdk.samples(self.uploaded)[0]
        problem = converter.convert(source, self.path("native.tif"))
        self.assertEqual(problem, "")
        self.assertIn("with DJI's Thermal SDK 1.8", read_tags(self.path("native.tif"), "XMP-dtc:Software")["Software"])
        with mock.patch.object(sdk, "current", return_value=None):
            self.assertEqual(converter.convert(source, self.path("port.tif")), "")
        with Image.open(self.path("native.tif")) as a, Image.open(self.path("port.tif")) as b:
            self.assertTrue(np.array_equal(np.asarray(a), np.asarray(b)))

        res = client.post(PAGE_URL, {"action": "remove"}, follow=True)
        self.assertContains(res, "built-in port again")
        self.assertIsNone(sdk.current())

    def test_a_sample_of_every_camera_converts_with_djis_sdk(self):
        if not jpegs_in("DJI_THERMAL_SAMPLES_DIR"):
            self.skipTest("DJI_THERMAL_SAMPLES_DIR has no JPEG images")
        sdk.install(sdk_zip_path())
        stage = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, stage)
        for source in jpegs_in("DJI_THERMAL_SAMPLES_DIR")[::7]:
            native = os.path.join(stage, "native.tif")
            self.assertEqual(converter.convert(source, native), "", source)
