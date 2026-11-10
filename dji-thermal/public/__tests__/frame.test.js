// The Analyzer's frame page (frame.js): a workset's frames one at a time, against a fake server and Leaflet
const fs = require('fs');
const path = require('path');
const core = require('../analyzer_core');
window.ThermalAnalyzerCore = core;
window.ThermalScale = require('../scale');
window.ThermalRecolour = require('../recolour');
window.ThermalAnalyzerViewer = require('../viewer');
window.ThermalRegions = require('../regions');
window.ThermalInspector = require('../inspector');
const frame = require('../frame');

function page() {
    const t = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'frame.html'), 'utf8');
    return t.slice(t.indexOf('{% block content %}') + 19, t.indexOf('{% endblock %}'))
        .replace(/<script[^>]*><\/script>/g, '')
        .replace('{% csrf_token %}', '<input name="csrfmiddlewaretoken" value="tok">')
        .replace(/\{\{ api \}\}/g, '/api/plugins/dji-thermal/')
        .replace(/\{\{ public \}\}/g, '/plugins/dji-thermal/')
        .replace(/\{\{ dataset\.id \}\}/g, 'd1')
        .replace(/\{\{ conversion\.id \}\}/g, 'c1')
        .replace(/\{\{[^}]*\}\}/g, '');
}

const BASE = "/api/plugins/dji-thermal/datasets/d1/conversions/c1";
const INFERNO = Array.from({length: 256}, (_, i) => ((i << 24) | ((255 - i) << 8) | 255) >>> 0);
const FRAMES = {
    name: "Nadir", dataset_name: "Roof", unit: "C", normalized: false, harmonized: false, max_pitch: -80, built: true,
    can_change: true, default_palette: "inferno", palettes: [{key: "inferno", label: "inferno", color_map: INFERNO}],
    frames: [{path: "a_T.JPG", time: "2026:10:12 18:29:50", pitch: -90, converted: true, mosaic: 0},
             {path: "sub/b_T.JPG", time: "2026:10:12 18:29:52", pitch: -90, converted: true, mosaic: 1},
             {path: "c_T.JPG", time: "2026:10:12 18:29:54", pitch: -45, converted: true, mosaic: null}]
};
const INFO = {frame: "a_T.JPG", width: 2, height: 1, unit: "C", distance_source: "rangefinder", notes: [], offset: 0, offset_known: true,
              params: {distance: 18.1, humidity: 50, emissivity: 0.91, reflection: 22.8, ambient_temp: 22.8},
              recorded: {distance: 5, lrf: 18.1, humidity: 50, emissivity: 0.91, reflection: 22.8, ambient: 22.8},
              changes: {}, stats: {min: 15, max: 15, mean: 15, percentiles: [15, 15], histogram: {counts: [1], edges: [15, 16]}}};

describe("the frame page's helpers", () => {
    afterEach(() => window.localStorage.clear());

    it("lists all the frames, those in the mosaic or the oblique ones, and says why the mosaics left one out", () => {
        const all = FRAMES.frames;
        expect(frame.listFrames(all, "mosaic").map(f => f.path)).toEqual(["a_T.JPG", "sub/b_T.JPG"]);
        expect(frame.listFrames(all, "oblique").map(f => f.path)).toEqual(["c_T.JPG"]);
        expect(frame.listFrames(all, "").length).toBe(3);
        // Before the mosaics placed any frame, there is one list
        const unplaced = all.map(f => Object.assign({}, f, {mosaic: null}));
        expect(frame.listFrames(unplaced, "mosaic").length).toBe(3);
        expect(frame.frameTag(all[2], "", -80, true)).toBe("oblique, -45°");
        expect(frame.frameTag(all[0], "", -80, true)).toBe("in the mosaic");
        expect(frame.frameTag(all[0], "mosaic", -80, true)).toBe("");
        expect(frame.frameTag(Object.assign({}, all[0], {mosaic: null}), "", -80, true)).toBe("left out as unusable");
        expect(frame.frameTag(Object.assign({}, all[0], {converted: false}), "", -80, false)).toBe("not converted");
    });

    it("reads the parameters typed: only those moved from where they started, temperatures in the workset's unit", () => {
        const starts = frame.changeStarts(INFO);
        expect(starts).toEqual({distance: "18.1", humidity: "50.0", emissivity: "0.91", reflected_temp: "22.8", ambient_temp: "22.8"});
        expect(frame.readChanges({emissivity: "0.80", humidity: "50", distance: ""}, starts, "C")).toEqual({changes: {emissivity: 0.8}});
        expect(frame.readChanges({emissivity: "2"}, starts, "C")).toEqual({error: "The emissivity is between 0.1 and 1", field: "emissivity"});
        expect(frame.readChanges({humidity: "wet"}, starts, "C").field).toBe("humidity");
        window.localStorage.setItem("unit_system", "imperial");
        const f = frame.changeStarts(INFO);
        expect(f.reflected_temp).toBe("73.0");
        // 86 °F typed, a workset in °C: 30 °C
        expect(frame.readChanges({reflected_temp: "86"}, f, "C")).toEqual({changes: {reflected_temp: 30}});
        expect(frame.readChanges({reflected_temp: "-500"}, f, "C").error).toMatch(/absolute zero/);
        expect(frame.changesTyped({reflected_temp: 30, emissivity: 0.8}, "C")).toEqual({reflected_temp: "86", emissivity: "0.8"});
    });

    it("asks for a frame measured with the changes, and opens the Worksets form filled in with them", () => {
        expect(frame.frameApiUrl(BASE, "frame/values", "sub/b T.JPG", {emissivity: 0.8}))
            .toBe(BASE + "/frame/values?frame=sub%2Fb%20T.JPG&emissivity=0.8");
        expect(frame.newWorksetUrl("/plugins/dji-thermal/", "d1", "c1", {emissivity: 0.8, distance: 12}))
            .toBe("/plugins/dji-thermal/dataset/d1?from=c1&emissivity=0.8&distance=12#convert");
    });

    it("reads the values under the cursor, and the difference the changes make", () => {
        const tile = {width: 2, height: 1, values: Float32Array.from([15, NaN])};
        const changed = {width: 2, height: 1, values: Float32Array.from([16.5, NaN])};
        expect(frame.valueAt(tile, 0.7, 0.2)).toBe(15);
        expect(frame.valueAt(tile, 1.2, 0.2)).toBeNull();
        expect(frame.valueAt(tile, 2, 0)).toBeNull();
        const el = document.createElement("div");
        el.innerHTML = frame.readoutHtml({x: 0.5, y: 0.5, inside: true}, [tile, changed], "C");
        expect(el.textContent).toContain("15.00 °C");
        expect(el.textContent).toContain("+1.50 °C");
        el.innerHTML = frame.readoutHtml({x: 1.5, y: 0.5, inside: true}, [tile, null], "C");
        expect(el.textContent).toContain("no data");
        expect(frame.readoutHtml({inside: false}, [tile], "C")).toContain("Outside the frame");
    });

    it("reads a pixel's difference from the median around it, over 2 m at the frame's ground resolution", () => {
        // 5 x 3 pixels of 0.5 m: 2 m is 2 pixels either side; a cooler seam down the middle column
        const values = Float32Array.from([20, 20, 17, 20, 21, 20, 20, 17, 20, 21, 20, NaN, 17, 20, 21]);
        const tile = {width: 5, height: 3, values}, info = {pixel_m: 0.5, size_m: 2};
        // The seam's pixel against all 14 pixels it has around it (median 20)
        expect(frame.surroundingsAt(tile, 2.5, 1.5, info)).toBe(-3);
        // A corner pixel against what the frame has of its window
        expect(frame.surroundingsAt(tile, 4.5, 0.5, info)).toBe(1);
        expect(frame.surroundingsAt(tile, 1.5, 2.5, info)).toBeNull();
        expect(frame.surroundingsAt(tile, 2.5, 1.5, {pixel_m: null})).toBeNull();
        const changed = {width: 5, height: 3, values: values.map(v => v + 1)};
        const el = document.createElement("div");
        el.innerHTML = frame.readoutHtml({x: 2.5, y: 1.5, inside: true}, [tile, null], "C", [info]);
        expect(el.textContent).toContain("ΔT from surroundings-3.00 °C");
        el.innerHTML = frame.readoutHtml({x: 2.5, y: 1.5, inside: true}, [tile, changed], "C", [info, info]);
        expect(el.textContent).toContain("ΔT from surroundings, changed-3.00 °C");
        expect(el.textContent).toContain("Difference+1.00 °C");
        el.innerHTML = frame.readoutHtml({x: 2.5, y: 1.5, inside: true}, [tile, null], "C", [{pixel_m: null}]);
        expect(el.textContent).not.toContain("ΔT");
    });
});

describe("the frame page", () => {
    // A Leaflet stand-in: the panes' maps and the canvas each shows
    function fakeLeaflet() {
        const L = {maps: [], CRS: {Simple: {}}, DomUtil: {addClass() {}}, Util: {falseFn() {}}, latLngBounds: b => b};
        const layer = extra => Object.assign({addTo(m) { (m.layers = m.layers || []).push(this); return this; }}, extra);
        L.layerGroup = () => layer({layers: [], clearLayers() { this.layers = []; }});
        L.circleMarker = (at, opts) => layer({marker: at, opts});
        L.circle = (at, opts) => layer({circle: at, opts});
        L.polyline = (points, opts) => layer({line: points, opts});
        L.polygon = (points, opts) => layer({polygon: points, opts});
        L.map = (el, opts) => {
            const handlers = {};
            const m = {el, opts, layers: [], center: [0, 0], zoom: 0, on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); return m; },
                       off() { return m; }, getContainer: () => el,
                       fire(ev, e) { (handlers[ev] || []).forEach(f => f(e)); }, fitBounds(b) { m.fitted = b; },
                       invalidateSize() {}, removeLayer(l) { m.layers = m.layers.filter(x => x !== l); },
                       setView(c, z) { m.center = c; m.zoom = z; m.fire("move"); }, getCenter: () => m.center, getZoom: () => m.zoom};
            L.maps.push(m);
            return m;
        };
        L.ImageOverlay = {extend(proto) {
            return function (url, bounds) {
                this.bounds = bounds;
                proto._initImage.call(this);
                this.addTo = m => { m.layers.push(this); return this; };
                this.setBounds = b => { this.bounds = b; };
            };
        }};
        return L;
    }

    // The server: the frames, a frame's figures and its values (a 2 × 1 frame: 15 and no data; 16.5 with the changes)
    function fakeServer() {
        const calls = [], saved = [];
        const json = (data, code) => Promise.resolve({ok: !code || code < 400, status: code || 200, json: () => Promise.resolve(data)});
        const fetchFn = jest.fn((url, opts) => {
            calls.push([url, opts]);
            const body = opts && opts.body ? JSON.parse(opts.body) : null;
            if (url === BASE + "/frames") return json(FRAMES);
            if (url === BASE + "/frame/region") {
                const point = body.geometry.type === "Point";
                return json({valid: true, reason: null, pixel_size: 1, statistics: {count: point ? 1 : 4, min: 15, max: 15, mean: point ? 15 : 16, std: 0,
                             median: 15, percentiles: {2: 15, 98: 15}, histogram: {counts: [1], edges: [15, 16]}, surroundings: null, delta_t: null}});
            }
            if (url.startsWith(BASE + "/frame/measurements")) {
                if (opts && opts.method === "POST") {
                    const m = Object.assign({id: "aaaaaaaaaaa" + (saved.length + 1), created_by: "admin", created_at: "2026-11-01T10:00:00Z",
                                             values: {valid: true, statistics: {count: 1, mean: 15}}}, body);
                    saved.push(m);
                    return json(m, 201);
                }
                if (opts && opts.method === "PATCH") {
                    const m = saved.filter(x => url.endsWith(x.id))[0];
                    Object.assign(m, body);
                    return json(m);
                }
                if (opts && opts.method === "DELETE") {
                    saved.splice(saved.findIndex(x => url.endsWith(x.id)), 1);
                    return Promise.resolve({ok: true, status: 204});
                }
                return json({measurements: saved.slice(), can_change: true});
            }
            const u = new URL(url, "http://x"), changed = u.searchParams.has("emissivity");
            if (u.pathname.endsWith("/frame")) {
                return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(Object.assign({}, INFO, {
                    frame: u.searchParams.get("frame"), changes: changed ? {emissivity: 0.8} : {}}))});
            }
            const headers = {"X-Values-Offset": changed ? "16.5" : "15", "X-Values-Step": "1", "X-Values-Margin": "0", "X-Sharpen-Sigma": "1"};
            return Promise.resolve({ok: true, status: 200, headers: {get: k => headers[k]}, blob: () => Promise.resolve("blob")});
        });
        return {fetchFn, calls};
    }

    let puts;
    beforeEach(() => {
        document.body.innerHTML = page();
        puts = [];
        window.createImageBitmap = jest.fn(() => Promise.resolve({width: 2, height: 1}));
        jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
            const canvas = this;
            return {drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0])}),
                    createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}),
                    putImageData(image) { puts.push([canvas, Array.from(image.data)]); }};
        });
        window.requestAnimationFrame = f => setTimeout(f, 0);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        window.localStorage.clear();
    });
    const $ = id => document.getElementById(id);
    const settle = () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0)));

    function start(search) {
        const server = fakeServer(), L = fakeLeaflet();
        const location = {search: search || "", assign: jest.fn()}, history = {replaceState: jest.fn()};
        const done = frame.init({doc: document, fetchFn: server.fetchFn, loadLeaflet: () => Promise.resolve(L), location, history});
        return done.then(settle).then(() => ({server, L, location, history}));
    }

    it("shows the frame a link asks for, listed among the frames of its list, coloured from its values", async () => {
        const {server, L} = await start("?frame=sub%2Fb_T.JPG&list=mosaic");
        expect($("ta-frame-name").textContent).toBe("b_T.JPG");
        expect($("ta-frame-subtitle").textContent).toBe("Roof · Nadir · 2026-10-12 18:29:52 · sub/b_T.JPG");
        expect(server.calls.map(c => c[0])).toContain(BASE + "/frame/values?frame=sub%2Fb_T.JPG");
        const items = Array.from(document.querySelectorAll("#ta-frame-list [data-path]"));
        expect(items.map(b => b.getAttribute("data-path"))).toEqual(["a_T.JPG", "sub/b_T.JPG"]);
        expect(document.querySelector("#ta-frame-list [aria-current=true]").getAttribute("data-path")).toBe("sub/b_T.JPG");
        expect(document.querySelector("[data-list=oblique]").textContent).toBe("Oblique 1");
        expect($("ta-frame-next").disabled).toBe(true);
        expect($("ta-frame-prev").disabled).toBe(false);
        // One pane, the frame on it at its size; the pixel with a value coloured, the other clear
        expect(L.maps.length).toBe(1);
        expect(L.maps[0].fitted).toEqual([[-1, 0], [0, 2]]);
        expect($("ta-frame-pane-1").hidden).toBe(true);
        const last = puts[puts.length - 1][1];
        expect(last[3]).toBe(255);
        expect(last[7]).toBe(0);
        expect($("ta-viewer-controls").textContent).toContain("This frame: 15.0 to 15.0 °C");
    });

    it("lists all the frames when the frame a link asks for isn't in its list", async () => {
        const {history} = await start("?frame=c_T.JPG&list=mosaic");
        expect($("ta-frame-name").textContent).toBe("c_T.JPG");
        expect(document.querySelector("[data-list='']").getAttribute("aria-pressed")).toBe("true");
        expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "?frame=c_T.JPG");
    });

    it("shows each listed frame's thumbnail in the preferred DJI palette, until the Thumbnails box is cleared, remembered", async () => {
        core.setPreferences({palette: "ironred"});
        await start();
        const thumbs = Array.from(document.querySelectorAll("#ta-frame-list img.ta-frame-thumb"));
        expect(thumbs.map(i => i.getAttribute("src"))).toEqual(["a_T.JPG", "sub/b_T.JPG", "c_T.JPG"].map(p =>
            "/api/plugins/dji-thermal/datasets/d1/thumbnail?workset=c1&size=list&palette=ironred&file=" + encodeURIComponent(p)));
        expect(thumbs[0].getAttribute("loading")).toBe("lazy");
        expect($("ta-frame-list").classList.contains("ta-frame-list-thumbs")).toBe(true);
        const box = document.querySelector("#ta-frame-list [data-thumbs]");
        box.checked = false;
        box.dispatchEvent(new Event("change", {bubbles: true}));
        expect(document.querySelectorAll("#ta-frame-list img").length).toBe(0);
        expect($("ta-frame-list").classList.contains("ta-frame-list-thumbs")).toBe(false);
        expect(document.querySelector("#ta-frame-list [data-thumbs]").checked).toBe(false);
        // Names only on the next visit too; without a preferred palette, each frame's embedded picture
        core.setPreferences({palette: null});
        document.body.innerHTML = page();
        await start();
        expect(document.querySelectorAll("#ta-frame-list img").length).toBe(0);
        window.localStorage.clear();
        document.body.innerHTML = page();
        await start();
        expect(document.querySelector("#ta-frame-list img").getAttribute("src")).toBe(
            "/api/plugins/dji-thermal/datasets/d1/thumbnail?workset=c1&size=list&file=a_T.JPG");
        // A workset writing coloured images: in its palette, over the preferred one
        core.setPreferences({palette: "arctic"});
        FRAMES.frames_palette = "ironred";
        try {
            document.body.innerHTML = page();
            await start();
            expect(document.querySelector("#ta-frame-list img").getAttribute("src")).toBe(
                "/api/plugins/dji-thermal/datasets/d1/thumbnail?workset=c1&size=list&palette=ironred&file=a_T.JPG");
        } finally {
            delete FRAMES.frames_palette;
            core.setPreferences({palette: null});
        }
    });

    it("scrolls the list to the frame shown once the page shows it, centred, and leaves it when it's in view", async () => {
        // The list 100 px high; the frame shown 20 px high, 400 px down it, until scrolled
        const box = $("ta-frame-list");
        let top = 0, seen = [];
        Object.defineProperty(box, "scrollTop", {get: () => top, set: v => { seen.push([v, $("ta-frame-main").hidden]); top = v; }});
        jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
            if (this === box) return {top: 0, bottom: 100, height: 100};
            const at = this.getAttribute("aria-current") ? 400 - top : 1000;
            return {top: at, bottom: at + 20, height: 20};
        });
        await start("?frame=sub%2Fb_T.JPG");
        expect(seen).toEqual([[360, false]]);
        document.querySelector("#ta-frame-list [data-list=mosaic]").click();
        await settle();
        expect(seen.length).toBe(1);
    });

    it("reads the pixel under the cursor, and steps through the list with the arrow keys, keeping the frame in the URL", async () => {
        const {L, history} = await start();
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}});
        expect($("ta-frame-readout").textContent).toContain("15.00 °C");
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 5}});
        expect($("ta-frame-readout").textContent).toContain("Outside the frame");
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight"}));
        await settle();
        expect($("ta-frame-name").textContent).toBe("b_T.JPG");
        expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "?frame=sub%2Fb_T.JPG");
        document.querySelector("[data-list=oblique]").click();
        await settle();
        expect($("ta-frame-name").textContent).toBe("c_T.JPG");
        expect(history.replaceState).toHaveBeenLastCalledWith(null, "", "?frame=c_T.JPG&list=oblique");
    });

    it("shows each pane's temperature beside the pointer once Temperature On Pointer is ticked, saved for the user, never where there is none", async () => {
        const {server, L} = await start();
        const box = $("ta-pointer-temp"), label = i => $("ta-frame-map-" + i).querySelector(".ta-pointer-temp");
        expect(document.querySelector('[data-section="cursor"] h5').textContent).toBe("Pointer Info");
        // Off until the user ticks it
        expect(box.checked).toBe(false);
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}, containerPoint: {x: 30, y: 40}});
        expect(label(0).style.display).toBe("none");
        box.checked = true;
        box.dispatchEvent(new Event("change", {bubbles: true}));
        const put = server.calls.filter(c => c[1] && c[1].method === "PUT");
        expect(put.map(c => [c[0], JSON.parse(c[1].body)])).toEqual([["/api/plugins/dji-thermal/display", {pointer_temperature: true}]]);
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}, containerPoint: {x: 30, y: 40}});
        expect([label(0).textContent, label(0).style.left, label(0).style.top, label(0).style.display]).toEqual(["15.00 °C", "44px", "54px", ""]);
        // The frame's second pixel has no temperature, and outside the frame there is none: no label
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 1.5}, containerPoint: {x: 60, y: 40}});
        expect(label(0).style.display).toBe("none");
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 5}, containerPoint: {x: 200, y: 40}});
        expect(label(0).style.display).toBe("none");

        // With the parameters changed, each pane shows its own
        const field = document.querySelector("#ta-frame-params input[name=emissivity]");
        field.value = "0.8";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        $("ta-frame-apply").click();
        await settle();
        L.maps[1].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}, containerPoint: {x: 30, y: 40}});
        expect(label(1).textContent).toBe("16.50 °C");
        L.maps[1].fire("mouseout");
        expect(label(1).style.display).toBe("none");
        // Cleared: none
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}, containerPoint: {x: 30, y: 40}});
        box.checked = false;
        box.dispatchEvent(new Event("change", {bubbles: true}));
        expect(label(0).style.display).toBe("none");
        core.setPreferences(null);
    });

    it("measures the frame again with the parameters changed beside it, the panes moving together, and clears them", async () => {
        const {server, L} = await start();
        const field = document.querySelector("#ta-frame-params input[name=emissivity]");
        field.value = "0.8";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        $("ta-frame-apply").click();
        await settle();
        expect(server.calls.map(c => c[0])).toContain(BASE + "/frame?frame=a_T.JPG&emissivity=0.8");
        expect($("ta-frame-pane-1").hidden).toBe(false);
        expect(L.maps.length).toBe(2);
        L.maps[0].fire("mousemove", {latlng: {lat: -0.5, lng: 0.5}});
        expect($("ta-frame-readout").textContent).toContain("+1.50 °C");
        L.maps[0].setView([-3, 4], 2);
        expect([L.maps[1].center, L.maps[1].zoom]).toEqual([[-3, 4], 2]);
        expect($("ta-frame-new-workset").getAttribute("href")).toBe("/plugins/dji-thermal/dataset/d1?from=c1&emissivity=0.8#convert");
        // The changes stay as the next frame is shown
        $("ta-frame-next").click();
        await settle();
        expect(server.calls.map(c => c[0])).toContain(BASE + "/frame?frame=sub%2Fb_T.JPG&emissivity=0.8");
        expect(document.querySelector("#ta-frame-params input[name=emissivity]").value).toBe("0.8");
        $("ta-frame-clear").click();
        await settle();
        expect($("ta-frame-pane-1").hidden).toBe(true);
        expect($("ta-frame-new-workset")).toBeNull();
    });

    it("refuses parameters out of their limits without asking the server", async () => {
        const {server} = await start();
        const before = server.calls.length;
        const field = document.querySelector("#ta-frame-params input[name=emissivity]");
        field.value = "3";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        expect($("ta-frame-change-error").textContent).toBe("The emissivity is between 0.1 and 1");
        expect(server.calls.length).toBe(before);
    });

    it("downloads the temperatures as measured, or with the changes when asked", async () => {
        const {location} = await start();
        document.querySelector("[data-download=csv]").click();
        expect(location.assign).toHaveBeenLastCalledWith(BASE + "/frame/download?frame=a_T.JPG&kind=csv");
        const field = document.querySelector("#ta-frame-params input[name=emissivity]");
        field.value = "0.8";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        $("ta-frame-apply").click();
        await settle();
        const withChanges = document.querySelector("input[name=ta-frame-measured][value='1']");
        withChanges.checked = true;
        withChanges.dispatchEvent(new Event("change", {bubbles: true}));
        document.querySelector("[data-download=tiff]").click();
        expect(location.assign).toHaveBeenLastCalledWith(BASE + "/frame/download?frame=a_T.JPG&emissivity=0.8&kind=tiff");
    });

    it("widens and narrows the range with the arrows between its fields", async () => {
        await start();
        $("ta-viewer-min").value = "10";
        $("ta-viewer-max").value = "30";
        $("ta-viewer-max").dispatchEvent(new Event("change", {bubbles: true}));
        $("ta-viewer-wider").click();
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["9", "31"]);
        $("ta-viewer-narrow").click();
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["10.1", "29.9"]);
    });

    it("raises and lowers the range with the arrows above and below Auto, never past the frame's temperatures", async () => {
        await start();
        $("ta-viewer-min").value = "5";
        $("ta-viewer-max").value = "10";
        $("ta-viewer-max").dispatchEvent(new Event("change", {bubbles: true}));
        $("ta-viewer-raise").click();
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["5.5", "10.5"]);
        // The frame is 15 °C throughout: the range is already below its lowest temperature
        $("ta-viewer-lower").click();
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["5.5", "10.5"]);
        // Auto sits in the middle of the arrows
        const pad = $("ta-viewer-auto").parentNode;
        expect(Array.from(pad.children).map(b => b.id)).toEqual(["ta-viewer-raise", "ta-viewer-narrow", "ta-viewer-auto", "ta-viewer-wider", "ta-viewer-lower"]);
    });

    it("recolours the frame as a slider moves, without asking the server", async () => {
        const {server} = await start();
        const before = server.calls.length, drawn = puts.length;
        const gamma = $("ta-viewer-gamma");
        gamma.value = "1";
        gamma.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        expect(server.calls.length).toBe(before);
        expect(puts.length).toBeGreaterThan(drawn);
    });

    it("pins a pixel, measured on the server in the frame's pixels, and saves it for everyone with a name", async () => {
        const {server, L} = await start();
        document.querySelector("[data-tool=pin]").click();
        L.maps[0].fire("click", {latlng: {lat: -0.5, lng: 0.25}});
        await settle();
        const region = server.calls.filter(c => c[0] === BASE + "/frame/region").pop();
        expect(JSON.parse(region[1].body)).toEqual({frame: "a_T.JPG", changes: {}, geometry: {type: "Point", coordinates: [0.25, 0.5]}, isotherm: null});
        expect($("ta-frame-measure").textContent).toContain("P1");
        expect($("ta-frame-measure").textContent).toContain("15.00 °C");
        document.querySelector("[data-item] [data-act=save]").click();
        document.querySelector("[data-form=name]").value = "Hot spot";
        document.querySelector("[data-act=form-save]").click();
        await settle();
        const post = server.calls.filter(c => c[0] === BASE + "/frame/measurements" && c[1] && c[1].method === "POST").pop();
        expect(JSON.parse(post[1].body)).toEqual(expect.objectContaining({name: "Hot spot", shape: "pin", frame: "a_T.JPG", changes: {}}));
        // Saved: out of the drawn ones, listed (and shown) under Saved on this frame
        expect(document.querySelector("#ta-frame-measure [data-item]")).toBeNull();
        expect($("ta-frame-saved").textContent).toContain("Hot spot");
        expect($("ta-frame-saved").textContent).toContain("As converted. Saved by admin");
    });

    it("measures the shapes again when the isotherm or the parameters change, the isotherm's limits in °C", async () => {
        const {server, L} = await start();
        document.querySelector("[data-tool=pin]").click();
        L.maps[0].fire("click", {latlng: {lat: -0.5, lng: 0.5}});
        await settle();
        const regions = () => server.calls.filter(c => c[0] === BASE + "/frame/region").map(c => JSON.parse(c[1].body));
        $("ta-viewer-iso-mode").value = "above";
        $("ta-viewer-iso-a").value = "20";
        $("ta-viewer-iso-a").dispatchEvent(new Event("change", {bubbles: true}));
        await settle();
        expect(regions().pop().isotherm).toEqual({low: 20, high: null});
        const field = document.querySelector("#ta-frame-params input[name=emissivity]");
        field.value = "0.8";
        field.dispatchEvent(new Event("input", {bubbles: true}));
        $("ta-frame-apply").click();
        await settle();
        expect(regions().pop().changes).toEqual({emissivity: 0.8});
        expect($("ta-frame-measure").textContent).toContain("Measured with the parameters changed.");
    });

    it("renames and deletes a saved measurement, and only who can change the project sees how", async () => {
        const {server, L} = await start();
        document.querySelector("[data-tool=pin]").click();
        L.maps[0].fire("click", {latlng: {lat: -0.5, lng: 0.5}});
        await settle();
        document.querySelector("[data-item] [data-act=save]").click();
        document.querySelector("[data-act=form-save]").click();
        await settle();
        document.querySelector("[data-saved] [data-act=edit]").click();
        document.querySelector("[data-form=name]").value = "Renamed";
        document.querySelector("[data-act=form-save]").click();
        await settle();
        expect(server.calls.some(c => c[1] && c[1].method === "PATCH")).toBe(true);
        expect($("ta-frame-saved").textContent).toContain("Renamed");
        document.querySelector("[data-saved] [data-act=delete]").click();
        document.querySelector(".ta-dialog .btn-danger").click();
        await settle();
        expect($("ta-frame-saved").textContent).toContain("None yet");
        const html = frame.savedHtml({saved: [{id: "x", name: "A", shape: "pin", values: {statistics: {count: 1, mean: 15}}}], canChange: false},
                                     window.ThermalInspector);
        expect(html).not.toContain("data-act=\"edit\"");
        expect(html).not.toContain("data-act=\"delete\"");
    });

    it("turns shapes drawn on a pane into the frame's pixels, a circle a polygon around its centre", () => {
        expect(frame.toPixels({type: "LineString", coordinates: [[1, -2], [3, -4]]})).toEqual({type: "LineString", coordinates: [[1, 2], [3, 4]]});
        expect(frame.toPixels({type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, -2], [0, 0]]]}).coordinates[0][2]).toEqual([2, 2]);
        const ring = frame.circlePixels({lat: -10, lng: 20, radius: 5}).coordinates[0];
        expect(ring.length).toBe(65);
        expect(ring[0]).toEqual([25, 10]);
        expect(ring[16][0]).toBeCloseTo(20, 9);
        expect(ring[16][1]).toBeCloseTo(15, 9);
        expect(frame.isothermLimits("between,50,68", "F")).toEqual({low: 10, high: 20});
        expect(frame.isothermLimits("", "C")).toBeNull();
        expect(frame.changesText({emissivity: 0.8, reflected_temp: 30}, "C")).toBe("emissivity 0.80, reflected temperature 30.0 °C");
        // A line's statistics name its length and profile in pixels, not metres
        const line = {id: "i1", label: "L1", shape: "line", geometry: {type: "LineString", coordinates: [[0, 0], [10, 0]]},
                      res: {valid: true, pixel_size: 1, length: 10, statistics: {count: 30, min: 1, max: 2, mean: 1.5, std: 0.1, median: 1.5,
                            percentiles: {2: 1, 98: 2}, histogram: {counts: [1], edges: [1, 2]}},
                            profile: {distance: [0, 10], values: [1, 2], points: [[0, 0], [10, 0]]}}};
        const el = document.createElement("div");
        el.innerHTML = frame.measureHtml({tool: null, items: [line], shown: "i1", canChange: true}, window.ThermalInspector);
        expect(el.textContent).toContain("Length10.0 px");
        expect(el.textContent).toContain("0.0 px10.0 px");
        expect(el.textContent).not.toMatch(/\d m\b/);
        expect(el.textContent).not.toContain("Area");
    });
});
