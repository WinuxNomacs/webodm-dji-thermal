// The point cloud as a source of temperatures (pointcloud3d.js) and its worker (pointcloud3d_worker.js): each point the
// temperature of the model's nearest surface, within 25 cm, else ODX's own grey
const Recolour = require("../recolour.js");
global.window.ThermalRecolour = Recolour;
const MeshIndex = require("../mesh_index.js");
const PointCloud3D = require("../pointcloud3d.js");

// The worker's script in this page: its `self` the test's
global.self = global.window;
global.self.ThermalMeshIndex = MeshIndex;
require("../pointcloud3d_worker.js");
const Worker3D = global.self.ThermalPointCloudWorker;

function attribute(array, size) {
    return {array, count: array.length / size, getX: (i) => array[i * size], getY: (i) => array[i * size + 1], getZ: (i) => array[i * size + 2]};
}
// The model: one triangle on the ground (z = 0) from (0, 0) to (10, 0) and (0, 10), its uvs those corners over 10;
// its material described as the first
function model() {
    const mesh = {isMesh: true, material: {__dtMaterial: 0},
                  geometry: {attributes: {position: attribute(Float32Array.of(0, 0, 0, 10, 0, 0, 0, 10, 0), 3),
                                          uv: attribute(Float32Array.of(0, 0, 1, 0, 0, 1), 2)}, index: null, groups: []},
                  matrixWorld: {elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}};
    return {mesh, index: MeshIndex.build([mesh])};
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const GREYS = Array.from({length: 256}, (_, i) => ((i << 24) | (i << 16) | (i << 8) | 255) >>> 0);

describe("the worker", () => {
    test("gives each point the material and texture coordinates of the model's nearest surface within 25 cm", () => {
        const m = model();
        Worker3D.setIndex(PointCloud3D.indexMessage(m.index, "", (hit) => hit.object.material.__dtMaterial));
        // A point on the triangle, one 20 cm above it, one 40 cm above, one moved by its node's matrix
        const positions = Float32Array.of(2, 3, 0.001, 2, 3, 0.2, 2, 3, 0.4, 1, 1, 0);
        const found = Worker3D.lookup(positions, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        expect(Array.from(found.material)).toEqual([0, 0, -1, 0]);
        expect(found.uv[0]).toBeCloseTo(0.2, 6);
        expect(found.uv[1]).toBeCloseTo(0.3, 6);
        const moved = Worker3D.lookup(Float32Array.of(1, 1, 0), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 0, 1]);
        expect(moved.uv[0]).toBeCloseTo(0.3, 6);         // at (3, 4)
        expect(moved.uv[1]).toBeCloseTo(0.4, 6);
    });
});

describe("colouring the points", () => {
    test("in the palette over the range, the isotherm over it, and ODX's own colour where there's no temperature", () => {
        const found = {material: Int16Array.of(0, 0, -1, 0), uv: Float32Array.of(0, 0, 0.5, 0, 0, 0, 0.9, 0)};
        const value = (m, u) => (u > 0.85 ? NaN : 10 + u * 20);       // 10 °C at u = 0, 20 °C at 0.5; none at 0.9
        const original = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
        const rgba = Uint8Array.from(original), palette = Recolour.tonedPalette(GREYS, null, false, null);
        PointCloud3D.colourPoints(rgba, original, found, value, {range: [10, 30]}, palette);
        expect(Array.from(rgba.slice(0, 3))).toEqual([0, 0, 0]);
        expect(rgba[4]).toBe(palette[Math.round(0.5 * (palette.length / 3 - 1)) * 3]);
        expect(Array.from(rgba.slice(8, 12))).toEqual([7, 8, 9, 255]);
        expect(Array.from(rgba.slice(12, 16))).toEqual([10, 11, 12, 255]);
        PointCloud3D.colourPoints(rgba, original, found, value, {range: [10, 30], isothermPaint: {rgb: [229, 57, 53], limits: [15, null]}}, palette);
        expect(Array.from(rgba.slice(4, 7))).toEqual([229, 57, 53]);
        expect(rgba[0]).toBe(0);
    });
});

describe("where a node's points are", () => {
    test("the point cloud's matrix times the node's own, as Potree places it, not the node's parents' added again", () => {
        // A child node at (410977, 4661801, 221) in the cloud's coordinates, under a parent at (410961, 4661801, 205):
        // three.js's chain of parents would put it at their sum, hundreds of kilometres away
        const at = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
        const pointcloud = {matrixWorld: {elements: at(0, 0, 0)}};
        const sceneNode = {matrix: {elements: at(410977, 4661801, 221)}, updateMatrix: jest.fn(),
                           matrixWorld: {elements: at(821938, 9323602, 426)}};
        const m = PointCloud3D.nodeMatrix(pointcloud, sceneNode);
        expect(m.slice(12, 15)).toEqual([410977, 4661801, 221]);
        expect(sceneNode.updateMatrix).toHaveBeenCalled();
        expect(sceneNode.matrixWorld.elements.slice(12, 15)).toEqual([821938, 9323602, 426]);     // Potree's own, untouched
        // The cloud moved and turned a quarter about z: the node's corner goes with it
        pointcloud.matrixWorld.elements = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
        sceneNode.matrix.elements = at(1, 2, 3);
        expect(PointCloud3D.nodeMatrix(pointcloud, sceneNode).slice(12, 15)).toEqual([5 - 2, 6 + 1, 7 + 3]);
    });
});

describe("the point cloud as a source", () => {
    function setup() {
        const m = model();
        const rgba = Uint8Array.from([50, 50, 50, 255, 60, 60, 60, 255]);
        const geometry = {attributes: {position: {array: Float32Array.of(2, 3, 0, 2, 3, 5)}, rgba: {array: rgba, needsUpdate: false}}};
        const node = {geometryNode: {geometry}, sceneNode: {matrix: {elements: IDENTITY}, updateMatrix: jest.fn()}};
        const pointcloud = {visible: true, visibleNodes: [node], matrixWorld: {elements: IDENTITY}};
        const viewer = {scene: {pointclouds: [pointcloud]}};
        const fake = {ready: Promise.resolve({}), values: () => Promise.resolve(), materialIndexOf: (hit) => hit.object.material.__dtMaterial,
                      valueAt: (i, uv) => 10 + uv.x * 20, reading: (hit) => ({valid: true, temperature: 10 + hit.uv.x * 20})};
        const workers = [];
        function Worker(url) { this.url = url; this.posted = []; this.postMessage = (msg) => this.posted.push(msg); this.terminate = jest.fn(); workers.push(this); }
        const cloud = PointCloud3D.source(viewer, fake, {Worker, script: "w.js", indexScript: "i.js"});
        return {m, rgba, geometry, pointcloud, cloud, workers};
    }

    test("sends each node Potree shows to the worker once, and colours its points when the answer comes", async () => {
        const s = setup();
        s.cloud.start(s.m.index);
        s.cloud.tick();
        s.cloud.tick();
        const w = s.workers[0];
        expect(w.posted.map((msg) => msg.type)).toEqual(["index", "node"]);
        expect(Array.from(w.posted[1].positions)).toEqual([2, 3, 0, 2, 3, 5]);
        s.cloud.restyle({colors: GREYS, range: [10, 30], shares: null, steps: null});
        // The worker's answer: the first point on the model at u = 0.5 (20 °C), the second too far
        w.onmessage({data: {type: "node", id: w.posted[1].id, material: Int16Array.of(0, -1), uv: Float32Array.of(0.5, 0, 0, 0)}});
        expect(s.rgba[0]).toBeGreaterThan(100);
        expect(s.rgba[0]).toBeLessThan(160);
        expect(Array.from(s.rgba.slice(4))).toEqual([60, 60, 60, 255]);
        expect(s.geometry.attributes.rgba.needsUpdate).toBe(true);
        // Restyled: coloured again from what it found, with no request
        s.cloud.restyle({colors: GREYS.map(() => 0xff0000ff), range: [10, 30], shares: null, steps: null});
        expect(Array.from(s.rgba.slice(0, 3))).toEqual([255, 0, 0]);
        expect(w.posted).toHaveLength(2);
    });

    test("puts ODX's own colours back when detached", async () => {
        const s = setup();
        s.cloud.start(s.m.index);
        s.cloud.tick();
        s.cloud.restyle({colors: GREYS.map(() => 0xff0000ff), range: [10, 30], shares: null, steps: null});
        const w = s.workers[0];
        w.onmessage({data: {type: "node", id: w.posted[1].id, material: Int16Array.of(0, 0), uv: Float32Array.of(0.5, 0, 0.5, 0)}});
        expect(s.rgba[0]).toBe(255);
        s.cloud.detach();
        expect(Array.from(s.rgba)).toEqual([50, 50, 50, 255, 60, 60, 60, 255]);
        expect(w.terminate).toHaveBeenCalled();
    });
});
