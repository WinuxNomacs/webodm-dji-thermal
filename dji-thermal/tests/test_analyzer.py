"""
Tests of the Thermal Analyzer's datasets: their holder tasks, uploads, the analysis (run by WebODM's worker, which the
tests run in place), and who sees and changes what.

The tests with real R-JPEGs read them from DJI_THERMAL_FLIGHT_DIR and are skipped without it.
"""
import contextlib
import importlib
import io
import os
import shutil
import zipfile
from unittest import mock

from django.contrib.auth.models import User
from guardian.shortcuts import assign_perm
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from app.tests.classes import BootTestCase
from worker.tasks import get_pending_tasks

from .test_converter import jpegs_in, skip_without

datasets = importlib.import_module("coreplugins.dji-thermal.datasets")
analysis = importlib.import_module("coreplugins.dji-thermal.analysis")
conversions = importlib.import_module("coreplugins.dji-thermal.conversions")

API = "/api/plugins/dji-thermal/datasets"


def jpeg(name):
    f = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 80, 40)).save(f, format="JPEG")
    f.seek(0)
    f.name = name
    return f


class AnalyzerTestCase(BootTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.get(username="testuser")
        self.project = Project.objects.get(owner=self.user)
        self.client = self.client_for("testuser")

    def client_for(self, username):
        client = APIClient()
        client.login(username=username, password="test1234")
        return client

    def create(self, name="Roof", client=None, project=None):
        res = (client or self.client).post(API, {"name": name, "project": (project or self.project).id}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        task = Task.objects.get(pk=res.data["id"])
        self.addCleanup(shutil.rmtree, task.task_path(), True)
        return task

    def upload(self, task, files, paths=None, client=None):
        data = {"images": files}
        if paths is not None:
            data["paths"] = paths
        return (client or self.client).post("{}/{}/upload".format(API, task.id), data, format="multipart")


class TestHolderTask(AnalyzerTestCase):
    def test_a_dataset_is_kept_in_a_task_webodm_never_processes(self):
        task = self.create("Roof")
        self.assertEqual(task.name, "Thermal dataset: Roof")
        self.assertEqual(task.tags, ".dji-thermal-dataset")
        self.assertFalse(task.partial)
        self.assertFalse(task.auto_processing_node)
        self.assertIsNone(task.processing_node)
        self.assertNotIn(task, get_pending_tasks())
        self.assertEqual(task.scan_images(), [])

    def test_its_name_is_the_tasks_and_renaming_changes_both(self):
        task = self.create("Roof")
        res = self.client.patch("{}/{}".format(API, task.id), {"name": "North roof"}, format="json")
        self.assertEqual(res.data["name"], "North roof")
        task.refresh_from_db()
        self.assertEqual(task.name, "Thermal dataset: North roof")

    def test_a_dataset_needs_a_name_and_a_project_the_user_can_change(self):
        res = self.client.post(API, {"name": " ", "project": self.project.id}, format="json")
        self.assertIn("name", res.data)
        other = Project.objects.get(owner__username="testuser2")
        res = self.client.post(API, {"name": "Roof", "project": other.id}, format="json")
        self.assertIn("project", res.data)
        assign_perm("view_project", self.user, other)
        res = self.client.post(API, {"name": "Roof", "project": other.id}, format="json")
        self.assertIn("project", res.data)

    def test_deleting_a_dataset_deletes_its_task_and_folder(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        folder = task.task_path()
        res = self.client.delete("{}/{}".format(API, task.id))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Task.objects.filter(pk=task.id).exists())
        self.assertFalse(os.path.exists(folder))

    def test_only_tasks_with_the_tag_are_datasets(self):
        task = Task.objects.create(project=self.project, name="Thermal dataset: not one", tags="dji-thermal-dataset")
        self.assertEqual(self.client.get("{}/{}".format(API, task.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(API).data["datasets"], [])


class TestSharing(AnalyzerTestCase):
    def test_a_user_sees_the_datasets_of_the_projects_they_can_view(self):
        task = self.create("Roof")
        other = self.client_for("testuser2")
        self.assertEqual(other.get(API).data["datasets"], [])
        self.assertEqual(other.get("{}/{}".format(API, task.id)).status_code, status.HTTP_404_NOT_FOUND)

        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        found = other.get(API).data["datasets"]
        self.assertEqual([(d["name"], d["can_change"], d["can_delete"]) for d in found], [("Roof", False, False)])
        self.assertNotIn("sharing", other.get("{}/{}".format(API, task.id)).data)
        self.assertIn("testuser2", self.client.get("{}/{}".format(API, task.id)).data["sharing"]["users"])

    def test_viewing_a_project_does_not_allow_changing_its_datasets(self):
        task = self.create()
        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        other = self.client_for("testuser2")
        self.assertEqual(self.upload(task, [jpeg("a.jpg")], client=other).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.post("{}/{}/analyze".format(API, task.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.delete("{}/{}".format(API, task.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Task.objects.filter(pk=task.id).exists())

    def test_the_pages_are_for_users_who_can_see_the_dataset(self):
        task = self.create("Roof")
        self.assertContains(self.client.get("/plugins/dji-thermal/"), 'id="ta-datasets"')
        self.assertContains(self.client.get("/plugins/dji-thermal/dataset/{}".format(task.id)), "Roof")
        other = self.client_for("testuser2")
        self.assertEqual(other.get("/plugins/dji-thermal/dataset/{}".format(task.id)).status_code, 404)

    def test_the_holder_task_is_listed_by_webodms_task_api(self):
        task = self.create("Roof")
        res = self.client.get("/api/projects/{}/tasks/".format(self.project.id))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual([t["name"] for t in res.data], [task.name])


class TestUpload(AnalyzerTestCase):
    def test_images_are_kept_in_their_subfolders_and_other_files_skipped(self):
        task = self.create()
        res = self.upload(task, [jpeg("a.jpg"), jpeg("b.JPG"), jpeg("notes.txt")],
                          paths=["flight/100MEDIA/a.jpg", "../../b.JPG", "notes.txt"])
        self.assertEqual((res.data["saved"], res.data["skipped"], res.data["file_count"]), (2, ["notes.txt"], 2))
        self.assertEqual([p for p, _ in datasets.image_files(task)], ["b.JPG", "flight/100MEDIA/a.jpg"])
        self.assertEqual(task.scan_images(), [])

    def test_the_images_count_toward_the_owners_quota(self):
        task = self.create()
        before = Task.objects.get(pk=task.id).size
        self.upload(task, [jpeg("a.jpg")])
        task.refresh_from_db()
        self.assertGreater(task.size, before)
        self.assertEqual(self.user.profile.used_quota(), task.size)

    def test_an_owner_over_quota_cannot_add_images_or_datasets(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        self.user.profile.quota = 0
        self.user.profile.save()
        res = self.upload(task, [jpeg("b.jpg")])
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("quota", res.data["error"])
        res = self.client.post(API, {"name": "More", "project": self.project.id}, format="json")
        self.assertIn("quota", res.data["project"])

    def test_images_added_after_an_analysis_mark_it_out_of_date(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        self.client.post("{}/{}/analyze".format(API, task.id))
        self.assertEqual(datasets.job(task)["status"], "ready")
        self.upload(task, [jpeg("b.jpg")])
        d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual((d["status"], d["analyzed"]), ("new", True))


class TestAnalysis(AnalyzerTestCase):
    def test_a_dataset_without_images_cannot_be_analyzed(self):
        task = self.create()
        res = self.client.post("{}/{}/analyze".format(API, task.id))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_analysis_lists_every_file_and_counts_in_the_quota(self):
        task = self.create()
        self.upload(task, [jpeg("DJI_0001_V.JPG")])
        size = Task.objects.get(pk=task.id).size
        d = self.client.post("{}/{}/analyze".format(API, task.id)).data
        self.assertEqual(d["status"], "ready")
        self.assertEqual([(f["path"], f["kind"]) for f in d["analysis"]["files"]], [("DJI_0001_V.JPG", "not_thermal")])
        self.assertTrue(d["analysis"]["version"])
        self.assertGreater(Task.objects.get(pk=task.id).size, size)

    def test_a_canceled_or_restarted_run_writes_nothing(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        datasets.update_job(task, status="analyzing", run_id="old")
        datasets.cancel_analysis(task)
        self.assertEqual(analysis.analyze(str(task.id), "old"), {"canceled": True})
        self.assertEqual(datasets.job(task)["status"], "canceled")
        self.assertEqual(datasets.analysis(task), {})

    def test_a_run_finds_its_task_gone_and_writes_nothing(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        datasets.update_job(task, status="analyzing", run_id="run")
        folder = task.task_path()
        task.delete()
        self.assertFalse(datasets.finish_job(task, "run", {"files": []}))
        self.assertFalse(os.path.exists(folder))

    def test_an_analysis_whose_job_is_gone_is_marked_failed(self):
        task = self.create()
        datasets.update_job(task, status="analyzing", run_id="run", celery_task_id="gone")
        with mock.patch.object(datasets, "job_gone", return_value=True):
            d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual(d["status"], "failed")
        self.assertIn("stopped", d["error"])

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flights_frames_are_analyzed_with_the_webodm_plan(self):
        frames = [f for f in jpegs_in("DJI_THERMAL_FLIGHT_DIR") if f.upper().endswith("_T.JPG")][:6]
        task = self.create()
        with contextlib.ExitStack() as stack:
            files = [stack.enter_context(open(f, "rb")) for f in frames]
            self.assertEqual(self.upload(task, files).data["saved"], len(frames))
        d = self.client.post("{}/{}/analyze".format(API, task.id)).data
        self.assertEqual((d["status"], d["thermal"]), ("ready", len(frames)), d["error"])
        self.assertEqual(d["cameras"], ["M4T"])
        self.assertIsNotNone(d["analysis"]["webodm"])
        row = d["analysis"]["files"][0]
        self.assertLess(row["tmin"], row["tmax"])
        thumb = self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": row["path"]})
        self.assertEqual(thumb["Content-Type"], "image/jpeg")
        self.assertEqual(self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": "../x.jpg"}).status_code,
                         status.HTTP_404_NOT_FOUND)


def flight_frames(count):
    return [f for f in jpegs_in("DJI_THERMAL_FLIGHT_DIR") if f.upper().endswith("_T.JPG")][:count]


class TestConversionSettings(AnalyzerTestCase):
    def test_settings_left_out_are_dji_thermal_clis_defaults(self):
        self.assertEqual(conversions.parse_settings({}), (conversions.DEFAULTS, {}))
        self.assertEqual(conversions.parse_settings(None), (conversions.DEFAULTS, {}))

    def test_settings_are_checked_field_by_field(self):
        settings, errors = conversions.parse_settings({
            "distance": "far", "emissivity": 2, "humidity": "wet", "unit": "R", "palette": "pink",
            "outputs": ["temp_c:tif", "pseudo", "temp_c:tiff"], "replace_above_value": "nothing"})
        self.assertEqual(set(errors), {"distance", "emissivity", "humidity", "unit", "palette", "replace_above_value"})
        self.assertEqual(settings["outputs"], ["temp_c:tiff", "pseudo:png"])
        _, errors = conversions.parse_settings({"outputs": ["pseudo:exr"]})
        self.assertIn("outputs", errors)
        _, errors = conversions.parse_settings({"outputs": []})
        self.assertIn("outputs", errors)

    def test_what_dji_thermal_cli_refuses_is_reported(self):
        _, errors = conversions.parse_settings({"range_min": 10})
        self.assertIn("range_max", errors["settings"])
        settings, errors = conversions.parse_settings({"replace_above": 80, "replace_above_value": "nodata",
                                                       "distance": "12.5", "normalize": 1})
        self.assertEqual(errors, {})
        self.assertEqual((settings["distance"], settings["normalize"]), (12.5, True))

    def test_a_user_saves_and_forgets_their_defaults(self):
        url = "/api/plugins/dji-thermal/preferences"
        res = self.client.get(url)
        self.assertEqual((res.data["saved"], res.data["settings"]), (False, conversions.DEFAULTS))
        self.assertIn("temp_c", [p["product"] for p in res.data["products"]])
        self.assertIn("ironred", res.data["palettes"])
        self.assertEqual(self.client.put(url, {"settings": {"emissivity": 5}}, format="json").status_code,
                         status.HTTP_400_BAD_REQUEST)
        self.client.put(url, {"settings": {"emissivity": 0.95}}, format="json")
        res = self.client.get(url)
        self.assertEqual((res.data["saved"], res.data["settings"]["emissivity"]), (True, 0.95))
        self.assertFalse(self.client_for("testuser2").get(url).data["saved"])
        self.client.delete(url)
        self.assertFalse(self.client.get(url).data["saved"])


class TestConversions(AnalyzerTestCase):
    def convert(self, task, settings=None, name="", client=None):
        return (client or self.client).post("{}/{}/conversions".format(API, task.id),
                                            {"name": name, "settings": settings or {}}, format="json")

    def test_a_dataset_without_images_cannot_be_converted(self):
        task = self.create()
        self.assertEqual(self.convert(task).status_code, status.HTTP_400_BAD_REQUEST)

    def test_settings_refused_start_no_conversion(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        res = self.convert(task, {"emissivity": 5})
        self.assertIn("emissivity", res.data)
        self.assertEqual(conversions.ids(task), [])

    def test_a_conversion_of_no_thermal_image_fails_with_each_images_reason(self):
        task = self.create()
        self.upload(task, [jpeg("DJI_0001_V.JPG")])
        res = self.convert(task)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual((res.data["name"], res.data["status"]), ("Conversion 1", "failed"))
        self.assertIn("No image could be converted", res.data["error"])
        self.assertEqual([(f["path"], f["ok"]) for f in res.data["results"]["files"]], [("DJI_0001_V.JPG", False)])
        d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual((d["conversion_count"], d["conversions_ready"], d["busy"]), (1, 0, False))
        self.assertEqual(d["conversions"][0]["id"], res.data["id"])

    def test_a_conversion_is_renamed_and_deleted_with_its_files(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        cid = self.convert(task, name="First").data["id"]
        url = "{}/{}/conversions/{}".format(API, task.id, cid)
        self.assertEqual(self.client.patch(url, {"name": "Renamed"}, format="json").data["name"], "Renamed")
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(os.path.exists(conversions.path(task, cid)))
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_viewers_download_conversions_but_do_not_make_or_delete_them(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        cid = self.convert(task).data["id"]
        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        other = self.client_for("testuser2")
        url = "{}/{}/conversions/{}".format(API, task.id, cid)
        self.assertEqual(other.get(url).status_code, status.HTTP_200_OK)
        self.assertEqual(other.get(url + "/download").status_code, status.HTTP_200_OK)
        self.assertEqual(self.convert(task, client=other).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.delete(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.post(url + "/cancel").status_code, status.HTTP_404_NOT_FOUND)

    def test_a_canceled_conversion_stops_and_keeps_what_it_wrote(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Running", conversions.DEFAULTS, self.user)
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), run_id="run")
        res = self.client.post("{}/{}/conversions/{}/cancel".format(API, task.id, cid))
        self.assertEqual(res.data["status"], "canceled")
        self.assertEqual(conversions.convert(str(task.id), "run", cid), {"canceled": True})
        self.assertTrue(os.path.exists(conversions.path(task, cid, "conversion.json")))

    def test_a_run_of_a_deleted_conversion_leaves_no_files(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Running", conversions.DEFAULTS, self.user)
        conversions.delete(task, cid)
        os.makedirs(conversions.output_path(task, cid))     # as the run's writes would make it again
        conversions.left_behind(task, cid)
        self.assertFalse(os.path.exists(conversions.path(task, cid)))

    def test_a_conversion_whose_job_is_gone_is_marked_failed(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            conversions.create(task, "Running", conversions.DEFAULTS, self.user)
        with mock.patch.object(datasets, "job_gone", return_value=True):
            d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual(d["conversions"][0]["status"], "failed")
        self.assertIn("conversion job stopped", d["conversions"][0]["error"])

    def test_deleting_a_dataset_cancels_its_conversions(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Running", conversions.DEFAULTS, self.user)
        with mock.patch.object(conversions, "cancel") as cancel:
            self.client.delete("{}/{}".format(API, task.id))
        cancel.assert_called_once_with(mock.ANY, cid)

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flights_frames_are_converted_downloaded_and_counted_in_the_quota(self):
        frames = flight_frames(3)
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in frames])
        size = Task.objects.get(pk=task.id).size
        res = self.convert(task, {"outputs": ["temp_c:tiff", "pseudo:png"], "emissivity": 0.95}, name="Nadir")
        self.assertEqual((res.data["status"], res.data["converted"], res.data["skipped"]), ("ready", 3, 0),
                         res.data["error"])
        self.assertEqual(res.data["file_count"], 6)
        self.assertGreater(Task.objects.get(pk=task.id).size, size)
        self.assertEqual(task.scan_images(), [])

        url = "{}/{}/conversions/{}/download".format(API, task.id, res.data["id"])
        tiff = next(o for o in res.data["results"]["files"][0]["outputs"] if o.endswith(".tiff"))
        one = self.client.get(url, {"file": tiff})
        self.assertEqual(one.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", one["Content-Disposition"])
        self.assertEqual(self.client.get(url, {"file": "../conversion.json"}).status_code, status.HTTP_404_NOT_FOUND)
        everything = self.client.get(url)
        self.assertIn("filename=Roof-Nadir.zip", everything["Content-Disposition"])
        with zipfile.ZipFile(io.BytesIO(b"".join(everything.streaming_content))) as z:
            self.assertEqual(sorted(z.namelist()), sorted(conversions.output_files(task, res.data["id"])))
            self.assertEqual(len(z.namelist()), 6)
