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

    def test_says_what_the_task_was_measured_with_for_manual_corrections(self):
        self.assertIsNone(self.client.get(self.url(self.task)).data['baseline'])
        with open(os.path.join(self.task.task_path(), 'a_temp_c.tiff'), 'wb') as f:
            f.write(b'II*\x00<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:dtc="urn:dji-thermal-cli:xmp:1.0" '
                    b'dtc:Emissivity="0.95" dtc:ReflectedTemperatureC="23"/></x:xmpmeta>')
        self.assertEqual(self.client.get(self.url(self.task)).data['baseline'], {'emissivity': 0.95, 'reflected': 23.0})

    def test_only_those_who_can_view_the_task_read_its_model_or_anyone_when_it_is_public(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.url(self.task)).status_code, status.HTTP_404_NOT_FOUND)    # as WebODM's
        self.task.public = True
        self.task.save()
        self.assertEqual(anonymous.get(self.url(self.task)).status_code, status.HTTP_200_OK)
        self.assertEqual(anonymous.get(self.url(self.task, "/0/values")).status_code, status.HTTP_200_OK)
