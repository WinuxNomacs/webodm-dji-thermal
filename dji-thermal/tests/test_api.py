"""
Tests of the plugin's API: describing a photo for the upload form, and converting photos into a partial task.

As in test_converter, the tests with real R-JPEGs read them from DJI_THERMAL_SAMPLES_DIR and are skipped without it.
"""
import importlib
import io
import os
import shutil
from unittest import mock

from django.contrib.auth.models import User
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from webodm import settings as django_settings

from .test_converter import ConverterTestCase, jpegs_in, read_tags, skip_without

converter = importlib.import_module("coreplugins.dji-thermal.converter")
api = importlib.import_module("coreplugins.dji-thermal.api")

DESCRIBE_URL = "/api/plugins/dji-thermal/describe"


def convert_url(task):
    return "/api/plugins/dji-thermal/projects/{}/tasks/{}/convert".format(task.project.id, task.id)


def jpeg_upload(name="DJI_0001_V.JPG"):
    f = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 80, 40)).save(f, format="JPEG")
    f.seek(0)
    f.name = name
    return f


def sample(camera):
    """A DJI sample image of camera (its EXIF model)"""
    return next(f for f in jpegs_in("DJI_THERMAL_SAMPLES_DIR") if converter.describe(f)["camera"] == camera)


class ApiTestCase(ConverterTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.login(username="testuser", password="test1234")
        self.project = Project.objects.get(owner=User.objects.get(username="testuser"))
        self.task = Task.objects.create(project=self.project, name="Thermal", partial=True)
        self.addCleanup(shutil.rmtree, self.task.task_path(), True)

    def post_file(self, url, path_or_file, **data):
        if isinstance(path_or_file, str):
            with open(path_or_file, "rb") as f:
                return self.client.post(url, dict(data, images=f), format="multipart")
        return self.client.post(url, dict(data, images=path_or_file), format="multipart")

    def task_images(self):
        return sorted(self.task.scan_images())

    def assertNoWorkFilesLeft(self):
        self.assertEqual([f for f in os.listdir(django_settings.MEDIA_TMP) if f.startswith("tmp")], [])


class TestDescribe(ApiTestCase):
    def test_describing_needs_a_login(self):
        self.client.logout()
        res = self.post_file(DESCRIBE_URL, jpeg_upload())
        self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_a_photo_that_is_not_thermal_is_described_as_such(self):
        res = self.post_file(DESCRIBE_URL, jpeg_upload())
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {"thermal": False, "reason": "not a DJI thermal image"})
        self.assertNoWorkFilesLeft()

    def test_one_photo_is_described_at_a_time(self):
        res = self.client.post(DESCRIBE_URL, {"images": [jpeg_upload("a.jpg"), jpeg_upload("b.jpg")]},
                               format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    @skip_without("DJI_THERMAL_SAMPLES_DIR")
    def test_a_thermal_photo_is_described_with_its_camera_s_parameters_and_ranges(self):
        res = self.post_file(DESCRIBE_URL, sample("ZH20T"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data["thermal"])
        self.assertEqual(res.data["camera"], "ZH20T")
        self.assertEqual(res.data["ranges"]["humidity"], [20.0, 100.0])
        self.assertNotIn("ambient_temp", res.data["recorded"])
        self.assertNoWorkFilesLeft()


class TestConvert(ApiTestCase):
    def test_converting_needs_a_login_and_the_right_to_change_the_project(self):
        self.client.logout()
        res = self.post_file(convert_url(self.task), jpeg_upload())
        self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

        self.client.login(username="testuser2", password="test1234")
        res = self.post_file(convert_url(self.task), jpeg_upload())
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        other = Project.objects.get(owner=User.objects.get(username="testuser2"))
        res = self.post_file("/api/plugins/dji-thermal/projects/{}/tasks/{}/convert".format(other.id, self.task.id),
                             jpeg_upload())
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.task_images(), [])

    def test_a_task_already_committed_takes_no_more_photos(self):
        self.task.partial = False
        self.task.save()
        res = self.post_file(convert_url(self.task), jpeg_upload())
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_measurement_values_that_are_not_numbers_are_refused(self):
        res = self.post_file(convert_url(self.task), jpeg_upload(), emissivity="high")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("emissivity must be a number", str(res.data))

    def test_a_photo_that_is_not_thermal_is_ignored_and_not_added_to_the_task(self):
        res = self.post_file(convert_url(self.task), jpeg_upload())
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {"status": "ignored", "reason": "not a DJI thermal image"})
        self.assertEqual(self.task_images(), [])
        self.assertNoWorkFilesLeft()

    def test_a_photo_that_fails_to_convert_is_not_added_to_the_task_and_says_why(self):
        with mock.patch.object(converter, "is_thermal_rjpeg", return_value=True), \
                mock.patch.object(converter, "convert", return_value="bad thermal block"):
            res = self.post_file(convert_url(self.task), jpeg_upload("DJI_0001_T.JPG"))
        self.assertEqual(res.data, {"status": "failed", "reason": "bad thermal block"})
        self.assertEqual(self.task_images(), [])
        self.assertNoWorkFilesLeft()

    def test_a_converted_image_is_named_after_its_photo_with_no_folder(self):
        self.assertEqual(api.tiff_name("DJI_0001_T.JPG"), "DJI_0001_T.tif")
        self.assertEqual(api.tiff_name("../../flight/DJI_0001_T.jpeg"), "DJI_0001_T.tif")

    @skip_without("DJI_THERMAL_SAMPLES_DIR")
    def test_a_thermal_photo_is_converted_into_the_task_with_the_values_sent(self):
        source = sample("M4T")
        res = self.post_file(convert_url(self.task), source, emissivity="0.9", distance="", unit="C")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        name = os.path.splitext(os.path.basename(source))[0] + ".tif"
        self.assertEqual(res.data, {"status": "converted", "image": name})
        self.assertEqual(self.task_images(), [name])
        with Image.open(self.task.get_image_path(name)) as im:
            self.assertEqual(im.mode, "F")
        self.assertEqual(read_tags(self.task.get_image_path(name), "XMP-dtc:Emissivity")["Emissivity"], 0.9)
