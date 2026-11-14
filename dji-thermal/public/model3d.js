// The textured 3D model on WebODM's 3D page as a source of temperatures, for the 3D Thermal Inspector (inspector3d.js):
// a Thermal Task's model is textured by ODX from temperature TIFFs, and its GLB has them as grey; the server sends
// each material's temperatures (model3d_api.py, as value tiles: recolour.js decodes them), and this colours them in
// the palette, as the 2D map colours the orthophoto, and reads the temperature at a point of the model from them.
//
// A source answers the 3D Inspector's few questions; another (the point cloud: pointcloud3d.js) answers the same ones:
//   ready        a Promise of whether the source holds temperatures (its description, or null)
//   loaded()     whether it can be read now; shown(), whether it's on screen (WebODM shows the model or the point
//                cloud, one at a time)
//   restyle(s)   colour it again with a recolour.js style ({colors, range, shares, steps, ...}, °C), with an isotherm
//                painted over it (isothermPaint: {rgb, limits: [low, high], °C, either null}) or not
//   reading(hit) the temperature at a hit of it: {valid, temperature (°C), reason}
//   detach()     its original look back, its listeners off
// The model also gives the meshes the 3D Inspector's index is built from (meshes()), and the temperature at texture
// coordinates of a material (valueAt), which the point cloud's points read.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var WATCH_MS = 400;             // how often the scene is looked at until WebODM has added the model
    var FETCHES = 6;                // material values fetched at once (a browser asks a server 6 at a time)
    var DILATE = 2;                 // texels a material's colours reach into the empty space around its patches
    var EMPTY_RGB = [128, 128, 128];    // where a texture holds no temperature, beyond that
    var DRACO_PATH = "/static/app/js/vendor/draco/";      // WebODM's own (ModelView.jsx)
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);

    function modelUrl(task, what) {
        return API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/model" + (what || "");
    }
    // WebODM's GLB of the task, as its 3D page loads it; for iOS, the smallest (its textures reduced), as the plugin's
    // own copy needs only its shapes
    function glbUrl(task) { return "/api/projects/" + task.project + "/tasks/" + task.id + "/textured_model/?platform=ios"; }

    // The meshes under an object, in order, and their materials, each once, in the order first met
    function materialsOf(object) {
        var out = [];
        object.traverse(function (o) {
            if (!o.isMesh) return;
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
                if (m && out.indexOf(m) === -1) out.push(m);
            });
        });
        return out;
    }

    function imageSize(map) {
        var im = map && map.image;
        return im ? [im.naturalWidth || im.width, im.naturalHeight || im.height] : null;
    }

    // Whether an image of size s is a texture of w by h, or that reduced by a power of two both ways (WebODM serves a
    // large GLB so to phones: Task.get_safe_textured_model)
    function sameTexture(s, w, h) {
        if (!s || !s[0] || !s[1] || w % s[0] || h % s[1]) return false;
        var k = w / s[0];
        return k === h / s[1] && (k & (k - 1)) === 0;
    }

    // The object's materials matched to the description's (model3d.describe), [material per described one], or null:
    // by name (the OBJ's MTLLoader keeps them), else in order (the GLB's are unnamed, in the same order), each
    // texture's size checked
    function matchMaterials(object, description) {
        var found = materialsOf(object), wanted = description.materials;
        if (found.length !== wanted.length) return null;
        var byName = {};
        found.forEach(function (m) { if (m.name) byName[m.name] = m; });
        var named = wanted.every(function (w) { return byName[w.name]; });
        var out = wanted.map(function (w, i) { return named ? byName[w.name] : found[i]; });
        var sizesMatch = out.every(function (m, i) { return sameTexture(imageSize(m.map), wanted[i].width, wanted[i].height); });
        return sizesMatch ? out : null;
    }

    // The model WebODM added to the scene: an object with textured meshes matching the description, or null
    function findModel(scene, description) {
        var kids = scene.children || [];
        for (var i = 0; i < kids.length; i++) {
            var materials = kids[i].isPoints ? null : matchMaterials(kids[i], description);
            if (materials) return {object: kids[i], materials: materials};
        }
        return null;
    }

    // Where the texels without a temperature (NaN) take their colour from, planned once per texture (where the values
    // are doesn't change with the style): each within `reach` texels of a patch from a nearest one of it, as
    // {targets, sources} (texel indices), so a patch sampled at its edge blends with its own colours, not black
    function fillPlan(values, w, h, reach) {
        var n = w * h, from = new Int32Array(n), empty = 0;
        for (var i = 0; i < n; i++) {
            from[i] = values[i] === values[i] ? i : -1;
            if (from[i] === -1) empty++;
        }
        // The texels a pass looks at, in order: at first every empty one, then the empty neighbours of those just
        // filled (no other can have gained a neighbour with a colour)
        var look = new Int32Array(empty), count = 0;
        for (var j = 0; j < n; j++) if (from[j] === -1) look[count++] = j;
        var targets = new Int32Array(empty), sources = new Int32Array(empty), done = 0;
        var seen = reach > 1 ? new Uint8Array(n) : null;
        for (var pass = 0; pass < reach && count; pass++) {
            var start = done;
            for (var k = 0; k < count; k++) {
                var at = look[k], x = at % w, y = (at - x) / w, src = -1;
                for (var d = 0; d < 8 && src === -1; d++) {
                    var xx = x + NEIGHBOURS[d][0], yy = y + NEIGHBOURS[d][1];
                    if (xx >= 0 && xx < w && yy >= 0 && yy < h && from[yy * w + xx] !== -1) src = from[yy * w + xx];
                }
                if (src !== -1) {
                    targets[done] = at;
                    sources[done++] = src;
                }
            }
            if (done === start) break;
            // Set after the pass, so a texel filled now is a source only for the next
            for (var f = start; f < done; f++) from[targets[f]] = sources[f];
            if (pass + 1 >= reach) break;
            count = 0;
            for (var g = start; g < done; g++) {
                var t = targets[g], tx = t % w, ty = (t - tx) / w;
                for (var e = 0; e < 8; e++) {
                    var nx = tx + NEIGHBOURS[e][0], ny = ty + NEIGHBOURS[e][1], q = ny * w + nx;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h && from[q] === -1 && !seen[q]) {
                        seen[q] = 1;
                        look[count++] = q;
                    }
                }
            }
            look.subarray(0, count).sort();
            for (var c = 0; c < count; c++) seen[look[c]] = 0;
        }
        return {targets: targets.slice(0, done), sources: sources.slice(0, done)};
    }
    var NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

    // An isotherm painted over the colours, as the 2D map lays one over the orthophoto: the texels whose temperatures
    // are within limits ([low, high], °C as the texture's, either null: open) in rgb (recolour.js)
    var paintIsotherm = Recolour.paintIsotherm;

    // The texels without a temperature coloured as planned (fillPlan), and in EMPTY_RGB beyond
    function fill(rgba, plan) {
        for (var k = 0; k < plan.targets.length; k++) {
            var o = plan.targets[k] * 4, q = plan.sources[k] * 4;
            rgba[o] = rgba[q];
            rgba[o + 1] = rgba[q + 1];
            rgba[o + 2] = rgba[q + 2];
            rgba[o + 3] = 255;
        }
        for (var e = 3; e < rgba.length; e += 4) {
            if (rgba[e]) continue;
            rgba[e - 3] = EMPTY_RGB[0];
            rgba[e - 2] = EMPTY_RGB[1];
            rgba[e - 1] = EMPTY_RGB[2];
            rgba[e] = 255;
        }
        return rgba;
    }

    // A material's texel at texture coordinates uv ({x, y}), as three.js samples it: rows from the top with flipY false
    // (a GLB's), from the bottom with it true (an OBJ's); 1 is the far edge's texel, beyond 0..1 repeated (a glTF
    // sampler's default). Its index in the texture's values
    function texelIndex(uv, w, h, flipY) {
        var within = function (t) { return t >= 0 && t <= 1 ? t : t - Math.floor(t); };
        var u = within(uv.x), v = within(uv.y);
        var col = Math.min(w - 1, Math.floor(u * w)), row = Math.min(h - 1, Math.floor((flipY ? 1 - v : v) * h));
        return row * w + col;
    }

    // The described material a mesh hit is of (its material marked with its index when matched), or -1
    function materialIndexOf(hit) {
        var m = hit && hit.object && hit.object.material;
        if (Array.isArray(m)) m = hit.face ? m[hit.face.materialIndex] : null;
        return m && typeof m.__dtMaterial === "number" ? m.__dtMaterial : -1;
    }

    // The model of a task on WebODM's 3D viewer as a source (see above). deps: {fetchFn, THREE, document, setInterval,
    // clearInterval, task: {id, project}}
    function source(viewer, deps) {
        var THREE = deps.THREE || root.THREE, doc = deps.document || root.document;
        var fetchFn = deps.fetchFn || root.fetch.bind(root), task = deps.task;
        var every = deps.setInterval || root.setInterval.bind(root), stop = deps.clearInterval || root.clearInterval.bind(root);
        var model = null, own = null, entries = [], style = null, timer = null, detached = false, description = null;
        var valuesLoaded = null;

        function readJson(r) { return r.json().then(function (data) { return {ok: r.ok, status: r.status, data: data}; }); }

        // Each material's values fetched, FETCHES at a time; each material on screen coloured as its values come
        function fetchValues() {
            var queue = entries.slice();
            function next() {
                var e = queue.shift();
                if (!e || detached) return Promise.resolve();
                return Recolour.fetchValues(modelUrl(task, "/" + e.index + "/values"), fetchFn).then(function (tile) {
                    if (detached || !tile) return;
                    e.tile = tile;
                    paint(e);
                }).then(next);
            }
            var runs = [];
            for (var k = 0; k < FETCHES; k++) runs.push(next());
            return Promise.all(runs);
        }

        // A model's materials (WebODM's, or the plugin's own copy) marked with their index, for reading hits
        function mark(materials) {
            materials.forEach(function (m, i) {
                m.__dtMaterial = i;
                if (entries[i].flipY === null && m.map) entries[i].flipY = !!m.map.flipY;
            });
        }

        // WebODM's model, coloured as its materials' values come
        function attach(found) {
            model = found;
            mark(found.materials);
            found.materials.forEach(function (m, i) {
                entries[i].material = m;
                entries[i].original = m.map;
                paint(entries[i]);
            });
        }

        // A material of WebODM's model coloured with the style, its texture made the first time (at the size WebODM's
        // GLB has it: a phone's may be reduced)
        function paint(e) {
            if (!style || !e.tile || !e.material) return;
            var w = e.tile.width, h = e.tile.height;
            if (!e.canvas) {
                e.canvas = doc.createElement("canvas");
                e.canvas.width = w;
                e.canvas.height = h;
            }
            var ctx = e.canvas.getContext("2d"), image = ctx.createImageData(w, h);
            Recolour.colour(e.tile, style, image.data);
            if (style.isothermPaint) paintIsotherm(e.tile.values, image.data, style.isothermPaint);
            if (!e.plan) e.plan = fillPlan(e.tile.values, w, h, DILATE);
            fill(image.data, e.plan);
            ctx.putImageData(image, 0, 0);
            var size = imageSize(e.original) || [w, h], drawn = e.canvas;
            if (size[0] !== w || size[1] !== h) {
                if (!e.small) {
                    e.small = doc.createElement("canvas");
                    e.small.width = size[0];
                    e.small.height = size[1];
                }
                e.small.getContext("2d").drawImage(e.canvas, 0, 0, size[0], size[1]);
                drawn = e.small;
            }
            if (!e.texture) {
                var t = new THREE.CanvasTexture(drawn), o = e.original;
                if (o) {
                    t.flipY = o.flipY;
                    t.wrapS = o.wrapS;
                    t.wrapT = o.wrapT;
                    t.magFilter = o.magFilter;
                    t.minFilter = o.minFilter;
                    if (o.encoding !== undefined) t.encoding = o.encoding;
                    t.anisotropy = o.anisotropy;
                }
                e.texture = t;
                e.material.map = t;
                e.material.needsUpdate = true;
                if (o && o.dispose) o.dispose();     // its GPU copy; uploaded again if detached
            } else {
                e.texture.needsUpdate = true;
            }
        }

        // The plugin's own copy of the model, for its shapes while WebODM shows the point cloud: its textures dropped
        function loadOwn() {
            if (own) return own;
            own = new Promise(function (resolve) {
                if (!THREE.GLTFLoader) return resolve(null);
                var loader = new THREE.GLTFLoader();
                if (THREE.DRACOLoader) {
                    var draco = new THREE.DRACOLoader();
                    draco.setDecoderPath(DRACO_PATH);
                    loader.setDRACOLoader(draco);
                }
                loader.load(glbUrl(task), function (gltf) {
                    var scene = gltf.scene, offset = scene.CESIUM_RTC && scene.CESIUM_RTC.center;
                    var materials = matchMaterials(scene, description);
                    if (!materials) return resolve(null);
                    mark(materials);
                    materials.forEach(function (m) { if (m.map && m.map.dispose) m.map.dispose(); m.map = null; });
                    // Where WebODM puts its own (ModelView.jsx: translated by the GLB's centre)
                    if (offset) { scene.translateX(offset[0]); scene.translateY(offset[1]); }
                    scene.updateMatrixWorld(true);
                    resolve(scene);
                }, undefined, function () { resolve(null); });
            });
            return own;
        }

        var ready = fetchFn(modelUrl(task), {credentials: "same-origin"}).then(readJson).then(function (r) {
            if (!r.ok || detached) return null;
            description = r.data;
            entries = description.materials.map(function (d, i) {
                return {index: i, tile: null, plan: null, canvas: null, small: null, texture: null, material: null, original: null, flipY: null};
            });
            valuesLoaded = fetchValues();
            timer = every(function () {
                var found = findModel(viewer.scene.scene, description);
                if (!found) return;
                stop(timer);
                timer = null;
                attach(found);
            }, WATCH_MS);
            return description;
        }, function () { return null; });

        return {
            kind: "model",
            ready: ready,
            description: function () { return description; },
            loaded: function () { return !!model; },
            shown: function () { return !!model && model.object.visible !== false; },
            // The meshes the index is built from: WebODM's model once it's there, else the plugin's own copy (a Promise)
            meshes: function () {
                var object = model ? Promise.resolve(model.object) : loadOwn();
                return object.then(function (o) {
                    var out = [];
                    if (o) o.traverse(function (m) { if (m.isMesh) out.push(m); });
                    return out;
                });
            },
            values: function () { return valuesLoaded || Promise.resolve(); },
            restyle: function (s) {
                style = s;
                entries.forEach(paint);
            },
            // The temperature (°C) of a material at texture coordinates, NaN where it holds none, undefined until its
            // values have come
            valueAt: function (index, uv) {
                var e = entries[index];
                if (!e || !e.tile) return undefined;
                return e.tile.values[texelIndex(uv, e.tile.width, e.tile.height, !!e.flipY)];
            },
            materialIndexOf: materialIndexOf,
            reading: function (hit) {
                var i = materialIndexOf(hit), e = entries[i];
                if (!e || !hit.uv) return {valid: false, temperature: null, reason: "outside"};
                if (!e.tile) return {valid: false, temperature: null, reason: "loading"};
                var value = e.tile.values[texelIndex(hit.uv, e.tile.width, e.tile.height, !!e.flipY)];
                return value === value ? {valid: true, temperature: value, reason: null}
                                       : {valid: false, temperature: null, reason: "nodata"};
            },
            detach: function () {
                detached = true;
                if (timer) stop(timer);
                entries.forEach(function (e) {
                    if (!e.texture) return;
                    e.material.map = e.original;
                    if (e.original) e.original.needsUpdate = true;
                    e.material.needsUpdate = true;
                    e.texture.dispose();
                });
                entries = [];
            }
        };
    }

    var api = {source: source, modelUrl: modelUrl, glbUrl: glbUrl, matchMaterials: matchMaterials, findModel: findModel,
               sameTexture: sameTexture, fillPlan: fillPlan, fill: fill, paintIsotherm: paintIsotherm, texelIndex: texelIndex,
               materialIndexOf: materialIndexOf, EMPTY_RGB: EMPTY_RGB};
    root.ThermalModel3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
