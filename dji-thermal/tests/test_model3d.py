"""
The 3D Thermal Inspector's reads of a task's textured model (model3d.py, model3d_api.py): tests on a model they make,
a GLB, OBJ and .mtl with float textures of known temperatures, laid out as ODX writes them (no image of anyone's).
"""
import importlib
import io
import json
import os
import shutil
import struct
from unittest import mock

import numpy as np
import rasterio
from PIL import Image
from django.contrib.auth.models import User
from rasterio.transform import from_origin
from rest_framework import status
from rest_framework.test import APIClient

from app.models import Project, Task
from app.tests.classes import BootTestCase

model3d = importlib.import_module("coreplugins.dji-thermal.model3d")

# Two materials, the OBJ using the second first, as their order in the GLB: (name, width, height)
MATERIALS = [('material0001', 6, 4), ('material0000', 8, 5)]
FILL_COLUMNS = 2       # each texture's last columns are mvs-texturing's fill (0.0)


def texels(name, width, height):
    """°C: 10 for material0000 and 40 for material0001, plus the column and a tenth of the row, the fill at 0.0"""
    rows, cols = np.mgrid[0:height, 0:width]
    values = (10.0 if name == 'material0000' else 40.0) + cols + 0.1 * rows
    values[:, width - FILL_COLUMNS:] = model3d.EMPTY
    return values.astype(np.float32)


def jpeg(width, height):
    buf = io.BytesIO()
    Image.new('L', (width, height), 128).save(buf, 'JPEG')
    return buf.getvalue()


def glb(sizes):
    """A GLB as ODX's: its materials each a base colour texture, a JPEG of the size given, in that order"""
    binary, views, images, textures, materials = b'', [], [], [], []
    for width, height in sizes:
        data = jpeg(width, height)
        data += b'\0' * (-len(data) % 4)
        views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary += data
        images.append({'bufferView': len(views) - 1, 'mimeType': 'image/jpeg'})
        textures.append({'source': len(images) - 1, 'sampler': 0})
        materials.append({'pbrMetallicRoughness': {'baseColorTexture': {'index': len(textures) - 1}}})
    gltf = json.dumps({'asset': {'version': '2.0'}, 'materials': materials, 'textures': textures, 'images': images,
                       'bufferViews': views, 'buffers': [{'byteLength': len(binary)}]}).encode()
    gltf += b' ' * (-len(gltf) % 4)
    body = struct.pack('<II', len(gltf), 0x4E4F534A) + gltf + struct.pack('<II', len(binary), 0x004E4942) + binary
    return b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body


def write_texture(path, values, count=1, dtype='float32'):
    with rasterio.open(path, 'w', driver='GTiff', width=values.shape[1], height=values.shape[0], count=count,
                       dtype=dtype) as dst:
        for band in range(1, count + 1):
            dst.write(values.astype(dtype), band)


def decoded(response):
    """A value tile's temperatures (°C), NaN where it holds none (recolour.js's decoding)"""
    rgba = np.asarray(Image.open(io.BytesIO(response.content)).convert('RGBA')).astype(np.float64)
    values = float(response['X-Values-Offset']) + (rgba[..., 0] * 256 + rgba[..., 1]) * float(response['X-Values-Step'])
    values[rgba[..., 3] == 0] = np.nan
    return values


class TestModel3D(BootTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.get(username="testuser")
        self.project = Project.objects.get(owner=self.user)
        self.client = APIClient()
        self.client.login(username="testuser", password="test1234")
        self.task = self.model_task()

    def model_task(self, bands=('lwir', None), materials=MATERIALS, glb_sizes=None, rgb=False):
        task = Task.objects.create(project=self.project, name="Model", available_assets=['orthophoto.tif', 'textured_model.glb'],
                                   orthophoto_bands=[{'name': 'gray', 'description': bands[0]},
                                                     {'name': 'alpha', 'description': bands[1]}])
        self.addCleanup(shutil.rmtree, task.task_path(), True)
        ortho = task.get_asset_download_path('orthophoto.tif')
        os.makedirs(os.path.dirname(ortho), exist_ok=True)
        with rasterio.open(ortho, 'w', driver='GTiff', width=4, height=4, count=1, dtype='float32', crs='EPSG:32616',
                           transform=from_origin(400000.0, 4660000.0, 0.5, 0.5)) as dst:
            dst.write(np.full((4, 4), 20.0, np.float32), 1)
        folder = os.path.dirname(task.get_asset_download_path('textured_model.glb'))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, 'odm_textured_model_geo.glb'), 'wb') as f:
            f.write(glb(glb_sizes or [(w, h) for _, w, h in materials]))
        with open(os.path.join(folder, 'odm_textured_model_geo.obj'), 'w') as f:
            f.write('mtllib odm_textured_model_geo.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\n')
            f.writelines('usemtl {}\nf 1/1 2/1 3/1\n'.format(name) for name, _, _ in materials)
            f.write('usemtl {}\nf 1/1 3/1 2/1\n'.format(materials[0][0]))     # used again: still first
        with open(os.path.join(folder, 'odm_textured_model_geo.mtl'), 'w') as f:
            for name, w, h in sorted(materials):
                f.write('newmtl {0}\nKd 1 1 1\nmap_Kd odm_textured_model_geo_{0}_map_Kd.tif\n'.format(name))
                write_texture(os.path.join(folder, 'odm_textured_model_geo_{}_map_Kd.tif'.format(name)),
                              texels(name, w, h), *((3, 'uint8') if rgb else ()))
        return task

    def url(self, task, what=""):
        return "/api/plugins/dji-thermal/projects/{}/tasks/{}/inspector/model{}".format(task.project.id, task.id, what)

    def test_describes_the_materials_in_the_order_the_obj_first_uses_them_as_the_glb_has_them(self):
        found = self.client.get(self.url(self.task)).data
        self.assertEqual([(m['name'], m['width'], m['height']) for m in found['materials']], MATERIALS)

    def test_the_range_is_the_textures_temperatures_leaving_out_the_fill_between_patches(self):
        found = self.client.get(self.url(self.task)).data['range']
        # material0000: 10 to 10 + 5 + 0.4; material0001: 40 to 40 + 3 + 0.3 (the last 2 columns are fill)
        self.assertAlmostEqual(found['min'], 10.0, places=4)
        self.assertAlmostEqual(found['max'], 43.3, places=4)
        self.assertTrue(10.0 < found['low'] < found['high'] < 43.3)

    def test_serves_a_materials_temperatures_as_a_value_tile_the_browser_decodes_to_the_texture(self):
        response = self.client.get(self.url(self.task, "/1/values"))     # material0000, second in the GLB
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['X-Values-Margin'], '0')
        values = decoded(response)
        expected = texels('material0000', 8, 5).astype(np.float64)
        expected[expected == model3d.EMPTY] = np.nan
        self.assertEqual(values.shape, expected.shape)
        self.assertTrue(np.array_equal(np.isnan(values), np.isnan(expected)))
        self.assertLess(np.nanmax(abs(values - expected)), 0.001)

    def test_a_browser_holding_a_materials_version_is_told_it_has_not_changed(self):
        etag = self.client.get(self.url(self.task, "/0/values"))['ETag']
        again = self.client.get(self.url(self.task, "/0/values"), HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(again.status_code, status.HTTP_304_NOT_MODIFIED)
        self.assertNotEqual(self.client.get(self.url(self.task, "/1/values"))['ETag'], etag)

    def test_a_materials_temperatures_are_read_once_and_kept_until_the_task_is_processed_again(self):
        first = self.client.get(self.url(self.task, "/1/values"))
        folder = os.path.join(self.task.task_path('thermal'), model3d.VALUES_DIR)
        version = model3d.describe(self.task)['version']
        self.assertEqual(sorted(os.listdir(folder)), [version + '-1.json', version + '-1.png'])
        with mock.patch.object(model3d, 'read_texture', side_effect=AssertionError("read again")):
            again = self.client.get(self.url(self.task, "/1/values"))
        self.assertEqual((again.content, again['X-Values-Offset'], again['X-Values-Step']),
                         (first.content, first['X-Values-Offset'], first['X-Values-Step']))
        # Processed again: its textures read again, and the old version's kept tiles removed
        texture = os.path.join(os.path.dirname(self.task.get_asset_download_path('textured_model.glb')),
                               'odm_textured_model_geo_material0000_map_Kd.tif')
        colder = texels('material0000', 8, 5)
        colder[colder != model3d.EMPTY] -= 30
        write_texture(texture, colder)
        self.assertLess(np.nanmin(decoded(self.client.get(self.url(self.task, "/1/values")))), -10)
        self.assertTrue(all(not name.startswith(version) for name in os.listdir(folder)))

    def test_a_material_the_model_does_not_have_is_not_found(self):
        self.assertEqual(self.client.get(self.url(self.task, "/2/values")).status_code, status.HTTP_404_NOT_FOUND)

    def test_a_task_processed_again_is_described_again(self):
        self.client.get(self.url(self.task))
        folder = os.path.dirname(self.task.get_asset_download_path('textured_model.glb'))
        colder = texels('material0000', 8, 5)
        colder[colder != model3d.EMPTY] -= 30
        write_texture(os.path.join(folder, 'odm_textured_model_geo_material0000_map_Kd.tif'), colder)
        self.assertAlmostEqual(self.client.get(self.url(self.task)).data['range']['min'], -20.0, places=4)

    def test_refuses_a_model_whose_textures_are_not_temperatures(self):
        rgb = self.model_task(rgb=True)
        self.assertEqual(self.client.get(self.url(rgb)).status_code, status.HTTP_404_NOT_FOUND)

    def test_refuses_a_model_whose_glb_does_not_match_its_textures(self):
        fewer = self.model_task(glb_sizes=[(6, 4)])
        self.assertIn("same materials", str(self.client.get(self.url(fewer)).data))
        swapped = self.model_task(glb_sizes=[(8, 5), (6, 4)])
        self.assertIn("don't match", str(self.client.get(self.url(swapped)).data))

    def test_refuses_a_task_without_a_thermal_orthophoto_or_a_glb(self):
        rgb = self.model_task(bands=('red', 'green'))
        self.assertEqual(self.client.get(self.url(rgb)).status_code, status.HTTP_404_NOT_FOUND)
        self.task.available_assets = ['orthophoto.tif']
        self.task.save()
        self.assertIn("no textured 3D model", str(self.client.get(self.url(self.task)).data))

    def test_says_the_palette_chosen_for_the_task(self):
        self.assertEqual(self.client.get(self.url(self.task)).data['palette'], '')
        conversion_tasks = importlib.import_module("coreplugins.dji-thermal.conversion_tasks")
        conversion_tasks.set_task_palette(self.task, 'ironred')
        self.assertEqual(self.client.get(self.url(self.task)).data['palette'], 'ironred')

    def test_says_what_the_task_was_measured_with_for_manual_corrections(self):
        self.assertIsNone(self.client.get(self.url(self.task)).data['baseline'])
        with open(os.path.join(self.task.task_path(), 'a_temp_c.tiff'), 'wb') as f:
            f.write(b'II*\x00<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:dtc="urn:dji-thermal-cli:xmp:1.0" '
                    b'dtc:Emissivity="0.95" dtc:ReflectedTemperatureC="23"/></x:xmpmeta>')
        self.assertEqual(self.client.get(self.url(self.task)).data['baseline'], {'emissivity': 0.95, 'reflected': 23.0})

    def test_gives_the_saved_pins_where_they_are_in_the_models_coordinates(self):
        from rasterio.warp import transform
        lon, lat = transform('EPSG:32616', 'EPSG:4326', [400001.0], [4659999.0])
        url = "/api/plugins/dji-thermal/projects/{}/tasks/{}/inspector/measurements".format(self.project.id, self.task.id)
        self.client.post(url, {'name': "Vent", 'shape': 'pin', 'geometry': {'type': 'Point', 'coordinates': [lon[0], lat[0]]}},
                         format="json")
        pins = self.client.get(self.url(self.task, "/saved")).data['pins']
        self.assertEqual([p['name'] for p in pins], ["Vent"])
        self.assertAlmostEqual(pins[0]['x'], 400001.0, places=3)
        self.assertAlmostEqual(pins[0]['y'], 4659999.0, places=3)
        self.assertAlmostEqual(pins[0]['values']['temperature'], 20.0, places=4)

    def test_only_those_who_can_view_the_task_read_its_model_or_anyone_when_it_is_public(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.url(self.task)).status_code, status.HTTP_404_NOT_FOUND)    # as WebODM's
        self.task.public = True
        self.task.save()
        self.assertEqual(anonymous.get(self.url(self.task)).status_code, status.HTTP_200_OK)
        self.assertEqual(anonymous.get(self.url(self.task, "/0/values")).status_code, status.HTTP_200_OK)


frames3d = importlib.import_module("coreplugins.dji-thermal.frames3d")
NADIR = [np.pi, 0.0, 0.0]       # world to camera looking straight down: x east, y south (rows down), z down
CAMERA = 'v2 test 40 30 brown 1.0'
LENS = {'projection_type': 'brown', 'width': 40, 'height': 30, 'focal_x': 1.0, 'focal_y': 1.0, 'c_x': 0.0, 'c_y': 0.0,
        'k1': 0.0, 'k2': 0.0, 'k3': 0.0, 'p1': 0.0, 'p2': 0.0}


def photo(col, row):
    """A photo's °C: 20 plus the column and a hundredth of the row"""
    return 20.0 + col + 0.01 * row


class TestFrames3D(TestModel3D):
    """The photos that saw a point of the model (frames3d.py), placed with ODX's cameras (shots.geojson, cameras.json)"""

    def setUp(self):
        super().setUp()
        # Straight down 50 m over (400001, 4659999, 0); 30 m east of it, turned to look west at the point (a wall facing
        # east); one whose photo isn't of temperatures; one whose photo is gone
        self.shots = [('a_nadir.tiff', [400001.0, 4659999.0, 50.0], NADIR, 'float'),
                      ('b_east.tiff', [400031.0, 4659999.0, 0.0], self.looking_west(), 'float'),
                      ('c_rgb.tiff', [400001.0, 4659999.0, 40.0], NADIR, 'rgb'),
                      ('d_gone.tiff', [400001.0, 4659999.0, 60.0], NADIR, None)]
        self.write_cameras(self.task, self.shots)

    @staticmethod
    def looking_west():
        """World to camera looking west, level (camera x north, y down, z west: rows [0, 1, 0], [0, 0, -1], [-1, 0, 0]),
        as a rotation vector: 120° about (1, 1, -1)"""
        return [float(v) * 2 * np.pi / 3 / np.sqrt(3) for v in (1, 1, -1)]

    def write_cameras(self, task, shots):
        features = []
        for name, centre, rotation, kind in shots:
            features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [0, 0, 0]},
                             'properties': {'filename': name, 'camera': CAMERA, 'translation': centre, 'rotation': rotation}})
            if kind:
                rows, cols = np.mgrid[0:30, 0:40]
                write_texture(task.task_path(name), photo(cols, rows), *((3, 'uint8') if kind == 'rgb' else ()))
        os.makedirs(task.assets_path('odm_report'), exist_ok=True)
        with open(task.assets_path('odm_report', 'shots.geojson'), 'w') as f:
            json.dump({'type': 'FeatureCollection', 'features': features}, f)
        with open(task.assets_path('cameras.json'), 'w') as f:
            json.dump({CAMERA.removeprefix('v2 '): LENS}, f)

    def frames(self, x, y, z, normal=None, task=None):
        query = "?x={}&y={}&z={}".format(x, y, z) + ("&nx={}&ny={}&nz={}".format(*normal) if normal else "")
        return self.client.get(self.url(task or self.task, "/frames" + query))

    def test_a_point_below_a_camera_is_at_its_photos_centre_with_the_photos_temperature_there(self):
        found = self.frames(400001.0, 4659999.0, 0.0).data
        nadir = next(f for f in found['frames'] if f['file'] == 'a_nadir.tiff')
        self.assertAlmostEqual(nadir['x'], 19.5, places=6)          # (40 - 1) / 2: pixel centres at whole numbers
        self.assertAlmostEqual(nadir['y'], 14.5, places=6)
        self.assertAlmostEqual(nadir['view_angle'], 0.0, places=6)
        self.assertAlmostEqual(nadir['distance'], 50.0, places=6)
        self.assertEqual(nadir['camera'], [400001.0, 4659999.0, 50.0])
        self.assertAlmostEqual(nadir['temperature'], photo(20, 15), places=4)     # its nearest pixel, floor(x + 0.5)
        self.assertIsNone(found['workset'])
        self.assertIsNone(nadir['frame'])

    def test_a_point_east_of_the_camera_is_right_of_centre_and_south_below_it(self):
        nadir = next(f for f in self.frames(400006.0, 4659998.0, 0.0).data['frames'] if f['file'] == 'a_nadir.tiff')
        # 5 m east and 1 m south at 50 m: 0.1 and 0.02 of the focal length, times the photo's larger side (40)
        self.assertAlmostEqual(nadir['x'], 19.5 + 4.0, places=6)
        self.assertAlmostEqual(nadir['y'], 14.5 + 0.8, places=6)
        self.assertAlmostEqual(nadir['temperature'], photo(24, 15), places=4)

    def test_the_camera_facing_the_surface_comes_first(self):
        # From straight down, the nadir photo first; on a wall facing east, the photo looking west at it
        down = [f['file'] for f in self.frames(400001.0, 4659999.0, 0.0).data['frames']]
        self.assertEqual(down[0], 'a_nadir.tiff')
        wall = self.frames(400001.0, 4659999.0, 0.0, normal=(1, 0, 0)).data['frames']
        self.assertEqual(wall[0]['file'], 'b_east.tiff')
        self.assertAlmostEqual(wall[0]['view_angle'], 0.0, places=5)
        self.assertAlmostEqual(wall[0]['x'], 19.5, places=5)
        self.assertAlmostEqual(wall[0]['y'], 14.5, places=5)
        self.assertAlmostEqual(next(f for f in wall if f['file'] == 'a_nadir.tiff')['view_angle'], 90.0, places=5)

    def test_leaves_out_photos_that_did_not_see_the_point_or_are_not_of_temperatures_and_says_which_are_gone(self):
        files = {f['file']: f for f in self.frames(400001.0, 4659999.0, 0.0).data['frames']}
        self.assertNotIn('c_rgb.tiff', files)
        self.assertFalse(files['d_gone.tiff']['available'])
        self.assertIsNone(files['d_gone.tiff']['temperature'])
        # 26 m west of the nadir camera's point is outside its photo (column -1.3: its nearest pixel is past the first;
        # at 25 m, column -0.5, the first), and in front of the east one; 9 m east of the point is behind the east one
        self.assertEqual([f['file'] for f in self.frames(399975.0, 4659999.0, 0.0).data['frames']
                          if f['file'] in ('a_nadir.tiff', 'b_east.tiff')], ['b_east.tiff'])
        self.assertEqual([f['file'] for f in self.frames(400040.0, 4659999.0, 0.0).data['frames'] if f['file'] == 'b_east.tiff'], [])

    def test_projects_through_a_brown_lens_as_opensfm_does(self):
        lens = dict(LENS, k1=0.1, k2=0.01, k3=0.001, p1=0.002, p2=0.003, c_x=0.01, c_y=-0.02)
        shot = {'centre': [0.0, 0.0, 10.0], 'rotation': frames3d.rotation_matrix(NADIR), 'camera': lens}
        x, y = 3.0 / 10, 2.0 / 10                    # 3 m east, 2 m south (the camera's y is south), 10 m below
        r2 = x * x + y * y
        radial = 1 + 0.1 * r2 + 0.01 * r2 ** 2 + 0.001 * r2 ** 3
        xd = x * radial + 2 * 0.002 * x * y + 0.003 * (r2 + 2 * x * x)
        yd = y * radial + 0.002 * (r2 + 2 * y * y) + 2 * 0.003 * x * y
        u, v = frames3d.project(shot, [3.0, -2.0, 0.0])
        self.assertAlmostEqual(u, (xd + 0.01) * 40 + 19.5, places=9)
        self.assertAlmostEqual(v, (yd - 0.02) * 40 + 14.5, places=9)
        self.assertIsNone(frames3d.project(shot, [0.0, 0.0, 20.0]))      # above the camera looking down: behind it

    def test_serves_a_photos_temperatures_as_a_value_tile_the_browser_decodes_to_the_photo(self):
        index = next(f for f in self.frames(400001.0, 4659999.0, 0.0).data['frames'] if f['file'] == 'a_nadir.tiff')['index']
        response = self.client.get(self.url(self.task, "/frames/{}/values".format(index)))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows, cols = np.mgrid[0:30, 0:40]
        self.assertLess(np.nanmax(abs(decoded(response) - photo(cols, rows))), 0.001)
        again = self.client.get(self.url(self.task, "/frames/{}/values".format(index)), HTTP_IF_NONE_MATCH=response['ETag'])
        self.assertEqual(again.status_code, status.HTTP_304_NOT_MODIFIED)
        gone = next(f for f in self.frames(400001.0, 4659999.0, 0.0).data['frames'] if f['file'] == 'd_gone.tiff')['index']
        self.assertEqual(self.client.get(self.url(self.task, "/frames/{}/values".format(gone))).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(self.url(self.task, "/frames/99/values")).status_code, status.HTTP_404_NOT_FOUND)

    def test_needs_a_point_and_odms_cameras(self):
        self.assertEqual(self.client.get(self.url(self.task, "/frames?x=1&y=2")).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(self.url(self.task, "/frames?x=1&y=2&z=nan")).status_code, status.HTTP_400_BAD_REQUEST)
        os.remove(self.task.assets_path('odm_report', 'shots.geojson'))
        self.assertEqual(self.frames(400001.0, 4659999.0, 0.0).status_code, status.HTTP_404_NOT_FOUND)

    def test_only_those_who_can_view_the_task_see_its_photos_or_anyone_when_it_is_public(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.url(self.task, "/frames?x=400001&y=4659999&z=0")).status_code, status.HTTP_404_NOT_FOUND)
        self.task.public = True
        self.task.save()
        found = anonymous.get(self.url(self.task, "/frames?x=400001&y=4659999&z=0"))
        self.assertEqual(found.status_code, status.HTTP_200_OK)
        self.assertIsNone(found.data['workset'])
        self.assertEqual(anonymous.get(self.url(self.task, "/frames/0/values")).status_code, status.HTTP_200_OK)

    # On WebODM's map (the 2D Inspector): a point of the orthophoto, at the surface model's height there

    def write_dsm(self, heights, task=None):
        """The task's surface model, 0.5 m cells from (399990, 4660010): heights(x, y) of each cell's centre, NaN none"""
        path = (task or self.task).assets_path('odm_dem', 'dsm.tif')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        rows, cols = np.mgrid[0:40, 0:120]
        values = np.asarray(heights(399990.25 + 0.5 * cols, 4660009.75 - 0.5 * rows) + 0.0 * cols, dtype=np.float32)
        values[~np.isfinite(values)] = -9999.0
        with rasterio.open(path, 'w', driver='GTiff', width=120, height=40, count=1, dtype='float32', crs='EPSG:32616',
                           nodata=-9999.0, transform=from_origin(399990.0, 4660010.0, 0.5, 0.5)) as dst:
            dst.write(values, 1)

    def map_url(self, what, task=None):
        task = task or self.task
        return "/api/plugins/dji-thermal/projects/{}/tasks/{}/inspector/{}".format(task.project.id, task.id, what)

    def on_map(self, x, y, client=None):
        from rasterio.warp import transform
        lon, lat = transform('EPSG:32616', 'EPSG:4326', [x], [y])
        return (client or self.client).get(self.map_url("frames?lon={!r}&lat={!r}".format(lon[0], lat[0]))), lon[0], lat[0]

    def test_a_point_of_the_map_is_placed_at_the_surface_models_height_and_read_in_each_photo_and_the_orthophoto(self):
        self.write_dsm(lambda x, y: 10.0)
        response, lon, lat = self.on_map(400001.1, 4659998.9)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        found = response.data
        nadir = next(f for f in found['frames'] if f['file'] == 'a_nadir.tiff')
        self.assertAlmostEqual(nadir['distance'], 40.0, places=2)            # 50 m up, over a surface at 10 m
        self.assertAlmostEqual(nadir['x'], 19.5 + 0.1, places=3)             # 0.1 m east at 40 m, times 40
        self.assertAlmostEqual(nadir['y'], 14.5 + 0.1, places=3)
        self.assertAlmostEqual(nadir['temperature'], photo(20, 15), places=4)
        self.assertAlmostEqual(nadir['lonlat'][0], lon, delta=1e-5)          # taken from 10 cm away
        self.assertAlmostEqual(nadir['lonlat'][1], lat, delta=1e-5)
        self.assertAlmostEqual(found['orthophoto'], 20.0, places=4)
        self.assertIsNone(found['workset'])
        self.assertIsNone(nadir['frame'])

    def test_leaves_out_the_photos_the_surface_hides_a_point_of_the_map_from_and_counts_them(self):
        # A wall 5 m high, 9 to 10 m east of the point, between it and the level camera 30 m east
        self.write_dsm(lambda x, y: np.where((x > 400010.0) & (x < 400011.0), 5.0, 0.0))
        found = self.on_map(400001.0, 4659999.0)[0].data
        self.assertEqual([f['file'] for f in found['frames']], ['a_nadir.tiff', 'd_gone.tiff'])
        self.assertEqual(found['hidden'], 1)
        beyond = self.on_map(400020.0, 4659999.0)[0].data       # east of the wall: the level camera sees it
        self.assertIn('b_east.tiff', [f['file'] for f in beyond['frames']])
        self.assertIn('a_nadir.tiff', [f['file'] for f in beyond['frames']])     # over the wall
        self.assertEqual(beyond['hidden'], 0)
        self.assertIsNone(beyond['orthophoto'])                  # past the orthophoto's edge

    def test_a_task_says_whether_the_photos_that_saw_a_point_of_its_map_can_be_told(self):
        self.assertFalse(self.client.get(self.map_url("measurements")).data['photos'])       # no surface model
        self.assertEqual(self.on_map(400001.0, 4659999.0)[0].status_code, status.HTTP_404_NOT_FOUND)
        self.write_dsm(lambda x, y: np.where(x < 400000.5, np.nan, 0.0))
        self.assertTrue(self.client.get(self.map_url("measurements")).data['photos'])
        none = self.on_map(400000.2, 4659999.0)[0]               # the surface model has no height there
        self.assertEqual(none.status_code, status.HTTP_200_OK)
        self.assertEqual((none.data['frames'], none.data['hidden']), ([], 0))
        self.assertEqual(self.on_map(399000.0, 4659999.0)[0].data['frames'], [])      # outside it
        self.assertEqual(self.client.get(self.map_url("frames?lon=200&lat=0")).status_code, status.HTTP_400_BAD_REQUEST)
        os.remove(self.task.assets_path('cameras.json'))
        self.assertFalse(self.client.get(self.map_url("measurements")).data['photos'])

    def test_a_maps_photos_are_served_without_a_thermal_model_to_those_who_can_view_the_task(self):
        self.write_dsm(lambda x, y: 0.0)
        os.remove(os.path.join(os.path.dirname(self.task.get_asset_download_path('textured_model.glb')), 'odm_textured_model_geo.glb'))
        self.assertEqual(self.frames(400001.0, 4659999.0, 0.0).status_code, status.HTTP_404_NOT_FOUND)       # the 3D page's
        index = self.on_map(400001.0, 4659999.0)[0].data['frames'][0]['index']
        response = self.client.get(self.map_url("frames/{}/values".format(index)))
        rows, cols = np.mgrid[0:30, 0:40]
        self.assertLess(np.nanmax(abs(decoded(response) - photo(cols, rows))), 0.001)
        again = self.client.get(self.map_url("frames/{}/values".format(index)), HTTP_IF_NONE_MATCH=response['ETag'])
        self.assertEqual(again.status_code, status.HTTP_304_NOT_MODIFIED)
        anonymous = APIClient()
        self.assertEqual(self.on_map(400001.0, 4659999.0, anonymous)[0].status_code, status.HTTP_404_NOT_FOUND)
        self.task.public = True
        self.task.save()
        self.assertEqual(self.on_map(400001.0, 4659999.0, anonymous)[0].status_code, status.HTTP_200_OK)
        self.assertEqual(anonymous.get(self.map_url("frames/{}/values".format(index))).status_code, status.HTTP_200_OK)
