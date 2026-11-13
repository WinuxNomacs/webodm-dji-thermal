// The textured 3D model as a source of temperatures (model3d.js) and the 3D Thermal Inspector's core (inspector3d.js):
// a model WebODM added to its scene, with materials as ODX's GLB has them, coloured from the values the server sends
const Recolour = require("../recolour.js");
const Model3D = require("../model3d.js");
global.window.ThermalRecolour = Recolour;
const Inspector = require("../inspector.js");
const Inspector3D = require("../inspector3d.js");

const TASK = {id: "6bdb19cb-f134-495a-9e4a-9e8691ab72bd", project: 1};
const DESCRIPTION = {version: "v1", unit: "C", palette: "", baseline: null,
                     materials: [{name: "material0001", width: 4, height: 2}, {name: "material0000", width: 2, height: 2}],
                     range: {min: 0, max: 30, low: 5, high: 25}};
const NaN_ = NaN;
// Each material's temperatures, rows from the top (a GLB's), NaN where the texture holds none
const VALUES = [[10, 11, NaN_, NaN_, 14, 15, NaN_, NaN_], [20, 21, 22, 23]];

// three.js as far as the source uses it
const THREE = {CanvasTexture: function (canvas) { this.image = canvas; this.dispose = jest.fn(); }};

function texture(w, h, flipY) { return {image: {width: w, height: h}, flipY: !!flipY, wrapS: 1, wrapT: 2, magFilter: 3, minFilter: 4, dispose: jest.fn()}; }

// A model as GLTFLoader makes one of ODX's GLB: a group of meshes, a material each, unnamed, in the GLB's order
function model(sizes, names, flipY) {
    const meshes = sizes.map(([w, h], i) => ({isMesh: true, material: {name: names ? names[i] : "", map: texture(w, h, flipY)}}));
    return {visible: true, children: meshes, traverse(fn) { fn(this); meshes.forEach(fn); }, meshes};
}

function fakeCanvas() {
    const ctx = {createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData: jest.fn(), drawImage: jest.fn()};
    return {getContext: () => ctx, ctx};
}

function json(data, ok = true) { return Promise.resolve({ok, status: ok ? 200 : 404, json: () => Promise.resolve(data)}); }

const flush = () => new Promise((r) => setTimeout(r, 0));
// A palette as WebODM's tiler gives one: 256 levels, here of grey (0xRRGGBBAA)
const GREYS = Array.from({length: 256}, (_, i) => ((i << 24) | (i << 16) | (i << 8) | 255) >>> 0);

describe("matching the model's materials to the server's", () => {
    test("in order, as the GLB has them, each texture's size checked", () => {
        const m = model([[4, 2], [2, 2]]);
        expect(Model3D.matchMaterials(m, DESCRIPTION)).toEqual([m.meshes[0].material, m.meshes[1].material]);
        expect(Model3D.matchMaterials(model([[2, 2], [4, 2]]), DESCRIPTION)).toBeNull();
        expect(Model3D.matchMaterials(model([[4, 2]]), DESCRIPTION)).toBeNull();
    });

    test("by name when the model keeps them (an OBJ's)", () => {
        const m = model([[2, 2], [4, 2]], ["material0000", "material0001"]);
        expect(Model3D.matchMaterials(m, DESCRIPTION)).toEqual([m.meshes[1].material, m.meshes[0].material]);
    });

    test("the point cloud isn't taken for the model", () => {
        const cloud = Object.assign(model([[4, 2], [2, 2]]), {isPoints: true}), m = model([[4, 2], [2, 2]]);
        expect(Model3D.findModel({children: [cloud, m]}, DESCRIPTION).object).toBe(m);
        expect(Model3D.findModel({children: [cloud]}, DESCRIPTION)).toBeNull();
    });
});

describe("a phone's GLB", () => {
    test("may have its textures reduced by a power of two both ways, and is still the model's", () => {
        expect(Model3D.sameTexture([4096, 4096], 4096, 4096)).toBe(true);
        expect(Model3D.sameTexture([1024, 1024], 4096, 4096)).toBe(true);
        expect(Model3D.sameTexture([1024, 2048], 4096, 4096)).toBe(false);
        expect(Model3D.sameTexture([1365, 1365], 4096, 4096)).toBe(false);
        expect(Model3D.matchMaterials(model([[2, 1], [1, 1]]), DESCRIPTION)).not.toBeNull();
    });
});

describe("a texel at texture coordinates", () => {
    test("counts rows from the top for a GLB's texture and from the bottom for an OBJ's", () => {
        expect(Model3D.texelIndex({x: 0.6, y: 0.1}, 4, 2, false)).toBe(2);
        expect(Model3D.texelIndex({x: 0.6, y: 0.1}, 4, 2, true)).toBe(6);
        expect(Model3D.texelIndex({x: 1, y: 1}, 4, 2, false)).toBe(7);       // the far edge is the last texel
        expect(Model3D.texelIndex({x: 1.25, y: -0.75}, 4, 2, false)).toBe(1); // repeated, as three.js wraps
    });
});

describe("the space around a texture's patches", () => {
    test("takes a patch's colours as far as it reaches, and grey beyond", () => {
        // One row: a patch texel, then four without a temperature
        const values = Float32Array.from([5, NaN, NaN, NaN, NaN]);
        const plan = Model3D.fillPlan(values, 5, 1, 2);
        const rgba = new Uint8ClampedArray(5 * 4);
        rgba.set([200, 100, 50, 255], 0);
        Model3D.fill(rgba, plan);
        const px = (i) => Array.from(rgba.slice(i * 4, i * 4 + 4));
        expect(px(1)).toEqual([200, 100, 50, 255]);
        expect(px(2)).toEqual([200, 100, 50, 255]);
        expect(px(3)).toEqual(Model3D.EMPTY_RGB.concat(255));
    });
});

describe("the model as a source", () => {
    let scene, timers, fetchFn, canvases;

    beforeEach(() => {
        scene = {children: []};
        timers = [];
        canvases = [];
        fetchFn = jest.fn((url) => url.endsWith("/inspector/model") ? json(DESCRIPTION) : Promise.reject(new Error(url)));
        jest.spyOn(Recolour, "fetchValues").mockImplementation((url) => {
            const i = Number(/model\/(\d+)\/values/.exec(url)[1]), d = DESCRIPTION.materials[i];
            return Promise.resolve({values: Float32Array.from(VALUES[i]), flags: null, width: d.width, height: d.height, margin: 0, sigma: 1});
        });
    });
    afterEach(() => jest.restoreAllMocks());

    function make() {
        return Model3D.source({scene: {scene}}, {
            fetchFn, THREE, task: TASK,
            document: {createElement: () => { const c = fakeCanvas(); canvases.push(c); return c; }},
            setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; }
        });
    }
    const tick = () => timers.forEach((fn) => fn && fn());

    test("asks the server whether the model holds temperatures, and holds none when it says no", async () => {
        fetchFn = jest.fn(() => json({error: "This task has no textured 3D model"}, false));
        await expect(make().ready).resolves.toBeNull();
        expect(fetchFn.mock.calls[0][0]).toBe("/api/plugins/dji-thermal/projects/1/tasks/" + TASK.id + "/inspector/model");
        expect(timers).toHaveLength(0);
    });

    test("waits for WebODM to add the model, then colours each material from its temperatures", async () => {
        const source = make();
        await source.ready;
        source.restyle({colors: GREYS, range: [10, 23], shares: null, steps: null, sharpen: 0, isotherm: null});
        tick();
        expect(source.loaded()).toBe(false);
        const m = model([[4, 2], [2, 2]]);
        const originals = m.meshes.map((x) => x.material.map);
        scene.children.push(m);
        tick();
        await flush();
        await flush();
        expect(source.loaded()).toBe(true);
        expect(timers.every((t) => t === null)).toBe(true);
        expect(Recolour.fetchValues.mock.calls.map((c) => c[0])).toEqual(
            [0, 1].map((i) => "/api/plugins/dji-thermal/projects/1/tasks/" + TASK.id + "/inspector/model/" + i + "/values"));
        m.meshes.forEach((mesh, i) => {
            expect(mesh.material.map).toBeInstanceOf(THREE.CanvasTexture);
            expect(mesh.material.map.flipY).toBe(false);
            expect(mesh.material.map.magFilter).toBe(3);
            expect(mesh.material.needsUpdate).toBe(true);
            expect(originals[i].dispose).toHaveBeenCalled();
        });
        // The first material's hottest texel (15 °C, of 10..23) is a grey of its share; its empty texels take a
        // patch's colours, not black
        const drawn = canvases[0].ctx.putImageData.mock.calls[0][0].data;
        expect(drawn[5 * 4]).toBe(Math.round((15 - 10) / 13 * 255));
        expect(drawn[2 * 4 + 3]).toBe(255);
        expect(drawn[2 * 4]).toBe(drawn[1 * 4]);
        // Coloured again with another style: the same canvas, its texture marked for upload
        source.restyle({colors: [0xff0000ff, 0xff0000ff], range: [10, 23], shares: null, steps: null, sharpen: 0, isotherm: null});
        expect(canvases).toHaveLength(2);
        expect(m.meshes[0].material.map.needsUpdate).toBe(true);
    });

    test("reads the temperature of the texel a ray hit, and says where there is none", async () => {
        const source = make();
        await source.ready;
        const m = model([[4, 2], [2, 2]]);
        scene.children.push(m);
        tick();
        await flush();
        await flush();
        const hit = (mesh, x, y) => ({object: mesh, uv: {x, y}});
        expect(source.reading(hit(m.meshes[1], 0.75, 0.75))).toEqual({valid: true, temperature: 23, reason: null});
        expect(source.reading(hit(m.meshes[0], 0.6, 0.1))).toEqual({valid: false, temperature: null, reason: "nodata"});
        expect(source.reading(hit({material: {}}, 0.5, 0.5)).reason).toBe("outside");
    });

    test("fetches the values before WebODM shows the model (the point cloud reads them), and colours a reduced texture at its size", async () => {
        const source = make();
        await source.ready;
        await flush();
        expect(Recolour.fetchValues).toHaveBeenCalledTimes(2);
        expect(source.valueAt(1, {x: 0.75, y: 0.75})).toBe(23);
        source.restyle({colors: GREYS, range: [10, 23], shares: null, steps: null, sharpen: 0, isotherm: null});
        const m = model([[2, 1], [1, 1]]);       // a phone's: each texture half the size
        scene.children.push(m);
        tick();
        const small = canvases.filter((c) => c.ctx.drawImage && c.ctx.drawImage.mock.calls.length);
        expect(small).toHaveLength(2);
        expect(small[0].ctx.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 2, 1]);
        expect(m.meshes[0].material.map.image).toBe(small[0]);
    });

    test("reads a hit on the plugin's own copy of the model by its material's index", async () => {
        const source = make();
        await source.ready;
        await flush();
        const copy = {object: {material: {__dtMaterial: 1}}, uv: {x: 0.25, y: 0.25}};
        expect(source.reading(copy)).toEqual({valid: true, temperature: 20, reason: null});
        expect(source.reading({object: {material: {}}, uv: {x: 0, y: 0}}).reason).toBe("outside");
    });

    test("puts the model's own look back when detached", async () => {
        const source = make();
        await source.ready;
        source.restyle({colors: GREYS, range: [10, 23], shares: null, steps: null, sharpen: 0, isotherm: null});
        const m = model([[4, 2], [2, 2]]);
        const originals = m.meshes.map((x) => x.material.map);
        scene.children.push(m);
        tick();
        await flush();
        await flush();
        const swapped = m.meshes[0].material.map;
        source.detach();
        expect(m.meshes.map((x) => x.material.map)).toEqual(originals);
        expect(swapped.dispose).toHaveBeenCalled();
    });
});

describe("the 3D Inspector's palette", () => {
    const display = {palette: "ironred", palettes: ["ironred", "whitehot"], colormaps: ["magma", "viridis"]};

    test("is the user's, else the task's, else WebODM's for a thermal orthophoto", () => {
        expect(Inspector3D.openingPalette(display, {palette: "whitehot"})).toBe("ironred");
        expect(Inspector3D.openingPalette(Object.assign({}, display, {palette: ""}), {palette: "whitehot"})).toBe("whitehot");
        expect(Inspector3D.openingPalette(Object.assign({}, display, {palette: "gone"}), {palette: ""})).toBe("magma");
        // A public page has no preferences: the task's
        expect(Inspector3D.openingPalette(null, {palette: "whitehot"})).toBe("whitehot");
    });

    test("uses the 2D Inspector's palette list", () => {
        expect(Inspector.paletteOptions(display).map((o) => o[0])).toEqual(["ironred", "whitehot", "magma", "viridis"]);
    });
});
