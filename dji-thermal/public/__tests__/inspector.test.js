// The Thermal Inspector on WebODM's 2D map (inspector.js), on a fake Leaflet map with WebODM's layer metadata
const inspector = require("../inspector.js");
const Recolour = require("../recolour.js");

const META = Symbol.for("meta");
const TILES = "/api/projects/2/tasks/abc-1/orthophoto/tiles/{z}/{x}/{y}.png?formula=Celsius&bands=L&color_map=magma&rescale=10,40";
const THERMAL_TASK = {id: "abc-1", orthophoto_bands: [{name: "gray", description: "lwir"}, {name: "alpha", description: null}]};
const RGB_TASK = {id: "rgb-2", orthophoto_bands: [{name: "red"}, {name: "green"}, {name: "blue"}]};

const flush = () => new Promise(r => setTimeout(r, 0));
const jsonResponse = (data, ok = true) => Promise.resolve({ok, json: () => Promise.resolve(data)});

// Leaflet's tile layers as the Inspector uses them: their tiles' URLs, and the events drawing from values listens to
const tiling = {on() { return this; }, getTileSize: () => ({x: 256, y: 256})};

function tileLayer(url, task, opts) {
    const layer = Object.assign({_url: url, options: Object.assign({zIndex: 1}, opts), redraws: 0,
                                 setUrl(u) { this._url = u; }, redraw() { this.redraws++; },
                                 getTileUrl(c) { return this._url.replace("{z}", c.z).replace("{x}", c.x).replace("{y}", c.y); }}, tiling);
    layer[META] = {raster: true, task};
    return layer;
}

// How a layer drawn from values is coloured now (recolour.js's style), and its value tile at 18/1/2
const drawn = layer => layer.__dtValues.style();
const valuesOf = layer => layer.__dtValues.url({z: 18, x: 1, y: 2});

function fakeLeaflet() {
    const L = {};
    const layer = extra => Object.assign({addTo(m) { m.added.push(this); return this; }}, extra);
    L.layerGroup = () => layer({layers: [], addLayer(l) { this.layers.push(l); }, clearLayers() { this.layers = []; }});
    L.circleMarker = (latlng, opts) => ({latlng, opts, bindTooltip(text) { this.tooltip = text; return this; }});
    L.DomUtil = {create(tag, cls, parent) { const el = document.createElement(tag); el.className = cls; if (parent) parent.appendChild(el); return el; }};
    L.DomEvent = {disableClickPropagation() {}, disableScrollPropagation() {}};
    L.Control = {extend(proto) { return function () { Object.assign(this, proto); }; }};
    L.tileLayer = (url, options) => {
        const container = document.createElement("div");
        return layer({_url: url, options, setUrl(u) { this._url = u; }, getContainer() { return container; }});
    };
    // The mosaics and isotherms, drawn from values
    L.gridLayer = (options) => {
        const container = document.createElement("div");
        return layer(Object.assign({options, redraws: 0, redraw() { this.redraws++; }, getContainer() { return container; }}, tiling));
    };
    return L;
}

function fakeMap(layers) {
    const handlers = {};
    const el = document.createElement("div");
    document.body.appendChild(el);
    const map = {
        _layers: {}, added: [], el, controls: [], panned: null,
        on(ev, f) { handlers[ev] = f; return map; },
        fire(ev, e) { if (handlers[ev]) handlers[ev](e); },
        hasLayer(l) { return Object.values(map._layers).indexOf(l) >= 0; },
        getContainer() { return el; },
        addControl(c) { map.controls.push(c); el.appendChild(c.onAdd(map)); },
        latLngToContainerPoint() { return {x: 10, y: 20}; },
        panTo(ll) { map.panned = ll; },
        removeLayer(l) { map.added = map.added.filter(x => x !== l); const k = Object.keys(map._layers).find(i => map._layers[i] === l); if (k !== undefined) { delete map._layers[k]; map.fire("layerremove", {layer: l}); } },
        add(l) { map._layers[Object.keys(map._layers).length] = l; map.fire("layeradd", {layer: l}); }
    };
    (layers || []).forEach(l => { map._layers[Object.keys(map._layers).length] = l; });
    return map;
}

function server(routes) {
    return jest.fn((url, opts) => {
        const key = ((opts && opts.method) || "GET") + " " + url.replace(/\?.*$/, "");
        const r = routes[key];
        if (!r) return Promise.reject(new Error("unexpected " + key));
        return typeof r === "function" ? r(url, opts) : jsonResponse(r);
    });
}

const DISPLAY = {unit: null, palette: null, palettes: ["ironred"], colormaps: ["inferno", "magma", "jet"]};
const POINT = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/point";

function start(map, routes, extra) {
    const storage = window.localStorage;
    const plugins = {Map: {onHandleClick: jest.fn()}};
    const fetchFn = server(Object.assign({"GET /api/plugins/dji-thermal/display": DISPLAY}, routes));
    const saved = [];
    const ins = inspector.create({map, tiles: [{type: "orthophoto", meta: {task: THERMAL_TASK}}]}, (extra && extra.L) || fakeLeaflet(),
                                 Object.assign({fetch: fetchFn, storage, doc: document, pluginsApi: plugins, save: p => saved.push(p)}, extra));
    return {ins, fetchFn, plugins, saved, panel: () => map.el.querySelector(".dt-inspector-panel")};
}

afterEach(() => { window.localStorage.clear(); document.body.innerHTML = ""; jest.useRealTimers(); });

describe("the Thermal Inspector", () => {
    it("is for maps with a thermal orthophoto: a single lwir band", () => {
        expect(inspector.hasThermal([{type: "orthophoto", meta: {task: THERMAL_TASK}}])).toBe(true);
        expect(inspector.hasThermal([{type: "orthophoto", meta: {task: RGB_TASK}}])).toBe(false);
        expect(inspector.hasThermal([{type: "dsm", meta: {task: THERMAL_TASK}}])).toBe(false);
        expect(inspector.hasThermal([])).toBe(false);
    });

    it("finds the thermal layer under the cursor, the topmost shown, and its task", () => {
        const low = tileLayer(TILES, THERMAL_TASK, {zIndex: 1});
        const high = tileLayer(TILES.replace("abc-1", "abc-2"), THERMAL_TASK, {zIndex: 5, bounds: {contains: () => true}});
        const rgb = tileLayer(TILES.replace("abc-1", "rgb-2"), RGB_TASK);
        const map = fakeMap([high, rgb, low]);
        expect(inspector.thermalLayers(map).map(t => t.task)).toEqual(["abc-1", "abc-2"]);
        expect(inspector.thermalLayerAt(map, {lat: 1, lng: 2}).task).toBe("abc-2");
        high.options.bounds = {contains: () => false};
        expect(inspector.thermalLayerAt(map, {lat: 1, lng: 2})).toEqual({project: "2", task: "abc-1", layer: low, name: ""});
        expect(inspector.pointUrl({project: "2", task: "abc-1"}, {lat: 0.6, lng: 0.5})).toBe(
            "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/point?lon=0.50000000&lat=0.60000000");
    });

    it("shows temperatures in WebODM's units", () => {
        expect(inspector.formatTemp(21.5)).toBe("21.50 °C");
        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.formatTemp(21.5)).toBe("70.70 °F");
        expect(inspector.formatTemp(null)).toBe("");
        expect(inspector.readoutHtml({valid: false, reason: "excluded"}, "C")).toContain("Outside the task&#39;s crop");
    });

    it("shows temperatures in the unit units.js gives (an anonymous viewer's default) over WebODM's", () => {
        window.localStorage.setItem("unit_system", "imperial");
        window.DjiThermalUnits = {current: () => "C"};
        try {
            expect(inspector.formatTemp(21.5)).toBe("21.50 °C");
        } finally {
            delete window.DjiThermalUnits;
        }
        expect(inspector.formatTemp(21.5)).toBe("70.70 °F");
    });

    it("changes a tile URL's colour map, keeping its other parameters", () => {
        const url = inspector.withColorMap(TILES, "jet");
        expect(inspector.colorMapOf(url)).toBe("jet");
        expect(url).toContain("formula=Celsius&bands=L&rescale=10,40");
        expect(inspector.withColorMap("/t/{z}/{x}/{y}.png", "dji_ironred")).toBe("/t/{z}/{x}/{y}.png?color_map=dji_ironred");
    });

    it("draws DJI's palettes with the plugin's tiles and WebODM's colour maps with WebODM's", () => {
        const dji = inspector.withPalette(TILES, "ironred", DISPLAY);
        expect(dji).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/tiles/{z}/{x}/{y}.png" +
                         "?formula=Celsius&bands=L&rescale=10,40&palette=ironred");
        expect(inspector.paletteOf(dji)).toBe("ironred");
        expect(inspector.thermalLayer(tileLayer(dji, THERMAL_TASK))).toMatchObject({project: "2", task: "abc-1"});
        const back = inspector.withPalette(dji, "jet", DISPLAY);
        expect(back).toBe(TILES.replace("color_map=magma&", "") + "&color_map=jet");
        expect(inspector.paletteOf(back)).toBe("jet");
    });

    it("draws the colour maps WebODM's tiler lacks with the plugin's tiles, the others with WebODM's", () => {
        const display = {...DISPLAY, colormaps: ["inferno", "hot", "jet"], own_colormaps: ["hot"]};
        const hot = inspector.withPalette(TILES, "hot", display);
        expect(hot).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/tiles/{z}/{x}/{y}.png" +
                         "?formula=Celsius&bands=L&rescale=10,40&palette=hot");
        expect(inspector.paletteOf(hot)).toBe("hot");
        expect(inspector.withPalette(hot, "jet", display)).toBe(TILES.replace("color_map=magma&", "") + "&color_map=jet");
        expect(inspector.withPalette(TILES, "hot", DISPLAY)).toBe(TILES.replace("color_map=magma&", "") + "&color_map=hot");
    });

    it("lists the palettes as the Analyzer does: DJI's, then WebODM's", () => {
        expect(inspector.paletteOptions(DISPLAY)).toEqual([["ironred", "DJI ironred"], ["inferno", "inferno"],
                                                           ["magma", "magma"], ["jet", "jet"]]);
        const core = require("../analyzer_core.js");
        const both = {palettes: ["whitehot", "ironred"], colormaps: ["inferno", "gray"]};
        expect(inspector.paletteOptions(both)).toEqual(core.paletteOptions(both));
    });

    it("reads the temperature where the cursor rests, beside it and in the panel", async () => {
        jest.useFakeTimers();
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, fetchFn, panel} = start(map, {[POINT]: {valid: true, temperature: 52.5}});
        ins.open();
        map.fire("mousemove", {latlng: {lat: 0.6, lng: 0.5}});
        map.fire("mousemove", {latlng: {lat: 0.7, lng: 0.5}});
        jest.advanceTimersByTime(100);
        jest.useRealTimers();
        await flush(); await flush();
        expect(fetchFn.mock.calls.filter(c => c[0].indexOf("/point") >= 0).map(c => c[0])).toEqual([
            "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/point?lon=0.50000000&lat=0.70000000"]);
        expect(panel().querySelector(".dt-inspector-readout").textContent).toBe("52.50 °C");
        expect(map.el.querySelector(".dt-inspector-cursor").textContent).toBe("52.50 °C");
    });

    it("shows the temperature beside the pointer under Pointer Info until Temperature On Pointer is cleared, saved for the user", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, fetchFn, panel} = start(map, {[POINT]: {valid: true, temperature: 52.5},
                                                  "PUT /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {pointer_temperature: false})});
        await ins.ready; await flush();
        ins.open();
        const box = () => panel().querySelector('[data-act="pointer-temperature"]'), label = map.el.querySelector(".dt-inspector-cursor");
        const hover = async () => {
            map.fire("mousemove", {latlng: {lat: 0.7, lng: 0.5}});
            await new Promise(r => setTimeout(r, 100));
            await flush(); await flush();
        };
        // On until the user clears it: the heading, then the box, then the readout
        const head = panel().querySelector(".dt-inspector-pointer");
        expect(head.querySelector("strong").textContent).toBe("Pointer Info");
        expect(box().parentNode.textContent.trim()).toBe("Temperature On Pointer");
        expect(box().checked).toBe(true);
        expect(head.compareDocumentPosition(panel().querySelector(".dt-inspector-readout")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await hover();
        expect([label.textContent, label.style.display]).toEqual(["52.50 °C", ""]);
        // A plain arrow over the map instead of Leaflet's hand, while the panel is open
        expect(map.el.classList.contains("dt-pointer-plain")).toBe(true);

        // Cleared: saved for the user (the Analyzer's pages too), the panel still reads the point, none beside the pointer
        box().checked = false;
        box().dispatchEvent(new Event("change", {bubbles: true}));
        expect(label.style.display).toBe("none");
        expect(map.el.classList.contains("dt-pointer-plain")).toBe(false);
        const put = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PUT");
        expect(put.map(c => [c[0], JSON.parse(c[1].body)])).toEqual([["/api/plugins/dji-thermal/display", {pointer_temperature: false}]]);
        await hover();
        expect(panel().querySelector(".dt-inspector-readout").textContent).toContain("52.50 °C");
        expect(label.style.display).toBe("none");
        expect(box().checked).toBe(false);
    });

    it("leaves Temperature On Pointer cleared when the user cleared it", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, panel} = start(map, {[POINT]: {valid: true, temperature: 52.5},
                                         "GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {pointer_temperature: false})});
        await ins.ready; await flush();
        ins.open();
        expect(panel().querySelector('[data-act="pointer-temperature"]').checked).toBe(false);
        expect(map.el.classList.contains("dt-pointer-plain")).toBe(false);
        map.fire("mousemove", {latlng: {lat: 0.7, lng: 0.5}});
        await new Promise(r => setTimeout(r, 100));
        await flush(); await flush();
        expect(panel().querySelector(".dt-inspector-readout").textContent).toContain("52.50 °C");
        expect(map.el.querySelector(".dt-inspector-cursor").style.display).toBe("none");
    });

    it("pins points with their temperature, kept in the browser for the same tasks, and exports them", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, plugins, panel} = start(map, {[POINT]: {valid: true, temperature: 30}});
        ins.open();
        const click = plugins.Map.onHandleClick.mock.calls[0][0];
        expect(click({latlng: {lat: 0.6, lng: 0.5}})).toBe(false);        // hovering: WebODM's click
        panel().querySelector('[data-mode="pin"]').click();
        expect(map.el.style.cursor).toBe("crosshair");
        expect(click({latlng: {lat: 0.6, lng: 0.5}})).toBe(true);
        await flush(); await flush();
        expect(panel().querySelector(".dt-inspector-pins").textContent).toContain("P130.00 °C");
        const pins = map.added[2];      // above the saved measurements and the regions
        expect(pins.layers.map(m => m.tooltip)).toEqual(["P1: 30.00 °C"]);
        const key = inspector.pinsKey(["abc-1"]);
        expect(JSON.parse(window.localStorage.getItem(key))[0]).toMatchObject({label: "P1", lat: 0.6, lng: 0.5, temperature: 30});

        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.pinsCsv(inspector.loadPins(window.localStorage, key), "F")).toBe(
            "label,latitude,longitude,temperature_f\nP1,0.60000000,0.50000000,86.000\n");
        panel().querySelector('[data-act="toggle"]').click();
        expect(pins.layers).toEqual([]);
        panel().querySelector('[data-act="remove"]').click();
        expect(window.localStorage.getItem(key)).toBe(null);
    });

    // WebODM's layer panel: the URL rebuilt from the layer's path, its own colour map and range (LayersControlLayer)
    const panelSets = (layer, colorMap, rescale) => layer.setUrl(layer._url.replace(/\?.*$/, "") +
        "?color_map=" + colorMap + "&formula=Celsius&bands=L&rescale=" + rescale + "&size=512&crop=1", true);

    it("opens with the user's palette and saves the one chosen, in its panel or WebODM's", async () => {
        const layer = tileLayer(TILES, THERMAL_TASK);
        const map = fakeMap([layer]);
        const {ins, saved, panel} = start(map, {"GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {palette: "inferno"})});
        await ins.ready;
        expect(inspector.paletteOf(layer._url)).toBe("inferno");
        ins.open();
        const select = panel().querySelector('[data-act="palette"]');
        expect([].map.call(select.options, o => o.value)).toEqual(["ironred", "inferno", "magma", "jet"]);
        expect([].map.call(select.options, o => o.textContent)).toEqual(["DJI ironred", "inferno", "magma", "jet"]);
        select.value = "jet";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        expect(inspector.paletteOf(layer._url)).toBe("jet");
        expect(saved).toEqual(["jet"]);
        // WebODM's panel still shows magma: a range set there keeps jet; a colour map chosen there is the user's
        panelSets(layer, "magma", "12,30");
        expect(inspector.paletteOf(layer._url)).toBe("jet");
        expect(layer._url).toContain("rescale=12,30");
        expect(saved).toEqual(["jet"]);
        panelSets(layer, "inferno", "12,30");
        expect(inspector.paletteOf(layer._url)).toBe("inferno");
        expect(saved).toEqual(["jet", "inferno"]);
        // A thermal layer added later is drawn in it
        const later = tileLayer(TILES.replace("abc-1", "abc-3"), THERMAL_TASK);
        map.add(later);
        expect(inspector.paletteOf(later._url)).toBe("inferno");
    });

    it("draws the layer in one of DJI's palettes with the plugin's tiles, through WebODM's range changes", async () => {
        const layer = tileLayer(TILES, THERMAL_TASK);
        const map = fakeMap([layer]);
        const {ins, saved, panel} = start(map, {"GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {palette: "ironred"})});
        await ins.ready;
        expect(layer._url).toContain("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/tiles/");
        expect(inspector.paletteOf(layer._url)).toBe("ironred");
        ins.open();
        expect(panel().querySelector('[data-act="palette"]').value).toBe("ironred");
        panelSets(layer, "magma", "15,35");
        expect(layer._url).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/tiles/{z}/{x}/{y}.png" +
                                "?formula=Celsius&bands=L&rescale=15,35&size=512&crop=1&palette=ironred");
        panelSets(layer, "jet", "15,35");
        expect(layer._url).toMatch(/^\/api\/projects\/2\/tasks\/abc-1\/orthophoto\/tiles\/.*color_map=jet/);
        expect(saved).toEqual(["jet"]);
        // One of WebODM's other colour maps is drawn, not saved, and shown in the list
        panelSets(layer, "rdylgn", "15,35");
        expect(inspector.paletteOf(layer._url)).toBe("rdylgn");
        expect(saved).toEqual(["jet"]);
        expect(panel().querySelector('[data-act="palette"]').value).toBe("rdylgn");
    });

    it("opens in the task's palette when the user has none, until they choose one; theirs wins", async () => {
        const MEASUREMENTS = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/measurements";
        const own = {measurements: [], can_change: true, baseline: null, palette: "ironred"};
        let layer = tileLayer(TILES, THERMAL_TASK);
        let s = start(fakeMap([layer]), {[MEASUREMENTS]: own});
        await s.ins.ready; await flush(); await flush();
        expect(inspector.paletteOf(layer._url)).toBe("ironred");
        expect(s.ins.state.palette).toBe("ironred");
        expect(s.saved).toEqual([]);

        // The user's palette wins
        layer = tileLayer(TILES, THERMAL_TASK);
        s = start(fakeMap([layer]), {[MEASUREMENTS]: own, "GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {palette: "inferno"})});
        await s.ins.ready; await flush(); await flush();
        expect(inspector.paletteOf(layer._url)).toBe("inferno");

        // A task without one keeps WebODM's colour map
        layer = tileLayer(TILES, THERMAL_TASK);
        s = start(fakeMap([layer]), {[MEASUREMENTS]: Object.assign({}, own, {palette: ""})});
        await s.ins.ready; await flush(); await flush();
        expect(inspector.colorMapOf(layer._url)).toBe("magma");
    });

    it("keeps the layer's own palette when the user's is not one offered", async () => {
        const layer = tileLayer(TILES, THERMAL_TASK);
        const map = fakeMap([layer]);
        const {ins, saved} = start(map, {"GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {palette: "gone"})});
        await ins.ready;
        expect(inspector.colorMapOf(layer._url)).toBe("magma");
        expect(ins.state.palette).toBe("magma");
        expect(saved).toEqual([]);
    });
});

describe("the Thermal Inspector's regions", () => {
    const L = require("leaflet");
    const REGION = "POST /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/region";
    const STATS = {valid: true, reason: null, pixel_size: 0.5, resampled: false, statistics: {
        count: 400, min: 10, max: 50, mean: 30, std: 5, median: 29.5, percentiles: {"2": 12, "98": 48},
        histogram: {counts: [100, 200, 100], edges: [10, 23, 36, 50]}, min_location: [0.4999, 0.5001], max_location: [0.4998, 0.5002],
        surroundings: 26, delta_t: 4}};
    const LINE = Object.assign({}, STATS, {length: 12.5, profile: {distance: [0, 5, 10, 12.5], values: [20, null, 40, 30],
        points: [[0.5, 0.5], [0.5001, 0.5], [0.5002, 0.5], [0.5003, 0.5]]}});
    const change = (el, value) => { el.value = value; el.dispatchEvent(new Event("change", {bubbles: true})); };
    const posts = fetchFn => fetchFn.mock.calls.filter(c => c[1] && c[1].method === "POST").map(c => JSON.parse(c[1].body));

    // WebODM's map: Leaflet's, with a thermal orthophoto layer as WebODM adds it
    function leafletMap() {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const map = L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([0.5, 0.5], 18);
        const layer = L.tileLayer(TILES);
        layer[META] = {raster: true, task: THERMAL_TASK};
        layer.addTo(map);
        map.el = div;
        return map;
    }

    function drawRectangle(map) {
        const a = map.containerPointToLatLng(L.point(10, 10));
        map.fire("mousedown", {latlng: a, originalEvent: {button: 0}});
        document.dispatchEvent(new MouseEvent("mouseup", {clientX: 60, clientY: 50}));
    }

    it("draws a region, reads its statistics and shows them with its hottest and coldest pixels", async () => {
        const map = leafletMap();
        const {ins, fetchFn, plugins, panel} = start(map, {[REGION]: STATS}, {L});
        ins.open();
        panel().querySelector('[data-mode="rectangle"]').click();
        expect(plugins.Map.onHandleClick.mock.calls[0][0]({latlng: map.getCenter()})).toBe(true);    // not WebODM's popup
        drawRectangle(map);
        await flush(); await flush();
        const posted = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "POST");
        expect(posted.length).toBe(1);
        expect(JSON.parse(posted[0][1].body).geometry.type).toBe("Polygon");
        expect(ins.state.mode).toBe("hover");
        const text = panel().querySelector(".dt-inspector-shown").textContent;
        ["R1", "Rectangle", "10.00 °C", "50.00 °C", "30.00 °C", "5.00 °C", "48.00 °C", "400", "100 m²", "Surroundings26.00 °C", "ΔT+4.00 °C"]
            .forEach(t => expect(text).toContain(t));
        expect(text).not.toContain("In the isotherm");
        expect(panel().querySelectorAll(".dt-inspector-histogram rect").length).toBe(3);
        const tips = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) tips.push(l.getTooltip()._content); });
        expect(tips).toEqual(expect.arrayContaining(["R1", "R1 coldest: 10.00 °C", "R1 hottest: 50.00 °C"]));

        // Kept in the browser, in WebODM's units, exported
        const saved = JSON.parse(window.localStorage.getItem(inspector.regionsKey(["abc-1"])));
        expect(saved[0]).toMatchObject({label: "R1", shape: "rectangle", statistics: {mean: 30}});
        expect(saved[0].loading).toBeUndefined();
        expect(inspector.regionsCsv(saved, "F").split("\n")[1]).toBe(
            "R1,rectangle,400,100.000,,50.000,122.000,86.000,9.000,85.100,53.600,118.400,78.800,7.200,,0.50010000,0.49990000,0.50020000,0.49980000,,");
        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.statisticsHtml(saved[0], "F")).toContain("1076 ft²");
        panel().querySelector('[data-region] [data-act="remove"]').click();
        expect(window.localStorage.getItem(inspector.regionsKey(["abc-1"]))).toBe(null);
        expect(panel().querySelector(".dt-inspector-shown")).toBe(null);
        map.remove();
    });

    it("draws a line and shows its temperatures along it, each found on the map from its profile, and exports them", async () => {
        const map = leafletMap();
        const {ins, fetchFn, panel} = start(map, {[REGION]: LINE}, {L});
        ins.open();
        panel().querySelector('[data-mode="line"]').click();
        expect(panel().textContent).toContain("Click the line's points");
        map.fire("click", {latlng: L.latLng(0.5, 0.5)});
        map.fire("dblclick", {latlng: L.latLng(0.5, 0.5)});
        expect(ins.state.notice).toBe("A line needs two points");
        map.fire("click", {latlng: L.latLng(0.5, 0.5003)});
        map.fire("dblclick", {latlng: L.latLng(0.5, 0.5003)});
        await flush(); await flush();
        expect(posts(fetchFn)).toEqual([{geometry: {type: "LineString", coordinates: [[0.5, 0.5], [0.5003, 0.5]]}, isotherm: null, correction: null}]);
        const shown = panel().querySelector(".dt-inspector-shown");
        ["L1", "Line", "Length12.5 m", "ΔT+4.00 °C"].forEach(t => expect(shown.textContent).toContain(t));
        expect(shown.textContent).not.toContain("Area");
        expect(shown.querySelector(".dt-inspector-histogram")).toBe(null);
        // No temperature at the second sample: the profile is broken there
        expect([shown.querySelectorAll(".dt-inspector-profile circle").length, shown.querySelectorAll(".dt-inspector-profile polyline").length]).toEqual([1, 1]);

        // Hovering the profile's end finds it on the map
        const svg = shown.querySelector(".dt-inspector-profile svg");
        svg.getBoundingClientRect = () => ({left: 0, width: 100});
        svg.dispatchEvent(new MouseEvent("mousemove", {clientX: 100, bubbles: true}));
        const markers = () => { const found = []; map.eachLayer(l => { if (l.getLatLng && l.options.fillColor === "#ff9800") found.push(l.getLatLng()); }); return found; };
        expect(markers()).toEqual([L.latLng(0.5, 0.5003)]);
        expect(panel().querySelector(".dt-inspector-profile-read").textContent).toContain("12.5 m: 30.00 °C");
        panel().dispatchEvent(new MouseEvent("mouseleave"));
        expect(markers()).toEqual([]);
        const labels = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) labels.push([l.getTooltip()._content, l.getLatLng ? l.getLatLng() : null]); });
        expect(labels).toContainEqual(["L1", L.latLng(0.5, 0.5)]);     // at its start

        expect(inspector.profileCsv(ins.state.regions[0], "C").split("\n").slice(0, 3)).toEqual(
            ["distance_m,latitude,longitude,temperature_c", "0.000,0.50000000,0.50000000,20.000", "5.000,0.50000000,0.50010000,"]);
        expect(inspector.regionsCsv(ins.state.regions, "C").split("\n")[1]).toMatch(/^L1,line,400,,12\.500,/);
        // Lines and regions are numbered apart
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();
        expect(ins.state.regions.map(r => r.label)).toEqual(["L1", "R1"]);
        map.remove();
    });

    it("measures the share of a region in the isotherm shown, again when the isotherm changes", async () => {
        const map = leafletMap();
        const {ins, fetchFn, panel} = start(map, {[REGION]: (url, opts) => jsonResponse(JSON.parse(opts.body).isotherm ?
            Object.assign({}, STATS, {statistics: Object.assign({}, STATS.statistics, {isotherm_share: 0.25})}) : STATS)}, {L});
        await ins.ready;
        ins.open();
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();
        expect(panel().querySelector(".dt-inspector-shown").textContent).not.toContain("In the isotherm");
        change(panel().querySelector('[data-act="isotherm-mode"]'), "above");
        await flush(); await flush();
        expect(posts(fetchFn).map(b => b.isotherm)).toEqual([null, {low: 31, high: null}]);
        expect(panel().querySelector(".dt-inspector-shown").textContent).toContain("In the isotherm25.0 %");
        // Other limits: the share is not that region's until measured with them
        change(panel().querySelector('[data-act="isotherm-low"]'), "35");
        expect(panel().querySelector(".dt-inspector-shown").textContent).not.toContain("25.0 %");
        await flush(); await flush();
        expect(posts(fetchFn).map(b => b.isotherm)[2]).toEqual({low: 35, high: null});
        expect(panel().querySelector(".dt-inspector-shown").textContent).toContain("25.0 %");
        map.remove();
    });

    it("says when a region has no temperatures, and reads one the page left before its statistics", async () => {
        window.localStorage.setItem(inspector.regionsKey(["abc-1"]), JSON.stringify([
            {id: "a", label: "R1", shape: "polygon", geometry: {type: "Polygon", coordinates: [[[0.5, 0.5], [0.501, 0.5], [0.501, 0.501], [0.5, 0.5]]]},
             statistics: null, reason: null}]));
        const map = leafletMap();
        const {ins, fetchFn, panel} = start(map, {[REGION]: {valid: false, reason: "excluded", statistics: null}}, {L});
        await flush(); await flush();
        expect(fetchFn.mock.calls.filter(c => c[1] && c[1].method === "POST").length).toBe(1);
        ins.open();
        expect(panel().querySelector(".dt-inspector-shown").textContent).toContain("Outside the task's crop");
        map.remove();
    });
});

describe("the Thermal Inspector's saved measurements and correction", () => {
    const L = require("leaflet");
    const REGION = "POST /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/region";
    const SAVED = "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/measurements";
    const BASELINE = {emissivity: 0.91, reflected: 21};
    const STATS = {valid: true, reason: null, pixel_size: 0.5, resampled: false, correction: null, statistics: {
        count: 400, min: 10, max: 50, mean: 30, std: 5, median: 29.5, percentiles: {"2": 12, "98": 48},
        histogram: {counts: [100, 200, 100], edges: [10, 23, 36, 50]}, min_location: [0.4999, 0.5001], max_location: [0.4998, 0.5002],
        surroundings: 26, delta_t: 4}};
    const change = (el, value) => { el.value = value; el.dispatchEvent(new Event("change", {bubbles: true})); };
    const type = (el, value) => { el.value = value; el.dispatchEvent(new Event("input", {bubbles: true})); };
    const calls = (fetchFn, method) => fetchFn.mock.calls.filter(c => c[1] && c[1].method === method);
    // The broadband model written out: the radiance seen with the baseline, solved for the parameters wanted
    const model = (c, e, r, e0, r0) => {
        const k = 273.15, seen = e0 * (c + k) ** 4 + (1 - e0) * (r0 + k) ** 4;
        return ((seen - (1 - e) * (r + k) ** 4) / e) ** 0.25 - k;
    };

    function leafletMap() {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const map = L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([0.5, 0.5], 18);
        const layer = L.tileLayer(TILES);
        layer[META] = {raster: true, task: Object.assign({name: "Roof survey"}, THERMAL_TASK)};
        layer.addTo(map);
        map.el = div;
        return map;
    }

    function drawRectangle(map) {
        const a = map.containerPointToLatLng(L.point(10, 10));
        map.fire("mousedown", {latlng: a, originalEvent: {button: 0}});
        document.dispatchEvent(new MouseEvent("mouseup", {clientX: 60, clientY: 50}));
    }

    it("corrects a temperature for another emissivity and reflected temperature, and back", () => {
        const fix = {wanted: {emissivity: 0.8, reflected: 10}, baseline: BASELINE};
        expect(inspector.corrected(30, fix)).toBeCloseTo(model(30, 0.8, 10, 0.91, 21), 6);
        expect(inspector.uncorrected(inspector.corrected(30, fix), fix)).toBeCloseTo(30, 6);
        expect(inspector.corrected(30, null)).toBe(30);
        expect(inspector.rawIsotherm({mode: "above", low: inspector.corrected(25, fix), color: "red"}, fix).low).toBeCloseTo(25, 5);
        // The legend's marks are corrected temperatures, where the layer's own values are drawn
        const html = inspector.legendHtml(["ff0000ff", "0000ffff"], [10, 40], "inferno", "C", null,
                                          {wanted: {emissivity: 0.5, reflected: 21}, baseline: BASELINE});
        const ticks = [...html.matchAll(/left: ([\d.]+)%;">([^<]+)</g)].map(m => [Number(m[1]), Number(m[2])]);
        const half = {wanted: {emissivity: 0.5, reflected: 21}, baseline: BASELINE};
        // The ends say the corrected range's own values, the marks between sit where the layer has those values
        expect(ticks[0]).toEqual([0, Number(inspector.corrected(10, half).toFixed(1))]);
        expect(ticks[ticks.length - 1]).toEqual([100, Number(inspector.corrected(40, half).toFixed(1))]);
        ticks.forEach(([at, label]) => expect(at).toBeCloseTo((inspector.uncorrected(label, half) - 10) / 30 * 100, 0));
    });

    it("measures ΔT between two spots clicked after choosing ΔT beside Hover, the second's temperature less the first's", async () => {
        const map = leafletMap();
        const DELTA = {valid: true, reason: null, first: 20, second: 26.5, delta_t: 6.5, reasons: [null, null], length: 2.31, measured: [20, 26.5], correction: null};
        const {ins, fetchFn, panel} = start(map, {[REGION]: DELTA}, {L});
        const posts = () => calls(fetchFn, "POST").map(c => JSON.parse(c[1].body));
        ins.open();
        const modes = [...panel().querySelectorAll(".dt-inspector-modes [data-mode]")].map(b => b.getAttribute("data-mode"));
        expect(modes.slice(0, 3)).toEqual(["hover", "delta", "pin"]);
        expect(panel().querySelector('[data-mode="delta"]').textContent.trim()).toBe("ΔT");
        // Hover and Pin are icons, each named and described when hovered
        ["hover", "pin"].forEach(m => {
            const b = panel().querySelector('[data-mode="' + m + '"]');
            expect(b.textContent.trim()).toBe("");
            expect([b.getAttribute("aria-label"), b.title]).toEqual(m === "hover" ?
                ["Hover", "Hover: read the temperature under the cursor"] :
                ["Pin", "Pin: click the map to keep a point and its temperature"]);
        });
        panel().querySelector('[data-mode="delta"]').click();
        expect(panel().textContent).toContain("Click the first spot, then the second");
        map.fire("click", {latlng: L.latLng(0.5, 0.5)});
        expect(posts(fetchFn)).toEqual([]);
        map.fire("click", {latlng: L.latLng(0.5, 0.50002)});
        await flush(); await flush();
        expect(posts(fetchFn)).toEqual([{geometry: {type: "LineString", coordinates: [[0.5, 0.5], [0.50002, 0.5]]}, shape: "delta", isotherm: null, correction: null}]);
        expect(ins.state.mode).toBe("hover");
        const shown = panel().querySelector(".dt-inspector-shown");
        ["D1", "ΔT", "First spot20.00 °C", "Second spot26.50 °C", "ΔT+6.50 °C", "Distance2.3 m"].forEach(t => expect(shown.textContent).toContain(t));
        expect(shown.textContent).not.toContain("Mean");
        expect(panel().querySelector("[data-region]").textContent).toContain("+6.50 °C ΔT");
        const tips = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) tips.push([l.getTooltip()._content, l.getLatLng()]); });
        expect(tips).toEqual([["D1: ΔT +6.50 °C", L.latLng(0.5, 0.50002)]]);     // at the second spot
        expect(inspector.regionsCsv(ins.state.regions, "F").split("\n")[1]).toBe("D1,delta,,,2.310,,,,,,,,,11.700,,,,,,68.000,79.700");

        // A spot with no temperature: no ΔT, and which one says why
        const missing = Object.assign({}, DELTA, {valid: false, reason: "nodata", second: null, delta_t: null, reasons: [null, "nodata"]});
        expect(inspector.statisticsHtml(Object.assign({shape: "delta"}, missing), "C")).toContain("No data here");
        map.remove();
    });

    it("saves a ΔT like the other measurements, listed with its ΔT and both spots in the CSV", async () => {
        const map = leafletMap();
        const DELTA = {valid: true, reason: null, first: 20, second: 18, delta_t: -2, reasons: [null, null], length: 3, measured: [20, 18]};
        let saved = null;
        const {ins, fetchFn, panel} = start(map, {
            [REGION]: DELTA,
            ["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE},
            ["POST " + SAVED]: (url, opts) => {
                saved = Object.assign({}, JSON.parse(opts.body), {id: "0123456789ab", values: DELTA, created_by: "ana", created_at: "2026-11-11T10:00:00Z"});
                return jsonResponse(saved);
            }
        }, {L});
        await ins.ready; await flush();
        ins.open();
        panel().querySelector('[data-mode="delta"]').click();
        map.fire("click", {latlng: L.latLng(0.5, 0.5)});
        map.fire("click", {latlng: L.latLng(0.50002, 0.5)});
        await flush(); await flush();
        panel().querySelector('[data-region] [data-act="save"]').click();
        type(panel().querySelector('[data-form="name"]'), "Vent");
        panel().querySelector('[data-act="form-save"]').click();
        await flush(); await flush();
        const body = JSON.parse(calls(fetchFn, "POST").filter(c => c[0] === SAVED)[0][1].body);
        expect(body).toMatchObject({name: "Vent", shape: "delta", geometry: {type: "LineString", coordinates: [[0.5, 0.5], [0.5, 0.50002]]}});
        expect(ins.state.regions).toEqual([]);
        expect(panel().querySelector("[data-saved]").textContent).toContain("-2.00 °C ΔT");
        const shown = panel().querySelector('[data-profile-of="saved"]').textContent;
        ["Vent", "ΔT", "First spot20.00 °C", "Second spot18.00 °C", "ΔT-2.00 °C"].forEach(t => expect(shown).toContain(t));
        const tips = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) tips.push(l.getTooltip()._content); });
        expect(tips).toContain("Vent: ΔT -2.00 °C");
        expect(inspector.savedCsv([{source: {name: "Roof survey"}, m: saved}], "C").split("\n")[1]).toMatch(
            /^Vent,,delta,Roof survey,,2026-11-11T10:00:00Z,ana,,,,,,3,,,,,,,,,-2,,,,,,,,20,18$/);
        map.remove();
    });

    it("saves a region named, with a comment, for everyone who can view the project; renames, deletes and exports it", async () => {
        const map = leafletMap();
        let saved = null;
        const confirm = jest.fn(() => true);
        const {ins, fetchFn, panel} = start(map, {
            [REGION]: STATS,
            ["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE},
            ["POST " + SAVED]: (url, opts) => {
                saved = Object.assign({}, JSON.parse(opts.body), {id: "0123456789ab", values: STATS, created_by: "ana", created_at: "2026-11-01T10:00:00Z"});
                return jsonResponse(saved);
            },
            ["PATCH " + SAVED + "/0123456789ab"]: (url, opts) => jsonResponse(Object.assign({}, saved, JSON.parse(opts.body))),
            ["DELETE " + SAVED + "/0123456789ab"]: () => Promise.resolve({ok: true, json: () => Promise.reject(new Error("no content"))})
        }, {L, confirm});
        await ins.ready; await flush();
        ins.open();
        expect(panel().textContent).toContain("None yet");
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();
        panel().querySelector('[data-region] [data-act="save"]').click();
        expect(panel().querySelector('[data-form="name"]').value).toBe("R1");
        type(panel().querySelector('[data-form="name"]'), "Warm roof");
        type(panel().querySelector('[data-form="comment"]'), "Above the boiler");
        ins.state.regionsVisible = true;
        panel().querySelector('[data-act="form-save"]').click();
        await flush(); await flush();
        const body = JSON.parse(calls(fetchFn, "POST").filter(c => c[0] === SAVED)[0][1].body);
        expect(body).toMatchObject({name: "Warm roof", comment: "Above the boiler", shape: "rectangle", isotherm: null, correction: null});
        expect(body.geometry.type).toBe("Polygon");
        expect(panel().querySelector(".dt-inspector-form")).toBe(null);
        expect(ins.state.regions).toEqual([]);      // saved: no longer the browser's own
        const shown = panel().querySelector('[data-profile-of="saved"]').textContent;
        ["Warm roof", "Above the boiler", "Roof survey", "Saved by ana, 2026-11-01", "Surroundings26.00 °C"].forEach(t => expect(shown).toContain(t));
        const tips = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) tips.push(l.getTooltip()._content); });
        expect(tips).toContain("Warm roof");

        const item = {source: {name: "Roof survey"}, m: saved};
        expect(inspector.savedCsv([item], "C").split("\n")[1]).toMatch(/^Warm roof,Above the boiler,rectangle,Roof survey,,2026-11-01T10:00:00Z,ana,,,,400,100,,10,50,30,5,29.5,12,48,26,4,,,,,,,,,$/);
        const geo = JSON.parse(inspector.savedGeoJson([item], "F"));
        expect(geo.features[0].geometry).toEqual(saved.geometry);
        expect(geo.features[0].properties).toMatchObject({name: "Warm roof", mean_f: 86, delta_t_f: 7.2});

        panel().querySelector('[data-saved] [data-act="edit"]').click();
        type(panel().querySelector('[data-form="name"]'), "Boiler roof");
        panel().querySelector('[data-act="form-save"]').click();
        await flush(); await flush();
        expect(JSON.parse(calls(fetchFn, "PATCH")[0][1].body)).toEqual({name: "Boiler roof", comment: "Above the boiler"});
        expect(panel().querySelector("[data-saved]").textContent).toContain("Boiler roof");
        panel().querySelector('[data-saved] [data-act="delete"]').click();
        await flush(); await flush();
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Boiler roof"));
        expect(calls(fetchFn, "DELETE").length).toBe(1);
        expect(panel().querySelector("[data-saved]")).toBe(null);
        map.remove();
    });

    it("shows who can only view the project the saved measurements, with no Save, rename or delete", async () => {
        const map = leafletMap();
        const m = {id: "0123456789ab", name: "Vent", comment: "", shape: "pin", geometry: {type: "Point", coordinates: [0.5, 0.5]},
                   values: {valid: true, temperature: 41.5, measured: 41.5}, isotherm: null, correction: null, created_by: "ana"};
        const {ins, panel} = start(map, {[REGION]: STATS, ["GET " + SAVED]: {measurements: [m], can_change: false, baseline: null}}, {L});
        await ins.ready; await flush();
        ins.open();
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();
        expect(panel().querySelector('[data-act="save"]')).toBe(null);
        expect(panel().querySelector("[data-saved]").textContent).toContain("41.50 °C");
        expect(panel().querySelector('[data-saved] [data-act="edit"]')).toBe(null);
        expect(panel().querySelector('[data-saved] [data-act="delete"]')).toBe(null);
        map.remove();
    });

    it("keeps a range's temperatures as shown when the correction changes, in the layer's own values", () => {
        const from = {wanted: {emissivity: 0.8, reflected: 21}, baseline: BASELINE}, to = {wanted: {emissivity: 0.6, reflected: 40}, baseline: BASELINE};
        const kept = inspector.keptRange([10, 40], from, to);
        kept.forEach((c, i) => expect(inspector.corrected(c, to)).toBeCloseTo(inspector.corrected([10, 40][i], from), 3));
        // Off again: the layer's own values are the temperatures shown
        expect(inspector.keptRange(kept, to, null).map(c => Number(c.toFixed(2))))
            .toEqual([10, 40].map(c => Number(inspector.corrected(c, from).toFixed(2))));
        expect(inspector.keptRange(null, from, to)).toBe(null);
    });

    it("corrects the temperatures shown from what the layer was measured with, measuring the regions again", async () => {
        const map = leafletMap();
        const {ins, fetchFn, panel, plugins} = start(map, {
            [REGION]: STATS, [POINT]: {valid: true, temperature: 30, reason: null},
            ["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE}
        }, {L});
        await ins.ready; await flush();
        ins.open();
        ins.setMode("pin");
        plugins.Map.onHandleClick.mock.calls[0][0]({latlng: L.latLng(0.5, 0.5)});
        await flush(); await flush();
        expect(panel().querySelector("[data-pin]").textContent).toContain("30.00 °C");
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();

        // Turned on: from what it was measured with, then another emissivity
        const on = panel().querySelector('[data-act="correction-on"]');
        on.checked = true;
        on.dispatchEvent(new Event("change", {bubbles: true}));
        expect(ins.state.correction).toEqual({on: true, emissivity: 0.91, reflected: 21});
        expect(panel().querySelector('[data-act="correction-emissivity"]').disabled).toBe(false);
        change(panel().querySelector('[data-act="correction-emissivity"]'), "0.8");
        await flush(); await flush();
        const bodies = calls(fetchFn, "POST").map(c => JSON.parse(c[1].body));
        expect(bodies[bodies.length - 1].correction).toEqual({emissivity: 0.8, reflected: 21});
        const want = model(30, 0.8, 21, 0.91, 21);
        expect(panel().querySelector("[data-pin]").textContent).toContain(want.toFixed(2) + " °C");
        expect(Object.keys(window.localStorage).filter(k => k.indexOf("correction") >= 0)).toEqual([]);
        // The colour scale keeps the temperatures it shows, so the layer is drawn over others of its own values
        expect(panel().querySelector('[data-act="range-min"]').value).toBe("10");
        expect(panel().querySelector('[data-act="range-max"]').value).toBe("40");
        const layer = Object.values(map._layers).find(l => l._url && l._url.indexOf("orthophoto/tiles") >= 0);
        const rescale = /rescale=([^&]+)/.exec(layer._url)[1].split(",").map(Number);
        const fix = {wanted: {emissivity: 0.8, reflected: 21}, baseline: BASELINE};
        expect(rescale[0]).toBeCloseTo(inspector.uncorrected(10, fix), 3);
        expect(rescale[1]).toBeCloseTo(inspector.uncorrected(40, fix), 3);
        change(panel().querySelector('[data-act="correction-emissivity"]'), "1.5");
        expect(panel().textContent).toContain("The emissivity is between 0.1 and 1");
        expect(ins.state.correction.emissivity).toBe(0.8);

        // The isotherm's limits are corrected temperatures: it paints the layer's own
        change(panel().querySelector('[data-act="isotherm-mode"]'), "above");
        const iso = ins.state.isotherm;
        const raw = inspector.uncorrected(iso.low, {wanted: {emissivity: 0.8, reflected: 21}, baseline: BASELINE});
        expect(drawn(ins.overlays()[0].overlay).isotherm[0]).toBeCloseTo(raw, 4);
        map.remove();
    });

    it("corrects the temperature beside the pointer as it corrects the layer", async () => {
        const map = leafletMap();
        const {ins, panel} = start(map, {[POINT]: {valid: true, temperature: 30, reason: null},
                                         ["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE}}, {L});
        await ins.ready; await flush();
        ins.open();
        const on = panel().querySelector('[data-act="correction-on"]');
        on.checked = true;
        on.dispatchEvent(new Event("change", {bubbles: true}));
        change(panel().querySelector('[data-act="correction-emissivity"]'), "0.8");
        await flush();
        map.setView([0.5, 0.5], 18);
        map.fire("mousemove", {latlng: L.latLng(0.5, 0.5)});
        await new Promise(r => setTimeout(r, 120));
        await flush();
        // Beside the pointer, the temperature the panel shows: corrected
        expect(map.getContainer().querySelector(".dt-inspector-cursor").textContent).toBe(model(30, 0.8, 21, 0.91, 21).toFixed(2) + " °C");
    });

    it("keeps Emissivity and Reflected under the scale, greyed with the layer's own values until Manual Corrections is ticked", async () => {
        const map = leafletMap();
        const {ins, panel} = start(map, {["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE}}, {L});
        await ins.ready; await flush();
        ins.open();
        const field = name => panel().querySelector('[data-act="correction-' + name + '"]');
        const tick = on => {
            field("on").checked = on;
            field("on").dispatchEvent(new Event("change", {bubbles: true}));
        };
        // Under the scale's range, just under the top (which stays in view), the tick box under the fields, with no description
        const order = ['[data-act="range-max"]', '[data-act="correction-emissivity"]', '[data-act="correction-reflected"]', '[data-act="correction-on"]', '[data-act="image-brightness"]']
            .map(sel => panel().querySelector(sel));
        order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
        expect(field("on").parentNode.textContent.trim()).toBe("Manual Corrections");
        expect(panel().textContent).not.toContain("Approximate");
        expect(panel().textContent).not.toContain("measured with emissivity");
        expect(field("on").checked).toBe(false);
        expect([field("emissivity").disabled, field("emissivity").value, field("reflected").disabled, field("reflected").value]).toEqual([true, "0.91", true, "21"]);

        tick(true);
        expect(field("emissivity").disabled).toBe(false);
        change(field("emissivity"), "0.8");
        expect(ins.state.correction).toEqual({on: true, emissivity: 0.8, reflected: 21});
        tick(false);
        expect(ins.state.correction).toEqual({on: false});
        expect([field("emissivity").disabled, field("emissivity").value]).toEqual([true, "0.91"]);
        // Ticked again: from what the layer was measured with
        tick(true);
        expect(ins.state.correction).toEqual({on: true, emissivity: 0.91, reflected: 21});
        map.remove();
    });

    it("starts every visit with Manual Corrections unticked, and removes a correction an earlier version kept", async () => {
        const map = leafletMap();
        window.localStorage.setItem("dji-thermal-inspector:correction:abc-1", JSON.stringify({on: true, emissivity: 0.8, reflected: 21}));
        window.localStorage.setItem("dji-thermal-inspector:correction:other", JSON.stringify({on: true, emissivity: 0.7, reflected: 20}));
        const {ins, panel} = start(map, {["GET " + SAVED]: {measurements: [], can_change: true, baseline: BASELINE}}, {L});
        await ins.ready; await flush();
        ins.open();
        expect(ins.state.correction).toEqual({on: false});
        expect(panel().querySelector('[data-act="correction-on"]').checked).toBe(false);
        expect(Object.keys(window.localStorage).filter(k => k.indexOf("correction") >= 0)).toEqual([]);
        map.remove();
    });

    it("says when a layer doesn't record how it was measured, and doesn't correct it", async () => {
        const map = leafletMap();
        const {ins, fetchFn, panel} = start(map, {[REGION]: STATS, ["GET " + SAVED]: {measurements: [], can_change: true, baseline: null}}, {L});
        await ins.ready; await flush();
        ins.open();
        const on = panel().querySelector('[data-act="correction-on"]');
        on.checked = true;
        on.dispatchEvent(new Event("change", {bubbles: true}));
        expect(panel().textContent).toContain("Roof survey: doesn't record how it was measured, so isn't corrected");
        panel().querySelector('[data-mode="rectangle"]').click();
        drawRectangle(map);
        await flush(); await flush();
        expect(calls(fetchFn, "POST").map(c => JSON.parse(c[1].body).correction)).toEqual([null]);
        map.remove();
    });
});

describe("the Thermal Inspector's isotherms and legend", () => {
    const PALETTE = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/palette";
    const INFERNO = Array.from({length: 256}, (_, i) => ((i << 24) | (0 << 16) | ((255 - i) << 8) | 255) >>> 0);
    const change = (el, value) => {
        if (el.type === "checkbox") el.checked = value; else el.value = value;
        el.dispatchEvent(new Event("change", {bubbles: true}));
    };

    it("paints the temperatures above, below or between limits with the plugin's tiles, keeping the layer's size and crop", () => {
        const url = "/api/projects/2/tasks/abc-1/orthophoto/tiles/{z}/{x}/{y}?formula=Celsius&bands=L&rescale=10,40&size=512&crop=1&color_map=magma";
        const base = "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/isotherm/{z}/{x}/{y}?size=512&crop=1&";
        expect(inspector.isothermUrl(url, {mode: "above", low: 30, color: "red"})).toBe(base + "low=30&color=e53935");
        expect(inspector.isothermUrl(url, {mode: "below", high: 12.5, color: "blue"})).toBe(base + "high=12.5&color=1e88e5");
        expect(inspector.isothermUrl(url, {mode: "between", low: 20, high: 30, color: "green"})).toBe(base + "low=20&high=30&color=43a047");
        const dji = inspector.withPalette(url, "ironred", DISPLAY);
        expect(inspector.isothermUrl(dji, {mode: "above", low: 30, color: "red"})).toBe(base + "low=30&color=e53935");
        expect(inspector.isothermUrl(TILES, {mode: "above", low: 30, color: "red"})).toBe(
            "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/isotherm/{z}/{x}/{y}?low=30&color=e53935");
        expect(inspector.isothermUrl(url, {mode: "between", low: 30, high: 20, color: "red"})).toBe("");
        expect(inspector.isothermUrl(url, {mode: "off", color: "red"})).toBe("");
        expect(inspector.validIsotherm({mode: "above", low: NaN, color: "red"})).toBe(false);
        expect(inspector.validIsotherm({mode: "above", low: 1, color: "pink"})).toBe(false);
    });

    it("asks for a tile's values where the layer's tile is, with its size and crop", () => {
        const url = "/api/projects/2/tasks/abc-1/orthophoto/tiles/18/1/2?formula=Celsius&bands=L&rescale=10,40&size=512&crop=1&color_map=magma";
        expect(inspector.valuesUrl(url)).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/values/18/1/2?size=512&crop=1");
        expect(inspector.valuesUrl(inspector.withPalette(url, "ironred", DISPLAY))).toBe(inspector.valuesUrl(url));
        expect(inspector.valuesUrl("/elsewhere/18/1/2.png")).toBe("");
    });

    it("starts limits within the layer's range, rounded in the user's unit", () => {
        expect(inspector.defaultIsotherm("above", [10, 40], "red", "C")).toEqual({mode: "above", color: "red", low: 31});
        expect(inspector.defaultIsotherm("between", [10, 40], "red", "C")).toEqual({mode: "between", color: "red", low: 19, high: 31});
        const f = inspector.defaultIsotherm("below", [10, 40], "red", "F");
        expect(f.high).toBe(19);                                // 30% of 50..104 °F is 66.2 °F
    });

    it("draws a legend of the palette and range in the user's unit, with the isotherm's part marked", () => {
        const html = inspector.legendHtml(INFERNO, [10, 40], "DJI ironred", "C", {mode: "above", low: 32.5, color: "red"});
        document.body.innerHTML = html;
        expect(document.querySelector(".dt-legend-title").textContent).toBe("DJI ironred °C");
        expect(document.querySelector(".dt-legend-bar").style.background).toMatch(/linear-gradient/);
        expect([...document.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["10", "20", "30", "40"]);
        const mark = document.querySelector(".dt-legend-isotherm");
        expect([mark.style.left, mark.style.width]).toEqual(["75%", "25%"]);
        expect(mark.title).toBe("Above 32.50 °C");
        document.body.innerHTML = inspector.legendHtml(INFERNO, [10, 40], "magma", "F", {mode: "below", high: 0, color: "red"});
        // 10 to 40 °C is 50 to 104 °F: the ends say so, 100 would crowd 104
        expect([...document.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["50", "60", "70", "80", "90", "104"]);
        expect(document.querySelector(".dt-legend-isotherm")).toBeNull();      // below the range: nothing painted
        expect(inspector.legendHtml(INFERNO, null, "magma", "C", null)).toBe("");
    });

    it("draws the isotherm over the thermal layer, hidden with it, kept in the browser for the same tasks", async () => {
        window.localStorage.setItem("unit_system", "imperial");
        const layer = tileLayer(TILES, THERMAL_TASK, {tileSize: 512, bounds: "b"});
        layer.isHidden = function () { return !!this.hiddenNow; };
        layer.hide = function () { this.hiddenNow = true; };
        layer.show = function () { this.hiddenNow = false; };
        const map = fakeMap([layer]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        ins.open();
        change(panel().querySelector('[data-act="isotherm-mode"]'), "above");
        expect(ins.state.isotherm).toEqual({mode: "above", color: "red", low: 31});      // 87.8 °F
        change(panel().querySelector('[data-act="isotherm-low"]'), "95");
        expect(ins.state.isotherm.low).toBe(35);
        const overlay = ins.overlays()[0].overlay;
        expect(map.added).toContain(overlay);
        // Painted in the browser from the layer's values
        expect(valuesOf(overlay)).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/values/18/1/2");
        expect(drawn(overlay)).toEqual({paint: [229, 57, 53], isotherm: [35, 3e38]});
        expect(overlay.options).toMatchObject({tileSize: 512, bounds: "b", zIndex: 2, opacity: 1});
        change(panel().querySelector('[data-act="isotherm-color"]'), "blue");
        expect(drawn(overlay).paint).toEqual([30, 136, 229]);
        layer.hide();
        expect(overlay.getContainer().style.display).toBe("none");
        layer.show();
        expect(overlay.getContainer().style.display).toBe("");
        change(panel().querySelector('[data-act="isotherm-mode"]'), "between");
        expect([ins.state.isotherm.low, ins.state.isotherm.high]).toEqual([35, 40]);       // up to the range's top
        change(panel().querySelector('[data-act="isotherm-high"]'), "80");                // below the lower limit
        expect(panel().textContent).toContain("The lower limit must not be above the upper one");
        expect(ins.state.isotherm.mode).toBe("between");
        const saved = JSON.parse(window.localStorage.getItem(inspector.isothermKey(["abc-1"])));
        expect(saved.color).toBe("blue");

        // Another page of the same task
        const map2 = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const again = start(map2, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        expect(again.ins.state.isotherm).toEqual(saved);
        const first = again.ins.overlays()[0].overlay;
        expect(map2.added).toContain(first);
        again.ins.open();
        change(again.panel().querySelector('[data-act="isotherm-mode"]'), "off");
        expect(again.ins.overlays()).toEqual([]);
        expect(map2.added).not.toContain(first);
        expect(window.localStorage.getItem(inspector.isothermKey(["abc-1"]))).toBeNull();
    });

    it("shows the legend of the thermal layer's palette and range, following WebODM's range, unless the preferences hide it", async () => {
        window.localStorage.setItem("dji-thermal-inspector:legend", "1");       // where earlier versions kept it
        const layer = tileLayer(TILES, THERMAL_TASK);
        const map = fakeMap([layer]);
        const {ins, fetchFn, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        expect(window.localStorage.getItem("dji-thermal-inspector:legend")).toBeNull();
        await ins.ready;
        await flush();
        const legend = ins.legend();
        expect(legend.hidden).toBe(false);
        expect(legend.querySelector(".dt-legend-title").textContent).toBe("magma °C");
        expect([...legend.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["10", "20", "30", "40"]);
        layer.setUrl(TILES.replace("rescale=10,40", "rescale=0,100"));       // WebODM's panel
        expect([...legend.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["0", "25", "50", "75", "100"]);
        expect(fetchFn.mock.calls.filter(c => c[0].indexOf("/palette?") !== -1).length).toBe(1);   // asked for once
        // Shown or hidden in the Analyzer's Preferences, not in the panel
        ins.open();
        expect(panel().querySelector('[data-act="legend"]')).toBeNull();
        const map2 = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const again = start(map2, {[PALETTE]: {name: "magma", color_map: INFERNO},
                                   "GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {legend: false})});
        await again.ins.ready;
        await flush();
        expect(again.ins.legend().hidden).toBe(true);
    });

    it("says the image's own lowest and highest temperatures under the legend when they reach beyond its colours", async () => {
        const extent = html => { document.body.innerHTML = html; const e = document.querySelector(".dt-legend-extent"); return e && e.textContent; };
        expect(extent(inspector.legendHtml(INFERNO, [10, 40], "magma", "C", null, null, [5.04, 45]))).toBe("Image: 5–45 °C");
        expect(extent(inspector.legendHtml(INFERNO, [10, 40], "magma", "F", null, null, [5, 45]))).toBe("Image: 41–113 °F");
        expect(extent(inspector.legendHtml(INFERNO, [10, 40], "magma", "C", null, null, [10.01, 39.98]))).toBeNull();
        expect(extent(inspector.legendHtml(INFERNO, [10, 40], "magma", "C", null, null, null))).toBeNull();
        // From what WebODM's tiles say of the orthophoto, its range narrowed in WebODM's layer panel
        const layer = tileLayer(TILES, THERMAL_TASK);
        layer[Symbol.for("tile-meta")] = {statistics: {1: {min: 2.5, max: 51.25}}};
        const {ins} = start(fakeMap([layer]), {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        expect(ins.legend().querySelector(".dt-legend-extent").textContent).toBe("Image: 2.5–51.3 °C");
        layer.setUrl(TILES.replace("rescale=10,40", "rescale=2.5,51.25"));
        expect(ins.legend().querySelector(".dt-legend-extent")).toBeNull();
        expect([...ins.legend().querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["2.5", "20", "30", "40", "51.3"]);
    });
});

describe("the Thermal Inspector's panel and legend dragged over the map", () => {
    const PALETTE = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/palette";
    const rect = (el, r) => {
        el.getBoundingClientRect = () => {
            const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el.style.transform) || [0, 0, 0];
            const left = r.left + Number(m[1]), top = r.top + Number(m[2]);
            return {left, top, right: left + r.width, bottom: top + r.height, width: r.width, height: r.height};
        };
    };
    const press = (el, x, y, button = 0) => el.dispatchEvent(new MouseEvent("pointerdown", {clientX: x, clientY: y, button, bubbles: true, cancelable: true}));
    const move = (x, y) => document.dispatchEvent(new MouseEvent("pointermove", {clientX: x, clientY: y, bubbles: true, cancelable: true}));
    const release = () => document.dispatchEvent(new MouseEvent("pointerup", {bubbles: true}));

    it("moves a box by where it is grabbed, keeping it inside the map, and puts it back", () => {
        const area = document.createElement("div"), corner = document.createElement("div"), box = document.createElement("div"), link = document.createElement("a");
        corner.className = "leaflet-bottom leaflet-left";
        box.appendChild(link);
        corner.appendChild(box);
        document.body.append(area, corner);
        rect(area, {left: 0, top: 0, width: 1000, height: 600});
        rect(box, {left: 700, top: 10, width: 280, height: 300});
        const moved = [];
        const mover = inspector.movable(box, area, t => !t.closest("a"), o => moved.push(o));
        press(box, 800, 20);
        move(600, 120);
        expect(box.style.transform).toBe("translate(-200px, 100px)");
        expect(box.classList.contains("dt-moving")).toBe(true);
        const z = Number(corner.style.zIndex);
        expect(z).toBeGreaterThan(1000);                    // over the map's other controls
        move(2000, -500);                                   // kept inside the map: right and top edges
        expect(box.style.transform).toBe("translate(20px, -10px)");
        release();
        expect(box.classList.contains("dt-moving")).toBe(false);
        move(100, 100);                                     // released: no longer follows
        expect(mover.offset()).toEqual({x: 20, y: -10});
        press(link, 800, 20);                               // a link is not a handle
        move(0, 0);
        expect(mover.offset()).toEqual({x: 20, y: -10});
        release();
        press(box, 800, 20, 2);                             // nor the right button
        move(0, 0);
        expect(mover.offset()).toEqual({x: 20, y: -10});
        release();
        rect(area, {left: 0, top: 0, width: 900, height: 600});
        mover.keep();                                       // the map grew narrower
        expect(mover.offset()).toEqual({x: -80, y: -10});
        press(box, 800, 20);
        release();
        expect(Number(corner.style.zIndex)).toBeGreaterThan(z);     // grabbed again: over the one grabbed since
        mover.reset();
        expect(box.style.transform).toBe("");
        expect(corner.style.zIndex).toBe("");
        expect(moved[moved.length - 1]).toEqual({x: 0, y: 0});
    });

    it("drags the panel by its heading, the frames window with it, back in its place when opened again", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: [0, 1]}});
        await ins.ready;
        ins.open();
        const frames = map.el.querySelector(".dt-inspector-frames");
        rect(map.el, {left: 0, top: 0, width: 1200, height: 800});
        rect(panel(), {left: 880, top: 10, width: 280, height: 400});
        press(panel().querySelector(".dt-inspector-head strong"), 900, 20);
        move(600, 60);
        release();
        expect(panel().style.transform).toBe("translate(-300px, 40px)");
        expect(frames.style.transform).toBe("translate(-300px, 40px)");
        expect(frames.classList.contains("dt-inspector-frames-right")).toBe(false);
        press(panel().querySelector(".dt-inspector-head strong"), 600, 60);
        move(0, 60);                                        // to the map's left edge: no room left of it for the frames
        release();
        expect(panel().getBoundingClientRect().left).toBe(0);
        expect(frames.classList.contains("dt-inspector-frames-right")).toBe(true);
        press(panel().querySelector(".dt-inspector-readout") || panel().lastElementChild, 100, 300);   // not by its body
        move(500, 300);
        release();
        expect(panel().getBoundingClientRect().left).toBe(0);
        ins.close();
        ins.open();
        expect(panel().style.transform).toBe("");
        expect(frames.style.transform).toBe("");
        expect(frames.classList.contains("dt-inspector-frames-right")).toBe(false);
    });

    it("drags the legend by any part", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins} = start(map, {[PALETTE]: {name: "magma", color_map: [0, 1]}});
        await ins.ready;
        await flush();
        const legend = ins.legend();
        rect(map.el, {left: 0, top: 0, width: 1200, height: 800});
        rect(legend, {left: 50, top: 10, width: 220, height: 40});
        press(legend.querySelector(".dt-legend-bar"), 100, 20);
        move(400, 620);
        release();
        expect(legend.style.transform).toBe("translate(300px, 600px)");
    });
});

describe("the Thermal Inspector's workset mosaics", () => {
    const L = require("leaflet");
    const BASE = "/api/plugins/dji-thermal/datasets/d-1/conversions/abc123def456/mosaics/";
    const LIST = "GET /api/plugins/dji-thermal/projects/2/inspector/mosaics";
    const BOUNDS = [0.499, 0.499, 0.501, 0.501];
    const MOSAICS = [{dataset: {id: "d-1", name: "Roof"}, workset: {id: "abc123def456", name: "Normalized"}, unit: "F",
                      built_at: "2026-11-01T10:00:00+00:00", palettes: ["dji_ironred", "inferno"], default_palette: "inferno",
                      tabs: [{tab: "as_converted", bounds: BOUNDS, minzoom: 15, maxzoom: 21, stats: {percentiles: [50.04, 120.96]}},
                             {tab: "harmonized", bounds: BOUNDS, minzoom: 15, maxzoom: 21, stats: {percentiles: [60.01, 110]}}]}];
    const change = (el, value) => {
        if (el.type === "checkbox") el.checked = value; else el.value = value;
        el.dispatchEvent(new Event("change", {bubbles: true}));
    };

    function leafletMap(task) {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const map = L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([0.5, 0.5], 18);
        if (task) {
            const layer = L.tileLayer(TILES);
            layer[META] = {raster: true, task};
            layer.addTo(map);
        }
        map.el = div;
        return map;
    }

    // The Inspector on WebODM's map of project 2 (tiles: the tasks it shows), the project's mosaics as routes give them
    function begin(map, tiles, routes, extra) {
        const plugins = {Map: {onHandleClick: jest.fn(), sideBySideChanged: jest.fn()}};
        const fetchFn = server(Object.assign({"GET /api/plugins/dji-thermal/display": Object.assign({}, DISPLAY, {palette: "ironred"}),
                                              [LIST]: {mosaics: MOSAICS}}, routes));
        const ins = inspector.create({map, tiles}, L, Object.assign({fetch: fetchFn, storage: window.localStorage, doc: document,
                                     pluginsApi: plugins, save() {}, path: "/map/project/2/", search: ""}, extra));
        return {ins, fetchFn, plugins, panel: () => map.el.querySelector(".dt-inspector-panel"),
                button: () => map.el.querySelector(".dt-inspector"), laid: () => Object.values(map._layers).filter(l => l.__dtMosaic)};
    }

    it("asks for the user's preferences only where the map has temperatures, never on a public map", async () => {
        const asked = s => s.fetchFn.mock.calls.filter(c => c[0].endsWith("/display")).length;
        const rgb = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, RGB_TASK)}}];
        const thermal = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}];
        // An RGB map of a project without mosaics: nothing more than the mosaics asked for
        let s = begin(leafletMap(), rgb, {[LIST]: {mosaics: []}});
        await s.ins.mosaicsReady;
        expect(asked(s)).toBe(0);
        // with mosaics: asked, before one could be laid
        s = begin(leafletMap(), rgb);
        await s.ins.mosaicsReady;
        expect(asked(s)).toBe(1);
        // a thermal orthophoto: asked once
        s = begin(leafletMap(THERMAL_TASK), thermal);
        await s.ins.mosaicsReady;
        expect(asked(s)).toBe(1);
        // A public map, thermal: its viewer may not be logged in; the legend shown
        s = begin(leafletMap(THERMAL_TASK), thermal, {}, {path: "/public/task/1f0a/map/"});
        await s.ins.mosaicsReady;
        expect(s.fetchFn).not.toHaveBeenCalledWith(expect.stringContaining("/display"), expect.anything());
        expect(s.ins.state.legendVisible).toBe(true);
    });

    it("shows Mosaic Overlays only when the project has built workset mosaics", async () => {
        const tasks = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}];
        let s = begin(leafletMap(THERMAL_TASK), tasks, {[LIST]: {mosaics: []}});
        await s.ins.mosaicsReady;
        s.ins.open();
        expect(s.panel().textContent).not.toContain("Mosaic Overlays");
        expect(s.panel().querySelector(".dt-inspector-mosaic")).toBe(null);
        s = begin(leafletMap(THERMAL_TASK), tasks);
        await s.ins.mosaicsReady;
        s.ins.open();
        expect(s.panel().textContent).toContain("Mosaic Overlays");
    });

    it("shows its button only where the map has temperatures: a thermal orthophoto or a linked mosaic, not an RGB map with mosaics", async () => {
        const rgb = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, RGB_TASK)}}];
        const thermal = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}];
        // An RGB orthophoto of a project with workset mosaics: no temperatures on the map
        let s = begin(leafletMap(), rgb);
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("none");
        // A project without tasks on its map (the project from the URL): none either
        s = begin(leafletMap(), [], {}, {path: "/map/project/2/"});
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("none");
        // A thermal orthophoto, with or without mosaics
        s = begin(leafletMap(THERMAL_TASK), thermal, {[LIST]: {mosaics: []}});
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("");
        expect(s.panel().hidden).toBe(true);      // opened only when asked
        // The Analyzer's "Open on WebODM's map" on an RGB map: the mosaic laid, the button there to close and reopen
        s = begin(leafletMap(), rgb, {}, {search: "?dt-mosaic=d-1%2Fabc123def456"});
        await s.ins.mosaicsReady;
        expect(s.laid().length).toBe(1);
        expect(s.button().style.display).toBe("");
        s.ins.close();
        expect(s.button().style.display).toBe("");
        // Lifted in the panel, it can be laid again until the panel closes; then the RGB map has no button
        s.ins.open();
        change(s.panel().querySelector('[data-act="mosaic-on"]'), false);
        expect(s.laid().length).toBe(0);
        expect(s.button().style.display).toBe("");
        s.ins.close();
        expect(s.button().style.display).toBe("none");
        // WebODM's public maps have no workset mosaics: not asked for
        s = begin(leafletMap(), rgb, {}, {path: "/public/task/1f0a/map/"});
        await s.ins.mosaicsReady;
        expect(s.fetchFn.mock.calls.some(c => c[0].includes("/inspector/mosaics"))).toBe(false);
        expect(s.button().style.display).toBe("none");
    });

    it("lays a workset's mosaic on the map in the user's palette, reads it in °C and swipes it with WebODM's split control", async () => {
        const map = leafletMap(THERMAL_TASK);
        const point = jest.fn(() => jsonResponse({valid: true, temperature: 104, unit: "F", frame: "DJI_0001_T.JPG"}));
        const region = jest.fn(() => jsonResponse({valid: true, reason: null, pixel_size: 0.1, resampled: false, statistics: {
            count: 4, min: 20, max: 40, mean: 30, std: 2, median: 30, percentiles: {"2": 21, "98": 39},
            histogram: {counts: [2, 2], edges: [20, 30, 40]}, min_location: [0.5, 0.5], max_location: [0.5, 0.5]}}));
        const {ins, plugins, panel, laid} = begin(map, [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}],
                                                  {["GET " + BASE + "as_converted/point"]: point, ["POST " + BASE + "as_converted/region"]: region});
        await ins.mosaicsReady;
        ins.open();
        expect(panel().querySelector(".dt-inspector-mosaic").textContent).toContain("Roof › Normalized");
        change(panel().querySelector('[data-act="mosaic-on"]'), true);
        const layer = laid()[0];
        // Drawn from the Analyzer's values (kept until it is built again), in DJI's ironred (the user's) over the tab's
        // 2nd to 98th percentile (°F, the mosaic's unit)
        expect(valuesOf(layer)).toBe(BASE + "as_converted/values/18/1/2.png?v=2026-11-01T10%3A00%3A00%2B00%3A00");
        expect([layer.__dtMosaic.key, layer.__dtMosaic.range]).toEqual(["dji_ironred", [50, 121]]);
        expect(layer.options.zIndex).toBeGreaterThan(100);

        map.setView([0.5, 0.5], 18);
        map.fire("mousemove", {latlng: L.latLng(0.5, 0.5)});
        await new Promise(r => setTimeout(r, 120));
        await flush();
        expect(point.mock.calls[0][0]).toContain(BASE + "as_converted/point?lon=0.50000000&lat=0.50000000");
        expect(panel().querySelector(".dt-inspector-readout").textContent).toBe("40.00 °C");

        // A region over it reads the mosaic's
        panel().querySelector('[data-mode="rectangle"]').click();
        map.fire("mousedown", {latlng: map.containerPointToLatLng(L.point(10, 10)), originalEvent: {button: 0}});
        document.dispatchEvent(new MouseEvent("mouseup", {clientX: 60, clientY: 50}));
        await flush(); await flush();
        expect(region).toHaveBeenCalledTimes(1);

        change(panel().querySelector('[data-act="mosaic-tab"]'), "harmonized");
        expect(valuesOf(layer)).toContain(BASE + "harmonized/values/");
        expect(layer.__dtMosaic.range).toEqual([60, 110]);
        change(panel().querySelector('[data-act="mosaic-opacity"]'), "40");
        expect(layer.options.opacity).toBe(0.4);
        panel().querySelector('[data-act="mosaic-swipe"]').click();
        expect(plugins.Map.sideBySideChanged).toHaveBeenLastCalledWith(layer, true);
        // Its isotherm is clipped as WebODM's divider clips it
        change(panel().querySelector('[data-act="isotherm-mode"]'), "above");
        const overlay = ins.overlays().find(o => o.layer === layer).overlay;
        expect(valuesOf(overlay)).toContain(BASE + "harmonized/values/");
        expect(drawn(overlay).isotherm[0]).toBeCloseTo(ins.state.isotherm.low * 1.8 + 32, 9);      // °F, the mosaic's unit
        layer.getContainer().style.clip = "rect(0px, 500px, 400px, 200px)";
        await flush();
        expect(overlay.getContainer().style.clip).toBe("rect(0px, 500px, 400px, 200px)");
        // Lifted while swiped: off WebODM's split control first
        change(panel().querySelector('[data-act="mosaic-on"]'), false);
        expect(plugins.Map.sideBySideChanged).toHaveBeenLastCalledWith(layer, false);
        expect(map.hasLayer(layer)).toBe(false);
        expect(laid().length).toBe(0);
        map.remove();
    });

    it("opens with the mosaic a link asks for laid on the map", async () => {
        const map = leafletMap();
        const {ins, panel, laid} = begin(map, [], {}, {search: "?dt-mosaic=d-1%2Fabc123def456/harmonized"});
        await ins.mosaicsReady;
        expect(ins.state.open).toBe(true);
        expect(laid()[0].__dtMosaic.tab).toBe("harmonized");
        expect(panel().querySelector('[data-act="mosaic-on"]').checked).toBe(true);
        map.remove();
    });

    // The frames that saw a point, as the Analyzer's API lists them
    const FOOTPRINT = [[0.499, 0.499], [0.501, 0.499], [0.501, 0.501], [0.499, 0.501]];
    const FRAMES = {models: true, frames: [
        {index: 3, file: "DJI_0003_T.JPG", x: 100, y: 50, width: 640, height: 512, view_angle: 8.25, footprint: FOOTPRINT, source: true},
        {index: 5, file: "DJI_0005_T.JPG", x: 300, y: 250, width: 640, height: 512, view_angle: 2.5, footprint: FOOTPRINT, source: false}]};
    const frameBox = map => map.el.querySelector(".dt-inspector-frames");
    const pip = (map, action) => frameBox(map).querySelector('[data-pip="' + action + '"]').click();

    it("shows the frames that saw a point clicked on a mosaic beside the panel, drawn as the mosaic is", async () => {
        const map = leafletMap();
        const frames = jest.fn(() => jsonResponse(FRAMES));
        const {ins, panel, laid} = begin(map, [], {["GET " + BASE + "as_converted/frames"]: frames, ["GET " + BASE + "harmonized/frames"]: frames});
        await ins.mosaicsReady;
        ins.open();
        change(panel().querySelector('[data-act="mosaic-on"]'), true);
        expect(panel().querySelector(".dt-inspector-readout").textContent).toContain("Click it to see the frames that saw the point");

        // A click in Hover is the Inspector's, not WebODM's popup
        expect(ins.click({latlng: L.latLng(0.5, 0.5)})).toBe(true);
        await flush(); await flush();
        expect(frames.mock.calls[0][0]).toBe(BASE + "as_converted/frames?lon=0.5&lat=0.5");
        expect(frameBox(map).hidden).toBe(false);
        expect(frameBox(map).textContent).toContain("Frame 1 of 2 that saw this point");
        expect(frameBox(map).textContent).toContain("The mosaic's pixel here comes from this frame");
        expect(frameBox(map).querySelector('[data-pip="open"]').getAttribute("href"))
            .toBe("/plugins/dji-thermal/dataset/d-1/conversion/abc123def456/frame?frame=DJI_0003_T.JPG&list=mosaic");
        expect(frameBox(map).querySelector("img").getAttribute("src"))
            .toBe(BASE + "as_converted/frames/3.png?v=2026-11-01T10%3A00%3A00%2B00%3A00&color_map=dji_ironred&rescale=50,121");
        pip(map, "next");
        expect(frameBox(map).textContent).toContain("Frame 2 of 2");
        expect(frameBox(map).querySelector("img").getAttribute("src")).toContain(BASE + "as_converted/frames/5.png?");

        // Drawn again in the palette chosen; on another tab, its frames, the one shown kept
        change(panel().querySelector('[data-act="palette"]'), "inferno");
        expect(frameBox(map).querySelector("img").getAttribute("src")).toContain("color_map=inferno&");
        change(panel().querySelector('[data-act="mosaic-tab"]'), "harmonized");
        await flush(); await flush();
        expect(frames.mock.calls[1][0]).toContain(BASE + "harmonized/frames?");
        expect(frameBox(map).querySelector("img").getAttribute("src")).toMatch(/harmonized\/frames\/5\.png\?.*rescale=60,110$/);

        pip(map, "close");
        expect(frameBox(map).hidden).toBe(true);
        // Gone with the mosaic lifted
        ins.click({latlng: L.latLng(0.5, 0.5)});
        await flush(); await flush();
        expect(frameBox(map).hidden).toBe(false);
        change(panel().querySelector('[data-act="mosaic-on"]'), false);
        expect(laid().length).toBe(0);
        expect(frameBox(map).hidden).toBe(true);
        map.remove();
    });

    it("drags the frames window by its heading on its own, where it stays as the panel moves, back beside the panel once closed", async () => {
        const rect = (el, r) => {
            el.getBoundingClientRect = () => {
                const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el.style.transform) || [0, 0, 0];
                const left = r.left + Number(m[1]), top = r.top + Number(m[2]);
                return {left, top, right: left + r.width, bottom: top + r.height, width: r.width, height: r.height};
            };
        };
        const press = (el, x, y) => el.dispatchEvent(new MouseEvent("pointerdown", {clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true}));
        const move = (x, y) => document.dispatchEvent(new MouseEvent("pointermove", {clientX: x, clientY: y, bubbles: true, cancelable: true}));
        const release = () => document.dispatchEvent(new MouseEvent("pointerup", {bubbles: true}));
        const map = leafletMap();
        const frames = jest.fn(() => jsonResponse(FRAMES));
        const {ins, panel} = begin(map, [], {["GET " + BASE + "as_converted/frames"]: frames});
        await ins.mosaicsReady;
        ins.open();
        change(panel().querySelector('[data-act="mosaic-on"]'), true);
        ins.click({latlng: L.latLng(0.5, 0.5)});
        await flush(); await flush();
        rect(map.getContainer(), {left: 0, top: 0, width: 1200, height: 800});
        rect(panel(), {left: 880, top: 10, width: 280, height: 400});
        rect(frameBox(map), {left: 556, top: 10, width: 300, height: 300});

        // Not by its buttons; by its heading, kept inside the map
        press(frameBox(map).querySelector('[data-pip="next"]'), 700, 20);
        move(400, 300);
        release();
        expect(frameBox(map).style.transform).toBe("");
        press(frameBox(map).querySelector(".ta-pip-title"), 600, 20);
        move(100, 2000);
        release();
        expect(frameBox(map).style.transform).toBe("translate(-500px, 490px)");

        // The panel moved, a frame stepped to or another point clicked: it stays where it was dropped
        press(panel().querySelector(".dt-inspector-head strong"), 900, 20);
        move(800, 60);
        release();
        expect(panel().style.transform).toBe("translate(-100px, 40px)");
        pip(map, "next");
        ins.click({latlng: L.latLng(0.5, 0.5)});
        await flush(); await flush();
        expect(frameBox(map).style.transform).toBe("translate(-500px, 490px)");

        // Closed, it opens beside the panel again
        pip(map, "close");
        ins.click({latlng: L.latLng(0.5, 0.5)});
        await flush(); await flush();
        expect(frameBox(map).style.transform).toBe("translate(-100px, 40px)");
        map.remove();
    });

    it("shows the frames of the workset an orthophoto was processed from, by view angle, in the orthophoto's palette and range", async () => {
        const map = leafletMap(THERMAL_TASK);
        const tiles = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}];
        const frames = jest.fn(() => jsonResponse(FRAMES));
        const point = jest.fn(() => jsonResponse({valid: true, temperature: 30}));
        const made = [Object.assign({}, MOSAICS[0], {tasks: ["abc-1"]})];
        const {ins} = begin(map, tiles, {[LIST]: {mosaics: made}, ["GET " + BASE + "as_converted/frames"]: frames, [POINT]: point});
        await ins.mosaicsReady;
        ins.open();
        expect(ins.click({latlng: L.latLng(0.5, 0.5)})).toBe(true);
        await flush(); await flush();
        // ODM blended the frames: none is the pixel's own, the one closest to straight down first, placed approximately
        expect(frameBox(map).querySelector("img").getAttribute("src"))
            .toBe(BASE + "as_converted/frames/5.png?v=2026-11-01T10%3A00%3A00%2B00%3A00&color_map=dji_ironred&rescale=50,104");
        expect(frameBox(map).textContent).not.toContain("comes from this frame");
        expect(frameBox(map).textContent).toContain("not ODM's cameras");

        // A pin shows them too
        ins.setMode("pin");
        ins.click({latlng: L.latLng(0.5005, 0.4995)});
        await flush(); await flush();
        expect(frames.mock.calls[1][0]).toContain("lat=0.5005");
        expect(ins.state.pins.length).toBe(1);
        map.remove();
    });

    it("leaves a click on an orthophoto from elsewhere to WebODM", async () => {
        const map = leafletMap(THERMAL_TASK);
        const tiles = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}];
        const {ins, fetchFn, panel} = begin(map, tiles, {[LIST]: {mosaics: [Object.assign({}, MOSAICS[0], {tasks: ["other"]})]}});
        await ins.mosaicsReady;
        ins.open();
        expect(panel().querySelector(".dt-inspector-readout").textContent).toBe("Move the cursor over a thermal layer.");
        expect(ins.click({latlng: L.latLng(0.5, 0.5)})).toBe(false);
        expect(fetchFn.mock.calls.some(c => c[0].includes("/frames"))).toBe(false);
        map.remove();
    });

    it("reads the project, the linked mosaic and the palette a mosaic is drawn in", () => {
        expect(inspector.projectOf([{meta: {task: {project: 7}}}], "/map/project/2/")).toBe("7");
        expect(inspector.projectOf([], "/map/project/2/task/abc/")).toBe("2");
        expect(inspector.projectOf([{meta: {task: {project: 7}}}], "/public/project/xyz/map/")).toBe(null);
        expect(inspector.linkedMosaic("?a=1&dt-mosaic=d-1%2Fabc/source_frame")).toEqual({dataset: "d-1", workset: "abc", tab: "source_frame"});
        expect(inspector.linkedMosaic("?dt-mosaic=d-1/abc/view_angle")).toEqual({dataset: "d-1", workset: "abc", tab: null});
        expect(inspector.linkedMosaic("?dt-mosaic=d-1")).toBe(null);
        const m = MOSAICS[0];
        expect(inspector.paletteKey(m, "ironred", DISPLAY)).toBe("dji_ironred");
        expect(inspector.paletteKey(m, "inferno", DISPLAY)).toBe("inferno");
        // One the workset doesn't have: its own
        expect(inspector.paletteKey(m, "magma", DISPLAY)).toBe("inferno");
        expect(inspector.mosaicRange({stats: {percentiles: [20.04, 20.06]}})).toEqual([20, 20.1]);
        expect(inspector.mosaicRange({stats: {percentiles: [20, 20]}})).toEqual([20, 21]);
        const info = inspector.laidMosaic(2, m, "harmonized", "ironred", DISPLAY);
        expect(inspector.mosaicValuesUrl(info, {z: 18, x: 1, y: 2})).toBe(BASE + "harmonized/values/18/1/2.png?v=2026-11-01T10%3A00%3A00%2B00%3A00");
        // An isotherm (°C) paints a mosaic's values in its unit, in its colour
        const painted = inspector.isothermStyle({mode: "between", low: 20, high: 30, color: "blue"}, "F");
        expect(painted.paint).toEqual([30, 136, 229]);
        expect(painted.isotherm[0]).toBeCloseTo(68, 9);
        expect(painted.isotherm[1]).toBeCloseTo(86, 9);
        expect(inspector.isothermStyle({mode: "above", low: 20, color: "red"})).toEqual({paint: [229, 57, 53], isotherm: [20, 3e38]});
        expect(inspector.isothermStyle({mode: "below", high: 5, color: "red"}).isotherm).toEqual([-3e38, 5]);
        expect(inspector.isothermStyle({mode: "off", color: "red"})).toBeNull();
        expect(inspector.toCelsius(212, "F")).toBe(100);
        expect(inspector.toCelsius(300, "K")).toBeCloseTo(26.85);
    });
});

describe("the Thermal Inspector's colour scale and Image section", () => {
    const PALETTE = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/palette";
    const HISTOGRAM = "GET /api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/histogram";
    const PLUGIN = "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/tiles/";
    const INFERNO = Array.from({length: 256}, (_, i) => ((i << 24) | ((255 - i) << 8) | 255) >>> 0);
    const change = (el, value) => { el.value = value; el.dispatchEvent(new Event("change", {bubbles: true})); };
    const slide = (el, value) => { el.value = value; el.dispatchEvent(new Event("input", {bubbles: true})); };
    const field = (panel, act) => panel.querySelector('[data-act="' + act + '"]');
    const ticks = el => [...el.querySelectorAll(".dt-tick")].map(t => t.textContent);
    // WebODM's tiles say the orthophoto's 2nd and 98th percentiles and its lowest and highest temperatures
    const orthophoto = () => {
        const layer = tileLayer(TILES, THERMAL_TASK);
        layer[Symbol.for("tile-meta")] = {statistics: {1: {min: 2.5, max: 51.25, percentiles: [12.34, 38.01]}}};
        return layer;
    };

    it("draws an orthophoto with adjustments by the plugin's tiles, and by WebODM's again in its colour maps without", () => {
        const adjusted = inspector.withPalette(TILES, "magma", DISPLAY, {gamma: 1.5, equalize: true, sharpen: 2});
        expect(adjusted).toBe(PLUGIN + "{z}/{x}/{y}.png?formula=Celsius&bands=L&rescale=10,40&palette=magma&gamma=1.5&equalize=1&sharpen=2");
        expect(inspector.adjustOf(adjusted)).toEqual({gamma: 1.5, equalize: true, sharpen: 2});
        expect(inspector.withPalette(adjusted, "magma", DISPLAY, {gamma: 1, equalize: false, sharpen: 0})).toBe(TILES.replace("color_map=magma&", "") + "&color_map=magma");
        expect(inspector.withPalette(adjusted, "ironred", DISPLAY)).toBe(PLUGIN + "{z}/{x}/{y}.png?formula=Celsius&bands=L&rescale=10,40&palette=ironred");
        expect(inspector.adjustOf(TILES)).toEqual({gamma: 1, equalize: false, sharpen: 0});
    });

    it("finds a layer's Auto range: an orthophoto's percentiles rounded outwards in the user's unit, a mosaic's own", () => {
        const t = inspector.thermalLayer(orthophoto());
        expect(inspector.autoRange(t, "C")).toEqual([12.3, 38.1]);
        // 54.212 to 100.418 °F, rounded to 54.2 and 100.5 °F
        expect(inspector.autoRange(t, "F")).toEqual([12.333333, 38.055556]);
        expect(inspector.autoRange(inspector.thermalLayer(tileLayer(TILES, THERMAL_TASK)), "C")).toBeNull();
        expect(inspector.autoRange({mosaic: {unit: "F", range: [50, 68], auto: [32, 212]}}, "C")).toEqual([0, 100]);
    });

    it("keeps the heading, modes, readout, Palette and the scale in the panel's top, which stays in view as the rest scrolls", async () => {
        const map = fakeMap([orthophoto()]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        ins.open();
        const top = panel().querySelector(".dt-inspector-top");
        expect(top).toBe(panel().firstElementChild);
        for (const part of [".dt-inspector-head", ".dt-inspector-modes", ".dt-inspector-readout", '[data-act="palette"]', ".dt-inspector-scale"]) {
            expect(top.querySelector(part)).not.toBeNull();
        }
        // The correction, the legend's tickbox, Image and the sections below scroll under it
        expect(top.querySelector('[data-act="legend"]')).toBeNull();
        expect(top.querySelector(".dt-inspector-image, .dt-inspector-section")).toBeNull();
        expect(top.nextElementSibling.querySelector('[data-act="correction-emissivity"]')).not.toBeNull();
        expect(top.querySelector('[data-act="correction-on"]')).toBeNull();
    });

    it("shows the topmost layer's scale, range and lowest and highest temperatures under Palette, the range typed or Auto", async () => {
        const layer = orthophoto();
        const map = fakeMap([layer]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        ins.open();
        const scale = panel().querySelector(".dt-inspector-scale");
        expect(ticks(scale)).toEqual(["10", "20", "30", "40"]);
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["10", "40"]);
        expect(scale.textContent).toContain("This layer: 2.5 to 51.3 °C");
        expect(scale.textContent).not.toContain("Of ");       // one thermal layer: no need to say which
        field(panel(), "range-min").value = "15";
        change(field(panel(), "range-max"), "35");
        expect(inspector.rangeOf(layer._url)).toEqual([15, 35]);
        expect(layer._url).toContain("color_map=magma");      // still WebODM's tiles
        expect(ticks(ins.legend())).toEqual(["15", "20", "25", "30", "35"]);
        // The arrows between the fields widen and narrow the range by a tenth of it, about its middle
        field(panel(), "range-wider").click();
        expect(inspector.rangeOf(layer._url)).toEqual([14, 36]);
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["14", "36"]);
        field(panel(), "range-narrow").querySelector("i").click();
        expect(inspector.rangeOf(layer._url)).toEqual([15.1, 34.9]);
        // Raise and Lower move it by a tenth of its width, the width kept, never past the layer's highest and lowest
        // temperatures (2.5 to 51.25 °C): the last step only as far as them
        field(panel(), "range-min").value = "40";
        change(field(panel(), "range-max"), "50");
        field(panel(), "range-raise").click();
        expect(inspector.rangeOf(layer._url)).toEqual([41, 51]);
        field(panel(), "range-raise").querySelector("i").click();
        expect(inspector.rangeOf(layer._url)).toEqual([41.25, 51.25]);
        field(panel(), "range-raise").click();
        expect(inspector.rangeOf(layer._url)).toEqual([41.25, 51.25]);
        field(panel(), "range-min").value = "3";
        change(field(panel(), "range-max"), "13");
        field(panel(), "range-lower").click();
        expect(inspector.rangeOf(layer._url)).toEqual([2.5, 12.5]);
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["2.5", "12.5"]);
        field(panel(), "range-min").value = "15";
        change(field(panel(), "range-max"), "35");
        change(field(panel(), "range-max"), "12");
        expect(panel().textContent).toContain("The maximum must be above the minimum");
        expect(inspector.rangeOf(layer._url)).toEqual([15, 35]);
        field(panel(), "range-auto").click();
        expect(inspector.rangeOf(layer._url)).toEqual([12.3, 38.1]);
        expect(panel().textContent).not.toContain("The maximum must be above the minimum");
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["12.3", "38.1"]);
    });

    it("colours the tiles again from their values while a slider moves: brightness and contrast move the range, no requests", async () => {
        const layer = orthophoto();
        const map = fakeMap([layer]);
        const {ins, panel, fetchFn} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        ins.open();
        // WebODM's layer drawn from values (its tiles drawn again once), in the layer's palette
        expect(valuesOf(layer)).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/values/18/1/2");
        expect(drawn(layer)).toMatchObject({colors: INFERNO, range: [10, 40], shares: null, sharpen: 0, seams: false});
        const redraws = layer.redraws, asked = fetchFn.mock.calls.length, recoloured = jest.spyOn(layer, "recolour");
        field(panel(), "range-auto").click();
        const contrast = field(panel(), "image-contrast");
        slide(contrast, "1");       // half as wide around Auto's middle: 18.75 to 31.65 °C
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["18.8", "31.7"]);
        expect(ticks(ins.legend())[0]).toBe("18.8");
        expect(inspector.rangeOf(layer._url)).toEqual([18.75, 31.65]);
        expect(drawn(layer).range).toEqual([18.75, 31.65]);
        expect(recoloured).toHaveBeenCalled();
        expect(field(panel(), "image-contrast")).toBe(contrast);          // the panel isn't drawn again under the cursor
        change(contrast, "1");
        expect(inspector.rangeOf(layer._url)).toEqual([18.75, 31.65]);
        const gamma = field(panel(), "image-gamma");
        slide(gamma, "1");
        expect(field(panel(), "image-gamma-value").textContent).toBe("2.00");
        expect(drawn(layer).shares[16]).toBeCloseTo(0.5, 12);
        change(gamma, "1");
        expect([layer.redraws, fetchFn.mock.calls.length]).toEqual([redraws, asked]);
        expect(layer._url).toContain(PLUGIN);
        expect(inspector.adjustOf(layer._url)).toEqual({gamma: 2, equalize: false, sharpen: 0});
        expect(inspector.paletteOf(layer._url)).toBe("magma");
        expect(ins.legend().querySelector(".dt-legend-bar").style.background).toMatch(/linear-gradient/);
    });

    it("equalizes along the orthophoto's histogram, asked for once, and Reset draws Auto's range without adjustments", async () => {
        const layer = orthophoto();
        const map = fakeMap([layer]);
        const H = {counts: [1, 2, 3, 0], edges: [0, 10, 20, 30, 40]};
        const histogram = jest.fn(() => jsonResponse(H));
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}, [HISTOGRAM]: histogram});
        await ins.ready;
        await flush();
        ins.open();
        change(field(panel(), "image-tone"), "equalize");
        expect(inspector.adjustOf(layer._url).equalize).toBe(true);
        await flush();
        const curve = Recolour.curveShares(10, 40, {gamma: 1}, Recolour.equalization(H, 10, 40));
        expect(drawn(layer).shares).toEqual(curve);
        const stops = ins.legend().querySelector(".dt-legend-bar").style.background.match(/rgb\(/g) || [];
        expect(stops.length).toBe(65);      // one stop per share of the curve
        change(field(panel(), "range-max"), "30");
        expect(drawn(layer).shares).toEqual(Recolour.curveShares(10, 30, {gamma: 1}, Recolour.equalization(H, 10, 30)));
        expect(histogram).toHaveBeenCalledTimes(1);
        expect(field(panel(), "image-tone").value).toBe("equalize");
        field(panel(), "image-reset").click();
        expect(layer._url).toBe(TILES.replace("color_map=magma&rescale=10,40", "rescale=12.3,38.1&color_map=magma"));
        expect(field(panel(), "image-tone").value).toBe("linear");
    });

    it("keeps the range in step with WebODM's layer panel both ways, and its adjustments when a colour map is chosen there", async () => {
        const layer = orthophoto();
        const map = fakeMap([layer]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        ins.open();
        const panelSets = (colorMap, rescale) => layer.setUrl(layer._url.replace(/\?.*$/, "") +
            "?color_map=" + colorMap + "&formula=Celsius&bands=L&rescale=" + rescale + "&size=512&crop=1", true);
        panelSets("magma", "5,45");     // a range set in WebODM's panel shows in the Inspector's
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["5", "45"]);
        change(field(panel(), "range-max"), "30");
        change(field(panel(), "image-sharpen"), "1.5");
        expect(layer._url).toContain(PLUGIN);
        // WebODM's panel sends its own range again with a colour map chosen there: the Inspector's range and
        // adjustments stay
        panelSets("jet", "5,45");
        expect(inspector.paletteOf(layer._url)).toBe("jet");
        expect(inspector.rangeOf(layer._url)).toEqual([5, 30]);
        expect(inspector.adjustOf(layer._url).sharpen).toBe(1.5);
        panelSets("jet", "0,50");
        expect(inspector.rangeOf(layer._url)).toEqual([0, 50]);
        expect(field(panel(), "range-max").value).toBe("50");
    });

    it("gives each thermal layer its own range and adjustments, the topmost's shown, a mosaic's in its tiles and frames", async () => {
        const below = orthophoto();
        const map = fakeMap([below]);
        const {ins, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO},
                                         "GET /api/plugins/dji-thermal/projects/2/inspector/palette": {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        ins.open();
        change(field(panel(), "image-sharpen"), "2");
        expect(inspector.adjustOf(below._url).sharpen).toBe(2);
        // A mosaic laid above it: its own range (°F) and no adjustments
        const info = {project: "2", dataset: "d-1", workset: "w-1", tab: "as_converted", unit: "F", built_at: "b", key: "magma",
                      range: [50, 104], auto: [50, 104], adjust: {gamma: 1, equalize: false, sharpen: 0}, extent: null, name: "Roof › W"};
        const mosaic = fakeLeaflet().gridLayer({zIndex: 1000});
        mosaic.__dtMosaic = info;
        ins.state.mosaics = [{dataset: {id: "d-1", name: "Roof"}, workset: {id: "w-1", name: "W"}, palettes: ["magma"], default_palette: "magma", tabs: []}];
        map.add(mosaic);
        expect(panel().querySelector(".dt-inspector-scale").textContent).toContain("Of Roof › W › Mosaic");
        expect([field(panel(), "range-min").value, field(panel(), "range-max").value]).toEqual(["10", "40"]);
        expect(field(panel(), "image-sharpen").value).toBe("0");
        change(field(panel(), "image-gamma"), "-1");
        expect(mosaic.__dtMosaic).toMatchObject({range: [50, 104], adjust: {gamma: 0.5, equalize: false, sharpen: 0}});
        expect(inspector.framesSource(inspector.thermalLayer(mosaic)).query).toContain("&gamma=0.5");
        expect(inspector.adjustOf(below._url)).toEqual({gamma: 1, equalize: false, sharpen: 2});
        // The orthophoto's frames are drawn with its adjustments too
        const frames = inspector.framesSource(inspector.thermalLayer(below), [{dataset: {id: "d-1", name: "Roof"}, workset: {id: "w-1", name: "W"},
            unit: "C", built_at: "b", palettes: ["magma"], default_palette: "magma", tasks: ["abc-1"], tabs: [{tab: "as_converted", stats: {}}]}], "magma", DISPLAY);
        expect(frames.query).toContain("&sharpen=2");
    });
});
