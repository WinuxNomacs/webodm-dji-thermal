"""
The Thermal Inspector's reads of a task's thermal orthophoto: tests on an orthophoto they make, in a UTM zone, with
known temperatures (no image of anyone's).
"""
import importlib
import json
import os
import shutil

import numpy as np
import rasterio
from django.contrib.auth.models import User
from django.contrib.gis.geos import GEOSGeometry
from rasterio.transform import from_origin
from rasterio.warp import transform
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from app.tests.classes import BootTestCase

inspector = importlib.import_module("coreplugins.dji-thermal.inspector")

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
        task.orthophoto_extent = GEOSGeometry(json.dumps(square(-1, -1, WIDTH, HEIGHT)), srid=4326)
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
        self.task.crop = GEOSGeometry(json.dumps(square(*corners)), srid=4326)
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

    def test_a_region_far_from_the_orthophoto_or_not_a_polygon_is_said_so(self):
        far = {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
        self.assertEqual(self.region(far).data['reason'], 'outside_raster')
        self.assertEqual(self.region({'type': 'Point', 'coordinates': [0, 0]}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.region("roof").status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.region(square(20, 10, 29, 19), bins=0).status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_who_can_view_the_task_reads_it(self):
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertIn(other.get(self.url(self.task, "point"), {'lon': 0, 'lat': 0}).status_code,
                      (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.task.public = True
        self.task.save()
        self.assertEqual(other.get(self.url(self.task, "point"), {'lon': 0, 'lat': 0}).status_code, status.HTTP_200_OK)
