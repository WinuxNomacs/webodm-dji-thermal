"""
Tests of the Analyzer's frame page API (frames.py, frames_api.py): a workset's frames measured as it converted them or
with parameters changed, their values, shapes measured in their pixels, downloads and saved measurements.

The flight test reads R-JPEGs from DJI_THERMAL_FLIGHT_DIR and is skipped without it.
"""
import contextlib
import importlib
import io
import math
from unittest import mock

import numpy as np
from django.contrib.auth.models import User
from guardian.shortcuts import assign_perm
from rest_framework import status

from .test_analyzer import API, AnalyzerTestCase, flight_frames, jpeg
from .test_converter import skip_without

conversions = importlib.import_module("coreplugins.dji-thermal.conversions")
datasets = importlib.import_module("coreplugins.dji-thermal.datasets")
frames = importlib.import_module("coreplugins.dji-thermal.frames")
colouring = importlib.import_module("coreplugins.dji-thermal.colouring")
frames_api = importlib.import_module("coreplugins.dji-thermal.frames_api")


def square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


class TestShapesOnAFrame(AnalyzerTestCase):
    def setUp(self):
        super().setUp()
        self.values = np.full((40, 60), 20.0)
        self.values[10:20, 30:40] = 50.0        # a hot square
        self.values[0, :] = np.nan

    def test_a_region_measures_the_pixels_it_touches_and_its_surroundings(self):
        r = frames.region(self.values, square(30, 10, 40, 20), isotherm=(40, None))
        s = r["statistics"]
        self.assertTrue(r["valid"])
        self.assertEqual((s["min"], s["max"], s["mean"]), (50.0, 50.0, 50.0))
        self.assertEqual(s["count"], 100)
        self.assertEqual((s["surroundings"], s["delta_t"]), (20.0, 30.0))
        self.assertEqual(s["isotherm_share"], 1.0)
        self.assertEqual(s["max_location"], [30.5, 10.5])

    def test_a_pin_is_its_pixels_value_and_a_line_has_a_profile_in_pixels(self):
        pin = frames.region(self.values, {"type": "Point", "coordinates": [35.2, 15.9]})
        self.assertEqual((pin["statistics"]["count"], pin["statistics"]["mean"]), (1, 50.0))
        line = frames.region(self.values, {"type": "LineString", "coordinates": [[5, 15.5], [55, 15.5]]})
        self.assertEqual(line["length"], 50.0)
        self.assertEqual(len(line["profile"]["values"]), 51)
        self.assertEqual(line["profile"]["values"][30], 50.0)
        self.assertEqual(line["profile"]["values"][0], 20.0)
        self.assertEqual(line["profile"]["points"][0], [5.0, 15.5])

    def test_a_delta_t_is_the_second_spots_pixel_less_the_firsts_with_its_length_in_pixels(self):
        line = {"type": "LineString", "coordinates": [[5.5, 15.5], [35.2, 15.9]]}
        d = frames.delta(self.values, line)
        self.assertEqual((d["valid"], d["first"], d["second"], d["delta_t"], d["reasons"]), (True, 20.0, 50.0, 30.0, [None, None]))
        self.assertAlmostEqual(d["length"], math.hypot(29.7, 0.4))
        # A spot on no data, or off the frame: no ΔT
        off = frames.delta(self.values, {"type": "LineString", "coordinates": [[3, 0.5], [100, 100]]})
        self.assertEqual((off["valid"], off["reason"], off["delta_t"], off["reasons"]), (False, "nodata", None, ["nodata", "outside_raster"]))
        for wrong in ({"type": "LineString", "coordinates": [[1, 1], [2, 2], [3, 3]]}, {"type": "LineString", "coordinates": [[1, 1], [1, 1]]},
                      {"type": "Point", "coordinates": [1, 1]}):
            with self.assertRaises(frames.FrameError):
                frames.delta(self.values, wrong)

    def test_shapes_off_the_frame_or_on_no_data_measure_nothing(self):
        self.assertEqual(frames.region(self.values, square(100, 100, 110, 110))["reason"], "outside_raster")
        self.assertEqual(frames.region(self.values, {"type": "Point", "coordinates": [3, 0.5]})["reason"], "nodata")
        with self.assertRaises(frames.FrameError):
            frames.region(self.values, {"type": "LineString", "coordinates": [[1, 1]]})
        with self.assertRaises(frames.FrameError):
            frames.region(self.values, {"type": "MultiPoint", "coordinates": [[1, 1]]})


class TestFrameSettings(AnalyzerTestCase):
    def workset(self, settings, results):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Nadir", dict(conversions.DEFAULTS, **settings), self.user)
        datasets.write_json(conversions.path(task, cid, conversions.RESULTS_FILE), results)
        return task, cid

    def test_a_harmonized_worksets_frames_take_the_flights_medians_and_lose_their_offset_in_its_unit(self):
        task, cid = self.workset({"normalize": True, "harmonize": True, "unit": "F", "ambient_temp": 70},
                                 {"normalization": {"ambient_c": 20.0, "reflected_c": 10.0},
                                  "files": [{"path": "a.jpg", "ok": True, "offset_c": 0.5}]})
        s = frames.frame_settings(task, cid)
        self.assertEqual((s.ambient_temp, s.reflected_temp, s.unit), (70, 50.0, "F"))
        self.assertEqual(frames.frame_offset(task, cid, "a.jpg"), (0.9, True))
        self.assertEqual(frames.frame_offset(task, cid, "b.jpg"), (0.0, False))
        changed = frames.frame_settings(task, cid, {"reflected_temp": 60.0, "emissivity": 0.8})
        self.assertEqual((changed.reflected_temp, changed.emissivity), (60.0, 0.8))

    def test_a_workset_that_did_not_harmonize_subtracts_nothing(self):
        task, cid = self.workset({}, {"files": [{"path": "a.jpg", "ok": True, "offset_c": None}]})
        self.assertEqual(frames.frame_offset(task, cid, "a.jpg"), (0.0, True))
        self.assertIsNone(frames.frame_settings(task, cid).reflected_temp)

    def test_changes_are_checked_as_the_workset_forms_and_blanks_left_out(self):
        self.assertEqual(frames.parse_changes({"emissivity": "0.9", "humidity": "", "palette": "x"}),
                         {"emissivity": 0.9})
        for bad in ({"emissivity": 5}, {"distance": "lrf"}, {"humidity": "wet"}):
            with self.assertRaises(frames.FrameError):
                frames.parse_changes(bad)


class TestFramePage(AnalyzerTestCase):
    def test_a_worksets_frames_are_drawn_in_the_palette_it_chose_else_in_the_users(self):
        self.assertEqual(conversions.frames_palette({"outputs": ["temp_c:tiff", "pseudo:png"], "palette": "ironred"}), "ironred")
        # DJI Thermal Task's: temperatures only, the palette its map opens in
        self.assertEqual(conversions.frames_palette({"outputs": ["temp_c:tiff"], "palette": "arctic"}), "arctic")
        # Each image's own palette: none of its own
        self.assertIsNone(conversions.frames_palette({"outputs": ["pseudo:png"], "palette": None}))
        # The frame page starts in it, over the user's preferred palette
        self.assertEqual(frames_api.default_palette({"outputs": ["temp_c:tiff"], "palette": "ironred"}, "magma"), "dji_ironred")
        self.assertEqual(frames_api.default_palette({"outputs": ["temp_c:tiff"]}, "magma"), "magma")
        self.assertEqual(frames_api.default_palette({"outputs": ["temp_c:tiff"]}, "arctic"), "dji_arctic")
        self.assertEqual(frames_api.default_palette({"outputs": ["temp_c:tiff"]}, None), "inferno")

    def url(self, task, cid, rest):
        return "{}/{}/conversions/{}/{}".format(API, task.id, cid, rest)

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_flights_frame_is_measured_as_converted_or_with_changes_drawn_measured_downloaded_and_saved(self):
        import rasterio
        found = flight_frames(2)
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in found])
        self.client.post("{}/{}/analyze".format(API, task.id))
        res = self.client.post("{}/{}/conversions".format(API, task.id),
                               {"name": "Nadir", "settings": {"outputs": ["temp_c:tiff"], "emissivity": 0.95,
                                                              "mosaics": False}}, format="json")
        cid = res.data["id"]
        self.assertEqual(res.data["status"], "ready", res.data["error"])

        page = self.client.get(self.url(task, cid, "frames")).data
        self.assertEqual(len(page["frames"]), 2)
        self.assertTrue(all(f["converted"] and f["mosaic"] is None for f in page["frames"]))
        self.assertEqual((page["unit"], page["built"], page["can_change"]), ("C", False, True))
        self.assertIn(page["default_palette"], [p["key"] for p in page["palettes"]])
        self.assertIsNone(page["frames_palette"])
        rel = page["frames"][0]["path"]

        # As converted: what the workset's own TIFF holds
        info = self.client.get(self.url(task, cid, "frame"), {"frame": rel}).data
        self.assertEqual((info["width"], info["height"]), (640, 512))
        self.assertAlmostEqual(info["params"]["emissivity"], 0.95, places=6)
        tiff = next(f for f in conversions.results(task, cid)["files"] if f["path"] == rel)["outputs"][0]
        with rasterio.open(conversions.output_path(task, cid) + "/" + tiff) as src:
            converted = src.read(1).astype(np.float64)
        values = frames.measure(task, cid, rel)["values"]
        np.testing.assert_allclose(values, converted, atol=1e-3)
        self.assertAlmostEqual(info["stats"]["mean"], float(np.nanmean(converted)), places=3)
        # Measured again with another emissivity: the SDK measured with it, and a high-emissivity surface reads cooler
        changed = self.client.get(self.url(task, cid, "frame"), {"frame": rel, "emissivity": "0.7"}).data
        self.assertAlmostEqual(changed["params"]["emissivity"], 0.7, places=6)
        self.assertEqual(changed["changes"], {"emissivity": 0.7})
        self.assertNotAlmostEqual(changed["stats"]["mean"], info["stats"]["mean"], places=1)
        self.assertEqual(self.client.get(self.url(task, cid, "frame"), {"frame": rel, "emissivity": "5"}).status_code,
                         status.HTTP_400_BAD_REQUEST)
        for other in ("../" + rel, "nope.jpg", ""):
            self.assertEqual(self.client.get(self.url(task, cid, "frame"), {"frame": other}).status_code,
                             status.HTTP_400_BAD_REQUEST)

        # Its values, as the browser decodes them, and asked again to check them
        tile = self.client.get(self.url(task, cid, "frame/values"), {"frame": rel})
        self.assertEqual((tile.status_code, tile["X-Values-Margin"]), (status.HTTP_200_OK, "0"))
        from PIL import Image
        rgba = np.asarray(Image.open(io.BytesIO(tile.content)).convert("RGBA")).astype(np.float64)
        decoded = float(tile["X-Values-Offset"]) + (rgba[..., 0] * 256 + rgba[..., 1]) * float(tile["X-Values-Step"])
        ok = np.isfinite(values)
        self.assertLessEqual(np.abs(decoded[ok] - values[ok]).max(), float(tile["X-Values-Step"]))
        again = self.client.get(self.url(task, cid, "frame/values"), {"frame": rel}, HTTP_IF_NONE_MATCH=tile["ETag"])
        self.assertEqual(again.status_code, status.HTTP_304_NOT_MODIFIED)
        changed_tile = self.client.get(self.url(task, cid, "frame/values"), {"frame": rel, "emissivity": "0.7"})
        self.assertNotEqual(changed_tile["ETag"], tile["ETag"])

        # A rectangle in its pixels, as converted and with the changes
        region = {"frame": rel, "geometry": square(100, 100, 140, 130)}
        r = self.client.post(self.url(task, cid, "frame/region"), region, format="json").data
        self.assertTrue(r["valid"])
        self.assertAlmostEqual(r["statistics"]["max"], float(np.nanmax(values[100:130, 100:140])), places=5)
        r2 = self.client.post(self.url(task, cid, "frame/region"), dict(region, changes={"emissivity": 0.7}),
                              format="json").data
        self.assertNotAlmostEqual(r2["statistics"]["mean"], r["statistics"]["mean"], places=1)
        # A ΔT: the second spot's pixel less the first's
        delta = {"frame": rel, "shape": "delta", "geometry": {"type": "LineString", "coordinates": [[100.5, 100.5], [300.5, 200.5]]}}
        d = self.client.post(self.url(task, cid, "frame/region"), delta, format="json").data
        self.assertAlmostEqual(d["first"], float(values[100, 100]), places=5)
        self.assertAlmostEqual(d["delta_t"], float(values[200, 300] - values[100, 100]), places=5)
        kept = self.client.post(self.url(task, cid, "frame/measurements"), dict(delta, name="Joint", isotherm={"low": 20, "high": None}),
                                format="json")
        self.assertEqual(kept.status_code, status.HTTP_201_CREATED, kept.data)
        self.assertEqual((kept.data["shape"], kept.data["isotherm"]), ("delta", None))
        self.assertAlmostEqual(kept.data["values"]["delta_t"], d["delta_t"], places=5)
        self.client.delete(self.url(task, cid, "frame/measurements/" + kept.data["id"]))

        # Downloads: CSV and a float TIFF of the same values
        csv = self.client.get(self.url(task, cid, "frame/download"), {"frame": rel, "kind": "csv"})
        rows = csv.content.decode().splitlines()
        self.assertEqual((len(rows), len(rows[0].split(","))), (512, 640))
        self.assertAlmostEqual(float(rows[5].split(",")[7]), values[5, 7], places=3)
        tif = self.client.get(self.url(task, cid, "frame/download"), {"frame": rel, "kind": "tiff", "emissivity": "0.7"})
        self.assertIn("-changed.tif", tif["Content-Disposition"])
        with rasterio.MemoryFile(tif.content) as mem, mem.open() as src:
            self.assertEqual((src.dtypes[0], src.crs), ("float32", None))
        self.assertEqual(self.client.get(self.url(task, cid, "frame/download"),
                                         {"frame": rel, "kind": "zip"}).status_code, status.HTTP_400_BAD_REQUEST)

        # Saved with its changes, listed by frame, renamed and deleted; a viewer sees it and can't save
        saved = self.client.post(self.url(task, cid, "frame/measurements"),
                                 dict(region, name="Hot corner", shape="rectangle", changes={"emissivity": 0.7}),
                                 format="json")
        self.assertEqual(saved.status_code, status.HTTP_201_CREATED, saved.data)
        self.assertEqual((saved.data["frame"], saved.data["changes"]), (rel, {"emissivity": 0.7}))
        self.assertAlmostEqual(saved.data["values"]["statistics"]["mean"], r2["statistics"]["mean"])
        listed = self.client.get(self.url(task, cid, "frame/measurements"), {"frame": rel}).data
        self.assertEqual([m["name"] for m in listed["measurements"]], ["Hot corner"])
        other = page["frames"][1]["path"]
        self.assertEqual(self.client.get(self.url(task, cid, "frame/measurements"), {"frame": other}).data["measurements"], [])
        viewer = User.objects.create_user(username="viewer", password="test1234")
        assign_perm("view_project", viewer, self.project)
        as_viewer = self.client_for("viewer")
        seen = as_viewer.get(self.url(task, cid, "frame/measurements")).data
        self.assertEqual((len(seen["measurements"]), seen["can_change"]), (1, False))
        self.assertEqual(as_viewer.post(self.url(task, cid, "frame/measurements"), dict(region, name="x", shape="rectangle"),
                                        format="json").status_code, status.HTTP_404_NOT_FOUND)
        mid = saved.data["id"]
        renamed = self.client.patch(self.url(task, cid, "frame/measurements/" + mid), {"name": "Roof"}, format="json")
        self.assertEqual(renamed.data["name"], "Roof")
        self.assertEqual(self.client.delete(self.url(task, cid, "frame/measurements/" + mid)).status_code,
                         status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.get(self.url(task, cid, "frame/measurements")).data["measurements"], [])

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_worksets_files_have_each_frames_figures_measured_once_and_some_of_its_files_download_as_a_zip(self):
        import os

        import rasterio
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in flight_frames(2)])
        res = self.client.post("{}/{}/conversions".format(API, task.id),
                               {"name": "Nadir", "settings": {"outputs": ["temp_c:tiff", "pseudo:png"], "emissivity": 0.95,
                                                              "mosaics": False}}, format="json")
        cid = res.data["id"]
        self.assertEqual(res.data["status"], "ready", res.data["error"])

        # Measured once converted: each frame's figures, its temperatures those of its TIFF
        detail = self.client.get(self.url(task, cid, "")[:-1]).data
        self.assertEqual(detail["figures_status"], "ready", detail["figures_error"])
        files = detail["results"]["files"]
        self.assertEqual(sorted(detail["figures"]), sorted(f["path"] for f in files))
        f = files[0]
        figures = detail["figures"][f["path"]]
        with rasterio.open(os.path.join(conversions.output_path(task, cid), f["outputs"][0])) as src:
            converted = src.read(1).astype(np.float64)
        converted[converted <= -273] = np.nan
        self.assertAlmostEqual(figures["min"], float(np.nanmin(converted)), places=2)
        self.assertAlmostEqual(figures["max"], float(np.nanmax(converted)), places=2)
        self.assertAlmostEqual(figures["emissivity"], 0.95, places=6)
        self.assertEqual(figures["distance_source"], f["distance_source"])
        self.assertIsNotNone(figures["reflected"])

        # A workset converted before they were measured has them measured when its Files are asked for, once
        for name in (frames.FIGURES_FILE, frames.FIGURES_JOB_FILE):
            os.remove(conversions.path(task, cid, name))
        with mock.patch.object(frames, "start_figures", wraps=frames.start_figures) as start:
            self.assertEqual(self.client.get(self.url(task, cid, "")[:-1]).data["figures"], detail["figures"])
            self.client.get(self.url(task, cid, "")[:-1])
        start.assert_called_once()
        # Measured again when asked (after it failed)
        again = self.client.post(self.url(task, cid, "figures"))
        self.assertEqual((again.status_code, again.data["figures_status"]), (status.HTTP_200_OK, "ready"))

        # Its frames' thumbnails, in a dataset never analyzed: through the workset, for the frames it converted
        thumbnail = "{}/{}/thumbnail".format(API, task.id)
        self.assertEqual(self.client.get(thumbnail, {"file": f["path"]}).status_code, status.HTTP_404_NOT_FOUND)
        for size in ("", "large"):
            res = self.client.get(thumbnail, {"file": f["path"], "workset": cid, "palette": "ironred", "size": size})
            self.assertEqual((res.status_code, res["Content-Type"]), (status.HTTP_200_OK, "image/jpeg"))
        self.assertEqual(self.client.get(thumbnail, {"file": "../" + f["path"], "workset": cid}).status_code,
                         status.HTTP_404_NOT_FOUND)

        # Some of its files as a zip, those of the workset only
        url = self.url(task, cid, "download")
        chosen = [f["outputs"][0], files[1]["outputs"][1]]
        zipped = self.client.post(url, {"file": chosen + ["../conversion.json"]})
        self.assertEqual(zipped.status_code, status.HTTP_200_OK)
        import zipfile
        with zipfile.ZipFile(io.BytesIO(b"".join(zipped.streaming_content))) as z:
            self.assertEqual(sorted(z.namelist()), sorted(chosen))
        self.assertEqual(self.client.post(url, {"file": ["../conversion.json"]}).status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_frame_page_is_for_who_can_see_the_dataset(self):
        task = self.create()
        self.upload(task, [jpeg("a.jpg")])
        with mock.patch.object(datasets, "start_job"):
            cid = conversions.create(task, "Nadir", dict(conversions.DEFAULTS), self.user)
        page = "/plugins/dji-thermal/dataset/{}/conversion/{}/frame".format(task.id, cid)
        self.assertEqual(self.client.get(page).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(page.replace(cid, "0" * 12)).status_code, status.HTTP_404_NOT_FOUND)
        User.objects.create_user(username="stranger", password="test1234")
        stranger = self.client_for("stranger")
        self.assertEqual(stranger.get(self.url(task, cid, "frames")).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(self.url(task, cid, "frames")).data["frames"], [])

    @skip_without("DJI_THERMAL_FLIGHT_DIR")
    def test_a_workset_converted_before_the_dataset_was_analyzed_has_its_frames_on_the_frame_page(self):
        found = flight_frames(2)
        task = self.create()
        with contextlib.ExitStack() as stack:
            self.upload(task, [stack.enter_context(open(f, "rb")) for f in found])
        res = self.client.post("{}/{}/conversions".format(API, task.id),
                               {"name": "Early", "settings": {"outputs": ["temp_c:tiff"], "mosaics": False}}, format="json")
        cid = res.data["id"]
        self.assertEqual(res.data["status"], "ready", res.data["error"])
        self.assertEqual(datasets.analysis(task), {})

        # Listed by name, without the analysis' times and pitches
        page = self.client.get(self.url(task, cid, "frames")).data
        self.assertEqual(len(page["frames"]), 2)
        self.assertTrue(all(f["converted"] for f in page["frames"]))
        rel = page["frames"][0]["path"]
        # Measured, with what the camera recorded read from the frame itself; its values, a region and its downloads
        info = self.client.get(self.url(task, cid, "frame"), {"frame": rel})
        self.assertEqual(info.status_code, status.HTTP_200_OK, info.data)
        self.assertIsNotNone(info.data["recorded"]["emissivity"])
        self.assertEqual(self.client.get(self.url(task, cid, "frame/values"), {"frame": rel}).status_code,
                         status.HTTP_200_OK)
        region = self.client.post(self.url(task, cid, "frame/region"),
                                  {"frame": rel, "geometry": square(10, 10, 20, 20)}, format="json")
        self.assertTrue(region.data["valid"])
        for kind in ("csv", "tiff"):
            self.assertEqual(self.client.get(self.url(task, cid, "frame/download"),
                                             {"frame": rel, "kind": kind}).status_code, status.HTTP_200_OK)
        # Only the frames it converted: still none of another dataset's, nor a path outside it
        for other in ("../" + rel, "nope.jpg"):
            self.assertEqual(self.client.get(self.url(task, cid, "frame"), {"frame": other}).status_code,
                             status.HTTP_400_BAD_REQUEST)
