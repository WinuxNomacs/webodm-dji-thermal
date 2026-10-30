"""
Tests of the conversion of DJI R-JPEGs into temperature TIFFs: which files are converted, the measurement settings,
the TIFF and its metadata, and what happens when a file or a tool fails.

No image is ever committed. The tests that need real R-JPEGs read them from two folders, and are skipped when they
are empty (see the README): DJI_THERMAL_SAMPLES_DIR, DJI's Thermal SDK sample images with one folder per camera,
and DJI_THERMAL_FLIGHT_DIR, a real flight's images (thermal frames and the RGB photos taken with them, in any
subfolders).
"""
import glob
import importlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np
from PIL import Image

from app.plugins import get_plugin_by_name
from app.tests.classes import BootTestCase

converter = importlib.import_module("coreplugins.dji-thermal.converter")


def pinned_version():
    """The dji-thermal-cli version requirements.txt pins"""
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "requirements.txt")) as f:
        return next(line.split("==")[1].strip() for line in f if line.startswith("dji-thermal-cli=="))


LIBRARY = "dji-thermal-cli " + pinned_version()

XMP_IMAGE_SOURCE = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" drone-dji:ImageSource="{}"/>'
    '</rdf:RDF></x:xmpmeta>')


# The DJI XMP tags ODM (modules/photo.py) and OpenSfM (exif.py) read
ODM_DJI_TAGS = ("AbsoluteAltitude", "RelativeAltitude", "GimbalPitchDegree", "GimbalRollDegree", "GimbalYawDegree",
                "FlightPitchDegree", "FlightRollDegree", "FlightYawDegree", "FlightXSpeed", "FlightYSpeed",
                "FlightZSpeed", "Latitude", "Longitude", "GpsLatitude", "GpsLongitude", "CalibratedFocalLength",
                "RtkFlag", "RtkStdLat", "RtkStdLon", "RtkStdHgt", "CaptureUUID", "ExposureTime", "SensorGain",
                "SensorGainAdjustment", "Irradiance")


def jpegs_in(variable):
    folder = os.environ.get(variable, "")
    return sorted(f for f in glob.glob(os.path.join(folder, "**", "*"), recursive=True)
                  if os.path.splitext(f)[1].lower() in converter.JPEG_EXTENSIONS) if folder else []


def skip_without(variable):
    return unittest.skipUnless(jpegs_in(variable), "{} has no JPEG images (see the README)".format(variable))


def read_tags(path, *tags):
    out = subprocess.run(["exiftool", "-config", converter.EXIFTOOL_CONFIG_FILE, "-j", "-n"]
                         + ["-" + t for t in tags] + [path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)[0]


class ConverterTestCase(BootTestCase):
    def setUp(self):
        super().setUp()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def path(self, name):
        return os.path.join(self.dir, name)

    def jpeg(self, name, image_source=None, exif=None):
        path = self.path(name)
        kwargs = {}
        if image_source is not None:
            kwargs["xmp"] = XMP_IMAGE_SOURCE.format(image_source).encode()
        if exif is not None:
            kwargs["exif"] = exif
        Image.new("RGB", (64, 48), (120, 80, 40)).save(path, format="JPEG", **kwargs)
        return path

    def write(self, name, data):
        path = self.path(name)
        with open(path, "wb") as f:
            f.write(data)
        return path


class TestWhatIsConverted(ConverterTestCase):
    def test_the_library_loads_from_the_plugins_site_packages(self):
        ok, message = converter.decoder_status()
        self.assertTrue(ok, message)
        self.assertIn(LIBRARY, message)
        self.assertTrue(converter.library().__file__.startswith(converter.site_packages_path()))

    def test_enabling_the_plugin_logs_the_library_it_measures_with(self):
        plugin = get_plugin_by_name("dji-thermal", only_active=False)
        with self.assertLogs("app.logger", level="INFO") as logs:
            plugin.enable()
        self.assertIn("Temperatures are computed with " + LIBRARY, "\n".join(logs.output))

    def test_an_ordinary_jpeg_is_not_a_thermal_image(self):
        self.assertFalse(converter.is_thermal_rjpeg(self.jpeg("photo.jpg")))

    def test_an_rgb_photo_from_a_dji_drone_is_not_a_thermal_image(self):
        self.assertFalse(converter.is_thermal_rjpeg(self.jpeg("DJI_0001_V.JPG", image_source="WideCamera")))

    def test_a_jpeg_that_names_dji_s_infrared_camera_without_its_thermal_data_is_not_a_thermal_image(self):
        self.assertFalse(converter.is_thermal_rjpeg(self.jpeg("DJI_0001_T.JPG", image_source="InfraredCamera")))

    def test_a_file_named_jpg_that_is_not_a_jpeg_is_not_a_thermal_image(self):
        self.assertFalse(converter.is_thermal_rjpeg(self.write("notes.jpg", b"not an image at all")))

    def test_a_jpeg_cut_short_is_not_a_thermal_image(self):
        with open(self.jpeg("whole.jpg"), "rb") as f:
            data = f.read()
        self.assertFalse(converter.is_thermal_rjpeg(self.write("cut.jpg", data[:len(data) // 3])))

    def test_a_file_that_is_not_named_jpg_is_not_read(self):
        path = self.jpeg("photo.png")
        with mock.patch.object(converter, "library") as library:
            self.assertFalse(converter.is_thermal_rjpeg(path))
        library.assert_not_called()

    def test_a_file_that_is_not_a_thermal_image_is_left_as_it_is_and_no_tiff_is_written(self):
        for source in (self.jpeg("photo.jpg"), self.write("notes.jpg", b"text"), self.path("missing.jpg")):
            with self.subTest(source=os.path.basename(source)):
                dest = self.path("out.tif")
                self.assertEqual(converter.convert(source, dest), "not a DJI thermal image")
                self.assertFalse(os.path.exists(dest))
            if os.path.exists(source):
                os.remove(source)


class TestMetadata(ConverterTestCase):
    def float_tiff(self, name):
        path = self.path(name)
        Image.fromarray(np.full((48, 64), 21.5, dtype=np.float32)).save(path, format="TIFF")
        return path

    def test_the_exiftool_command_copies_all_the_metadata_names_the_band_lwir_and_adds_the_measurement(self):
        command = converter.exiftool_command("/in/a.jpg", "/out/a.tif", {"Emissivity": "0.95"})
        self.assertEqual(command[1:3], ["-config", converter.EXIFTOOL_CONFIG_FILE])
        self.assertTrue(os.path.isfile(converter.EXIFTOOL_CONFIG_FILE))
        self.assertIn("-XMP-Camera:BandName=LWIR", command)
        self.assertIn("-XMP-dtc:Emissivity=0.95", command)
        self.assertEqual(command[command.index("-TagsFromFile") + 1:command.index("-TagsFromFile") + 3],
                         ["/in/a.jpg", "-all:all>all:all"])
        self.assertEqual(command[-2:], ["-overwrite_original", "/out/a.tif"])

    def test_the_measurement_is_written_in_the_tiff_s_xmp(self):
        measurement = mock.Mock(params={"distance": 29.422, "humidity": 50.0, "emissivity": 0.8999999761581421,
                                        "reflection": 27.75}, distance_source="rangefinder")
        source, dest = self.jpeg("DJI_0001_T.JPG", image_source="InfraredCamera"), self.float_tiff("out.tif")
        self.assertEqual(converter.copy_metadata(source, dest, converter.measurement_tags(measurement)), "")
        tags = read_tags(dest, "XMP-dtc:all")
        tags.pop("SourceFile")
        self.assertEqual(tags, {"Software": LIBRARY, "Distance": 29.422, "Humidity": 50,
                                "Emissivity": 0.9, "ReflectedTemperatureC": 27.75, "DistanceSource": "rangefinder"})

    def test_the_tiff_gets_the_source_s_gps_and_the_lwir_band_name(self):
        exif = Image.Exif()
        exif[0x0110] = "M4T"
        exif.get_ifd(0x8825).update({1: "N", 2: (42.0, 6.0, 12.48), 3: "W", 4: (71.0, 30.0, 0.0)})
        source = self.jpeg("DJI_0001_T.JPG", image_source="InfraredCamera", exif=exif)
        dest = self.float_tiff("out.tif")

        self.assertEqual(converter.copy_metadata(source, dest), "")
        tags = read_tags(dest, "Model", "GPSLatitude", "GPSLongitude", "XMP-Camera:BandName")
        self.assertEqual(tags["Model"], "M4T")
        self.assertAlmostEqual(tags["GPSLatitude"], 42.1034667, places=6)
        self.assertAlmostEqual(tags["GPSLongitude"], -71.5, places=6)
        self.assertEqual(tags["BandName"], "LWIR")
        with Image.open(dest) as im:
            self.assertEqual(im.mode, "F")

    def test_without_exiftool_the_metadata_is_not_written_and_says_why(self):
        with mock.patch.object(converter.shutil, "which", return_value=None):
            self.assertEqual(converter.copy_metadata(self.jpeg("a.jpg"), self.float_tiff("a.tif")),
                             "exiftool not found")

    def test_an_error_exiftool_reports_is_returned_even_with_exit_code_zero(self):
        result = subprocess.CompletedProcess([], 0, stdout="    1 image files updated\n",
                                             stderr="Warning: Sorry, BandName is not defined\n")
        with mock.patch.object(converter.subprocess, "run", return_value=result):
            self.assertEqual(converter.copy_metadata(self.jpeg("a.jpg"), self.float_tiff("a.tif")),
                             "Warning: Sorry, BandName is not defined")

    def test_an_exiftool_that_fails_or_hangs_is_reported(self):
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="")
        with mock.patch.object(converter.subprocess, "run", return_value=failed):
            self.assertEqual(converter.copy_metadata("a.jpg", "a.tif"), "exiftool exit code 1")
        with mock.patch.object(converter.subprocess, "run", side_effect=subprocess.TimeoutExpired("exiftool", 60)):
            self.assertIn("exiftool did not run", converter.copy_metadata("a.jpg", "a.tif"))


class TestMeasurementSettings(ConverterTestCase):
    def test_by_default_the_rangefinder_s_distance_and_the_recorded_parameters_are_used(self):
        for values in (None, {}, {"distance": "", "emissivity": "", "humidity": None}):
            with self.subTest(values=values):
                s = converter.settings(values)
                self.assertEqual(s.distance, "lrf")
                self.assertEqual(s.unit, "C")
                for name in converter.MEASUREMENT_FIELDS:
                    self.assertIsNone(getattr(s, name), name)

    def test_the_values_sent_as_text_are_read_as_numbers(self):
        s = converter.settings({"distance": "12.5", "emissivity": "0.95", "reflected_temp": "-3",
                                "ambient_temp": "21", "humidity": "70"})
        self.assertEqual((s.distance, s.emissivity, s.reflected_temp, s.ambient_temp, s.humidity),
                         (12.5, 0.95, -3.0, 21.0, 70.0))

    def test_the_recorded_distance_can_be_chosen_instead_of_the_rangefinder_s(self):
        self.assertEqual(converter.settings({"distance": "embedded"}).distance, "embedded")

    def test_temperatures_in_fahrenheit_are_measured_in_celsius(self):
        s = converter.settings({"unit": "f", "reflected_temp": "50", "ambient_temp": "32"})
        self.assertEqual(s.overrides().reflection, 10.0)
        self.assertEqual(s.overrides().ambient_temp, 0.0)

    def test_temperatures_in_kelvin_are_measured_in_celsius(self):
        s = converter.settings({"unit": "K", "reflected_temp": "283.15"})
        self.assertAlmostEqual(s.overrides().reflection, 10.0, places=4)

    def test_a_value_that_is_not_a_number_is_refused_naming_it(self):
        for values, message in (({"emissivity": "high"}, "emissivity must be a number"),
                                ({"distance": "far"}, "distance must be a number"),
                                ({"humidity": "nan"}, "humidity must be a number"),
                                ({"unit": "R"}, "unit must be C, F or K"),
                                ({"reflected_temp": "-500"}, "reflected_temp")):
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, message):
                converter.settings(values)


class TestFailedConversions(ConverterTestCase):
    def convert_thermal(self, **patches):
        source = self.jpeg("DJI_0001_T.JPG")
        with mock.patch.object(converter, "is_thermal_rjpeg", return_value=True), \
                mock.patch.multiple(converter, **patches):
            return source, converter.convert(source, self.path("out.tif"))

    def test_a_file_that_fails_to_decode_leaves_no_tiff_and_says_why(self):
        source, reason = self.convert_thermal(measure=mock.Mock(side_effect=ValueError("bad thermal block")))
        self.assertEqual(reason, "bad thermal block")
        self.assertEqual(os.listdir(self.dir), [os.path.basename(source)])

    def test_a_tiff_whose_metadata_could_not_be_written_is_removed(self):
        # Without its GPS and band name, ODM could neither place the image nor treat it as thermal
        temps = np.zeros((48, 64), dtype=np.float32)
        measurement = mock.Mock(temperature=temps, params={}, distance_source="embedded")
        source, reason = self.convert_thermal(measure=mock.Mock(return_value=measurement),
                                              copy_metadata=mock.Mock(return_value="exiftool not found"))
        self.assertEqual(reason, "the metadata could not be written: exiftool not found")
        self.assertEqual(os.listdir(self.dir), [os.path.basename(source)])

    def test_a_library_that_does_not_load_converts_nothing_and_says_so(self):
        with mock.patch.object(converter, "library", side_effect=ImportError("No module named 'dji_thermal_cli'")):
            ok, message = converter.decoder_status()
            self.assertFalse(converter.is_thermal_rjpeg(self.path("DJI_0001_T.JPG")))
        self.assertFalse(ok)
        self.assertIn("No module named 'dji_thermal_cli'", message)


class ConvertedImagesTestCase(ConverterTestCase):
    def assertConverts(self, source, measurement_settings=None):
        out = tempfile.mkdtemp(dir=self.dir)
        dest = os.path.join(out, os.path.splitext(os.path.basename(source))[0] + ".tif")
        self.assertEqual(converter.convert(source, dest, measurement_settings), "")
        with Image.open(dest) as im:
            self.assertEqual(im.mode, "F")
            temps = np.asarray(im)
        np.testing.assert_array_equal(temps, converter.measure(source, measurement_settings).temperature)
        self.assertEqual(os.listdir(out), [os.path.basename(dest)])
        return dest, temps


@skip_without("DJI_THERMAL_SAMPLES_DIR")
class TestDjiSampleImages(ConvertedImagesTestCase):
    def test_every_camera_s_sample_images_convert_with_the_library_s_temperatures(self):
        files = jpegs_in("DJI_THERMAL_SAMPLES_DIR")
        for source in files:
            with self.subTest(source=os.path.relpath(source, os.environ["DJI_THERMAL_SAMPLES_DIR"])):
                dest, temps = self.assertConverts(source)
                self.assertTrue(np.isfinite(temps).all())
                self.assertTrue(-60 < np.median(temps) < 200)
                self.assertEqual(read_tags(dest, "XMP-Camera:BandName")["BandName"], "LWIR")

    def test_every_camera_s_recorded_parameters_and_ranges_are_described_for_the_form(self):
        cameras = {}
        for source in jpegs_in("DJI_THERMAL_SAMPLES_DIR"):
            info = converter.describe(source)
            cameras.setdefault(info["camera"], info)
            self.assertEqual(sorted(info["recorded"]), sorted(info["ranges"]), source)
        self.assertEqual(cameras["M4T"]["ranges"]["distance"], [1.0, 300.0])
        self.assertEqual(cameras["M30T"]["ranges"]["distance"], [1.0, 25.0])
        for camera in ("ZH20T", "XT S"):
            self.assertNotIn("ambient_temp", cameras[camera]["ranges"], camera)
            self.assertIn("reflected_temp", cameras[camera]["ranges"], camera)
        self.assertIn("ambient_temp", cameras["M4T"]["ranges"])

    def test_changed_parameters_change_the_temperatures_and_are_recorded_in_the_tiff(self):
        source = next(f for f in jpegs_in("DJI_THERMAL_SAMPLES_DIR") if converter.describe(f)["camera"] == "M4T")
        changed = converter.settings({"emissivity": "0.7", "reflected_temp": "68", "unit": "F", "distance": "12"})
        dest, temps = self.assertConverts(source, changed)
        _, recorded = self.assertConverts(source)
        self.assertGreater(abs(float(np.median(temps)) - float(np.median(recorded))), 0.5)
        tags = read_tags(dest, "XMP-dtc:all")
        self.assertEqual((tags["Emissivity"], tags["ReflectedTemperatureC"], tags["Distance"], tags["DistanceSource"]),
                         (0.7, 20, 12, "option"))

    def test_a_value_outside_the_camera_s_range_fails_the_photo_with_the_reason(self):
        source = next(f for f in jpegs_in("DJI_THERMAL_SAMPLES_DIR") if converter.describe(f)["camera"] == "M30T")
        dest = self.path("out.tif")
        reason = converter.convert(source, dest, converter.settings({"distance": "100"}))
        self.assertIn("distance=100 is outside [1, 25]", reason)
        self.assertFalse(os.path.exists(dest))


@skip_without("DJI_THERMAL_FLIGHT_DIR")
class TestRealFlight(ConvertedImagesTestCase):
    def test_only_the_thermal_frames_of_a_flight_are_thermal_images(self):
        thermal, other = [], []
        for f in jpegs_in("DJI_THERMAL_FLIGHT_DIR"):
            (thermal if converter.is_thermal_rjpeg(f) else other).append(f)
        self.assertTrue(thermal, "the flight has no thermal frames")
        self.assertTrue(other, "the flight has no RGB photos")
        for f in other:
            with Image.open(f) as im:
                self.assertEqual(im.mode, "RGB")

    def test_a_flight_s_thermal_frames_convert_keeping_the_metadata_odm_reads(self):
        # exiftool copies only the DJI XMP tags it can write (not ImageSource, the rangefinder's, ...), which
        # include all those ODM and OpenSfM read for a photo's position and orientation
        tags = ["GPSLatitude", "GPSLongitude", "GPSAltitude", "DateTimeOriginal", "Make", "Model", "FocalLength"] + [
            "XMP-drone-dji:" + t for t in ODM_DJI_TAGS]
        thermal = [f for f in jpegs_in("DJI_THERMAL_FLIGHT_DIR") if converter.is_thermal_rjpeg(f)]
        for source in thermal[:5]:
            with self.subTest(source=os.path.basename(source)):
                dest, _ = self.assertConverts(source)
                before, after = read_tags(source, *tags), read_tags(dest, *tags + ["XMP-Camera:BandName"])
                self.assertEqual(after.pop("BandName"), "LWIR")
                self.assertEqual(read_tags(dest, "XMP-dtc:DistanceSource")["DistanceSource"], "rangefinder")
                before.pop("SourceFile"), after.pop("SourceFile")
                self.assertIn("GimbalPitchDegree", before)
                self.assertEqual(sorted(after), sorted(before))
                for tag, value in before.items():
                    if isinstance(value, float):
                        # GPS is stored as fractions: it comes back within a millionth of a millimetre
                        self.assertAlmostEqual(after[tag], value, delta=1e-9, msg=tag)
                    else:
                        self.assertEqual(after[tag], value, tag)
