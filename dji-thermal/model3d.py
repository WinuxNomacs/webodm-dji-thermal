"""
A task's textured 3D model as temperatures, for the 3D Thermal Inspector on WebODM's 3D page (inspector3d.js).

ODX textures the model from the task's images: from a DJI Thermal Task's (or a workset's) one-band temperature TIFFs,
its textures are one-band float TIFFs of °C too (assets/odm_texturing/odm_textured_model_geo_material*_map_Kd.tif),
but the GLB WebODM's 3D page loads has them as grey JPEGs, stretched over the whole model's range (ODX's
modules/gltf.py). The browser swaps each of the GLB's materials for one coloured from these temperatures
(model3d.js), as the 2D map colours the orthophoto's.

Which texture is which GLB material: ODX writes the GLB's materials in the order the OBJ first uses them (`usemtl`), and
names none of them; each name's texture is the .mtl's `map_Kd`. So the order is read from the OBJ (once per version of
it), and each texture's size is checked against its GLB image's: a model where they don't match is refused rather
than coloured wrongly.

The space between a texture's patches is exactly 0.0 (mvs-texturing's fill), which no measured temperature is in
practice (a texel's value went through seam levelling): it holds no temperature (EMPTY).
"""
import hashlib
import json
import os
import re
import struct

from . import datasets, inspector

GLB_ASSET = 'textured_model.glb'
EMPTY = 0.0                     # a texture's fill between patches, no temperature
PERCENTILES = (2, 98)           # Auto's range, as the 2D colour scale's
STATS_SAMPLES = 4_000_000       # texels the range is computed from, at most (evenly spread over the textures)
CACHE_FILE = 'model3d.json'     # in the task's thermal/ folder: the model's description, by its version
# The description's layout: a change to it (or to how it's computed) is a new version of every model's
VERSION = 1


class NotThermalModel(Exception):
    """The task's 3D model doesn't hold temperatures, or can't be matched to its textures; the message says why"""


def glb_path(task):
    """The task's GLB when WebODM lists one, else None"""
    if GLB_ASSET not in (task.available_assets or []):
        return None
    path = task.get_asset_download_path(GLB_ASSET)
    return path if os.path.isfile(path) else None


def obj_materials(obj_path):
    """The OBJ's material library (its first `mtllib`) and its materials in the order its faces first use them"""
    library, order, seen = None, [], set()
    with open(obj_path, 'rb') as f:
        for line in f:
            if line.startswith(b'usemtl '):
                name = line[7:].strip().decode('utf-8', 'replace')
                if name not in seen:
                    seen.add(name)
                    order.append(name)
            elif library is None and line.startswith(b'mtllib '):
                library = line[7:].strip().decode('utf-8', 'replace')
    return library, order


def mtl_textures(mtl_path):
    """{material: its map_Kd file name} of a .mtl"""
    out, current = {}, None
    with open(mtl_path, encoding='utf-8', errors='replace') as f:
        for line in f:
            parts = line.split(None, 1)
            if not parts:
                continue
            if parts[0] == 'newmtl' and len(parts) > 1:
                current = parts[1].strip()
            elif parts[0] == 'map_Kd' and len(parts) > 1 and current:
                out[current] = parts[1].strip()
    return out


def glb_image_sizes(glb):
    """The (width, height) of each of a GLB's materials' base colour images, in its materials' order"""
    import io

    from PIL import Image
    with open(glb, 'rb') as f:
        head = f.read(20)
        if len(head) < 20 or head[:4] != b'glTF':
            raise NotThermalModel("The 3D model isn't a GLB")
        length, kind = struct.unpack('<II', head[12:20])
        if kind != 0x4E4F534A:      # JSON
            raise NotThermalModel("The 3D model's GLB has no JSON chunk")
        gltf = json.loads(f.read(length))
        binary_at = 20 + length + 8
        sizes = []
        for material in gltf.get('materials') or []:
            info = (material.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
            if info is None:
                raise NotThermalModel("A material of the 3D model has no texture")
            image = gltf['images'][gltf['textures'][info['index']]['source']]
            view = gltf['bufferViews'][image['bufferView']]
            f.seek(binary_at + view.get('byteOffset', 0))
            with Image.open(io.BytesIO(f.read(view['byteLength']))) as im:
                sizes.append(im.size)
    return sizes


def textures(task):
    """
    The task's model's textures, in its GLB's materials' order: [{name, path, width, height}]
    :raises NotThermalModel: no GLB, no OBJ or .mtl beside it, a texture missing, or textures that don't match the GLB's
    """
    glb = glb_path(task)
    if glb is None:
        raise NotThermalModel("This task has no textured 3D model")
    folder = os.path.dirname(glb)
    obj = os.path.join(folder, re.sub(r'\.glb$', '.obj', os.path.basename(glb)))
    if not os.path.isfile(obj):
        raise NotThermalModel("The 3D model's OBJ isn't there")
    library, order = obj_materials(obj)
    mtl = os.path.join(folder, os.path.basename(library or re.sub(r'\.obj$', '.mtl', os.path.basename(obj))))
    if not os.path.isfile(mtl):
        raise NotThermalModel("The 3D model's material library isn't there")
    maps = mtl_textures(mtl)
    sizes = glb_image_sizes(glb)
    if len(sizes) != len(order):
        raise NotThermalModel("The 3D model's GLB and OBJ don't have the same materials")
    out = []
    for name, (width, height) in zip(order, sizes):
        file = maps.get(name)
        path = os.path.join(folder, os.path.basename(file)) if file else None
        if path is None or not os.path.isfile(path):
            raise NotThermalModel("A texture of the 3D model isn't there")
        if texture_size(path) != (width, height):
            raise NotThermalModel("The 3D model's textures don't match its GLB's")
        out.append({'name': name, 'path': path, 'width': width, 'height': height})
    return out


def version(task):
    """The model's version: its GLB's, OBJ's and .mtl's sizes and times (a task processed again is a new one)"""
    glb = glb_path(task)
    if glb is None:
        return None
    folder = os.path.dirname(glb)
    parts = [VERSION]
    for name in sorted(os.listdir(folder)):
        if name.lower().endswith(('.glb', '.obj', '.mtl', '.tif', '.tiff')):
            st = os.stat(os.path.join(folder, name))
            parts.append((name, st.st_size, st.st_mtime_ns))
    return hashlib.sha1(repr(parts).encode()).hexdigest()[:20]


def open_texture(path):
    """A texture opened with rasterio (it has no place on Earth: rasterio's warning about it left out)"""
    import warnings

    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    with warnings.catch_warnings():
        warnings.simplefilter('ignore', NotGeoreferencedWarning)
        return rasterio.open(path)


def texture_size(path):
    """A texture's (width, height)"""
    with open_texture(path) as src:
        return src.width, src.height


def read_texture(path):
    """A texture's temperatures (°C, float64), NaN where it holds none
    :raises NotThermalModel: not a one-band float texture (an RGB model's)"""
    import numpy as np

    with open_texture(path) as src:
        if src.count != 1 or not np.issubdtype(np.dtype(src.dtypes[0]), np.floating):
            raise NotThermalModel("The 3D model's textures aren't temperatures")
        values = src.read(1).astype(np.float64)
    values[(values == EMPTY) | ~np.isfinite(values)] = np.nan
    return values


def describe(task):
    """
    What the 3D Inspector needs of a task's model: {version, materials: [{name, width, height}], range: {min, max, low,
    high} (°C: the coldest and hottest texels and Auto's 2nd and 98th percentiles), unit: 'C'}; kept in the task's
    thermal/ folder by version, as computing the range reads every texture
    :raises NotThermalModel: the task's orthophoto isn't thermal, or its model doesn't hold temperatures
    """
    import numpy as np

    if inspector.thermal_orthophoto(task) is None:
        raise NotThermalModel("This task has no thermal orthophoto")
    current = version(task)
    cache = datasets.data_path(task, CACHE_FILE)
    kept = datasets.read_json(cache, {})
    if kept.get('version') == current and current is not None:
        return kept
    found = textures(task)
    total = sum(t['width'] * t['height'] for t in found)
    stride = max(1, int(np.ceil(np.sqrt(total / STATS_SAMPLES))))
    samples, low, high = [], np.inf, -np.inf
    for t in found:
        values = read_texture(t['path'])
        has = np.isfinite(values)
        if has.any():
            low, high = min(low, float(values[has].min())), max(high, float(values[has].max()))
        sample = values[::stride, ::stride]
        samples.append(sample[np.isfinite(sample)])
    sampled = np.concatenate(samples) if samples else np.array([])
    if not np.isfinite(low) or not len(sampled):
        raise NotThermalModel("The 3D model's textures hold no temperatures")
    p_low, p_high = (float(v) for v in np.percentile(sampled, PERCENTILES))
    out = {'version': current, 'unit': 'C',
           'materials': [{'name': t['name'], 'width': t['width'], 'height': t['height']} for t in found],
           'range': {'min': low, 'max': high, 'low': p_low, 'high': p_high}}
    try:
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        datasets.write_json(cache, out)
    except OSError:
        pass        # kept only to answer faster next time
    return out


def material_values(task, index):
    """One material's temperatures as a value tile for the browser (colouring.value_png): (PNG bytes, offset, step),
    rows from the texture's top, as the GLB's image
    :raises NotThermalModel: as textures; IndexError: no such material"""
    from . import colouring

    materials = describe(task)['materials']      # the order, kept: not the OBJ read again for each material
    if not 0 <= index < len(materials):
        raise IndexError(index)
    return colouring.value_png(read_texture(texture_path(task, materials[index]['name'])))


def texture_path(task, name):
    """The texture of a material named in the model's .mtl
    :raises NotThermalModel: no such material or texture"""
    folder = os.path.dirname(glb_path(task) or '')
    mtl = [n for n in os.listdir(folder) if n.lower().endswith('.mtl')] if folder else []
    for library in sorted(mtl, key=lambda n: (not n.endswith('_geo.mtl'), n)):
        file = mtl_textures(os.path.join(folder, library)).get(name)
        if file and os.path.isfile(os.path.join(folder, os.path.basename(file))):
            return os.path.join(folder, os.path.basename(file))
    raise NotThermalModel("A texture of the 3D model isn't there")
