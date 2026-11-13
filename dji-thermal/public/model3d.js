// The textured 3D model on WebODM's 3D page as a source of temperatures, for the 3D Thermal Inspector (inspector3d.js):
// a Thermal Task's model is textured by ODX from temperature TIFFs, and its GLB has them as grey; the server sends
// each material's temperatures (model3d_api.py, as value tiles: recolour.js decodes them), and this colours them in
// the palette, as the 2D map colours the orthophoto, and reads the temperature at a point of the model from them.
//
// A source answers the 3D Inspector's few questions; another (the point cloud: R26) answers the same ones:
//   ready        a Promise of whether the source holds temperatures (its description, or null)
//   shown()      whether it's on screen now (WebODM shows the model or the point cloud, one at a time)
//   restyle(s)   colour it again with a recolour.js style ({colors, range, shares, steps, ...}, °C), with an isotherm
//                painted over it (isothermPaint: {rgb, limits: [low, high], °C, either null}) or not
//   reading(hit) the temperature at a hit of it ({object, uv, point}, as three.js's raycaster gives): {valid,
//                temperature (°C), reason}
//   objects()    what to cast rays at (three.js objects)
//   detach()     its original look back, its listeners off
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var WATCH_MS = 400;             // how often the scene is looked at until WebODM has added the model
    var FETCHES = 3;                // material values fetched at once
    var DILATE = 2;                 // texels a material's colours reach into the empty space around its patches
    var EMPTY_RGB = [128, 128, 128];    // where a texture holds no temperature, beyond that
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);

    function modelUrl(task, what) {
        return API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/model" + (what || "");
    }

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
        var sizesMatch = out.every(function (m, i) {
            var s = imageSize(m.map);
            return s && s[0] === wanted[i].width && s[1] === wanted[i].height;
        });
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
        var from = new Int32Array(w * h), targets = [], sources = [];
        for (var i = 0; i < w * h; i++) from[i] = values[i] === values[i] ? i : -1;
        for (var pass = 0; pass < reach; pass++) {
            var found = [];
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var at = y * w + x;
                    if (from[at] !== -1) continue;
                    for (var d = 0, src = -1; d < 8 && src === -1; d++) {
                        var xx = x + NEIGHBOURS[d][0], yy = y + NEIGHBOURS[d][1];
                        if (xx >= 0 && xx < w && yy >= 0 && yy < h && from[yy * w + xx] !== -1) src = from[yy * w + xx];
                    }
                    if (src !== -1) found.push(at, src);
                }
            }
            if (!found.length) break;
            // Set after the pass, so a texel filled now is a source only for the next
            for (var k = 0; k < found.length; k += 2) {
                from[found[k]] = found[k + 1];
                targets.push(found[k]);
                sources.push(found[k + 1]);
            }
        }
        return {targets: Int32Array.from(targets), sources: Int32Array.from(sources)};
    }
    var NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

    // An isotherm painted over the colours, as the 2D map lays one over the orthophoto: the texels whose temperatures
    // are within limits ([low, high], °C as the texture's, either null: open) in rgb
    function paintIsotherm(values, rgba, isotherm) {
        var lo = isotherm.limits[0], hi = isotherm.limits[1], rgb = isotherm.rgb;
        for (var i = 0; i < values.length; i++) {
            var v = values[i];
            if (v !== v || (lo !== null && v < lo) || (hi !== null && v > hi)) continue;
            rgba[i * 4] = rgb[0];
            rgba[i * 4 + 1] = rgb[1];
            rgba[i * 4 + 2] = rgb[2];
        }
        return rgba;
    }

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

    // The model of a task on WebODM's 3D viewer as a source (see above). deps: {fetchFn, THREE, document, setInterval,
    // clearInterval, task: {id, project}}
    function source(viewer, deps) {
        var THREE = deps.THREE || root.THREE, doc = deps.document || root.document;
        var fetchFn = deps.fetchFn || root.fetch.bind(root), task = deps.task;
        var every = deps.setInterval || root.setInterval.bind(root), stop = deps.clearInterval || root.clearInterval.bind(root);
        var model = null, entries = [], style = null, timer = null, detached = false, description = null;

        function readJson(r) { return r.json().then(function (data) { return {ok: r.ok, status: r.status, data: data}; }); }

        // Each material's values fetched, FETCHES at a time, then coloured
        function load(found) {
            model = found;
            entries = found.materials.map(function (m, i) {
                return {material: m, original: m.map, index: i, tile: null, plan: null, canvas: null, texture: null};
            });
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

        // A material coloured with the style, its texture made the first time
        function paint(e) {
            if (!style || !e.tile) return;
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
            if (!e.texture) {
                var t = new THREE.CanvasTexture(e.canvas), o = e.original;
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

        var ready = fetchFn(modelUrl(task), {credentials: "same-origin"}).then(readJson).then(function (r) {
            if (!r.ok || detached) return null;
            description = r.data;
            timer = every(function () {
                var found = findModel(viewer.scene.scene, description);
                if (!found) return;
                stop(timer);
                timer = null;
                load(found);
            }, WATCH_MS);
            return description;
        }, function () { return null; });

        return {
            kind: "model",
            ready: ready,
            description: function () { return description; },
            loaded: function () { return !!model; },
            shown: function () { return !!model && model.object.visible !== false; },
            objects: function () { return model ? [model.object] : []; },
            restyle: function (s) {
                style = s;
                entries.forEach(paint);
            },
            reading: function (hit) {
                var e = null;
                for (var i = 0; hit && hit.object && i < entries.length && !e; i++) {
                    var m = hit.object.material;
                    if (m === entries[i].material || (Array.isArray(m) && hit.face && m[hit.face.materialIndex] === entries[i].material)) e = entries[i];
                }
                if (!e || !hit.uv) return {valid: false, temperature: null, reason: "outside"};
                if (!e.tile) return {valid: false, temperature: null, reason: "loading"};
                var flipY = e.original ? e.original.flipY : false;
                var value = e.tile.values[texelIndex(hit.uv, e.tile.width, e.tile.height, flipY)];
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

    var api = {source: source, modelUrl: modelUrl, matchMaterials: matchMaterials, findModel: findModel, fillPlan: fillPlan, fill: fill, paintIsotherm: paintIsotherm,
               texelIndex: texelIndex, EMPTY_RGB: EMPTY_RGB};
    root.ThermalModel3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
