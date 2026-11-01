"""
Tests of the plugin's API: describing a photo for the upload form, converting photos into a partial task, and a
task's DJI Thermal Analyzer dataset.

As in test_converter, the tests with real R-JPEGs read them from DJI_THERMAL_SAMPLES_DIR and are skipped without it.
"""
import contextlib
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
datasets = importlib.import_module("coreplugins.dji-thermal.datasets")
conversions = importlib.import_module("coreplugins.dji-thermal.conversions")
conversion_tasks = importlib.import_module("coreplugins.dji-thermal.conversion_tasks")

DESCRIBE_URL = "/api/plugins/dji-thermal/describe"


def convert_url(task):
    return "/api/plugins/dji-thermal/projects/{}/tasks/{}/convert".format(task.project.id, task.id)


def dataset_url(task):
    return "/api/plugins/dji-thermal/projects/{}/tasks/{}/dataset".format(task.project.id, task.id)


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

    def test_a_photo_is_kept_in_the_task_s_linked_dataset_whatever_its_conversion(self):
        dataset = self.link_dataset()
        res = self.post_file(convert_url(self.task), jpeg_upload("flight/DJI_0001_V.JPG"), dataset=str(dataset.id))
        self.assertEqual(res.data["status"], "ignored")
        self.assertEqual(datasets.image_files(dataset), [("DJI_0001_V.JPG", os.path.getsize(
            os.path.join(datasets.images_path(dataset), "DJI_0001_V.JPG")))])
        self.assertEqual(self.task_images(), [])
        self.assertNoWorkFilesLeft()

    def test_a_photo_is_kept_only_in_the_dataset_the_task_is_linked_to(self):
        other = datasets.create(self.project, "Other", User.objects.get(username="testuser"))
        self.addCleanup(shutil.rmtree, other.task_path(), True)
        res = self.post_file(convert_url(self.task), jpeg_upload(), dataset=str(other.id))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(datasets.image_files(other), [])

    def link_dataset(self):
        res = self.client.post(dataset_url(self.task))
        self.task.refresh_from_db()
        return Task.objects.get(pk=res.data["id"])

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


class TestTaskDataset(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.task.partial = False
        self.task.tags = "roof .dji-thermal-task"
        self.task.save()

    def tasks_in_project(self):
        return Task.objects.filter(project=self.project).count()

    def test_making_a_task_s_dataset_needs_a_login_and_the_right_to_change_the_project(self):
        self.client.logout()
        self.assertIn(self.client.post(dataset_url(self.task)).status_code,
                      (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        self.client.login(username="testuser2", password="test1234")
        self.assertEqual(self.client.post(dataset_url(self.task)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Task.objects.filter(tags__contains=datasets.TAG).exists())

    def test_a_task_becomes_its_own_dataset_with_its_name_and_no_task_beside_it(self):
        before = self.tasks_in_project()
        res = self.client.post(dataset_url(self.task))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["id"], str(self.task.id))
        self.assertEqual(self.tasks_in_project(), before)
        self.task.refresh_from_db()
        self.assertTrue(datasets.is_dataset(self.task))
        self.assertEqual(self.task.tags, "roof .dji-thermal-task .dji-thermal-dataset")
        self.assertEqual(self.task.name, "Thermal")
        self.assertTrue(os.path.isdir(datasets.images_path(self.task)))
        detail = self.client.get("/api/plugins/dji-thermal/datasets/{}".format(self.task.id)).data
        self.assertEqual((detail["name"], detail["in_task"], detail["parent"]["name"]), ("Thermal", True, "Thermal"))

    def test_a_task_that_is_a_dataset_gets_itself_again(self):
        self.client.post(dataset_url(self.task))
        res = self.client.post(dataset_url(self.task))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["id"], str(self.task.id))
        self.task.refresh_from_db()
        self.assertEqual(self.task.tags.split().count(datasets.TAG), 1)

    def test_a_task_linked_to_a_dataset_gets_that_one(self):
        holder = datasets.create(self.project, "Flight", User.objects.get(username="testuser"))
        self.addCleanup(shutil.rmtree, holder.task_path(), True)
        Task.objects.filter(pk=self.task.pk).update(tags="roof .dji-thermal-from-{}".format(holder.id))
        res = self.client.post(dataset_url(self.task))
        self.assertEqual((res.status_code, res.data["id"]), (status.HTTP_200_OK, str(holder.id)))

    def test_renaming_the_dataset_renames_its_task_without_the_holder_s_prefix(self):
        self.client.post(dataset_url(self.task))
        self.client.patch("/api/plugins/dji-thermal/datasets/{}".format(self.task.id), {"name": "Roof"}, format="json")
        self.task.refresh_from_db()
        self.assertEqual(self.task.name, "Roof")

    def test_deleting_the_dataset_keeps_its_task_as_it_was(self):
        self.client.post(dataset_url(self.task))
        res = self.client.delete("/api/plugins/dji-thermal/datasets/{}".format(self.task.id))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.task.refresh_from_db()
        self.assertEqual((self.task.name, self.task.tags), ("Thermal", "roof .dji-thermal-task"))
        self.assertFalse(os.path.exists(datasets.data_path(self.task)))
        res = self.client.post(dataset_url(self.task))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_an_owner_over_quota_gets_no_dataset(self):
        with mock.patch.object(datasets, "over_quota", return_value=True):
            res = self.client.post(dataset_url(self.task))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("quota", str(res.data))
        self.task.refresh_from_db()
        self.assertFalse(datasets.is_dataset(self.task))


class TestTaskWorkset(ApiTestCase):
    """DJI Thermal Task normalized or harmonized: the photos in the task's dataset, converted in a workset of it"""
    def setUp(self):
        super().setUp()
        self.task.tags = ".dji-thermal-task"
        self.task.auto_processing_node = True
        self.task.save()
        self.url = "/api/plugins/dji-thermal/projects/{}/tasks/{}/workset".format(self.project.id, self.task.id)

    def made_dataset(self, *photos):
        self.client.post(dataset_url(self.task))
        self.task.refresh_from_db()
        res = self.client.post("/api/plugins/dji-thermal/datasets/{}/upload".format(self.task.id),
                               {"images": list(photos) or [jpeg_upload()]}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)

    def test_a_workset_needs_a_partial_task_that_is_a_dataset_with_photos_and_normalizing(self):
        self.assertIn("not a dataset", str(self.client.post(self.url, {"settings": {"normalize": True}}, format="json").data))
        self.client.post(dataset_url(self.task))
        self.assertIn("photos", str(self.client.post(self.url, {"settings": {"normalize": True}}, format="json").data))
        self.made_dataset()
        self.assertIn("Normalize or harmonize", str(self.client.post(self.url, {"settings": {}}, format="json").data))
        Task.objects.filter(pk=self.task.pk).update(partial=False)
        self.assertIn("already been committed", str(self.client.post(self.url, {"settings": {"normalize": True}}, format="json").data))
        self.assertEqual(conversions.ids(self.task), [])

    def test_the_workset_has_the_panel_s_values_and_commits_the_task_to_its_node_once_converted(self):
        self.made_dataset()
        with mock.patch.object(datasets, "start_job"):
            res = self.client.post(self.url, {"settings": {"harmonize": True, "emissivity": "0.9", "unit": "F",
                                                           "reflected_temp": "70", "distance": "embedded"}}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        record = conversions.record(self.task, res.data["id"])
        self.assertEqual(record["name"], "DJI Thermal Task")
        self.assertEqual({k: record["settings"][k] for k in ("normalize", "harmonize", "emissivity", "unit", "reflected_temp",
                                                             "distance", "outputs", "mosaics")},
                         {"normalize": True, "harmonize": True, "emissivity": 0.9, "unit": "F", "reflected_temp": 70.0,
                          "distance": "embedded", "outputs": ["temp_c:tiff"], "mosaics": True})
        self.assertEqual(record["then"], {"processing_node": None, "auto_processing_node": True})

    def test_once_converted_the_task_gets_the_tiffs_keeps_its_text_files_and_is_committed(self):
        self.made_dataset()
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(self.task, "DJI Thermal Task", dict(conversions.DEFAULTS, normalize=True),
                                     User.objects.get(username="testuser"))
        out = conversions.output_path(self.task, cid)
        for name in ("DJI_0001_T_temp_c.tiff", "DJI_0002_T_temp_c.tiff"):
            with open(os.path.join(out, name), "wb") as f:
                f.write(b"II*\0")
        datasets.write_json(conversions.path(self.task, cid, conversions.RESULTS_FILE), {"files": [
            {"path": n.replace("_temp_c.tiff", ".JPG"), "ok": True, "outputs": [n]} for n in os.listdir(out) if n.endswith(".tiff")]})
        with open(self.task.get_image_path("gcp_list.txt"), "w") as f:
            f.write("EPSG:4326\n")
        with mock.patch("worker.tasks.process_task") as process:
            conversion_tasks.commit_parent(self.task, cid, {"processing_node": None, "auto_processing_node": True})
        self.task.refresh_from_db()
        self.assertEqual((self.task.partial, self.task.auto_processing_node, self.task.images_count), (False, True, 3))
        self.assertEqual(sorted(self.task.scan_images()), ["DJI_0001_T_temp_c.tiff", "DJI_0002_T_temp_c.tiff", "gcp_list.txt"])
        process.delay.assert_called_once_with(self.task.id)

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flight_normalized_through_a_workset_is_committed_with_its_tiffs(self):
        frames = [f for f in jpegs_in("DJI_THERMAL_FLIGHT_DIR") if f.upper().endswith("_T.JPG")][:3]
        with contextlib.ExitStack() as stack:
            self.made_dataset(*[stack.enter_context(open(f, "rb")) for f in frames])
        with mock.patch("worker.tasks.process_task") as process:
            res = self.client.post(self.url, {"settings": {"normalize": True}}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(conversions.job(self.task, res.data["id"])["status"], "ready")
        self.task.refresh_from_db()
        self.assertFalse(self.task.partial)
        self.assertEqual(sorted(self.task.scan_images()),
                         sorted(os.path.splitext(os.path.basename(f))[0] + "_temp_c.tiff" for f in frames))
        process.delay.assert_called_once_with(self.task.id)
