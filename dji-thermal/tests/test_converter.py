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
import sys
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
    out = subprocess.run(["exiftool", "-j", "-n"]
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
    def convert_thermal(self, process):
        source = self.jpeg("DJI_0001_T.JPG")
        library = mock.Mock()
        library.return_value.process = process
        with mock.patch.object(converter, "is_thermal_rjpeg", return_value=True), \
                mock.patch.object(converter, "settings"), mock.patch.object(converter, "library", library):
            return source, converter.convert(source, self.path("out.tif"))

    def test_a_file_that_fails_to_decode_leaves_no_tiff_and_says_why(self):
        failed = mock.Mock(results=[mock.Mock(ok=False, reason="bad thermal block", outputs=[])])
        source, reason = self.convert_thermal(mock.Mock(return_value=failed))
        self.assertEqual(reason, "bad thermal block")
        self.assertEqual(os.listdir(self.dir), [os.path.basename(source)])

    def test_a_library_that_fails_while_writing_leaves_no_tiff_and_no_working_folder(self):
        source, reason = self.convert_thermal(mock.Mock(side_effect=OSError("disk full")))
        self.assertEqual(reason, "disk full")
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
        self.assertEqual((tags["Software"], tags["Emissivity"], tags["ReflectedTemperatureC"], tags["Distance"],
                          tags["DistanceSource"]), (LIBRARY, 0.7, 20, 12, "option"))

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
        # All those ODM and OpenSfM read for a photo's position and orientation, and DJI's others (ImageSource, the
        # rangefinder's)
        tags = ["GPSLatitude", "GPSLongitude", "GPSAltitude", "DateTimeOriginal", "Make", "Model", "FocalLength"] + [
            "XMP-drone-dji:" + t for t in ODM_DJI_TAGS + ("ImageSource", "LRFStatus", "LRFTargetDistance")]
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


class TestStaleMetadata(unittest.TestCase):
    """WebODM's pip --target leaves an upgraded package's old metadata, which the plugin removes"""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.packages = os.path.join(self.dir, "site-packages")
        self.requirements = os.path.join(self.dir, "requirements.txt")
        with open(self.requirements, "w") as f:
            f.write("dji-thermal-cli==1.10.0\nnumpy==1.26.2\nPillow == 11.3.0  # WebODM's\n")

    def installed(self, *names):
        for name in names:
            os.makedirs(os.path.join(self.packages, name))

    def test_the_versions_no_longer_pinned_are_removed_beside_the_pinned_one(self):
        self.installed("dji_thermal_cli", "dji_thermal_cli-1.9.0.dist-info", "dji_thermal_cli-1.10.0.dist-info",
                       "pillow-11.3.0.dist-info", "PIL", "numpy-1.26.2.dist-info", "numpy-1.25.0.dist-info",
                       "rasterio-1.0.dist-info")
        removed = converter.remove_stale_metadata(self.packages, self.requirements)
        self.assertEqual(sorted(removed), ["dji_thermal_cli-1.9.0.dist-info", "numpy-1.25.0.dist-info"])
        self.assertEqual(sorted(os.listdir(self.packages)),
                         ["PIL", "dji_thermal_cli", "dji_thermal_cli-1.10.0.dist-info", "numpy-1.26.2.dist-info",
                          "pillow-11.3.0.dist-info", "rasterio-1.0.dist-info"])

    def test_the_version_pinned_for_another_python_is_removed_after_webodm_moves_to_this_one(self):
        with open(self.requirements, "w") as f:
            f.write('numpy==1.26.2 ; python_version < "3"\nnumpy==2.5.4 ; python_version >= "3"  # WebODM 4\n')
        self.installed("numpy-1.26.2.dist-info")
        self.assertEqual(converter.remove_stale_metadata(self.packages, self.requirements), [])
        self.installed("numpy-2.5.4.dist-info")
        self.assertEqual(converter.remove_stale_metadata(self.packages, self.requirements), ["numpy-1.26.2.dist-info"])
        self.assertEqual(os.listdir(self.packages), ["numpy-2.5.4.dist-info"])

    def test_nothing_is_removed_until_the_pinned_version_is_installed(self):
        self.installed("dji_thermal_cli-1.9.0.dist-info")
        self.assertEqual(converter.remove_stale_metadata(self.packages, self.requirements), [])
        self.assertEqual(os.listdir(self.packages), ["dji_thermal_cli-1.9.0.dist-info"])
        shutil.rmtree(self.packages)
        self.assertEqual(converter.remove_stale_metadata(self.packages, self.requirements), [])

    def test_packages_built_for_another_python_are_found(self):
        this = "{}{}".format(*sys.version_info[:2])
        self.installed("shapely", "numpy/core", "PIL")
        for name in ("shapely/lib.cpython-{}-x86_64-linux-gnu.so".format(this), "PIL/_imaging.cp{}-win_amd64.pyd".format(this),
                     "numpy/core/_umath.abi3.so", "shapely/__init__.py"):
            open(os.path.join(self.packages, name), "w").close()
        self.assertFalse(converter.built_for_another_python(self.packages))
        other = "39" if this != "39" else "314"
        open(os.path.join(self.packages, "numpy/core/_multiarray_umath.cpython-{}-darwin.so".format(other)), "w").close()
        self.assertTrue(converter.built_for_another_python(self.packages))
        self.assertFalse(converter.built_for_another_python(os.path.join(self.dir, "none")))

    def test_the_plugin_installs_its_packages_again_when_they_were_built_for_another_python(self):
        plugin = get_plugin_by_name("dji-thermal", only_active=False)
        packages = self.packages
        os.makedirs(packages)
        md5 = os.path.join(packages, "install_md5")
        seen = []
        with mock.patch.object(type(plugin), "get_python_packages_path", return_value=packages), \
                mock.patch.object(type(plugin).__mro__[1], "check_requirements",
                                  side_effect=lambda: seen.append(os.path.exists(md5))), \
                mock.patch.object(converter, "remove_stale_metadata", return_value=[]):
            for other in (False, True):
                open(md5, "w").close()
                with mock.patch.object(converter, "built_for_another_python", return_value=other):
                    plugin.check_requirements()
        # WebODM's check saw the file of what was installed only when the packages were this Python's
        self.assertEqual(seen, [True, False])

    def test_the_plugin_tidies_its_packages_after_webodm_installs_them(self):
        plugin = get_plugin_by_name("dji-thermal", only_active=False)
        with mock.patch.object(type(plugin).__mro__[1], "check_requirements") as install, \
                mock.patch.object(converter, "remove_stale_metadata", return_value=[]) as tidy:
            plugin.check_requirements()
        install.assert_called_once()
        tidy.assert_called_once_with(plugin.get_python_packages_path(), plugin.get_path("requirements.txt"))
