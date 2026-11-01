"""
Tests of the Thermal Analyzer's datasets: their holder tasks, uploads, the analysis (run by WebODM's worker, which the
tests run in place), and who sees and changes what.

The tests with real R-JPEGs read them from DJI_THERMAL_FLIGHT_DIR and are skipped without it.
"""
import collections
import contextlib
import importlib
import io
import math
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
from nodeodm import status_codes
from nodeodm.models import ProcessingNode
from worker.tasks import get_pending_tasks

from .test_converter import jpegs_in, skip_without

datasets = importlib.import_module("coreplugins.dji-thermal.datasets")
analysis = importlib.import_module("coreplugins.dji-thermal.analysis")
conversions = importlib.import_module("coreplugins.dji-thermal.conversions")
mosaics = importlib.import_module("coreplugins.dji-thermal.mosaics")
colouring = importlib.import_module("coreplugins.dji-thermal.colouring")
conversion_tasks = importlib.import_module("coreplugins.dji-thermal.conversion_tasks")

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
        drawn = self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": row["path"], "palette": "rainbow1"})
        self.assertEqual(drawn["Content-Type"], "image/jpeg")
        self.assertNotEqual(drawn.content, thumb.content)
        self.assertEqual(len(os.listdir(datasets.data_path(task, "thumbnails", "rainbow1"))), 1)
        again = self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": row["path"], "palette": "rainbow1"})
        self.assertEqual(again.content, drawn.content)
        # The detail pane's: at the frame's own size, in its own DJI palette when the user's is one of WebODM's
        large = self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": row["path"], "palette": "magma", "size": "large"})
        own = self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": row["path"], "palette": row["palette"], "size": "large"})
        with Image.open(io.BytesIO(large.content)) as im:
            self.assertEqual(im.size, (row["width"], row["height"]))
        self.assertEqual(large.content, own.content)
        self.assertEqual(self.client.get("{}/{}/thumbnail".format(API, task.id), {"file": "../x.jpg"}).status_code,
                         status.HTTP_404_NOT_FOUND)


class TestDatasetFiles(AnalyzerTestCase):
    """The Files tab's detail pane: a file as uploaded, shown or downloaded, and several as a zip"""

    def setUp(self):
        super().setUp()
        self.task = self.create()
        self.assertEqual(self.upload(self.task, [jpeg("a.jpg"), jpeg("b.jpg")], paths=["a.jpg", "sub/b.jpg"]).data["saved"], 2)
        datasets.update_job(self.task, status="analyzing", run_id="run")
        datasets.finish_job(self.task, "run", {"files": [{"path": "a.jpg", "kind": "not_thermal"},
                                                         {"path": "sub/b.jpg", "kind": "not_thermal"}]})
        self.url = "{}/{}/files".format(API, self.task.id)

    def source(self, rel):
        with open(os.path.join(datasets.images_path(self.task), rel), "rb") as f:
            return f.read()

    def test_a_file_is_shown_or_downloaded_as_uploaded(self):
        res = self.client.get(self.url, {"file": "sub/b.jpg"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(res.streaming_content) if res.streaming else res.content, self.source("sub/b.jpg"))
        self.assertTrue(res["Content-Disposition"].startswith("inline"))
        res = self.client.get(self.url, {"file": "a.jpg", "download": "1"})
        self.assertTrue(res["Content-Disposition"].startswith("attachment"))

    def test_several_files_download_as_a_zip_at_their_paths(self):
        res = self.client.post(self.url, {"file": ["a.jpg", "sub/b.jpg", "a.jpg"]})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn(".zip", res["Content-Disposition"])
        with zipfile.ZipFile(io.BytesIO(b"".join(res.streaming_content))) as z:
            self.assertEqual(sorted(z.namelist()), ["a.jpg", "sub/b.jpg"])
            self.assertEqual(z.read("sub/b.jpg"), self.source("sub/b.jpg"))
        self.assertEqual(self.client.post(self.url, {}).status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_the_datasets_files_for_who_can_view_it(self):
        for rel in ("../x.jpg", "c.jpg", ""):
            self.assertEqual(self.client.get(self.url, {"file": rel}).status_code, status.HTTP_404_NOT_FOUND, rel)
        self.assertEqual(self.client.post(self.url, {"file": ["a.jpg", "../../x"]}).status_code, status.HTTP_404_NOT_FOUND)
        other = self.client_for("testuser2")
        self.assertEqual(other.get(self.url, {"file": "a.jpg"}).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.post(self.url, {"file": ["a.jpg"]}).status_code, status.HTTP_404_NOT_FOUND)


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


    def test_a_user_saves_their_palette_of_djis_or_webodms_and_the_pages_get_it(self):
        url = "/api/plugins/dji-thermal/display"
        res = self.client.get(url)
        self.assertEqual((res.data["unit"], res.data["palette"]), (None, None))
        self.assertIn("ironred", res.data["palettes"])
        self.assertIn("magma", res.data["colormaps"])
        self.assertIn("palette", self.client.put(url, {"palette": "pink"}, format="json").data)
        self.client.put(url, {"palette": "ironred"}, format="json")
        self.assertEqual(self.client.get(url).data["palette"], "ironred")
        self.client.put(url, {"palette": "magma"}, format="json")
        self.assertEqual(self.client.get(url).data["palette"], "magma")
        self.assertEqual(self.client_for("testuser2").get(url).data["palette"], None)
        self.assertContains(self.client.get("/plugins/dji-thermal/"),
                            '<script id="ta-display" type="application/json">{"unit": null, "palette": "magma"}')
        self.client.put(url, {"palette": None}, format="json")
        self.assertEqual(self.client.get(url).data["palette"], None)

    def test_a_unit_saved_before_is_handed_to_the_page_once_and_dropped_when_it_saves_again(self):
        url = "/api/plugins/dji-thermal/display"
        conversions.save_display(self.user, {"unit": "F", "palette": "ironred"})
        self.assertEqual((self.client.get(url).data["unit"], self.client.get(url).data["palette"]), ("F", "ironred"))
        res = self.client.put(url, {"unit": "K", "palette": "ironred"}, format="json")
        self.assertEqual((res.data["unit"], res.data["palette"]), (None, "ironred"))
        self.assertEqual(self.client.get(url).data["unit"], None)

    def test_new_conversions_start_with_the_preferred_palette_unless_the_saved_defaults_have_one(self):
        url = "/api/plugins/dji-thermal/preferences"
        self.client.put("/api/plugins/dji-thermal/display", {"palette": "magma"}, format="json")
        self.assertEqual(self.client.get(url).data["settings"]["palette"], None)
        self.client.put("/api/plugins/dji-thermal/display", {"palette": "ironred"}, format="json")
        self.assertEqual(self.client.get(url).data["settings"]["palette"], "ironred")
        self.client.put(url, {"settings": {"palette": "rainbow1"}}, format="json")
        self.assertEqual(self.client.get(url).data["settings"]["palette"], "rainbow1")

    def test_the_viewer_opens_in_the_preferred_palette_when_the_frames_hold_it(self):
        held = {"ironred": [], "whitehot": []}
        with mock.patch.object(mosaics, "palettes_of", return_value=held), \
                mock.patch.object(mosaics, "result", return_value={"kinds": {"as_converted": {"palette": "whitehot"}}}):
            self.assertEqual(mosaics.default_palette(None, "c", {}, "ironred"), "dji_ironred")
            self.assertEqual(mosaics.default_palette(None, "c", {}, "hotiron"), "dji_whitehot")
            self.assertEqual(mosaics.default_palette(None, "c", {}, None), "dji_whitehot")
            self.assertEqual(mosaics.default_palette(None, "c", {}, "magma"), "magma")


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
        self.assertEqual((res.data["name"], res.data["status"]), ("Workset 1", "failed"))
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
        res = self.convert(task, {"outputs": ["temp_c:tiff", "pseudo:png"], "emissivity": 0.95, "mosaics": False},
                           name="Nadir")
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


def web_mercator_tile(lon, lat, z):
    """The (z, x, y) of the Web Mercator tile with a point"""
    n = 2 ** z
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return collections.namedtuple("Tile", "z x y")(z, int((lon + 180) / 360 * n), int(y))


class TestMosaics(AnalyzerTestCase):
    def converted(self, mosaics_too=False):
        """A dataset with a conversion its job says is converted (nothing converted in fact)"""
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Nadir", dict(conversions.DEFAULTS, mosaics=mosaics_too), self.user)
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), status="ready", run_id="")
        return task, cid

    def url(self, task, cid, rest=""):
        return "{}/{}/conversions/{}/mosaics{}".format(API, task.id, cid, rest)

    def test_the_source_frames_lines_are_a_black_and_a_white_pixel_either_side_of_where_frames_meet(self):
        import numpy as np
        frames = np.array([[0, 0, 1],
                           [0, 0, 1],
                           [2, 2, 2]])
        valid = np.ones(frames.shape, bool)
        valid[2, 2] = False
        first, second = mosaics.seams(frames, valid)
        self.assertEqual(first.astype(int).tolist(), [[0, 1, 0], [1, 1, 0], [0, 0, 0]])
        self.assertEqual(second.astype(int).tolist(), [[0, 0, 1], [0, 0, 1], [1, 1, 0]])

    def test_the_viewer_draws_values_as_dji_thermal_ui_does(self):
        import numpy as np
        grey = [(i << 24) | (i << 16) | (i << 8) | 255 for i in range(256)]
        # The range's ends at the palette's ends, its middle half way; no value clear
        out = colouring.colour(np.array([[0.0, 5.0, 10.0, np.nan]]), grey, (0, 10))
        self.assertEqual(out[0, :, 0].tolist(), [0, 128, 255, 0])
        self.assertEqual(out[0, :, 3].tolist(), [255, 255, 255, 0])
        # Gamma 2: a quarter of the range drawn half way along the palette
        shares = colouring.curve_shares(0, 10, {"gamma": 2.0})
        self.assertEqual(len(shares), colouring.CURVE_SAMPLES)
        self.assertAlmostEqual(colouring.colour(np.array([[2.5]]), grey, (0, 10), shares)[0, 0, 0], 128, delta=1)
        # Sharpening raises an edge (darker on its dark side, lighter on its light side) and leaves a flat area
        edge = np.where(np.arange(9) < 5, 2.0, 8.0)[np.newaxis].repeat(9, axis=0)
        plain, sharp = colouring.colour(edge, grey, (0, 10)), colouring.colour(edge, grey, (0, 10), sharpen=2.0)
        self.assertLess(sharp[4, 4, 0], plain[4, 4, 0])
        self.assertGreater(sharp[4, 5, 0], plain[4, 5, 0])
        self.assertEqual(sharp[4, 0, 0], plain[4, 0, 0])
        self.assertEqual(colouring.colour(edge, grey, (0, 10), sharpen=2.0, margin=2).shape, (5, 5, 4))
        # An isotherm keeps the palette for the values in it, and greys the others
        red = [(i << 24) | 255 for i in range(256)]
        inside = colouring.isotherm_range(colouring.parse_isotherm("between,4,6"))
        out = colouring.colour(np.array([[5.0, 2.0]]), red, (0, 10), isotherm=inside)
        self.assertEqual(out[0, :, :3].tolist(), [[128, 0, 0], [51, 51, 51]])
        self.assertEqual(colouring.parse_isotherm("above,40"), ("above", 40.0, None))
        self.assertEqual(colouring.parse_isotherm("below,5"), ("below", None, 5.0))
        self.assertEqual(colouring.parse_isotherm(""), None)
        self.assertEqual(colouring.isotherm_range(("above", 40.0, None)), (40.0, 3e38))
        for bad in ("above", "between,2,1", "near,3", "above,x"):
            with self.assertRaises(ValueError, msg=bad):
                colouring.parse_isotherm(bad)
        # The equalization's curve rises from 0 to 1, steepest where most values are
        values = np.concatenate([np.full(900, 20.0), np.linspace(10, 30, 100)])
        curve = colouring.equalization(colouring.value_histogram(values, (10, 30)), 10, 30)
        self.assertEqual((curve[1][0], curve[1][-1]), (0.0, 1.0))
        self.assertTrue(np.all(np.diff(curve[1]) >= 0))
        self.assertGreater(np.interp(20.1, *curve) - np.interp(19.9, *curve), 0.5)
        # The adjustments checked, none by default; the unsharp mask's sigma in the pixels drawn
        self.assertEqual(colouring.parse_adjust({}), {"gamma": 1.0, "equalize": False, "sharpen": 0.0})
        self.assertEqual(colouring.parse_adjust({"gamma": "2", "equalize": "1", "sharpen": "1.5"}),
                         {"gamma": 2.0, "equalize": True, "sharpen": 1.5})
        for bad in ({"gamma": "9"}, {"gamma": "x"}, {"sharpen": "-1"}, {"equalize": "2"}):
            with self.assertRaises(ValueError, msg=bad):
                colouring.parse_adjust(bad)
        self.assertEqual(colouring.sharpen_sigma(0.02, 0.01), 2.0)
        self.assertEqual((colouring.sharpen_sigma(0.01, 1), colouring.sharpen_sigma(1, 0.01)), colouring.SIGMA_LIMITS)
        self.assertAlmostEqual(mosaics.tile_pixel_m(0, 0), 40075016.686 / 256, delta=1)

    def test_a_frames_pixels_angles_are_from_its_camera_model(self):
        import numpy as np
        # Looking straight down, the frame's top to the north: forward is down, right is east, the image's down south
        model = {'width': 5, 'height': 3, 'focal_px': 2.0, 'principal_point_px': [2.0, 1.0],
                 'ned_to_camera': [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]}
        angles = mosaics.pixel_angles(model)
        self.assertEqual(angles.shape, (3, 5))
        self.assertAlmostEqual(angles[1, 2], 0)
        self.assertAlmostEqual(angles[1, 4], 45)
        self.assertAlmostEqual(angles[1, 0], 45)
        self.assertAlmostEqual(angles[0, 2], np.degrees(np.arctan(0.5)))

    def test_mosaics_are_built_only_of_a_converted_conversion_by_who_can_change_it(self):
        task, cid = self.converted()
        self.assertEqual(self.client.get(self.url(task, cid)).data["mosaic_status"], "")
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), status="converting")
        self.assertEqual(self.client.post(self.url(task, cid)).status_code, status.HTTP_400_BAD_REQUEST)
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), status="ready")
        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        self.assertEqual(self.client_for("testuser2").post(self.url(task, cid)).status_code, status.HTTP_404_NOT_FOUND)
        with mock.patch.object(datasets, "over_quota", return_value=True):
            self.assertEqual(self.client.post(self.url(task, cid)).status_code, status.HTTP_400_BAD_REQUEST)
        with mock.patch.object(datasets, "start_job") as start:
            res = self.client.post(self.url(task, cid))
        self.assertEqual((res.status_code, res.data["mosaic_status"]), (status.HTTP_200_OK, "building"))
        start.assert_called_once()
        self.assertEqual(self.client.post(self.url(task, cid)).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.client.get("{}/{}".format(API, task.id)).data["busy"])

    def test_a_failed_build_keeps_no_mosaic_files_and_says_why(self):
        task, cid = self.converted()
        with mock.patch.object(datasets, "start_job"):
            mosaics.start(task, cid)
        datasets.update_job(task, rel=mosaics.rel(cid, mosaics.JOB_FILE), run_id="run")

        def build(task, cid, write_progress):
            os.makedirs(mosaics.path(task, cid, mosaics.MOSAICS_DIR, "harmonized"))
            raise RuntimeError("No frame could be placed")

        with mock.patch.object(mosaics, "build", build):
            self.assertEqual(mosaics.make(str(task.id), "run", cid), {"error": "No frame could be placed"})
        d = self.client.get(self.url(task, cid)).data
        self.assertEqual((d["mosaic_status"], d["mosaic_error"]), ("failed", "No frame could be placed"))
        self.assertEqual((d["mosaic_files"], d["tabs"]), ([], []))
        self.assertFalse(os.path.exists(mosaics.path(task, cid, mosaics.MOSAICS_DIR)))
        self.assertEqual(self.client.get(self.url(task, cid, "/harmonized/tiles/20/1/1.png")).status_code,
                         status.HTTP_404_NOT_FOUND)

    def test_a_canceled_build_stops_at_its_next_progress_and_keeps_nothing(self):
        task, cid = self.converted()
        with mock.patch.object(datasets, "start_job"):
            mosaics.start(task, cid)
        datasets.update_job(task, rel=mosaics.rel(cid, mosaics.JOB_FILE), run_id="run")
        res = self.client.post("{}/{}/conversions/{}/cancel".format(API, task.id, cid))
        self.assertEqual((res.data["status"], res.data["mosaic_status"]), ("ready", "canceled"))

        def build(task, cid, write_progress):
            os.makedirs(mosaics.path(task, cid, mosaics.MOSAICS_DIR, "harmonized"))
            write_progress(0.5, now=True)

        with mock.patch.object(mosaics, "build", build):
            self.assertEqual(mosaics.make(str(task.id), "run", cid), {"canceled": True})
        self.assertFalse(os.path.exists(mosaics.path(task, cid, mosaics.MOSAICS_DIR)))
        self.assertEqual(mosaics.job(task, cid)["status"], "canceled")

    def test_a_mosaic_job_that_is_gone_is_marked_failed(self):
        task, cid = self.converted()
        with mock.patch.object(datasets, "start_job"):
            mosaics.start(task, cid)
        with mock.patch.object(datasets, "job_gone", return_value=True):
            d = self.client.get(self.url(task, cid)).data
        self.assertEqual(d["mosaic_status"], "failed")

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flights_frames_make_mosaics_shown_on_a_map_and_downloaded(self):
        frames = flight_frames(6)
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in frames])
        self.client.post("{}/{}/analyze".format(API, task.id))
        res = self.client.post("{}/{}/conversions".format(API, task.id),
                               {"name": "Nadir", "settings": {"outputs": ["temp_c:tiff"]}}, format="json")
        cid = res.data["id"]
        size = Task.objects.get(pk=task.id).size
        v = self.client.get(self.url(task, cid)).data
        self.assertEqual((v["status"], v["mosaic_status"]), ("ready", "ready"), v["mosaic_error"] or v["error"])
        self.assertEqual([t["tab"] for t in v["tabs"]], ["as_converted", "harmonized", "source_frame", "view_angle"])
        self.assertEqual(set(v["kinds"]), {"as_converted", "harmonized"})
        self.assertIn(v["default_palette"], [p["key"] for p in v["palettes"]])
        self.assertEqual(len(v["flown"]), 2)
        self.assertGreaterEqual(Task.objects.get(pk=task.id).size, size)

        tab = v["tabs"][1]
        west, south, east, north = tab["bounds"]
        lon, lat = (west + east) / 2, (south + north) / 2
        t = web_mercator_tile(lon, lat, tab["maxzoom"])
        lo, hi = tab["stats"]["percentiles"]
        tile_url = self.url(task, cid, "/harmonized/tiles/{}/{}/{}.png".format(t.z, t.x, t.y))
        tile = self.client.get(tile_url, {"color_map": "inferno", "rescale": "{},{}".format(lo, hi)})
        self.assertEqual((tile.status_code, tile["Content-Type"]), (status.HTTP_200_OK, "image/png"))
        self.assertEqual(Image.open(io.BytesIO(tile.content)).size, (256, 256))
        self.assertEqual(self.client.get(tile_url, {"color_map": "pink"}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(tile_url, {"rescale": "5,1"}).status_code, status.HTTP_400_BAD_REQUEST)
        # Drawn with gamma and Equalized: the same pixels clear, other colours; sharpened, others again
        import numpy as np
        style = {"color_map": "inferno", "rescale": "{},{}".format(lo, hi)}
        drawn = lambda r: np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))
        plain = drawn(tile)
        toned = self.client.get(tile_url, dict(style, gamma=2, equalize=1))
        self.assertEqual(toned.status_code, status.HTTP_200_OK)
        self.assertEqual((drawn(toned)[..., 3] > 0).tolist(), (plain[..., 3] > 0).tolist())
        self.assertFalse(np.array_equal(drawn(toned)[..., :3], plain[..., :3]))
        sharp = self.client.get(tile_url, dict(style, gamma=2, equalize=1, sharpen=3))
        self.assertEqual(sharp.status_code, status.HTTP_200_OK)
        self.assertFalse(np.array_equal(drawn(sharp)[..., :3], drawn(toned)[..., :3]))
        self.assertEqual(self.client.get(tile_url, dict(style, gamma=9)).status_code, status.HTTP_400_BAD_REQUEST)
        # An isotherm greys the temperatures outside it; only temperatures have one
        iso = self.client.get(tile_url, dict(style, isotherm="above,{}".format((lo + hi) / 2)))
        self.assertEqual(iso.status_code, status.HTTP_200_OK)
        self.assertFalse(np.array_equal(drawn(iso)[..., :3], plain[..., :3]))
        self.assertEqual(self.client.get(tile_url, dict(style, isotherm="between,5,1")).status_code, status.HTTP_400_BAD_REQUEST)
        angles_url = self.url(task, cid, "/view_angle/tiles/{}/{}/{}.png".format(t.z, t.x, t.y))
        self.assertEqual(self.client.get(angles_url, {"rescale": "0,20", "equalize": 1}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(angles_url, {"rescale": "0,20", "isotherm": "above,5"}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(angles_url, {"rescale": "0,20", "gamma": 2, "sharpen": 3}).status_code, status.HTTP_200_OK)
        # The colour scale's curve: linear without adjustments, Equalized from the mosaic's histogram, kept in a file
        # and read again from it
        linear = self.client.get(self.url(task, cid, "/harmonized/curve"), {"rescale": style["rescale"]}).data["shares"]
        self.assertEqual(len(linear), colouring.CURVE_SAMPLES)
        self.assertAlmostEqual(linear[32], 0.5)
        curve = self.client.get(self.url(task, cid, "/harmonized/curve"), {"rescale": style["rescale"], "equalize": 1}).data["shares"]
        self.assertEqual((len(curve), curve[0], curve[-1]), (colouring.CURVE_SAMPLES, 0.0, 1.0))
        self.assertNotAlmostEqual(curve[32], 0.5, places=2)
        self.assertEqual(self.client.get(self.url(task, cid, "/view_angle/curve"), {"rescale": "0,20", "equalize": 1}).status_code,
                         status.HTTP_400_BAD_REQUEST)
        self.assertTrue(os.path.isfile(mosaics.path(task, cid, mosaics.VIEWER_DIR, mosaics.HISTOGRAM_FILE.format("harmonized"))))
        kept = mosaics.histogram(task, cid, "harmonized")
        colouring._histograms.clear()
        with mock.patch.object(mosaics, "temperatures", side_effect=AssertionError("read again")):
            self.assertEqual(mosaics.histogram(task, cid, "harmonized")[0].tolist(), kept[0].tolist())
        # The source frames: the temperatures in the palette, with black and white lines where frames meet (white is
        # not in inferno), the whole mosaic in one tile
        whole = web_mercator_tile(lon, lat, tab["minzoom"])
        frames_tile = self.client.get(self.url(task, cid, "/source_frame/tiles/{}/{}/{}.png".format(whole.z, whole.x, whole.y)),
                                      {"color_map": "inferno", "rescale": "{},{}".format(lo, hi)})
        self.assertEqual(frames_tile.status_code, status.HTTP_200_OK)
        pixels = Image.open(io.BytesIO(frames_tile.content)).convert("RGBA").getdata()
        self.assertIn((255, 255, 255, 255), pixels)
        self.assertIn((0, 0, 0, 255), pixels)
        self.assertEqual(self.client.get(self.url(task, cid, "/harmonized/tiles/{}/0/0.png".format(t.z))).status_code,
                         status.HTTP_404_NOT_FOUND)

        p = self.client.get(self.url(task, cid, "/harmonized/point"), {"lon": lon, "lat": lat}).data
        self.assertTrue(p["valid"], p)
        self.assertLess(tab["stats"]["min"] - 1, p["temperature"])
        self.assertIn(p["frame"], v["frames"])
        self.assertTrue(set(v["frames"]) <= {os.path.basename(f) for f in frames}, v["frames"])
        outside = self.client.get(self.url(task, cid, "/harmonized/point"), {"lon": 0, "lat": 0}).data
        self.assertEqual((outside["valid"], outside["frame_pixel"]), (False, None))

        # The frames that saw a mosaic pixel's centre, the mosaic's own first; each drawn as its tab draws the mosaic,
        # the same value at the point's pixel as the mosaic's (the view angle from the frame's pixel, not the ground's)
        import rasterio
        from rasterio.warp import transform as warp
        with rasterio.open(mosaics.tab_raster(task, cid, "harmonized")[0]) as r:
            (clon,), (clat,) = warp(r.crs, "EPSG:4326", *([c] for c in r.xy(r.height // 2, r.width // 2)))
        centre = {"lon": clon, "lat": clat}
        found = self.client.get(self.url(task, cid, "/harmonized/frames"), centre).data
        self.assertTrue(found["models"])
        first = found["frames"][0]
        own = self.client.get(self.url(task, cid, "/harmonized/point"), centre).data
        self.assertEqual((first["file"], first["source"]), (own["frame"], True))
        self.assertTrue(all(not f["source"] for f in found["frames"][1:]))
        here = (math.floor(first["y"] + 0.5), math.floor(first["x"] + 0.5))
        # The frame's pixel the mosaic read the point from (its column and row), as the frames window finds it
        self.assertEqual(len(own["frame_pixel"]), 2)
        for got, want in zip(own["frame_pixel"], (here[1], here[0])):
            self.assertAlmostEqual(got, want, delta=1)
        for name, key, delta in (("harmonized", "temperature", 0.01), ("as_converted", "temperature", 0.01),
                                 ("view_angle", "view_angle", 0.2)):
            want = self.client.get(self.url(task, cid, "/{}/point".format(name)), centre).data[key]
            self.assertAlmostEqual(mosaics.frame_values(task, cid, name, first["index"])[here], want, delta=delta, msg=name)
        image = self.client.get(self.url(task, cid, "/harmonized/frames/{}.png".format(first["index"])),
                                {"color_map": "inferno", "rescale": "{},{}".format(lo, hi)})
        self.assertEqual((image.status_code, image["Content-Type"]), (status.HTTP_200_OK, "image/png"))
        self.assertEqual(Image.open(io.BytesIO(image.content)).size, (first["width"], first["height"]))
        self.assertEqual(self.client.get(self.url(task, cid, "/harmonized/frames/999.png")).status_code,
                         status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(self.url(task, cid, "/harmonized/frames"), {"lon": 0, "lat": 0}).data["frames"], [])

        # The Thermal Inspector lays the project's mosaics on WebODM's map: listed for who can view the project, their
        # temperature tabs only; a region and an isotherm read them. This project has no map in WebODM (no finished task
        # with an orthophoto), so no link to one
        self.assertFalse(v["project_map"])
        listed_url = "/api/plugins/dji-thermal/projects/{}/inspector/mosaics".format(task.project.id)
        listed = self.client.get(listed_url).data["mosaics"]
        self.assertEqual([(m["dataset"]["id"], m["workset"]["id"]) for m in listed], [(str(task.id), cid)])
        self.assertEqual([t["tab"] for t in listed[0]["tabs"]], ["as_converted", "harmonized", "source_frame"])
        self.assertIn(listed[0]["default_palette"], listed[0]["palettes"])
        self.assertEqual(listed[0]["tasks"], [])      # no WebODM task processed its TIFFs
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(other.get(listed_url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(APIClient().get(listed_url).status_code, status.HTTP_404_NOT_FOUND)
        d = (east - west) / 10
        square = {"type": "Polygon", "coordinates": [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d],
                                                      [lon - d, lat + d], [lon - d, lat - d]]]}
        region = self.client.post(self.url(task, cid, "/harmonized/region"), {"geometry": square}, format="json").data
        self.assertTrue(region["valid"], region)
        st = region["statistics"]
        self.assertTrue(tab["stats"]["min"] - 0.01 <= st["min"] <= p["temperature"] <= st["max"] <= tab["stats"]["max"] + 0.01)
        self.assertEqual(self.client.post(self.url(task, cid, "/view_angle/region"), {"geometry": square}, format="json").status_code,
                         status.HTTP_400_BAD_REQUEST)
        # A line across the point: its profile names the frame each sample came from, the point's among them
        line = {"type": "LineString", "coordinates": [[lon - d, lat], [lon + d, lat]]}
        profile = self.client.post(self.url(task, cid, "/harmonized/region"), {"geometry": line}, format="json").data["profile"]
        self.assertEqual(len(profile["frames"]), len(profile["values"]))
        self.assertIn(p["frame"], profile["frames"])
        self.assertTrue(set(profile["frames"]) - {None} <= set(v["frames"]), profile["frames"])
        isotherm_url = self.url(task, cid, "/harmonized/isotherm/{}/{}/{}.png".format(t.z, t.x, t.y))
        painted = drawn(self.client.get(isotherm_url, {"low": (lo + hi) / 2, "color": "e53935"}))[..., 3]
        self.assertTrue(0 < (painted == 255).sum() < (plain[..., 3] > 0).sum())
        self.assertEqual(self.client.get(isotherm_url, {"low": 30}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(self.url(task, cid, "/view_angle/isotherm/{}/{}/{}.png".format(t.z, t.x, t.y)),
                                         {"low": 5, "color": "e53935"}).status_code, status.HTTP_400_BAD_REQUEST)

        download = "{}/{}/conversions/{}/download".format(API, task.id, cid)
        name = v["kinds"]["harmonized"]["files"][0]
        self.assertEqual(self.client.get(download, {"mosaic": "harmonized/" + name}).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(download, {"mosaic": "../conversion.json"}).status_code,
                         status.HTTP_404_NOT_FOUND)
        with zipfile.ZipFile(io.BytesIO(b"".join(self.client.get(download).streaming_content))) as z:
            self.assertIn("mosaics/harmonized/" + name, z.namelist())

        # Built again: a new build time, so new tile URLs
        built_at = v["built_at"]
        self.client.post(self.url(task, cid))
        self.assertNotEqual(self.client.get(self.url(task, cid)).data["built_at"], built_at)


PLAN = {'process_args': ['--normalize', '--max-pitch', '-80', '--emissivity', '0.95', '--outputs', 'temp_c:tiff'],
        'recommended': {'radiometric-calibration': {'value': 'none', 'reason': "already temperatures"},
                        'orthophoto-resolution': {'value': 6.2, 'reason': "the frames' GSD"}},
        'consider': {'fast-orthophoto': {'value': True, 'reason': "flat ground"}}}


class TestConversionTasks(AnalyzerTestCase):
    def converted(self, frames=("a/DJI_0001_T.JPG", "b/DJI_0001_T.JPG", "b/DJI_0002_T.JPG"), task=None, **settings):
        """A dataset (or another conversion of `task`) with a WebODM plan and a converted conversion whose results name
        a TIFF per frame (small files in place of the TIFFs)"""
        if task is None:
            task = self.create()
            self.upload(task, [jpeg("a.jpg")])
            datasets.write_json(datasets.data_path(task, datasets.ANALYSIS_FILE), {'webodm': PLAN})
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Nadir", dict(conversions.DEFAULTS, mosaics=False, **settings), self.user)
        files = []
        for f in frames:
            out = f.rsplit(".", 1)[0] + "_temp_c.tiff"
            path = os.path.join(conversions.output_path(task, cid), out)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fp:
                fp.write(b"II*\0" + f.encode())
            files.append({'path': f, 'ok': True, 'outputs': [out, out.replace("_temp_c.tiff", "_pseudo.png")]})
        datasets.write_json(conversions.path(task, cid, conversions.RESULTS_FILE), {'files': files})
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), status="ready", run_id="")
        return task, cid

    def url(self, task, cid):
        return "{}/{}/conversions/{}/task".format(API, task.id, cid)

    def test_a_task_is_made_of_the_conversions_tiffs_and_waits_for_a_processing_node(self):
        task, cid = self.converted(normalize=True, max_pitch=-80.0, emissivity=0.95)
        info = self.client.get(self.url(task, cid)).data
        self.assertEqual((info["problems"], info["warnings"], info["frames"]), ([], [], 3))
        self.assertEqual([o["name"] for o in info["options"]],
                         ["radiometric-calibration", "orthophoto-resolution", "fast-orthophoto"])
        self.assertEqual((info["name"], info["can_create"]), ("Roof - Nadir", True))

        res = self.client.post(self.url(task, cid), {"name": "Roof thermal", "options": [
            {"name": "radiometric-calibration", "value": "none"}, {"name": "orthophoto-resolution", "value": 6.2}]},
            format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        new = Task.objects.get(pk=res.data["id"])
        self.addCleanup(shutil.rmtree, new.task_path(), True)
        self.assertEqual((new.project, new.name, new.partial, new.auto_processing_node, new.processing_node),
                         (self.project, "Roof thermal", False, False, None))
        self.assertEqual(new.options, [{"name": "radiometric-calibration", "value": "none"},
                                       {"name": "orthophoto-resolution", "value": 6.2}])
        # A name two subfolders share keeps its folders
        self.assertEqual(sorted(new.scan_images()), ["DJI_0002_T_temp_c.tiff", "a_DJI_0001_T_temp_c.tiff",
                                                     "b_DJI_0001_T_temp_c.tiff"])
        self.assertEqual(new.images_count, 3)
        self.assertGreater(new.size, 0)
        # Its hidden tag names the dataset, for the dashboard's Thermal dataset button
        self.assertEqual(new.tags, ".dji-thermal-from-{}".format(task.id))
        src = os.path.join(conversions.output_path(task, cid), "a", "DJI_0001_T_temp_c.tiff")
        self.assertTrue(os.path.samefile(src, new.task_path("a_DJI_0001_T_temp_c.tiff")))
        self.assertNotIn(new, get_pending_tasks())

        # Listed on the conversion and counted on the dataset
        d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual([t["id"] for t in d["conversions"][0]["tasks"]], [str(new.id)])
        self.assertEqual(d["task_count"], 1)

        # Given a node, as WebODM's Edit panel does, it is processed
        new.processing_node = ProcessingNode.objects.create(hostname="localhost", port=11223)
        new.save()
        self.assertIn(new, get_pending_tasks())

        # Deleting the conversion keeps the task's images
        self.client.delete("{}/{}/conversions/{}".format(API, task.id, cid))
        self.assertEqual(len(new.scan_images()), 3)

    def test_what_stops_a_task_is_refused_and_where_it_is_off_the_plan_is_said(self):
        tasks = Task.objects.exclude(tags__contains=datasets.TAG).count()
        task, cid = self.converted()
        info = self.client.get(self.url(task, cid)).data
        self.assertEqual(info["problems"], [])
        self.assertEqual(info["warnings"], [
            "Not normalized: the frames' offsets show as seams where ODM blends them",
            "Oblique frames kept: the plan leaves out frames above -80° pitch",
            "Emissivity as recorded, the plan's is 0.95"])

        for settings, problem in (({"strip_location": True}, "stripped the frames' location"),
                                  ({}, "at least 2 frames")):
            task, cid = self.converted(frames=("DJI_0001_T.JPG",), **settings)
            self.assertIn(problem, " ".join(self.client.get(self.url(task, cid)).data["problems"]))
            res = self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json")
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        datasets.update_job(task, rel=conversions.rel(cid, "job.json"), status="converting")
        self.assertIn("The workset is not finished converting", self.client.get(self.url(task, cid)).data["problems"])
        self.assertEqual(Task.objects.exclude(tags__contains=datasets.TAG).count(), tasks)

    def test_options_refused_or_tiffs_gone_make_no_task(self):
        task, cid = self.converted()
        before = Task.objects.count()
        for options in ("--fast", [{"name": "dsm"}], [{"name": "", "value": 1}]):
            res = self.client.post(self.url(task, cid), {"name": "x", "options": options}, format="json")
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST, options)
        shutil.rmtree(conversions.output_path(task, cid))
        res = self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json")
        self.assertEqual(res.data["error"], "The workset's TIFFs are no longer on the server")
        self.assertEqual(Task.objects.count(), before)
        with mock.patch.object(datasets, "over_quota", return_value=True):
            self.assertEqual(self.client.post(self.url(task, cid), {"name": "x"}, format="json").status_code,
                             status.HTTP_400_BAD_REQUEST)

    def test_viewers_see_what_a_task_would_be_but_do_not_make_one(self):
        task, cid = self.converted()
        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        viewer = self.client_for("testuser2")
        self.assertFalse(viewer.get(self.url(task, cid)).data["can_create"])
        self.assertEqual(viewer.post(self.url(task, cid), {"name": "x"}, format="json").status_code,
                         status.HTTP_404_NOT_FOUND)

    def test_a_task_deleted_in_webodm_is_no_longer_listed(self):
        task, cid = self.converted()
        res = self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json")
        Task.objects.get(pk=res.data["id"]).delete()
        self.assertEqual(self.client.get("{}/{}/conversions/{}".format(API, task.id, cid)).data["tasks"], [])

    def test_a_task_made_without_the_link_tag_gets_it_when_the_dataset_is_listed(self):
        task, cid = self.converted()
        made = Task.objects.get(pk=self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json").data["id"])
        self.addCleanup(shutil.rmtree, made.task_path(), True)
        Task.objects.filter(pk=made.pk).update(tags="survey")
        self.assertEqual(self.client.get(API).status_code, status.HTTP_200_OK)
        self.assertEqual(Task.objects.get(pk=made.pk).tags, "survey .dji-thermal-from-{}".format(task.id))

    def test_tasks_made_from_a_deleted_dataset_no_longer_link_to_it(self):
        task, cid = self.converted()
        made = Task.objects.get(pk=self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json").data["id"])
        self.addCleanup(shutil.rmtree, made.task_path(), True)
        Task.objects.filter(pk=made.pk).update(tags="survey {} roof".format(made.tags))
        self.assertEqual(self.client.delete("{}/{}".format(API, task.id)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Task.objects.get(pk=made.pk).tags, "survey roof")

        # A dataset whose own task is kept as an ordinary task unlinks them too
        task, cid = self.converted()
        made = Task.objects.get(pk=self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json").data["id"])
        self.addCleanup(shutil.rmtree, made.task_path(), True)
        self.client.post(self.parent_url(task, cid), format="json")
        self.client.delete("{}/{}".format(API, task.id))
        self.assertEqual((Task.objects.get(pk=made.pk).tags, Task.objects.get(pk=task.pk).tags), ("", ""))

    def parent_url(self, task, cid):
        return "{}/{}/conversions/{}/parent".format(API, task.id, cid)

    def test_a_conversion_sent_to_the_datasets_task_replaces_what_was_sent_there_before(self):
        task, cid = self.converted()
        res = self.client.post(self.parent_url(task, cid), format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual((res.data["images_count"], res.data["conversion"], res.data["processed"]), (3, cid, False))
        task.refresh_from_db()
        self.assertEqual(sorted(task.scan_images()), ["DJI_0002_T_temp_c.tiff", "a_DJI_0001_T_temp_c.tiff",
                                                      "b_DJI_0001_T_temp_c.tiff"])
        self.assertEqual((task.images_count, task.processing_node, task.auto_processing_node), (3, None, False))
        # A task without options gets the plan's recommended ones; it waits for a node, and is still the dataset
        self.assertEqual(task.options, [{"name": "radiometric-calibration", "value": "none"},
                                        {"name": "orthophoto-resolution", "value": 6.2}])
        self.assertNotIn(task, get_pending_tasks())
        d = self.client.get("{}/{}".format(API, task.id)).data
        self.assertEqual((d["name"], d["parent"]["conversion"], len(d["conversions"])), ("Roof", cid, 1))

        # Processed in WebODM, its options changed there
        node = ProcessingNode.objects.create(hostname="localhost", port=11223)
        os.makedirs(task.assets_path(), exist_ok=True)
        with open(task.assets_path("orthophoto.tif"), "wb") as fp:
            fp.write(b"II*\0")
        Task.objects.filter(pk=task.pk).update(status=status_codes.COMPLETED, uuid="old-uuid", processing_node=node,
                                               available_assets=["orthophoto.tif"], options=[{"name": "dsm", "value": True}])
        self.assertTrue(self.client.get("{}/{}".format(API, task.id)).data["parent"]["processed"])

        # Another conversion replaces its images and what it processed; its options are kept
        task, cid2 = self.converted(frames=("DJI_0005_T.JPG", "DJI_0006_T.JPG"), task=task)
        with mock.patch.object(ProcessingNode, "remove_task") as remove:
            res = self.client.post(self.parent_url(task, cid2), format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        remove.assert_called_once_with("old-uuid")
        task.refresh_from_db()
        self.assertEqual(sorted(task.scan_images()), ["DJI_0005_T_temp_c.tiff", "DJI_0006_T_temp_c.tiff"])
        self.assertEqual((task.status, task.uuid, task.processing_node, task.available_assets, task.images_count),
                         (None, "", None, [], 2))
        self.assertFalse(os.path.exists(task.assets_path("orthophoto.tif")))
        self.assertEqual(task.options, [{"name": "dsm", "value": True}])
        self.assertEqual(res.data["conversion"], cid2)
        # The conversion's own files are untouched
        self.assertTrue(os.path.isfile(os.path.join(conversions.output_path(task, cid), "a", "DJI_0001_T_temp_c.tiff")))

    def test_a_conversions_tiffs_are_held_by_the_tasks_made_from_it_and_by_the_datasets_own_while_last_sent_there(self):
        # The tasks whose orthophotos the Thermal Inspector shows the conversion's source frames on
        task, cid = self.converted()
        task, cid2 = self.converted(frames=("DJI_0005_T.JPG", "DJI_0006_T.JPG"), task=task)
        made = Task.objects.get(pk=self.client.post(self.url(task, cid), {"name": "x", "options": []}, format="json").data["id"])
        self.addCleanup(shutil.rmtree, made.task_path(), True)
        self.assertEqual((conversion_tasks.holding(task, cid), conversion_tasks.holding(task, cid2)), ([str(made.id)], []))
        self.client.post(self.parent_url(task, cid2), format="json")
        self.assertEqual((conversion_tasks.holding(task, cid), conversion_tasks.holding(task, cid2)), ([str(made.id)], [str(task.id)]))
        self.client.post(self.parent_url(task, cid), format="json")
        self.assertEqual((conversion_tasks.holding(task, cid), conversion_tasks.holding(task, cid2)),
                         ([str(made.id), str(task.id)], []))

    def test_the_datasets_task_is_not_replaced_while_it_processes_nor_by_a_conversion_it_cannot_use(self):
        task, cid = self.converted()
        Task.objects.filter(pk=task.pk).update(status=status_codes.RUNNING)
        res = self.client.post(self.parent_url(task, cid), format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("processing in WebODM", str(res.data))
        self.assertEqual(Task.objects.get(pk=task.pk).scan_images(), [])

        task, cid = self.converted(frames=("DJI_0001_T.JPG",))
        self.assertEqual(self.client.post(self.parent_url(task, cid), format="json").status_code, status.HTTP_400_BAD_REQUEST)
        assign_perm("view_project", User.objects.get(username="testuser2"), self.project)
        viewer = self.client_for("testuser2")
        task, cid = self.converted()
        self.assertEqual(viewer.post(self.parent_url(task, cid), format="json").status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_a_dataset_keeps_the_task_a_conversion_was_sent_to(self):
        task, cid = self.converted()
        self.client.post(self.parent_url(task, cid), format="json")
        res = self.client.delete("{}/{}".format(API, task.id))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        kept = Task.objects.get(pk=task.pk)
        self.assertEqual((kept.name, datasets.is_dataset(kept), len(kept.scan_images())), ("Roof", False, 3))
        self.assertFalse(os.path.exists(datasets.data_path(kept)))
        self.assertNotIn(str(kept.id), [d["id"] for d in self.client.get(API).data["datasets"]])

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flights_conversion_makes_a_task_of_thermal_tiffs(self):
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in flight_frames(3)])
        conv = self.client.post("{}/{}/conversions".format(API, task.id),
                                {"name": "Nadir", "settings": {"outputs": ["temp_c:tiff"], "mosaics": False}},
                                format="json").data
        self.assertEqual(conv["status"], "ready", conv["error"])
        res = self.client.post(self.url(task, conv["id"]), {"name": "Thermal", "options": [
            {"name": "radiometric-calibration", "value": "none"}]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        new = Task.objects.get(pk=res.data["id"])
        self.addCleanup(shutil.rmtree, new.task_path(), True)
        self.assertEqual(new.images_count, 3)
        with Image.open(new.task_path(min(new.scan_images()))) as im:
            self.assertEqual(im.mode, "F")
