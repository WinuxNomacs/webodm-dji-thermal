// The bounding-volume tree over a model's triangles (mesh_index.js): what it finds is what testing every triangle finds
const MeshIndex = require("../mesh_index.js");

// A buffer attribute as three.js's: getX/getY/getZ of an item
function attribute(array, size) {
    return {array, count: array.length / size, getX: (i) => array[i * size], getY: (i) => array[i * size + 1], getZ: (i) => array[i * size + 2]};
}

// A mesh as three.js's, of positions (and uvs), indexed or not, moved by a translation
function mesh(positions, opts = {}) {
    const attributes = {position: attribute(Float32Array.from(positions), 3)};
    if (opts.uvs) attributes.uv = attribute(Float32Array.from(opts.uvs), 2);
    const [tx, ty, tz] = opts.move || [0, 0, 0];
    return {geometry: {attributes, index: opts.index ? attribute(Uint32Array.from(opts.index), 1) : null, groups: []},
            matrixWorld: {elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]}, material: opts.material || {}};
}

// A seeded random number generator, so a failure can be run again
function random(seed) {
    let s = seed;
    return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function randomMesh(n, rnd) {
    const positions = [];
    for (let i = 0; i < n; i++) {
        const cx = rnd() * 100, cy = rnd() * 100, cz = rnd() * 20;
        for (let k = 0; k < 3; k++) positions.push(cx + rnd() * 4 - 2, cy + rnd() * 4 - 2, cz + rnd() * 4 - 2);
    }
    return mesh(positions);
}

// Every triangle tested: the nearest a ray meets, and the closest to a point (by sampling it finely)
function bruteRay(index, o, d) {
    let best = Infinity;
    for (let t = 0; t < index.tris.count; t++) {
        const single = MeshIndex.raycast({tris: index.tris, order: Uint32Array.of(t), bounds: Float32Array.of(-1e9, -1e9, -1e9, 1e9, 1e9, 1e9),
                                          first: Int32Array.of(0), counts: Int32Array.of(1)}, o, d);
        if (single && single.distance < best) best = single.distance;
    }
    return best;
}

describe("a ray cast at the model", () => {
    test("meets the same triangle, at the same distance, as testing every triangle", () => {
        const rnd = random(7), index = MeshIndex.build([randomMesh(2000, rnd)]);
        for (let i = 0; i < 60; i++) {
            const o = {x: rnd() * 100, y: rnd() * 100, z: 60}, d = {x: rnd() * 0.4 - 0.2, y: rnd() * 0.4 - 0.2, z: -1};
            const hit = MeshIndex.raycast(index, o, d), brute = bruteRay(index, o, d);
            if (brute === Infinity) expect(hit).toBeNull();
            else expect(hit.distance).toBeCloseTo(brute, 9);
        }
    });

    test("gives the hit's mesh, point and texture coordinates as three.js's raycaster does", () => {
        // One triangle, at height 5 once moved, its uvs (0,0), (1,0), (0,1) over its corners
        const m = mesh([0, 0, 0, 10, 0, 0, 0, 10, 0], {uvs: [0, 0, 1, 0, 0, 1], move: [100, 200, 5], material: {name: "m"}});
        const hit = MeshIndex.raycast(MeshIndex.build([m]), {x: 102, y: 203, z: 50}, {x: 0, y: 0, z: -1});
        expect(hit.object).toBe(m);
        expect(hit.distance).toBeCloseTo(45, 9);
        expect(hit.point).toEqual({x: 102, y: 203, z: 5});
        expect(hit.uv.x).toBeCloseTo(0.2, 9);
        expect(hit.uv.y).toBeCloseTo(0.3, 9);
    });

    test("keeps a model's map coordinates to the millimetre", () => {
        // A triangle 4.66 million metres north, as a UTM model's: 32-bit floats alone would keep it to half a metre
        const m = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], {move: [410976.123, 4661816.456, 180.789]});
        const hit = MeshIndex.raycast(MeshIndex.build([m]), {x: 410976.323, y: 4661816.756, z: 300}, {x: 0, y: 0, z: -1});
        expect(hit.point.x).toBeCloseTo(410976.323, 3);
        expect(hit.point.y).toBeCloseTo(4661816.756, 3);
        expect(hit.point.z).toBeCloseTo(180.789, 3);
    });

    test("reads an indexed mesh's vertices through its index, and passes by what isn't visible", () => {
        const a = mesh([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0], {index: [0, 1, 2, 1, 3, 2]});
        const b = mesh([0, 0, 0, 10, 0, 0, 0, 10, 0], {move: [0, 0, 3]});
        const index = MeshIndex.build([a, b]);
        expect(MeshIndex.raycast(index, {x: 8, y: 8, z: 9}, {x: 0, y: 0, z: -1}).object).toBe(a);   // only a's second triangle there
        expect(MeshIndex.raycast(index, {x: 1, y: 1, z: 9}, {x: 0, y: 0, z: -1}).object).toBe(b);
        expect(MeshIndex.raycast(index, {x: 1, y: 1, z: 9}, {x: 0, y: 0, z: -1}, (m) => m !== b).object).toBe(a);
        expect(MeshIndex.raycast(index, {x: 50, y: 50, z: 9}, {x: 0, y: 0, z: -1})).toBeNull();
    });
});

describe("the model's closest point", () => {
    test("is as close as testing every triangle finds", () => {
        const rnd = random(11), index = MeshIndex.build([randomMesh(800, rnd)]);
        for (let i = 0; i < 40; i++) {
            const q = {x: rnd() * 100, y: rnd() * 100, z: rnd() * 20};
            const hit = MeshIndex.closest(index, q, 1e6);
            let best = Infinity;
            for (let t = 0; t < index.tris.count; t++) {
                const one = MeshIndex.closest({tris: index.tris, order: Uint32Array.of(t), bounds: Float32Array.of(-1e9, -1e9, -1e9, 1e9, 1e9, 1e9),
                                               first: Int32Array.of(0), counts: Int32Array.of(1), left: Int32Array.of(0), right: Int32Array.of(0)}, q, 1e6);
                best = Math.min(best, one.distance);
            }
            expect(hit.distance).toBeCloseTo(best, 9);
        }
    });

    test("is none beyond the distance asked, and its texture coordinates are where it lies", () => {
        const m = mesh([0, 0, 0, 10, 0, 0, 0, 10, 0], {uvs: [0, 0, 1, 0, 0, 1]});
        const index = MeshIndex.build([m]);
        expect(MeshIndex.closest(index, {x: 2, y: 3, z: 0.5}, 0.4)).toBeNull();
        const hit = MeshIndex.closest(index, {x: 2, y: 3, z: 0.5}, 1);
        expect(hit.distance).toBeCloseTo(0.5, 9);
        expect(hit.uv.x).toBeCloseTo(0.2, 9);
        expect(hit.uv.y).toBeCloseTo(0.3, 9);
        // Beyond the triangle's corner: the corner itself
        expect(MeshIndex.closest(index, {x: -3, y: -4, z: 0}, 10).distance).toBeCloseTo(5, 9);
    });
});
