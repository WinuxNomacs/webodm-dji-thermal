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
