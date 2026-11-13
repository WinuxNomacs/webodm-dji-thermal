// A bounding-volume tree over a 3D model's triangles, for the 3D Thermal Inspector: the first triangle a ray meets
// (the pointer's, a click's), and the closest point of the model to a point (the point cloud's points: R26), fast on
// a million triangles where three.js's raycaster tests each one. Built once from three.js meshes (their positions,
// indices and texture coordinates, in world coordinates as they are then); a hit is what three.js's raycaster gives
// ({object, point, distance, face: {a, b, c, materialIndex}, uv}), so a source reads it the same way.
(function (root) {
    var LEAF = 8;                   // triangles in a leaf, at most
    var EPS = 1e-9;
    var SLACK = 1e-3;               // metres each node's box is widened by: its bounds are 32-bit floats

    // The triangles of meshes, in world coordinates less origin (the first vertex's: a model's coordinates are a map
    // projection's, millions of metres, which 32-bit floats keep only to the metre; from its own origin, to the
    // millimetre): {positions (9 per triangle), origin, meshes (each triangle's mesh's index), faces (its vertices'
    // indices in its mesh: 3 per triangle), list (the meshes)}
    function triangles(meshes) {
        var count = 0;
        meshes.forEach(function (m) {
            var g = m.geometry;
            count += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        var positions = new Float32Array(count * 9), owner = new Uint32Array(count), faces = new Uint32Array(count * 3);
        var t = 0, origin = null;
        meshes.forEach(function (m, mi) {
            if (m.updateMatrixWorld) m.updateMatrixWorld(true);
            var e = m.matrixWorld ? m.matrixWorld.elements : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
            var g = m.geometry, pos = g.attributes.position, idx = g.index;
            var n = (idx ? idx.count : pos.count) / 3;
            for (var f = 0; f < n; f++, t++) {
                owner[t] = mi;
                for (var k = 0; k < 3; k++) {
                    var v = idx ? idx.getX(f * 3 + k) : f * 3 + k;
                    faces[t * 3 + k] = v;
                    var x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v), o = t * 9 + k * 3;
                    var wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13],
                        wz = e[2] * x + e[6] * y + e[10] * z + e[14];
                    if (!origin) origin = [wx, wy, wz];
                    positions[o] = wx - origin[0];
                    positions[o + 1] = wy - origin[1];
                    positions[o + 2] = wz - origin[2];
                }
            }
        });
        return {positions: positions, origin: origin || [0, 0, 0], meshes: owner, faces: faces, list: meshes, count: count};
    }

    // The tree: nodes in flat arrays (bounds: 6 per node; a leaf's first triangle in order and its count, or an inner
    // node's children), built by splitting each node's triangles at the median of their centres along its longest side
    function build(meshes) {
        var tris = triangles(meshes), n = tris.count, p = tris.positions;
        var order = new Uint32Array(n), centres = new Float64Array(n * 3);
        for (var i = 0; i < n; i++) {
            order[i] = i;
            for (var a = 0; a < 3; a++) centres[i * 3 + a] = (p[i * 9 + a] + p[i * 9 + 3 + a] + p[i * 9 + 6 + a]) / 3;
        }
        var maxNodes = Math.max(1, 2 * Math.ceil(n / LEAF) * 2);
        var bounds = new Float32Array(maxNodes * 6), first = new Int32Array(maxNodes), counts = new Int32Array(maxNodes);
        var left = new Int32Array(maxNodes), right = new Int32Array(maxNodes), used = 0;

        function nodeBounds(node, start, end) {
            var b = node * 6;
            bounds[b] = bounds[b + 1] = bounds[b + 2] = Infinity;
            bounds[b + 3] = bounds[b + 4] = bounds[b + 5] = -Infinity;
            for (var j = start; j < end; j++) {
                var o = order[j] * 9;
                for (var k = 0; k < 9; k += 3) {
                    for (var ax = 0; ax < 3; ax++) {
                        var v = p[o + k + ax];
                        if (v < bounds[b + ax]) bounds[b + ax] = v;
                        if (v > bounds[b + 3 + ax]) bounds[b + 3 + ax] = v;
                    }
                }
            }
        }

        // order[start..end) partly sorted so the k-th smallest centre along axis is at k (quickselect)
        function select(start, end, k, axis) {
            var lo = start, hi = end - 1;
            while (hi > lo) {
                var pivot = centres[order[(lo + hi) >> 1] * 3 + axis], l = lo, r = hi;
                while (l <= r) {
                    while (centres[order[l] * 3 + axis] < pivot) l++;
                    while (centres[order[r] * 3 + axis] > pivot) r--;
                    if (l <= r) { var tmp = order[l]; order[l] = order[r]; order[r] = tmp; l++; r--; }
                }
                if (k <= r) hi = r;
                else if (k >= l) lo = l;
                else break;
            }
        }

        var stack = [[used++, 0, n]];
        while (stack.length) {
            var item = stack.pop(), node = item[0], start = item[1], end = item[2];
            nodeBounds(node, start, end);
            for (var g = 0; g < 3; g++) { bounds[node * 6 + g] -= SLACK; bounds[node * 6 + 3 + g] += SLACK; }
            if (end - start <= LEAF) {
                first[node] = start;
                counts[node] = end - start;
                continue;
            }
            var b = node * 6, axis = 0, size = -1;
            for (var ax = 0; ax < 3; ax++) {
                if (bounds[b + 3 + ax] - bounds[b + ax] > size) { size = bounds[b + 3 + ax] - bounds[b + ax]; axis = ax; }
            }
            var mid = (start + end) >> 1;
            select(start, end, mid, axis);
            counts[node] = -1;
            left[node] = used++;
            right[node] = used++;
            stack.push([left[node], start, mid], [right[node], mid, end]);
        }
        return {tris: tris, order: order, bounds: bounds, first: first, counts: counts, left: left, right: right, nodes: used};
    }

    // Where a ray (origin, direction: [x, y, z]) enters a node's box, or Infinity when it misses it before far
    function boxEntry(bounds, node, o, inv, far) {
        var b = node * 6, tmin = 0, tmax = far;
        for (var ax = 0; ax < 3; ax++) {
            var t1 = (bounds[b + ax] - o[ax]) * inv[ax], t2 = (bounds[b + 3 + ax] - o[ax]) * inv[ax];
            if (t1 > t2) { var s = t1; t1 = t2; t2 = s; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) return Infinity;
        }
        return tmin;
    }

    // Möller–Trumbore: the ray's distance to a triangle and the barycentric (u, v) of where it meets it, or null; both
    // faces count (a model seen from inside, a roof's underside)
    function intersect(p, t, o, d) {
        var i = t * 9;
        var e1x = p[i + 3] - p[i], e1y = p[i + 4] - p[i + 1], e1z = p[i + 5] - p[i + 2];
        var e2x = p[i + 6] - p[i], e2y = p[i + 7] - p[i + 1], e2z = p[i + 8] - p[i + 2];
        var hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
        var det = e1x * hx + e1y * hy + e1z * hz;
        if (det > -EPS && det < EPS) return null;
        var f = 1 / det, sx = o[0] - p[i], sy = o[1] - p[i + 1], sz = o[2] - p[i + 2];
        var u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) return null;
        var qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        var v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
        if (v < 0 || u + v > 1) return null;
        var dist = f * (e2x * qx + e2y * qy + e2z * qz);
        return dist > EPS ? {distance: dist, u: u, v: v} : null;
    }

    // A triangle's hit as three.js's raycaster gives it: {object, point, distance, face, uv}
    function hitOf(index, t, u, v, distance, point) {
        var tris = index.tris, mesh = tris.list[tris.meshes[t]], a = tris.faces[t * 3], b = tris.faces[t * 3 + 1], c = tris.faces[t * 3 + 2];
        var g = mesh.geometry, uvs = g.attributes.uv, w = 1 - u - v, uv = null;
        if (uvs) uv = {x: w * uvs.getX(a) + u * uvs.getX(b) + v * uvs.getX(c), y: w * uvs.getY(a) + u * uvs.getY(b) + v * uvs.getY(c)};
        var materialIndex = 0;
        (g.groups || []).forEach(function (gr) { if (t * 3 >= gr.start && t * 3 < gr.start + gr.count) materialIndex = gr.materialIndex; });
        return {object: mesh, point: {x: point[0], y: point[1], z: point[2]}, distance: distance,
                face: {a: a, b: b, c: c, materialIndex: materialIndex}, uv: uv, triangle: t};
    }

    // The first triangle a ray meets (origin and direction: {x, y, z}; direction need not be of unit length: distance is
    // then in its lengths), or null; only meshes visible(mesh) says are (all, without it)
    function raycast(index, origin, direction, visible) {
        var at = index.tris.origin, o = [origin.x - at[0], origin.y - at[1], origin.z - at[2]], d = [direction.x, direction.y, direction.z];
        var inv = [1 / d[0], 1 / d[1], 1 / d[2]], p = index.tris.positions, best = null, far = Infinity;
        var stack = [0];
        while (stack.length) {
            var node = stack.pop();
            if (boxEntry(index.bounds, node, o, inv, far) === Infinity) continue;
            if (index.counts[node] >= 0) {
                for (var j = index.first[node], end = j + index.counts[node]; j < end; j++) {
                    var t = index.order[j];
                    if (visible && !visible(index.tris.list[index.tris.meshes[t]])) continue;
                    var h = intersect(p, t, o, d);
                    if (h && h.distance < far) { far = h.distance; best = {t: t, u: h.u, v: h.v}; }
                }
                continue;
            }
            // The nearer child last, so it's looked at first
            var l = index.left[node], r = index.right[node];
            var tl = boxEntry(index.bounds, l, o, inv, far), tr = boxEntry(index.bounds, r, o, inv, far);
            if (tl < tr) { if (tr !== Infinity) stack.push(r); stack.push(l); }
            else { if (tl !== Infinity) stack.push(l); if (tr !== Infinity) stack.push(r); }
        }
        if (!best) return null;
        return hitOf(index, best.t, best.u, best.v, far, [o[0] + d[0] * far + at[0], o[1] + d[1] * far + at[1], o[2] + d[2] * far + at[2]]);
    }

    // The closest point of a triangle to a point (Ericson, Real-Time Collision Detection 5.1.5): [x, y, z, u, v]
    function closestOnTriangle(p, t, q) {
        var i = t * 9;
        var ax = p[i], ay = p[i + 1], az = p[i + 2], bx = p[i + 3], by = p[i + 4], bz = p[i + 5], cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
        var abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
        var apx = q[0] - ax, apy = q[1] - ay, apz = q[2] - az;
        var d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
        if (d1 <= 0 && d2 <= 0) return [ax, ay, az, 0, 0];
        var bpx = q[0] - bx, bpy = q[1] - by, bpz = q[2] - bz;
        var d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) return [bx, by, bz, 1, 0];
        var vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { var s = d1 / (d1 - d3); return [ax + s * abx, ay + s * aby, az + s * abz, s, 0]; }
        var cpx = q[0] - cx, cpy = q[1] - cy, cpz = q[2] - cz;
        var d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) return [cx, cy, cz, 0, 1];
        var vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) { var w = d2 / (d2 - d6); return [ax + w * acx, ay + w * acy, az + w * acz, 0, w]; }
        var va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            var x = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            return [bx + x * (cx - bx), by + x * (cy - by), bz + x * (cz - bz), 1 - x, x];
        }
        var denom = 1 / (va + vb + vc), v2 = vb * denom, w2 = vc * denom;
        return [ax + abx * v2 + acx * w2, ay + aby * v2 + acy * w2, az + abz * v2 + acz * w2, v2, w2];
    }

    // The model's closest point to a point ({x, y, z}) within maxDistance, as a hit (its distance the point's to it), or
    // null
    function closest(index, point, maxDistance) {
        var at = index.tris.origin, q = [point.x - at[0], point.y - at[1], point.z - at[2]], p = index.tris.positions, best = null, bestD2 = maxDistance * maxDistance;
        var stack = [0];
        while (stack.length) {
            var node = stack.pop(), b = node * 6, d2 = 0;
            for (var ax = 0; ax < 3; ax++) {
                var v = q[ax] < index.bounds[b + ax] ? index.bounds[b + ax] - q[ax] : q[ax] > index.bounds[b + 3 + ax] ? q[ax] - index.bounds[b + 3 + ax] : 0;
                d2 += v * v;
            }
            if (d2 > bestD2) continue;
            if (index.counts[node] >= 0) {
                for (var j = index.first[node], end = j + index.counts[node]; j < end; j++) {
                    var t = index.order[j], c = closestOnTriangle(p, t, q);
                    var dx = c[0] - q[0], dy = c[1] - q[1], dz = c[2] - q[2], e = dx * dx + dy * dy + dz * dz;
                    if (e <= bestD2) { bestD2 = e; best = {t: t, c: c}; }
                }
                continue;
            }
            stack.push(index.left[node], index.right[node]);
        }
        return best ? hitOf(index, best.t, best.c[3], best.c[4], Math.sqrt(bestD2), [best.c[0] + at[0], best.c[1] + at[1], best.c[2] + at[2]]) : null;
    }

    var api = {build: build, raycast: raycast, closest: closest, triangles: triangles, LEAF: LEAF};
    root.ThermalMeshIndex = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
