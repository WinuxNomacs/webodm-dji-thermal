// The point cloud's points looked up on the model, off the page's thread (pointcloud3d.js starts it): given the 3D
// Thermal Inspector's index of the model (mesh_index.js, copied: {index}), each node's points ({node}: their positions
// and the node's matrix) come back with the model's material and texture coordinates at each point's nearest surface
// within LIMIT (material -1 beyond it), for the page to read their temperatures from the model's values.
/* global importScripts */
(function (self) {
    var NEAR = 0.03, LIMIT = 0.25;      // metres: most points lie within millimetres of the model, so a close search first
    var index = null;

    // The index as it was copied: its meshes only their texture coordinates and material
    function received(d) {
        var list = d.meshes.map(function (m) {
            var uv = m.uv;
            return {materialIndex: m.material, geometry: {groups: [], attributes: {uv: uv ? {getX: function (i) { return uv[i * 2]; },
                                                                                        getY: function (i) { return uv[i * 2 + 1]; }} : null}}};
        });
        var tris = {positions: d.positions, origin: d.origin, meshes: d.owner, faces: d.faces, list: list, count: d.owner.length};
        return {tris: tris, order: d.order, bounds: d.bounds, first: d.first, counts: d.counts, left: d.left, right: d.right, nodes: d.nodes};
    }

    // A node's points: their material (-1: no surface within LIMIT) and texture coordinates (2 each)
    function lookup(positions, m) {
        var MeshIndex = self.ThermalMeshIndex, n = positions.length / 3;
        var material = new Int16Array(n), uv = new Float32Array(n * 2), p = {x: 0, y: 0, z: 0};
        for (var i = 0; i < n; i++) {
            var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
            p.x = m[0] * x + m[4] * y + m[8] * z + m[12];
            p.y = m[1] * x + m[5] * y + m[9] * z + m[13];
            p.z = m[2] * x + m[6] * y + m[10] * z + m[14];
            var hit = MeshIndex.closest(index, p, NEAR) || MeshIndex.closest(index, p, LIMIT);
            if (!hit || !hit.uv) { material[i] = -1; continue; }
            material[i] = hit.object.materialIndex;
            uv[i * 2] = hit.uv.x;
            uv[i * 2 + 1] = hit.uv.y;
        }
        return {material: material, uv: uv};
    }

    self.onmessage = function (e) {
        var d = e.data;
        if (d.type === "index") {
            if (!self.ThermalMeshIndex) importScripts(d.script);
            index = received(d);
        } else if (d.type === "node" && index) {
            var found = lookup(d.positions, d.matrix);
            self.postMessage({type: "node", id: d.id, material: found.material, uv: found.uv}, [found.material.buffer, found.uv.buffer]);
        }
    };
    self.ThermalPointCloudWorker = {lookup: lookup, received: received, setIndex: function (d) { index = received(d); }, NEAR: NEAR, LIMIT: LIMIT};
})(self);
