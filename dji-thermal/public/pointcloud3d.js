// The point cloud on WebODM's 3D page as a source of temperatures, for the 3D Thermal Inspector (inspector3d.js): ODX
// colours its points grey, each photo stretched over its own range, so their colours can't be read back as
// temperatures; each point takes instead the temperature of the textured model's nearest surface (model3d.js), within
// LIMIT (99.5 % of a model's points lie within 25 cm of it, most within millimetres: upcoming-changes.md, R26). Points
// farther keep ODX's grey and read "no temperature".
// The lookups run in a Web Worker (pointcloud3d_worker.js), node by node as Potree loads them; a point's material and
// texture coordinates are kept on its node's geometry, so restyling them is a lookup of their texels. A source as
// model3d.js describes, with start(index) once the model's index is built and tick() each frame.
(function (root) {
    var LIMIT = 0.25;                   // metres: as the worker's
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);
    var MeshIndex = root.ThermalMeshIndex || (typeof require !== "undefined" ? require("./mesh_index.js") : null);

    function clip01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

    // What the worker needs of the index, copied: its arrays, and each mesh's texture coordinates and material
    // (materialIndexOf: model3d's)
    function indexMessage(index, script, materialIndexOf) {
        var t = index.tris;
        return {type: "index", script: script, positions: t.positions, origin: t.origin, owner: t.meshes, faces: t.faces,
                order: index.order, bounds: index.bounds, first: index.first, counts: index.counts, left: index.left,
                right: index.right, nodes: index.nodes,
                meshes: t.list.map(function (m) {
                    var uv = m.geometry.attributes.uv;
                    return {uv: uv ? Float32Array.from(uv.array) : null, material: materialIndexOf({object: m})};
                })};
    }

    // A node's points coloured (rgba: its geometry's colour attribute's array, 4 each) from the model's values: each
    // point's temperature (value(material, uv), °C) in the palette (palette: recolour.tonedPalette's) over the range, the
    // isotherm painted over (style.isothermPaint), and ODX's own colour (original) where there is none
    function colourPoints(rgba, original, found, value, style, palette) {
        var n = found.material.length, low = style.range[0], span = (style.range[1] - style.range[0]) || 1;
        var steps = palette.length / 3, iso = style.isothermPaint;
        var lo = iso ? iso.limits[0] : null, hi = iso ? iso.limits[1] : null;
        for (var i = 0; i < n; i++) {
            var o = i * 4, m = found.material[i], v = m < 0 ? NaN : value(m, found.uv[i * 2], found.uv[i * 2 + 1]);
            if (v !== v || v === undefined) {
                rgba[o] = original[o];
                rgba[o + 1] = original[o + 1];
                rgba[o + 2] = original[o + 2];
                continue;
            }
            if (iso && (lo === null || v >= lo) && (hi === null || v <= hi)) {
                rgba[o] = iso.rgb[0];
                rgba[o + 1] = iso.rgb[1];
                rgba[o + 2] = iso.rgb[2];
                continue;
            }
            var s = Math.round(clip01((v - low) / span) * (steps - 1)) * 3;
            rgba[o] = palette[s];
            rgba[o + 1] = palette[s + 1];
            rgba[o + 2] = palette[s + 2];
        }
        return rgba;
    }

    // The point cloud of WebODM's viewer as a source, its temperatures the model's (a model3d source). deps: {Worker,
    // script (the worker's URL), indexScript (mesh_index.js's), Potree}
    function source(viewer, model, deps) {
        var WorkerType = deps.Worker || root.Worker, Potree = deps.Potree || root.Potree;
        var index = null, worker = null, style = null, palette = null, nodes = [], pending = {}, seq = 0, detached = false;

        function cloud() { var pcs = viewer.scene.pointclouds || []; return pcs[0] || null; }

        function value(m, u, v) { return model.valueAt(m, {x: u, y: v}); }

        // A node's points coloured with the style, once its lookups have come
        function paint(state) {
            if (!style || !palette || !state.found) return;
            var attr = state.geometry.attributes.rgba;
            if (!attr) return;
            colourPoints(attr.array, state.original, state.found, value, style, palette);
            attr.needsUpdate = true;
        }

        // The nodes Potree shows now that haven't been sent yet, sent to the worker
        function tick() {
            var pc = cloud();
            if (!pc || !worker || detached) return;
            (pc.visibleNodes || []).forEach(function (node) {
                var g = node.geometryNode && node.geometryNode.geometry;
                if (!g || g.__dtCloud || !g.attributes.position || !g.attributes.rgba) return;
                var id = ++seq, state = {id: id, geometry: g, original: Uint8Array.from(g.attributes.rgba.array), found: null};
                g.__dtCloud = state;
                pending[id] = state;
                nodes.push(state);
                node.sceneNode.updateMatrixWorld(true);
                worker.postMessage({type: "node", id: id, positions: Float32Array.from(g.attributes.position.array),
                                    matrix: Array.prototype.slice.call(node.sceneNode.matrixWorld.elements)});
            });
        }

        function onMessage(e) {
            var d = e.data, state = d && pending[d.id];
            if (!state || detached) return;
            delete pending[d.id];
            state.found = {material: d.material, uv: d.uv};
            paint(state);
        }

        return {
            kind: "cloud",
            ready: model.ready,
            loaded: function () { return !!index; },
            shown: function () { var pc = cloud(); return !!pc && pc.visible !== false; },
            // Started once the model's index is built (and its values have come, so the points can be coloured)
            start: function (built) {
                if (index || detached || !WorkerType) return;
                index = built;
                worker = new WorkerType(deps.script);
                worker.onmessage = onMessage;
                worker.postMessage(indexMessage(built, deps.indexScript, model.materialIndexOf));
                model.values().then(function () { nodes.forEach(paint); });
            },
            tick: tick,
            restyle: function (s) {
                style = s;
                palette = Recolour.tonedPalette(s.colors, s.shares, false, s.steps);
                nodes.forEach(paint);
            },
            // The temperature where the pointer is ({x, y} in the view's pixels): the point Potree picks there, read on
            // the model's nearest surface; {point, reading}
            spotAt: function (mouse, camera) {
                var pc = cloud();
                if (!index || !pc || !Potree || !Potree.Utils) return {point: null, reading: {valid: false, reason: "building"}};
                var picked = Potree.Utils.getMousePointCloudIntersection(mouse, camera, viewer, [pc], {pickClipped: false});
                if (!picked || !picked.location) return {point: null, reading: {valid: false, reason: "outside"}};
                var p = {x: picked.location.x, y: picked.location.y, z: picked.location.z};
                var hit = MeshIndex.closest(index, p, LIMIT);
                return {point: p, reading: hit ? model.reading(hit) : {valid: false, reason: "far"}};
            },
            reading: function (hit) { return model.reading(hit); },
            detach: function () {
                detached = true;
                if (worker) worker.terminate();
                nodes.forEach(function (state) {
                    var attr = state.geometry.attributes.rgba;
                    if (attr) { attr.array.set(state.original); attr.needsUpdate = true; }
                    delete state.geometry.__dtCloud;
                });
                nodes = [];
            }
        };
    }

    var api = {source: source, colourPoints: colourPoints, indexMessage: indexMessage, LIMIT: LIMIT};
    root.ThermalPointCloud3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
