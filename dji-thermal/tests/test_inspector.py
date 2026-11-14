"""
The Thermal Inspector's reads of a task's thermal orthophoto: tests on an orthophoto they make, in a UTM zone, with
known temperatures (no image of anyone's).
"""
import importlib
import io
import json
import math
import os
import shutil

import numpy as np
import rasterio
from PIL import Image
from django.contrib.auth.models import User
from rasterio.transform import from_origin
from rasterio.warp import transform
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from app.tests.classes import BootTestCase

inspector = importlib.import_module("coreplugins.dji-thermal.inspector")
colouring = importlib.import_module("coreplugins.dji-thermal.colouring")
converter = importlib.import_module("coreplugins.dji-thermal.converter")
conversions = importlib.import_module("coreplugins.dji-thermal.conversions")
correction = importlib.import_module("coreplugins.dji-thermal.correction")
conversion_tasks = importlib.import_module("coreplugins.dji-thermal.conversion_tasks")

WIDTH, HEIGHT, PIXEL = 100, 80, 0.5
ORIGIN = (400000.0, 4660000.0)     # UTM 16N, near Chicago
TRANSPARENT_COLUMNS = 10           # the left edge has no data (alpha 0)


def temperatures():
    """°C: the column plus a quarter of the row, so each pixel's value is known"""
    rows, cols = np.mgrid[0:HEIGHT, 0:WIDTH]
    return (cols + 0.25 * rows).astype(np.float32)


def lonlat(col, row):
    """A pixel's centre, lon/lat"""
    x, y = ORIGIN[0] + (col + 0.5) * PIXEL, ORIGIN[1] - (row + 0.5) * PIXEL
    lons, lats = transform('EPSG:32616', 'EPSG:4326', [x], [y])
    return lons[0], lats[0]


def stored(polygon):
    """A polygon (GeoJSON, lon/lat) as a task keeps its crop and extents: GeoJSON in WebODM 4.0.0, GEOS in 3.3.2"""
    if Task._meta.get_field('crop').get_internal_type() == 'JSONField':
        return polygon
    from django.contrib.gis.geos import GEOSGeometry
    return GEOSGeometry(json.dumps(polygon), srid=4326)


def web_mercator_tile(lon, lat, zoom):
    """The map tile (z, x, y) holding a point, the tile's bounds (left, bottom, right, top) and the point (x, y), in
    Web Mercator metres"""
    half = math.pi * 6378137.0
    n = 2 ** zoom
    x = math.floor((lon + 180.0) / 360.0 * n)
    y = math.floor((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    side = 2 * half / n
    left, top = -half + x * side, half - y * side
    point = (math.radians(lon) * 6378137.0, math.asinh(math.tan(math.radians(lat))) * 6378137.0)
    return (zoom, x, y), (left, top - side, left + side, top), point


def xmp_tiff(path, emissivity, reflected):
    """A file holding what dji-thermal-cli records in a TIFF's XMP about how it was measured (no image)"""
    with open(path, 'wb') as f:
        f.write(b'II*\x00<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:dtc="urn:dji-thermal-cli:xmp:1.0" '
                b'dtc:Emissivity="%g" dtc:ReflectedTemperatureC="%g"/></x:xmpmeta>' % (emissivity, reflected))


def corrected(celsius, wanted, baseline):
    """The broadband model, written out: the radiance seen with the baseline, solved for the wanted parameters"""
    k = 273.15
    (e, r), (e0, r0) = wanted, baseline
    seen = e0 * (celsius + k) ** 4 + (1 - e0) * (r0 + k) ** 4
    return ((seen - (1 - e) * (r + k) ** 4) / e) ** 0.25 - k


def square(col0, row0, col1, row1):
    """A polygon (lon/lat) whose corners are the centres of two pixels"""
    corners = [lonlat(col0, row0), lonlat(col1, row0), lonlat(col1, row1), lonlat(col0, row1)]
    return {'type': 'Polygon', 'coordinates': [[list(c) for c in corners + corners[:1]]]}


class TestInspector(BootTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.get(username="testuser")
        self.project = Project.objects.get(owner=self.user)
        self.client = APIClient()
        self.client.login(username="testuser", password="test1234")
        self.task = self.thermal_task()

    def thermal_task(self, bands=('lwir', None)):
        task = Task.objects.create(project=self.project, name="Inspector", available_assets=['orthophoto.tif'],
                                   orthophoto_bands=[{'name': 'gray', 'description': bands[0]},
                                                     {'name': 'alpha', 'description': bands[1]}])
        self.addCleanup(shutil.rmtree, task.task_path(), True)
        # WebODM keeps a crop within the orthophoto's extent
        task.orthophoto_extent = stored(square(-1, -1, WIDTH, HEIGHT))
        task.save()
        path = task.get_asset_download_path('orthophoto.tif')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        alpha = np.full((HEIGHT, WIDTH), 255, np.float32)
        alpha[:, :TRANSPARENT_COLUMNS] = 0
        with rasterio.open(path, 'w', driver='GTiff', width=WIDTH, height=HEIGHT, count=2, dtype='float32',
                           crs='EPSG:32616', transform=from_origin(ORIGIN[0], ORIGIN[1], PIXEL, PIXEL), alpha='YES') as dst:
            dst.write(temperatures(), 1)
            dst.write(alpha, 2)
        return task

    def crop(self, *corners):
        self.task.crop = stored(square(*corners))
        self.task.save()

    def url(self, task, what):
        return "/api/plugins/dji-thermal/projects/{}/tasks/{}/inspector/{}".format(task.project.id, task.id, what)

    def point(self, lon, lat, task=None):
        return self.client.get(self.url(task or self.task, "point"), {'lon': lon, 'lat': lat})

    def region(self, geometry, task=None, **extra):
        return self.client.post(self.url(task or self.task, "region"), dict(geometry=geometry, **extra), format="json")

    def test_only_an_orthophoto_of_one_lwir_band_is_thermal(self):
        self.assertIsNotNone(inspector.thermal_orthophoto(self.task))
        rgb = self.thermal_task(bands=('red', 'green'))
        self.assertIsNone(inspector.thermal_orthophoto(rgb))
        self.assertEqual(self.point(*lonlat(50, 40), task=rgb).status_code, status.HTTP_404_NOT_FOUND)

    def test_the_temperature_at_a_pixel_is_that_pixels(self):
        res = self.point(*lonlat(50, 40))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['valid'])
        self.assertAlmostEqual(res.data['temperature'], 50 + 0.25 * 40, places=4)
        self.assertEqual(self.point(*lonlat(5, 40)).data['reason'], 'nodata')
        self.assertEqual(self.point(*lonlat(500, 40)).data['reason'], 'outside_raster')
        self.assertEqual(self.point(0, 0).data['reason'], 'outside_raster')
        self.assertEqual(self.client.get(self.url(self.task, "point"), {'lon': 'east'}).status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_a_point_outside_the_tasks_crop_is_excluded(self):
        self.crop(40, 30, 60, 50)
        self.assertTrue(self.point(*lonlat(50, 40)).data['valid'])
        self.assertEqual(self.point(*lonlat(70, 40)).data['reason'], 'excluded')

    def test_a_regions_statistics_are_those_of_the_pixels_it_covers(self):
        res = self.region(square(20, 10, 29, 19), bins=10, percentiles=[50])
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        st = res.data['statistics']
        expected = temperatures()[10:20, 20:30]
        self.assertEqual(st['count'], expected.size)
        self.assertAlmostEqual(st['min'], float(expected.min()), places=4)
        self.assertAlmostEqual(st['max'], float(expected.max()), places=4)
        self.assertAlmostEqual(st['mean'], float(expected.mean()), places=4)
        self.assertAlmostEqual(st['percentiles']['50'], float(np.percentile(expected, 50)), places=4)
        self.assertEqual(len(st['histogram']['counts']), 10)
        self.assertEqual(sum(st['histogram']['counts']), expected.size)
        np.testing.assert_allclose(st['min_location'], lonlat(20, 10), atol=1e-7)
        np.testing.assert_allclose(st['max_location'], lonlat(29, 19), atol=1e-7)
        self.assertAlmostEqual(res.data['pixel_size'], PIXEL)
        self.assertFalse(res.data['resampled'])

    def test_a_region_leaves_out_pixels_without_data_and_outside_the_crop(self):
        st = self.region(square(0, 0, 19, 9)).data['statistics']
        self.assertEqual(st['count'], (20 - TRANSPARENT_COLUMNS) * 10)
        self.assertAlmostEqual(st['min'], float(TRANSPARENT_COLUMNS))
        self.crop(40, 30, 60, 50)
        self.assertEqual(self.region(square(0, 0, 19, 9)).data['reason'], 'excluded')
        st = self.region(square(30, 20, 49, 39)).data['statistics']
        self.assertAlmostEqual(st['min'], 40 + 0.25 * 30, places=4)
        self.assertEqual(self.region(square(500, 0, 510, 9)).data['reason'], 'excluded')

    def test_a_region_far_from_the_orthophoto_or_not_a_polygon_nor_a_line_is_said_so(self):
        far = {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
        self.assertEqual(self.region(far).data['reason'], 'outside_raster')
        self.assertEqual(self.region({'type': 'Point', 'coordinates': [0, 0]}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.region("roof").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.region(square(20, 10, 29, 19), bins=0).status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_line_measures_a_strip_along_it_and_its_profile_every_pixel(self):
        line = {'type': 'LineString', 'coordinates': [list(lonlat(20, 40)), list(lonlat(40, 40))]}
        res = self.region(line)
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertAlmostEqual(res.data['length'], 20 * PIXEL, places=2)
        profile = res.data['profile']
        self.assertEqual(len(profile['distance']), 21)
        self.assertAlmostEqual(profile['distance'][-1], 20 * PIXEL, places=2)
        np.testing.assert_allclose(profile['values'], [col + 0.25 * 40 for col in range(20, 41)], atol=1e-4)
        np.testing.assert_allclose(profile['points'][0], lonlat(20, 40), atol=1e-7)
        self.assertNotIn('frames', profile)
        # A sample without data is None; a line of one point is refused
        into_the_edge = {'type': 'LineString', 'coordinates': [list(lonlat(5, 40)), list(lonlat(15, 40))]}
        values = self.region(into_the_edge).data['profile']['values']
        self.assertIsNone(values[0])
        self.assertAlmostEqual(values[-1], 15 + 0.25 * 40, places=4)
        one = {'type': 'LineString', 'coordinates': [list(lonlat(20, 40)), list(lonlat(20, 40))]}
        self.assertEqual(self.region(one).status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_regions_surroundings_are_a_ring_around_it_and_delta_t_the_difference(self):
        # 20 °C, with a square of 50 °C (columns and rows 30 to 39)
        path = os.path.join(self.task.task_path(), "hot.tif")
        values = np.full((HEIGHT, WIDTH), 20, np.float32)
        values[30:40, 30:40] = 50
        with rasterio.open(path, 'w', driver='GTiff', width=WIDTH, height=HEIGHT, count=1, dtype='float32',
                           crs='EPSG:32616', transform=from_origin(ORIGIN[0], ORIGIN[1], PIXEL, PIXEL)) as dst:
            dst.write(values, 1)
        st = inspector.raster_region(path, square(30, 30, 39, 39))['statistics']
        self.assertEqual((st['count'], st['mean'], st['surroundings'], st['delta_t']), (100, 50, 20, 30))
        # Half in it: the surroundings are what is around it, the hot square's rest included
        st = inspector.raster_region(path, square(30, 30, 34, 39))['statistics']
        self.assertTrue(20 < st['surroundings'] < 50, st)
        # A line along a hot band two pixels wide (between rows 49 and 50, on the pixels' corners so that its strip's
        # edges are mid-pixel): the strip is the band, its surroundings the band beside it
        values = np.full((HEIGHT, WIDTH), 20, np.float32)
        values[49:51, 19:41] = 50
        with rasterio.open(path, 'w', driver='GTiff', width=WIDTH, height=HEIGHT, count=1, dtype='float32',
                           crs='EPSG:32616', transform=from_origin(ORIGIN[0], ORIGIN[1], PIXEL, PIXEL)) as dst:
            dst.write(values, 1)
        line = {'type': 'LineString', 'coordinates': [list(lonlat(19.5, 49.5)), list(lonlat(39.5, 49.5))]}
        st = inspector.raster_region(path, line)['statistics']
        self.assertEqual((st['count'], st['mean'], st['surroundings'], st['delta_t']), (44, 50, 20, 30))

    def test_a_regions_isotherm_share_is_that_of_its_pixels_within_the_limits(self):
        expected = temperatures()[10:20, 20:30]
        low = float(np.median(expected))
        st = self.region(square(20, 10, 29, 19), isotherm={'low': low, 'high': None}).data['statistics']
        self.assertAlmostEqual(st['isotherm_share'], float((expected >= low).mean()))
        st = self.region(square(20, 10, 29, 19), isotherm={'low': 25, 'high': 27}).data['statistics']
        self.assertAlmostEqual(st['isotherm_share'], float(((expected >= 25) & (expected <= 27)).mean()))
        self.assertNotIn('isotherm_share', self.region(square(20, 10, 29, 19)).data['statistics'])
        for wrong in ({'low': 30, 'high': 20}, {'low': 'warm'}, "above"):
            self.assertEqual(self.region(square(20, 10, 29, 19), isotherm=wrong).status_code,
                             status.HTTP_400_BAD_REQUEST, wrong)

    def test_a_correction_solves_the_broadband_model_for_another_emissivity_and_reflected_temperature(self):
        base = (0.91, 21.0)
        self.assertEqual(correction.value(30.0, base, base), 30.0)
        for wanted in ((0.95, 21.0), (0.7, 5.0), (1.0, 40.0)):
            self.assertAlmostEqual(correction.value(30.0, wanted, base), corrected(30.0, wanted, base), places=6)
        # A lower emissivity: the surface gave off more than it seemed, so it is hotter (above the reflected)
        self.assertGreater(correction.value(30.0, (0.7, 21.0), base), 30.0)
        values = correction.apply(np.array([10.0, np.nan, 50.0]), (0.8, 10.0), base)
        self.assertTrue(np.isnan(values[1]))
        self.assertAlmostEqual(values[2], corrected(50.0, (0.8, 10.0), base), places=6)
        for wrong in ({'emissivity': 0.05, 'reflected': 20}, {'emissivity': 0.9, 'reflected': -200},
                      {'emissivity': 0.9}, {'emissivity': True, 'reflected': 20}, "0.9,20"):
            with self.assertRaises(ValueError, msg=wrong):
                correction.parse(wrong)

    def test_an_orthophotos_baseline_is_the_median_of_what_its_tiffs_record(self):
        self.assertIsNone(correction.task_baseline(self.task))
        for i, (e, r) in enumerate(((0.91, 21.0), (0.95, 19.0), (0.91, 25.0))):
            xmp_tiff(os.path.join(self.task.task_path(), "DJI_000{}_T_temp_c.tiff".format(i)), e, r)
        self.assertEqual(correction.task_baseline(self.task), (0.91, 21.0))

    def test_a_corrected_region_has_the_statistics_of_its_corrected_temperatures(self):
        wanted = {'emissivity': 0.8, 'reflected': 10.0}
        res = self.region(square(20, 10, 29, 19), correction=wanted)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)     # its TIFFs don't say how it was measured
        xmp_tiff(os.path.join(self.task.task_path(), "DJI_0001_T_temp_c.tiff"), 0.91, 21.0)
        expected = corrected(temperatures()[10:20, 20:30].astype(np.float64), (0.8, 10.0), (0.91, 21.0))
        low = float(np.median(expected))
        res = self.region(square(20, 10, 29, 19), correction=wanted, isotherm={'low': low, 'high': None})
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        st = res.data['statistics']
        self.assertAlmostEqual(st['mean'], float(expected.mean()), places=4)
        self.assertAlmostEqual(st['max'], float(expected.max()), places=4)
        self.assertAlmostEqual(st['isotherm_share'], float((expected >= low).mean()))
        self.assertEqual(res.data['correction'], {'emissivity': 0.8, 'reflected': 10.0,
                                                  'baseline': {'emissivity': 0.91, 'reflected': 21.0}})
        self.assertIsNone(self.region(square(20, 10, 29, 19)).data['correction'])

    def test_measurements_are_saved_with_the_task_measured_here_renamed_and_deleted(self):
        url = self.url(self.task, "measurements")
        self.assertEqual(self.client.get(url).data, {'measurements': [], 'can_change': True, 'baseline': None, 'palette': '', 'photos': False})
        conversion_tasks.set_task_palette(self.task, 'ironred')
        self.assertEqual(self.client.get(url).data['palette'], 'ironred')
        pin = {'name': "Vent", 'comment': "Warm air", 'shape': 'pin',
               'geometry': {'type': 'Point', 'coordinates': list(lonlat(50, 40))}}
        res = self.client.post(url, pin, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertAlmostEqual(res.data['values']['temperature'], 60.0, places=4)
        self.assertEqual((res.data['name'], res.data['comment'], res.data['created_by']), ("Vent", "Warm air", "testuser"))
        area = {'name': "Roof", 'shape': 'circle', 'geometry': square(20, 10, 29, 19), 'circle': {'lat': 1, 'lng': 2, 'radius': 3},
                'isotherm': {'low': 25, 'high': None}}
        saved = self.client.post(url, area, format="json").data
        self.assertEqual(saved['values']['statistics']['count'], 100)
        self.assertEqual((saved['circle'], saved['isotherm']), ({'lat': 1, 'lng': 2, 'radius': 3}, {'low': 25, 'high': None}))
        for wrong in (dict(pin, name=" "), dict(pin, shape='star'), dict(pin, geometry=square(1, 1, 2, 2)),
                      dict(area, geometry={'type': 'Point', 'coordinates': [0, 0]}), dict(pin, comment=7),
                      dict(pin, correction={'emissivity': 0.9, 'reflected': 20})):
            self.assertEqual(self.client.post(url, wrong, format="json").status_code, status.HTTP_400_BAD_REQUEST, wrong)
        one = "{}/{}".format(url, res.data['id'])
        self.assertEqual(self.client.patch(one, {'name': "Chimney", 'comment': ""}, format="json").data['name'], "Chimney")
        self.assertEqual(self.client.patch(one, {}, format="json").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.patch(url + "/0123456789ab", {'name': "x"}, format="json").status_code,
                         status.HTTP_404_NOT_FOUND)
        listed = self.client.get(url).data['measurements']
        self.assertEqual([(m['name'], m['comment']) for m in listed], [("Chimney", ""), ("Roof", "")])
        with open(os.path.join(self.task.task_path(), "thermal", "measurements.json")) as f:
            self.assertEqual(listed, json.load(f))
        self.assertEqual(self.client.delete(one).status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.delete(one).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual([m['name'] for m in self.client.get(url).data['measurements']], ["Roof"])
        # Saved with a correction: the corrected temperature, and the one measured
        xmp_tiff(os.path.join(self.task.task_path(), "DJI_0001_T_temp_c.tiff"), 0.91, 21.0)
        fixed = self.client.post(url, dict(pin, correction={'emissivity': 0.8, 'reflected': 10}), format="json").data
        self.assertAlmostEqual(fixed['values']['measured'], 60.0, places=4)
        self.assertAlmostEqual(fixed['values']['temperature'], corrected(60.0, (0.8, 10.0), (0.91, 21.0)), places=4)

    def test_a_delta_t_reads_each_spot_as_its_pixel_and_gives_the_second_less_the_first(self):
        def delta(*spots):
            return {'type': 'LineString', 'coordinates': [list(lonlat(*s)) for s in spots]}
        res = self.region(delta((50, 40), (30, 40)), shape='delta')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        d = res.data
        self.assertTrue(d['valid'])
        self.assertAlmostEqual(d['first'], 60.0, places=4)
        self.assertAlmostEqual(d['second'], 40.0, places=4)
        self.assertAlmostEqual(d['delta_t'], -20.0, places=4)
        self.assertAlmostEqual(d['length'], 20 * PIXEL, delta=0.05)
        self.assertNotIn('statistics', d)
        # A spot with no temperature: no ΔT, and why
        none = self.region(delta((50, 40), (5, 40)), shape='delta').data
        self.assertEqual((none['valid'], none['reason'], none['delta_t'], none['second'], none['reasons']),
                         (False, 'nodata', None, None, [None, 'nodata']))
        self.crop(40, 30, 60, 50)
        self.assertEqual(self.region(delta((50, 40), (70, 40)), shape='delta').data['reasons'], [None, 'excluded'])
        # Not a line of two distinct spots
        for wrong in (delta((50, 40)), delta((50, 40), (51, 40), (52, 40)), delta((50, 40), (50, 40)),
                      {'type': 'Point', 'coordinates': list(lonlat(50, 40))}, square(20, 10, 29, 19)):
            self.assertEqual(self.region(wrong, shape='delta').status_code, status.HTTP_400_BAD_REQUEST, wrong)
        # Corrected: each spot as the layer is
        wanted = {'emissivity': 0.8, 'reflected': 10.0}
        self.assertEqual(self.region(delta((50, 40), (45, 40)), shape='delta', correction=wanted).status_code,
                         status.HTTP_400_BAD_REQUEST)
        xmp_tiff(os.path.join(self.task.task_path(), "DJI_0001_T_temp_c.tiff"), 0.91, 21.0)
        fixed = self.region(delta((50, 40), (45, 40)), shape='delta', correction=wanted).data
        a, b = corrected(60.0, (0.8, 10.0), (0.91, 21.0)), corrected(55.0, (0.8, 10.0), (0.91, 21.0))
        self.assertAlmostEqual(fixed['first'], a, places=4)
        self.assertAlmostEqual(fixed['delta_t'], b - a, places=4)
        self.assertEqual([round(m, 4) for m in fixed['measured']], [60.0, 55.0])

    def test_a_delta_t_is_saved_with_its_two_spots_like_the_other_measurements(self):
        url = self.url(self.task, "measurements")
        line = {'type': 'LineString', 'coordinates': [list(lonlat(50, 40)), list(lonlat(50, 60))]}
        res = self.client.post(url, {'name': "Joint", 'shape': 'delta', 'geometry': line, 'isotherm': {'low': 25, 'high': None}},
                               format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        m = res.data
        self.assertEqual((m['shape'], m['geometry'], m['isotherm'], m['correction']), ('delta', line, None, None))
        self.assertAlmostEqual(m['values']['first'], 60.0, places=4)
        self.assertAlmostEqual(m['values']['second'], 65.0, places=4)
        self.assertAlmostEqual(m['values']['delta_t'], 5.0, places=4)
        self.assertEqual([x['name'] for x in self.client.get(url).data['measurements']], ["Joint"])
        three = dict(line, coordinates=line['coordinates'] + [list(lonlat(1, 1))])
        self.assertEqual(self.client.post(url, {'name': "Bad", 'shape': 'delta', 'geometry': three}, format="json").status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_who_can_only_view_the_project_sees_the_saved_measurements_but_cant_change_them(self):
        url = self.url(self.task, "measurements")
        mid = self.client.post(url, {'name': "Vent", 'shape': 'pin', 'geometry': {'type': 'Point', 'coordinates': list(lonlat(50, 40))}},
                               format="json").data['id']
        self.task.public = True
        self.task.save()
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(other.get(url).data['can_change'], False)
        self.assertEqual(len(other.get(url).data['measurements']), 1)
        self.assertEqual(other.post(url, {'name': "Mine", 'shape': 'pin'}, format="json").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(other.patch("{}/{}".format(url, mid), {'name': "Mine"}, format="json").status_code,
                         status.HTTP_403_FORBIDDEN)
        self.assertEqual(other.delete("{}/{}".format(url, mid)).status_code, status.HTTP_403_FORBIDDEN)

    def tile(self, col, row, zoom=18, task=None, what="tiles", headers=None, **params):
        """The map tile holding a pixel's centre (of the thermal layer, or what), and where that centre is in it (x, y)"""
        lon, lat = lonlat(col, row)
        (z, x, y), (left, bottom, right, top), (mx, my) = web_mercator_tile(lon, lat, zoom)
        size = int(params.get('size', 256))
        url = self.url(task or self.task, "{}/{}/{}/{}".format(what, z + (size == 512), x, y))
        at = (int((mx - left) / (right - left) * size), int((top - my) / (top - bottom) * size))
        return self.client.get(url, params, **(headers or {})), at

    def test_a_mosaics_regions_and_isotherms_are_in_celsius_without_its_no_data_marker(self):
        # A workset mosaic as dji-thermal-cli writes it: one band in its unit (here °F), absolute zero where it has none
        path = os.path.join(self.task.task_path(), "mosaic-f.tif")
        values = temperatures() * 1.8 + 32
        values[:, :TRANSPARENT_COLUMNS] = -459.67
        with rasterio.open(path, 'w', driver='GTiff', width=WIDTH, height=HEIGHT, count=1, dtype='float32',
                           crs='EPSG:32616', transform=from_origin(ORIGIN[0], ORIGIN[1], PIXEL, PIXEL)) as dst:
            dst.write(values.astype(np.float32), 1)
        st = inspector.raster_region(path, square(0, 0, 19, 9), unit='F')['statistics']
        expected = temperatures()[0:10, TRANSPARENT_COLUMNS:20]
        self.assertEqual(st['count'], expected.size)
        self.assertAlmostEqual(st['min'], float(expected.min()), places=3)
        self.assertAlmostEqual(st['max'], float(expected.max()), places=3)
        self.assertEqual(inspector.raster_region(path, square(0, 0, 5, 5), unit='F')['reason'], 'nodata')

        def painted(col, row, low=None, high=None):
            lon, lat = lonlat(col, row)
            (z, tx, ty), (left, bottom, right, top), (mx, my) = web_mercator_tile(lon, lat, 18)
            png = inspector.raster_isotherm(path, z, tx, ty, low, high, (255, 0, 0), unit='F')
            x = int((mx - left) / (right - left) * 256)
            y = int((top - my) / (top - bottom) * 256)
            return np.array(Image.open(io.BytesIO(png)).convert('RGBA'))[y, x, 3] == 255

        # (50, 40) is at 60 °C (140 °F): its limits are °C
        self.assertTrue(painted(50, 40, low=55))
        self.assertFalse(painted(50, 40, low=65))
        self.assertTrue(painted(50, 40, low=58, high=62))
        # Where it has no data, not painted even below any limit
        self.assertFalse(painted(3, 40, high=1000))

    def test_djis_palettes_are_the_librarys_colour_tables(self):
        luts = converter.palette_luts()
        self.assertEqual(list(luts), conversions.palettes())
        for lut in luts.values():
            self.assertEqual((lut.shape, lut.dtype), ((256, 3), np.uint8))
        np.testing.assert_array_equal(luts['whitehot'][[0, 255]], [[0, 0, 0], [255, 255, 255]])
        np.testing.assert_array_equal(luts['blackhot'][[0, 255]], [[255, 255, 255], [0, 0, 0]])

    def test_a_tile_draws_the_temperatures_over_the_range_in_a_dji_palette(self):
        res, (x, y) = self.tile(50, 40, palette='whitehot', rescale='0,200')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res['Content-Type'], 'image/png')
        im = np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))
        expected = (50 + 0.25 * 40) / 200 * 255
        self.assertEqual(im[y, x, 3], 255)
        self.assertLess(abs(int(im[y, x, 0]) - expected), 4)
        self.assertEqual(len(set(im[y, x, :3])), 1)
        # Without data (the alpha band), transparent; in a tile of 512 pixels, the same place
        res, (x, y) = self.tile(3, 40, palette='whitehot', rescale='0,200')
        self.assertEqual(np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))[y, x, 3], 0)
        res, (x, y) = self.tile(50, 40, palette='ironred', rescale='0,200', size=512)
        im = np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))
        self.assertEqual(im.shape, (512, 512, 4))
        np.testing.assert_allclose(im[y, x, :3], converter.palette_luts()['ironred'][round(expected)], atol=8)

    def test_a_tile_keeps_to_the_tasks_crop_when_asked(self):
        self.crop(40, 30, 60, 50)
        res, (x, y) = self.tile(70, 40, palette='whitehot', rescale='0,200', crop='1')
        self.assertEqual(np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))[y, x, 3], 0)
        res, (x, y) = self.tile(70, 40, palette='whitehot', rescale='0,200')
        self.assertEqual(np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))[y, x, 3], 255)

    def test_a_tile_needs_a_palette_and_a_range_on_the_orthophoto(self):
        self.assertEqual(self.tile(50, 40, palette='nope')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='../magma')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', rescale='10')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', rescale='5,5')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', size=300)[0].status_code, status.HTTP_400_BAD_REQUEST)
        far = self.client.get(self.url(self.task, "tiles/18/0/0"), {'palette': 'whitehot'})
        self.assertEqual(far.status_code, status.HTTP_404_NOT_FOUND)
        rgb = self.thermal_task(bands=('red', 'green'))
        self.assertEqual(self.tile(50, 40, task=rgb, palette='whitehot')[0].status_code, status.HTTP_404_NOT_FOUND)

    def pixel(self, col, row, **params):
        """A tile's colour at a pixel's centre (RGBA)"""
        res, (x, y) = self.tile(col, row, **params)
        self.assertEqual((res.status_code, res['Content-Type']), (status.HTTP_200_OK, 'image/png'), res.content[:200])
        return np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))[y, x].astype(int)

    def test_a_tile_draws_in_webodms_colour_maps_too(self):
        from app.api.tiler import get_colormap_encoded_values
        c = get_colormap_encoded_values('magma')[round((50 + 0.25 * 40) / 200 * 255)]
        np.testing.assert_allclose(self.pixel(50, 40, palette='magma', rescale='0,200')[:3],
                                   [(c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255], atol=8)

    def test_a_tile_is_drawn_with_gamma_stepped_or_sharpened_as_the_mosaics_are(self):
        # (50, 40) is at 60 °C: 30% of 0..200; gamma 2 draws it at its square root
        self.assertLess(abs(self.pixel(50, 40, palette='whitehot', rescale='0,200', gamma=2)[0] - 0.3 ** 0.5 * 255), 4)
        # Stepped: in the colour of its band's middle (50 to 100 °C: 75 °C, 37.5% of 0..200), beside WebODM's own
        # bands=L; a view kept from before Stepped (equalize) drawn Linear
        self.assertLess(abs(self.pixel(50, 40, palette='whitehot', rescale='0,200', bands='L', stepped='50,0')[0] - 0.375 * 255), 4)
        self.assertLess(abs(self.pixel(50, 40, palette='whitehot', rescale='0,200', equalize=1)[0] - 0.3 * 255), 4)
        self.assertFalse(os.path.exists(os.path.join(self.task.task_path(), "thermal", "histogram.json")))
        # Sharpened: the edge of its data stands out (beside it, only hotter pixels: (11, 40) is at 21 °C), and the
        # middle of a steady slope stays
        plain = self.pixel(TRANSPARENT_COLUMNS + 1, 40, palette='whitehot', rescale='17,25')[0]
        self.assertLess(self.pixel(TRANSPARENT_COLUMNS + 1, 40, palette='whitehot', rescale='17,25', sharpen=5)[0], plain - 20)
        self.assertLess(abs(self.pixel(50, 40, palette='whitehot', rescale='0,200', sharpen=5, size=512)[0] - 0.3 * 255), 4)
        for params in ({'gamma': 9}, {'gamma': 'x'}, {'stepped': '0,0'}, {'stepped': '1'}, {'sharpen': -1}):
            self.assertEqual(self.tile(50, 40, palette='whitehot', **params)[0].status_code, status.HTTP_400_BAD_REQUEST, params)

    def test_a_value_tile_holds_the_temperatures_a_tile_is_drawn_from_with_a_margin(self):
        margin = colouring.MARGIN
        res, (x, y) = self.tile(50, 40, what="values")
        self.assertEqual((res.status_code, res['Content-Type']), (status.HTTP_200_OK, 'image/png'))
        self.assertEqual((res['X-Values-Margin'], res['Cache-Control']), (str(margin), 'private, no-cache'))
        rgba = np.asarray(Image.open(io.BytesIO(res.content)))
        self.assertEqual(rgba.shape, (256 + 2 * margin, 256 + 2 * margin, 4))
        offset, step = float(res['X-Values-Offset']), float(res['X-Values-Step'])
        value = lambda px: offset + (int(px[0]) * 256 + int(px[1])) * step
        # (50, 40) is at 60 °C, read as the drawn tile reads it (bilinear)
        self.assertLess(abs(value(rgba[y + margin, x + margin]) - 60), 0.5)
        self.assertEqual(rgba[y + margin, x + margin, 3], 255)
        res, (x, y) = self.tile(3, 40, what="values")
        self.assertEqual(np.asarray(Image.open(io.BytesIO(res.content)))[y + margin, x + margin, 3], 0)
        # 512 pixels, and the task's crop, as the drawn tiles have them
        res, _at = self.tile(50, 40, what="values", size=512)
        self.assertEqual(Image.open(io.BytesIO(res.content)).size, (512 + 2 * margin,) * 2)
        self.crop(40, 30, 60, 50)
        res, (x, y) = self.tile(70, 40, what="values", crop='1')
        self.assertEqual(np.asarray(Image.open(io.BytesIO(res.content)))[y + margin, x + margin, 3], 0)

    def test_a_value_tile_is_asked_again_only_to_check_it_is_the_orthophotos_version(self):
        res, _at = self.tile(50, 40, what="values")
        etag = res['ETag']
        again, _at = self.tile(50, 40, what="values", headers={'HTTP_IF_NONE_MATCH': etag})
        self.assertEqual((again.status_code, again['ETag']), (status.HTTP_304_NOT_MODIFIED, etag))
        # Asked within the crop: the crop's part of it (the task had none: the same tile)
        self.assertEqual(self.tile(50, 40, what="values", crop='1')[0]['ETag'], etag)
        self.crop(40, 30, 60, 50)
        self.assertEqual(self.tile(50, 40, what="values")[0]['ETag'], etag)
        cropped, _at = self.tile(50, 40, what="values", crop='1')
        self.assertNotEqual(cropped['ETag'], etag)
        os.utime(inspector.thermal_orthophoto(self.task), ns=(1, 1))
        self.assertEqual(self.tile(50, 40, what="values", headers={'HTTP_IF_NONE_MATCH': etag})[0].status_code, status.HTTP_200_OK)
        far = self.client.get(self.url(self.task, "values/18/0/0"))
        self.assertEqual(far.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_legends_curve_is_the_tiles(self):
        res = self.client.get(self.url(self.task, "curve"), {'rescale': '0,200', 'gamma': 2})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        shares = res.data['shares']
        self.assertEqual((len(shares), shares[0], shares[-1]), (65, 0.0, 1.0))
        self.assertAlmostEqual(shares[16], 0.25 ** 0.5, places=6)
        self.assertEqual(self.client.get(self.url(self.task, "histogram")).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(self.url(self.task, "curve"), {'rescale': '0,200', 'gamma': 0}).status_code,
                         status.HTTP_400_BAD_REQUEST)

    def isotherm(self, col, row, **params):
        """The isotherm tile's colour at a pixel's centre (RGBA)"""
        res, (x, y) = self.tile(col, row, what="isotherm", **params)
        self.assertEqual((res.status_code, res['Content-Type']), (status.HTTP_200_OK, 'image/png'))
        return tuple(np.array(Image.open(io.BytesIO(res.content)).convert('RGBA'))[y, x])

    def test_an_isotherm_paints_the_temperatures_above_below_or_between_its_limits(self):
        # (50, 40) is at 60 °C
        self.assertEqual(self.isotherm(50, 40, low=55, color='e53935'), (0xe5, 0x39, 0x35, 255))
        self.assertEqual(self.isotherm(50, 40, low=65, color='e53935')[3], 0)
        self.assertEqual(self.isotherm(50, 40, high=65, color='1E88E5'), (0x1e, 0x88, 0xe5, 255))
        self.assertEqual(self.isotherm(50, 40, high=55, color='1e88e5')[3], 0)
        self.assertEqual(self.isotherm(50, 40, low=58, high=62, color='43a047', size=512), (0x43, 0xa0, 0x47, 255))
        self.assertEqual(self.isotherm(50, 40, low=62, high=70, color='43a047')[3], 0)
        # Not where the orthophoto has no data (its alpha band), nor outside the crop when asked
        self.assertEqual(self.isotherm(3, 40, high=1000, color='e53935')[3], 0)
        self.crop(40, 30, 60, 50)
        self.assertEqual(self.isotherm(70, 40, low=0, color='e53935', crop='1')[3], 0)
        self.assertEqual(self.isotherm(70, 40, low=0, color='e53935')[3], 255)

    def test_an_isotherm_needs_limits_in_order_and_a_colour(self):
        for params in ({'color': 'e53935'}, {'low': 30, 'high': 20, 'color': 'e53935'}, {'low': 'inf', 'color': 'e53935'},
                       {'low': 'x', 'color': 'e53935'}, {'low': 30}, {'low': 30, 'color': 'red'},
                       {'low': 30, 'color': 'e53935', 'size': 300}):
            self.assertEqual(self.tile(50, 40, what="isotherm", **params)[0].status_code, status.HTTP_400_BAD_REQUEST, params)
        far = self.client.get(self.url(self.task, "isotherm/18/0/0"), {'low': 30, 'color': 'e53935'})
        self.assertEqual(far.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_legend_has_the_colours_of_djis_palettes_and_webodms_colour_maps(self):
        res = self.client.get(self.url(self.task, "palette"), {'name': 'whitehot'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        colors = res.data['color_map']
        self.assertEqual((len(colors), colors[0], colors[-1]), (256, 0x000000ff, 0xffffffff))
        res = self.client.get(self.url(self.task, "palette"), {'name': 'rdylgn'})       # in WebODM's panel only
        self.assertEqual((res.status_code, len(res.data['color_map'])), (status.HTTP_200_OK, 256))
        for name in ('nope', '../magma', ''):
            self.assertEqual(self.client.get(self.url(self.task, "palette"), {'name': name}).status_code,
                             status.HTTP_404_NOT_FOUND, name)

    def test_only_who_can_view_the_task_reads_it(self):
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertIn(other.get(self.url(self.task, "point"), {'lon': 0, 'lat': 0}).status_code,
                      (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.task.public = True
        self.task.save()
        self.assertEqual(other.get(self.url(self.task, "point"), {'lon': 0, 'lat': 0}).status_code, status.HTTP_200_OK)
