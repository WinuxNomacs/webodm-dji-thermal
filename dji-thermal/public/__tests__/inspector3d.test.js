// The 3D Thermal Inspector's panel and tools (inspector3d.js) on a 3D page made for the test: WebODM's Potree viewer,
// three.js's camera and raycaster as far as it uses them, the model as a source whose temperature at a point is its x
const Recolour = require("../recolour.js");
global.window.ThermalRecolour = Recolour;
global.window.ThermalScale = require("../scale.js");
global.window.ThermalRegions = require("../regions.js");
const Inspector = require("../inspector.js");
const Model3D = require("../model3d.js");
const MeshIndex = require("../mesh_index.js");
const Inspector3D = require("../inspector3d.js");

const TASK = {id: "6bdb19cb-f134-495a-9e4a-9e8691ab72bd", project: 1, epsg: 32616};
const DESCRIPTION = {version: "v1", unit: "C", palette: "whitehot", baseline: {emissivity: 0.95, reflected: 20},
                     materials: [{name: "material0000", width: 2, height: 2}], range: {min: 0, max: 40, low: 5.04, high: 24.96}};
const DISPLAY = {palette: "ironred", palettes: ["ironred", "whitehot"], colormaps: ["magma"], legend: true, pointer_temperature: true};
const COLORS = Array.from({length: 256}, (_, i) => ((i << 24) | (i << 16) | (i << 8) | 255) >>> 0);

// three.js as far as the Inspector uses it: a point projects to the screen as its x, y over 100 (z between -1 and 1),
// and a ray from the screen goes straight down from 100 times the pointer's place
const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; },
    Vector3: function (x, y, z) {
        this.x = x; this.y = y; this.z = z;
        this.project = () => ({x: this.x / 100, y: this.y / 100, z: 0.5});
    },
    Raycaster: function () {
        this.setFromCamera = (ndc) => { this.ray = {origin: {x: ndc.x * 100, y: ndc.y * 100, z: 100}, direction: {x: 0, y: 0, z: -1}}; };
    }
};

function json(data, ok = true) { return Promise.resolve({ok, status: ok ? 200 : 404, json: () => Promise.resolve(data)}); }
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function memoryStorage() {
    const items = {};
    return {getItem: (k) => (k in items ? items[k] : null), setItem: (k, v) => { items[k] = String(v); }, removeItem: (k) => { delete items[k]; }, items};
}

// The page, the viewer and the model as a source; the timers run when told
async function page(opts = {}) {
    document.body.innerHTML = '<div data-modelview data-task=\'' + JSON.stringify(TASK) + '\'></div><div id="area"></div>';
    const area = document.getElementById("area"), canvas = document.createElement("canvas");
    area.appendChild(canvas);
    // The 3D view: 200 by 200 px from the page's corner, so the pointer at (150, 50) is ndc (0.5, 0.5)
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 200, height: 200});
    area.getBoundingClientRect = () => ({left: 0, top: 0, width: 200, height: 200});
    Object.defineProperty(area, "clientWidth", {value: 200});
    Object.defineProperty(area, "clientHeight", {value: 200});
    // The point cloud, shown when the model isn't
    const pointcloud = {visible: opts.shown === false, visibleNodes: []};
    const viewer = {renderArea: area, renderer: {domElement: canvas}, scene: {getActiveCamera: () => ({}), view: {lookAt: jest.fn()}, pointclouds: [pointcloud]}};
    const source = {ready: Promise.resolve(opts.description || DESCRIPTION), loaded: () => true, shown: jest.fn(() => opts.shown !== false),
                    meshes: () => Promise.resolve([{isMesh: true}]), values: () => Promise.resolve(), materialIndexOf: () => 0,
                    restyle: jest.fn(), detach: jest.fn(),
                    reading: (hit) => (hit.point.x >= 0 ? {valid: true, temperature: hit.point.x, reason: null} : {valid: false, temperature: null, reason: "nodata"})};
    jest.spyOn(Model3D, "source").mockReturnValue(source);
    const index = {tris: {origin: [0, 0, 0], list: []}, bounds: Float32Array.of(-1e3, -1e3, 0, 1e3, 1e3, 30)};
    // The model's nearest surface to a point picked on the point cloud: right under it, within 25 cm where y < 80
    jest.spyOn(MeshIndex, "closest").mockImplementation((idx, p) => (p.y < 80 ? {point: {x: p.x, y: p.y, z: 0}} : null));
    // Potree picks the cloud's point under the pointer: at the pointer's place in the view, as the model's rays
    jest.spyOn(MeshIndex, "build").mockReturnValue(index);
    // The model is the plane z = 0 where x and y are within 90; a saved pin far away isn't on it
    jest.spyOn(MeshIndex, "raycast").mockImplementation((idx, o) => (Math.abs(o.x) <= 90 && Math.abs(o.y) <= 90 ? {point: {x: o.x, y: o.y, z: 0}} : null));
    const timers = [];
    const saved = jest.fn();
    const fetchFn = jest.fn((url) => {
        if (url.endsWith("/display")) return json(DISPLAY);
        if (url.indexOf("/inspector/palette?name=") !== -1) return json({color_map: COLORS});
        if (url.endsWith("/inspector/model/saved")) return json({pins: opts.saved || []});
        return json({}, false);
    });
    const storage = opts.storage || memoryStorage(), downloads = [];
    const Potree = {Utils: {getMousePointCloudIntersection: (mouse) => {
        const x = (mouse.x / 200 * 2 - 1) * 100, y = (1 - mouse.y / 200 * 2) * 100;
        return Math.abs(x) <= 90 && Math.abs(y) <= 90 ? {location: {x, y, z: 0.1}} : null;
    }}};
    const workers = [];
    function Worker(url) { this.url = url; this.posted = []; this.postMessage = (m) => this.posted.push(m); this.terminate = jest.fn(); workers.push(this); }
    const inspector = await Inspector3D.create(viewer, {
        fetchFn, storage, THREE, Potree, Worker, scriptUrl: (name) => "/plugins/dji-thermal/" + name,
        path: opts.path || "/3d/project/1/task/x/", save: saved,
        setTimeout: (fn) => { timers.push(fn); return timers.length; }, requestAnimationFrame: () => 0,
        download: (name, text) => downloads.push({name, text})
    });
    const run = () => { while (timers.length) timers.shift()(); };
    const panel = () => area.querySelector(".dt-inspector3d-panel");
    const pointer = (type, x, y) => canvas.dispatchEvent(Object.assign(new Event(type), {clientX: x, clientY: y, button: 0}));
    const click = (x, y) => { pointer("pointerdown", x, y); pointer("pointerup", x, y); };
    const act = (name) => panel().querySelector('[data-act="' + name + '"]');
    const change = (name, value) => {
        const el = act(name);
        if (el.type === "checkbox") el.checked = value; else el.value = value;
        el.dispatchEvent(new Event("change", {bubbles: true}));
    };
    return {inspector, viewer, area, source, fetchFn, storage, saved, downloads, run, panel, pointer, click, act, change, workers};
}

beforeEach(() => { window.localStorage.setItem("unit_system", "metric"); });
afterEach(() => jest.restoreAllMocks());

describe("opening", () => {
    test("colours the model in the user's palette over Auto's range, rounded outwards to a tenth", async () => {
        const p = await page();
        expect(p.inspector.state.palette).toBe("ironred");
        expect(p.source.restyle).toHaveBeenLastCalledWith(expect.objectContaining({colors: COLORS, range: [5, 25], isothermPaint: null}));
    });

    test("isn't there without the page's task, nor when the model doesn't hold temperatures", async () => {
        document.body.innerHTML = "<div></div>";
        await expect(Inspector3D.create({}, {fetchFn: jest.fn()})).resolves.toBeNull();
        document.body.innerHTML = '<div data-modelview data-task=\'' + JSON.stringify(TASK) + '\'></div>';
        jest.spyOn(Model3D, "source").mockReturnValue({ready: Promise.resolve(null)});
        await expect(Inspector3D.create({}, {fetchFn: jest.fn()})).resolves.toBeNull();
    });

    test("has the 2D Inspector's tools that make sense in 3D, and its colour sections", async () => {
        const p = await page();
        p.inspector.toggle();
        expect(p.panel().hidden).toBe(false);
        expect(Array.from(p.panel().querySelectorAll("[data-mode]")).map((b) => b.getAttribute("data-mode"))).toEqual(["hover", "delta", "pin"]);
        ["palette", "range-min", "range-max", "correction-on", "image-gamma", "isotherm-mode"].forEach((name) => expect(p.act(name)).not.toBeNull());
        expect(p.panel().textContent).not.toMatch(/Overlays/);
        p.act("close").click();
        expect(p.panel().hidden).toBe(true);
    });
});

describe("reading the model", () => {
    test("hovering says the temperature under the pointer in the panel and beside it", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.pointer("pointermove", 150, 50);         // ndc (0.5, 0.5): the point (50, 50) on the model, 50 °C
        p.run();
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe("50.00 °C");
        const label = p.area.querySelector(".dt-inspector-cursor");
        expect(label.style.display).toBe("");
        expect(label.textContent).toBe("50.00 °C");
        p.pointer("pointermove", 195, 100);        // beyond the model
        p.run();
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe("Not on the model");
    });

    test("a tap (or a click) in Hover reads where it is, as a phone has no hover", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.click(130, 100);                                      // (30, 0): 30 °C
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe("30.00 °C");
        expect(p.inspector.state.measurements).toHaveLength(0);
    });

    test("with the point cloud shown, reads the picked point on the model's nearest surface, and says when it has none", async () => {
        const p = await page({shown: false});
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        await flush();
        p.pointer("pointermove", 150, 50);         // the cloud's point (50, 50): the model under it, 50 °C
        p.run();
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe("50.00 °C");
        p.pointer("pointermove", 150, 5);          // (50, 95): beyond the model's reach
        p.run();
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe("Not on the model");
        p.pointer("pointermove", 110, 15);         // (10, 85): a point with no surface within 25 cm
        p.run();
        expect(p.panel().querySelector(".dt-inspector-readout").textContent).toBe(Inspector3D.REASONS.far);
    });

    test("starts the point cloud's lookups in a worker once the model is indexed, with the index and the scripts", async () => {
        const p = await page();
        p.run();
        await flush();
        expect(p.workers).toHaveLength(1);
        expect(p.workers[0].url).toBe("/plugins/dji-thermal/pointcloud3d_worker.js");
        expect(p.workers[0].posted[0]).toEqual(expect.objectContaining({type: "index", script: "/plugins/dji-thermal/mesh_index.js"}));
    });
});

describe("pins and ΔTs", () => {
    test("Pin keeps a clicked point and its temperature, numbered, in the browser for the task", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.inspector.setMode("pin");
        p.click(150, 50);
        p.click(120, 80);
        const list = p.inspector.state.measurements;
        expect(list.map((m) => m.label)).toEqual(["P1", "P2"]);
        expect(list[0].temperature).toBeCloseTo(50, 9);
        expect(list[1].temperature).toBeCloseTo(20, 9);
        expect(list[0].point).toEqual({x: 50, y: 50, z: 0});
        expect(JSON.parse(p.storage.items["dji-thermal-inspector3d:measurements:" + TASK.id])).toHaveLength(2);
        expect(p.area.querySelectorAll(".dt-inspector3d-marker.dt-pin")).toHaveLength(2);
    });

    test("a drag of the view isn't a click", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.inspector.setMode("pin");
        p.pointer("pointerdown", 150, 50);
        p.pointer("pointerup", 170, 50);
        expect(p.inspector.state.measurements).toHaveLength(0);
    });

    test("ΔT is the second spot's temperature less the first's, with their distance in 3D; Esc cancels the first", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.inspector.setMode("delta");
        p.click(150, 50);                                       // (50, 50): 50 °C
        document.dispatchEvent(Object.assign(new Event("keydown"), {key: "Escape"}));
        expect(p.inspector.state.pending).toBeNull();
        p.click(110, 100);                                      // (10, 0): 10 °C
        p.click(140, 60);                                       // (40, 40): 40 °C
        const d = p.inspector.state.measurements[0];
        expect(d.label).toBe("D1");
        expect(Inspector3D.deltaOf(d, (r) => r.temperature)).toBeCloseTo(30, 9);
        expect(d.length).toBeCloseTo(Math.hypot(30, 40), 9);
        expect(p.panel().querySelector(".dt-inspector-delta-figures").textContent).toMatch(/\+30\.00 °C/);
    });

    test("Manual Corrections change the temperatures shown, and the scale keeps the temperatures it shows", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.inspector.setMode("pin");
        p.click(130, 100);                                      // (30, 0): 30 °C measured with 0.95 and 20 °C
        p.change("correction-on", true);
        p.change("correction-emissivity", "0.8");
        const fix = {wanted: {emissivity: 0.8, reflected: 20}, baseline: {emissivity: 0.95, reflected: 20}};
        expect(p.panel().querySelector(".dt-inspector-pins").textContent).toMatch(Inspector.formatTemp(Inspector.corrected(30, fix), "C"));
        // The range is of the textures' own values, so it shows 5 to 25 °C still
        const range = p.inspector.look.range;
        expect(Inspector.corrected(range[0], fix)).toBeCloseTo(5, 3);
        expect(Inspector.corrected(range[1], fix)).toBeCloseTo(25, 3);
    });

    test("the CSV has each one's place in the model's coordinates and the task's projection", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.inspector.setMode("pin");
        p.click(150, 50);
        p.act("csv-measurements").click();
        const lines = p.downloads[0].text.trim().split("\n");
        expect(lines[0]).toBe("label,shape,x,y,z,temperature_c,first_spot_c,second_spot_c,delta_t_c,distance_m,epsg");
        expect(lines[1]).toBe("P1,pin,50.000,50.000,0.000,50.000,,,,,32616");
    });
});

describe("the isotherm", () => {
    test("is painted over the model, and kept with the 2D map's of the same task", async () => {
        const p = await page();
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        p.change("isotherm-mode", "above");
        const iso = p.inspector.state.isotherm;
        expect(iso.mode).toBe("above");
        expect(p.source.restyle).toHaveBeenLastCalledWith(expect.objectContaining({isothermPaint: {rgb: [0xe5, 0x39, 0x35], limits: [iso.low, null]}}));
        expect(JSON.parse(p.storage.items[Inspector.isothermKey([TASK.id])])).toEqual(iso);
    });
});

describe("the saved 2D pins", () => {
    test("are placed on the model's top surface, and say when they aren't on it", async () => {
        const p = await page({saved: [{id: "a1", name: "Vent", x: 20, y: 30, values: {temperature: 21.5}},
                                      {id: "b2", name: "Far", x: 500, y: 500, values: {temperature: 9}}]});
        p.inspector.toggle();
        await flush();
        p.run();
        await flush();
        await flush();
        expect(p.inspector.state.saved.map((s) => s.point)).toEqual([{x: 20, y: 30, z: 0}, null]);
        expect(MeshIndex.raycast).toHaveBeenCalledWith(expect.anything(), {x: 20, y: 30, z: 40}, {x: 0, y: 0, z: -1});
        const rows = p.panel().querySelectorAll("[data-saved]");
        expect(rows[0].textContent).toMatch(/Vent.*21\.50 °C/);
        expect(rows[1].textContent).toMatch(/not on the model/);
        expect(p.area.querySelectorAll(".dt-inspector3d-marker.dt-saved")).toHaveLength(1);
    });
});

describe("the palette", () => {
    test("chosen in the panel is the user's preference, but never saved from a public page", async () => {
        const p = await page();
        p.inspector.toggle();
        p.change("palette", "magma");
        expect(p.saved).toHaveBeenCalledWith({palette: "magma"});
        const pub = await page({path: "/public/task/x/3d/"});
        expect(pub.inspector.state.palette).toBe("whitehot");        // no preferences: the task's
        pub.inspector.toggle();
        pub.change("palette", "magma");
        expect(pub.saved).not.toHaveBeenCalled();
    });
});
