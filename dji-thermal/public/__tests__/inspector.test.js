// The Thermal Inspector on WebODM's 2D map (inspector.js), on a fake Leaflet map with WebODM's layer metadata
const inspector = require("../inspector.js");

const META = Symbol.for("meta");
const TILES = "/api/projects/2/tasks/abc-1/orthophoto/tiles/{z}/{x}/{y}.png?formula=Celsius&bands=L&color_map=magma&rescale=10,40";
const THERMAL_TASK = {id: "abc-1", orthophoto_bands: [{name: "gray", description: "lwir"}, {name: "alpha", description: null}]};
const RGB_TASK = {id: "rgb-2", orthophoto_bands: [{name: "red"}, {name: "green"}, {name: "blue"}]};

const flush = () => new Promise(r => setTimeout(r, 0));
const jsonResponse = (data, ok = true) => Promise.resolve({ok, json: () => Promise.resolve(data)});

function tileLayer(url, task, opts) {
    const layer = {_url: url, options: Object.assign({zIndex: 1}, opts), redraws: 0,
                   setUrl(u) { this._url = u; }, redraw() { this.redraws++; }, _removeAllTiles() {}};
    layer[META] = {raster: true, task};
    return layer;
}

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
        expect(inspector.thermalLayerAt(map, {lat: 1, lng: 2})).toEqual({project: "2", task: "abc-1", layer: low});
        expect(inspector.pointUrl({project: "2", task: "abc-1"}, {lat: 42.1, lng: -88.07})).toBe(
            "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/point?lon=-88.07000000&lat=42.10000000");
    });

    it("shows temperatures in WebODM's units", () => {
        expect(inspector.formatTemp(21.5)).toBe("21.50 °C");
        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.formatTemp(21.5)).toBe("70.70 °F");
        expect(inspector.formatTemp(null)).toBe("");
        expect(inspector.readoutHtml({valid: false, reason: "excluded"}, "C")).toContain("Outside the task&#39;s crop");
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
        map.fire("mousemove", {latlng: {lat: 42.1, lng: -88.07}});
        map.fire("mousemove", {latlng: {lat: 42.2, lng: -88.07}});
        jest.advanceTimersByTime(100);
        jest.useRealTimers();
        await flush(); await flush();
        expect(fetchFn.mock.calls.filter(c => c[0].indexOf("/point") >= 0).map(c => c[0])).toEqual([
            "/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/point?lon=-88.07000000&lat=42.20000000"]);
        expect(panel().querySelector(".dt-inspector-readout").textContent).toBe("52.50 °C");
        expect(map.el.querySelector(".dt-inspector-cursor").textContent).toBe("52.50 °C");
    });

    it("pins points with their temperature, kept in the browser for the same tasks, and exports them", async () => {
        const map = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const {ins, plugins, panel} = start(map, {[POINT]: {valid: true, temperature: 30}});
        ins.open();
        const click = plugins.Map.onHandleClick.mock.calls[0][0];
        expect(click({latlng: {lat: 42.1, lng: -88.07}})).toBe(false);        // hovering: WebODM's click
        panel().querySelector('[data-mode="pin"]').click();
        expect(map.el.style.cursor).toBe("crosshair");
        expect(click({latlng: {lat: 42.1, lng: -88.07}})).toBe(true);
        await flush(); await flush();
        expect(panel().querySelector(".dt-inspector-pins").textContent).toContain("P130.00 °C");
        const pins = map.added[1];      // above the regions
        expect(pins.layers.map(m => m.tooltip)).toEqual(["P1: 30.00 °C"]);
        const key = inspector.pinsKey(["abc-1"]);
        expect(JSON.parse(window.localStorage.getItem(key))[0]).toMatchObject({label: "P1", lat: 42.1, lng: -88.07, temperature: 30});

        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.pinsCsv(inspector.loadPins(window.localStorage, key), "F")).toBe(
            "label,latitude,longitude,temperature_f\nP1,42.10000000,-88.07000000,86.000\n");
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
        histogram: {counts: [100, 200, 100], edges: [10, 23, 36, 50]}, min_location: [-88.0701, 42.0001], max_location: [-88.0702, 42.0002]}};

    // WebODM's map: Leaflet's, with a thermal orthophoto layer as WebODM adds it
    function leafletMap() {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const map = L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([42, -88.07], 18);
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
        ["R1", "Rectangle", "10.00 °C", "50.00 °C", "30.00 °C", "5.00 °C", "48.00 °C", "400", "100 m²"].forEach(t => expect(text).toContain(t));
        expect(panel().querySelectorAll(".dt-inspector-histogram rect").length).toBe(3);
        const tips = [];
        map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) tips.push(l.getTooltip()._content); });
        expect(tips).toEqual(expect.arrayContaining(["R1", "R1 coldest: 10.00 °C", "R1 hottest: 50.00 °C"]));

        // Kept in the browser, in WebODM's units, exported
        const saved = JSON.parse(window.localStorage.getItem(inspector.regionsKey(["abc-1"])));
        expect(saved[0]).toMatchObject({label: "R1", shape: "rectangle", statistics: {mean: 30}});
        expect(saved[0].loading).toBeUndefined();
        expect(inspector.regionsCsv(saved, "F").split("\n")[1]).toBe(
            "R1,rectangle,400,100.000,50.000,122.000,86.000,9.000,85.100,53.600,118.400,42.00010000,-88.07010000,42.00020000,-88.07020000");
        window.localStorage.setItem("unit_system", "imperial");
        expect(inspector.statisticsHtml(saved[0], "F")).toContain("1076 ft²");
        panel().querySelector('[data-region] [data-act="remove"]').click();
        expect(window.localStorage.getItem(inspector.regionsKey(["abc-1"]))).toBe(null);
        expect(panel().querySelector(".dt-inspector-shown")).toBe(null);
        map.remove();
    });

    it("says when a region has no temperatures, and reads one the page left before its statistics", async () => {
        window.localStorage.setItem(inspector.regionsKey(["abc-1"]), JSON.stringify([
            {id: "a", label: "R1", shape: "polygon", geometry: {type: "Polygon", coordinates: [[[-88.07, 42], [-88.069, 42], [-88.069, 42.001], [-88.07, 42]]]},
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
        expect([...document.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["50", "60", "70", "80", "90", "100"]);
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
        expect(overlay._url).toBe("/api/plugins/dji-thermal/projects/2/tasks/abc-1/inspector/isotherm/{z}/{x}/{y}?low=35&color=e53935");
        expect(overlay.options).toMatchObject({tileSize: 512, bounds: "b", zIndex: 2, opacity: 1});
        change(panel().querySelector('[data-act="isotherm-color"]'), "blue");
        expect(overlay._url).toMatch(/color=1e88e5$/);
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
        expect(map2.added).toContain(again.ins.overlays()[0].overlay);
        again.ins.open();
        change(again.panel().querySelector('[data-act="isotherm-mode"]'), "off");
        expect(again.ins.overlays()).toEqual([]);
        expect(map2.added.some(l => /isotherm/.test(l._url || ""))).toBe(false);
        expect(window.localStorage.getItem(inspector.isothermKey(["abc-1"]))).toBeNull();
    });

    it("shows the legend of the thermal layer's palette and range, following WebODM's range, unless the user hides it", async () => {
        const layer = tileLayer(TILES, THERMAL_TASK);
        const map = fakeMap([layer]);
        const {ins, fetchFn, panel} = start(map, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await ins.ready;
        await flush();
        const legend = ins.legend();
        expect(legend.hidden).toBe(false);
        expect(legend.querySelector(".dt-legend-title").textContent).toBe("magma °C");
        expect([...legend.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["10", "20", "30", "40"]);
        layer.setUrl(TILES.replace("rescale=10,40", "rescale=0,100"));       // WebODM's panel
        expect([...legend.querySelectorAll(".dt-tick")].map(t => t.textContent)).toEqual(["0", "25", "50", "75", "100"]);
        expect(fetchFn.mock.calls.filter(c => c[0].indexOf("/palette?") !== -1).length).toBe(1);   // asked for once
        ins.open();
        change(panel().querySelector('[data-act="legend"]'), false);
        expect(legend.hidden).toBe(true);
        expect(window.localStorage.getItem("dji-thermal-inspector:legend")).toBe("0");
        const map2 = fakeMap([tileLayer(TILES, THERMAL_TASK)]);
        const again = start(map2, {[PALETTE]: {name: "magma", color_map: INFERNO}});
        await again.ins.ready;
        expect(again.ins.legend().hidden).toBe(true);
    });
});

describe("the Thermal Inspector's workset mosaics", () => {
    const L = require("leaflet");
    const BASE = "/api/plugins/dji-thermal/datasets/d-1/conversions/abc123def456/mosaics/";
    const LIST = "GET /api/plugins/dji-thermal/projects/2/inspector/mosaics";
    const BOUNDS = [-88.071, 41.999, -88.069, 42.001];
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
        const map = L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([42, -88.07], 18);
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

    it("shows its button when the map has a thermal orthophoto or the project has workset mosaics, and not on public maps", async () => {
        const rgb = [{type: "orthophoto", meta: {task: Object.assign({project: 2}, RGB_TASK)}}];
        let s = begin(leafletMap(), rgb, {[LIST]: {mosaics: []}});
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("none");
        s = begin(leafletMap(), rgb);
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("");
        expect(s.panel().hidden).toBe(true);      // laid only when asked
        // A project without tasks on its map: the project from the URL
        s = begin(leafletMap(), [], {}, {path: "/map/project/2/"});
        await s.ins.mosaicsReady;
        expect(s.button().style.display).toBe("");
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
            histogram: {counts: [2, 2], edges: [20, 30, 40]}, min_location: [-88.07, 42], max_location: [-88.07, 42]}}));
        const {ins, plugins, panel, laid} = begin(map, [{type: "orthophoto", meta: {task: Object.assign({project: 2}, THERMAL_TASK)}}],
                                                  {["GET " + BASE + "as_converted/point"]: point, ["POST " + BASE + "as_converted/region"]: region});
        await ins.mosaicsReady;
        ins.open();
        expect(panel().querySelector(".dt-inspector-mosaic").textContent).toContain("Roof › Normalized");
        change(panel().querySelector('[data-act="mosaic-on"]'), true);
        const layer = laid()[0];
        // The Analyzer's tiles, in DJI's ironred (the user's) over the tab's 2nd to 98th percentile (°F, the mosaic's unit)
        expect(layer._url).toBe(BASE + "as_converted/tiles/{z}/{x}/{y}.png?v=2026-11-01T10%3A00%3A00%2B00%3A00&color_map=dji_ironred&rescale=50,121");
        expect(layer.options.zIndex).toBeGreaterThan(100);

        map.setView([42, -88.07], 18);
        map.fire("mousemove", {latlng: L.latLng(42, -88.07)});
        await new Promise(r => setTimeout(r, 120));
        await flush();
        expect(point.mock.calls[0][0]).toContain(BASE + "as_converted/point?lon=-88.07000000&lat=42.00000000");
        expect(panel().querySelector(".dt-inspector-readout").textContent).toBe("40.00 °C");

        // A region over it reads the mosaic's
        panel().querySelector('[data-mode="rectangle"]').click();
        map.fire("mousedown", {latlng: map.containerPointToLatLng(L.point(10, 10)), originalEvent: {button: 0}});
        document.dispatchEvent(new MouseEvent("mouseup", {clientX: 60, clientY: 50}));
        await flush(); await flush();
        expect(region).toHaveBeenCalledTimes(1);

        change(panel().querySelector('[data-act="mosaic-tab"]'), "harmonized");
        expect(layer._url).toContain(BASE + "harmonized/tiles/");
        expect(layer._url).toContain("rescale=60,110");
        change(panel().querySelector('[data-act="mosaic-opacity"]'), "40");
        expect(layer.options.opacity).toBe(0.4);
        panel().querySelector('[data-act="mosaic-swipe"]').click();
        expect(plugins.Map.sideBySideChanged).toHaveBeenLastCalledWith(layer, true);
        // Its isotherm is clipped as WebODM's divider clips it
        change(panel().querySelector('[data-act="isotherm-mode"]'), "above");
        const overlay = ins.overlays().find(o => o.layer === layer).overlay;
        expect(overlay._url).toContain(BASE + "harmonized/isotherm/{z}/{x}/{y}.png?low=");
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
    const FOOTPRINT = [[-88.071, 41.999], [-88.069, 41.999], [-88.069, 42.001], [-88.071, 42.001]];
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
        expect(ins.click({latlng: L.latLng(42, -88.07)})).toBe(true);
        await flush(); await flush();
        expect(frames.mock.calls[0][0]).toBe(BASE + "as_converted/frames?lon=-88.07&lat=42");
        expect(frameBox(map).hidden).toBe(false);
        expect(frameBox(map).textContent).toContain("Frame 1 of 2 that saw this point");
        expect(frameBox(map).textContent).toContain("The mosaic's pixel here comes from this frame");
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
        ins.click({latlng: L.latLng(42, -88.07)});
        await flush(); await flush();
        expect(frameBox(map).hidden).toBe(false);
        change(panel().querySelector('[data-act="mosaic-on"]'), false);
        expect(laid().length).toBe(0);
        expect(frameBox(map).hidden).toBe(true);
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
        expect(ins.click({latlng: L.latLng(42, -88.07)})).toBe(true);
        await flush(); await flush();
        // ODM blended the frames: none is the pixel's own, the one closest to straight down first, placed approximately
        expect(frameBox(map).querySelector("img").getAttribute("src"))
            .toBe(BASE + "as_converted/frames/5.png?v=2026-11-01T10%3A00%3A00%2B00%3A00&color_map=dji_ironred&rescale=50,104");
        expect(frameBox(map).textContent).not.toContain("comes from this frame");
        expect(frameBox(map).textContent).toContain("not ODM's cameras");

        // A pin shows them too
        ins.setMode("pin");
        ins.click({latlng: L.latLng(42.0005, -88.0705)});
        await flush(); await flush();
        expect(frames.mock.calls[1][0]).toContain("lat=42.0005");
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
        expect(ins.click({latlng: L.latLng(42, -88.07)})).toBe(false);
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
        expect(inspector.mosaicIsothermUrl(info, {mode: "between", low: 20, high: 30, color: "blue"})).toBe(
            BASE + "harmonized/isotherm/{z}/{x}/{y}.png?low=20&high=30&color=1e88e5");
        expect(inspector.toCelsius(212, "F")).toBe(100);
        expect(inspector.toCelsius(300, "K")).toBeCloseTo(26.85);
    });
});
