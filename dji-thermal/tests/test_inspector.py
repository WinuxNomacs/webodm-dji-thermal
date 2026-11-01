"""
The Thermal Inspector's reads of a task's thermal orthophoto: tests on an orthophoto they make, in a UTM zone, with
known temperatures (no image of anyone's).
"""
import importlib
import io
import json
import os
import shutil

import morecantile
import numpy as np
import rasterio
from PIL import Image
from django.contrib.auth.models import User
from django.contrib.gis.geos import GEOSGeometry
from rasterio.transform import from_origin
from rasterio.warp import transform
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from app.tests.classes import BootTestCase

inspector = importlib.import_module("coreplugins.dji-thermal.inspector")
converter = importlib.import_module("coreplugins.dji-thermal.converter")
conversions = importlib.import_module("coreplugins.dji-thermal.conversions")

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

    def tile(self, col, row, zoom=18, task=None, what="tiles", **params):
        """The map tile holding a pixel's centre (of the thermal layer, or what), and where that centre is in it (x, y)"""
        lon, lat = lonlat(col, row)
        tms = morecantile.tms.get('WebMercatorQuad')
        t = tms.tile(lon, lat, zoom)
        bounds, (mx, my) = tms.xy_bounds(t), tms.xy(lon, lat)
        size = int(params.get('size', 256))
        url = self.url(task or self.task, "{}/{}/{}/{}".format(what, t.z + (size == 512), t.x, t.y))
        at = (int((mx - bounds.left) / (bounds.right - bounds.left) * size),
              int((bounds.top - my) / (bounds.top - bounds.bottom) * size))
        return self.client.get(url, params), at

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
            tms = morecantile.tms.get('WebMercatorQuad')
            t = tms.tile(lon, lat, 18)
            bounds, (mx, my) = tms.xy_bounds(t), tms.xy(lon, lat)
            png = inspector.raster_isotherm(path, t.z, t.x, t.y, low, high, (255, 0, 0), unit='F')
            x = int((mx - bounds.left) / (bounds.right - bounds.left) * 256)
            y = int((bounds.top - my) / (bounds.top - bounds.bottom) * 256)
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

    def test_a_tile_needs_a_dji_palette_and_a_range_on_the_orthophoto(self):
        self.assertEqual(self.tile(50, 40, palette='magma')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', rescale='10')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', rescale='5,5')[0].status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.tile(50, 40, palette='whitehot', size=300)[0].status_code, status.HTTP_400_BAD_REQUEST)
        far = self.client.get(self.url(self.task, "tiles/18/0/0"), {'palette': 'whitehot'})
        self.assertEqual(far.status_code, status.HTTP_404_NOT_FOUND)
        rgb = self.thermal_task(bands=('red', 'green'))
        self.assertEqual(self.tile(50, 40, task=rgb, palette='whitehot')[0].status_code, status.HTTP_404_NOT_FOUND)

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
