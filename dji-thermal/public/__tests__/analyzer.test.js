// The Thermal Analyzer's pages: the shared core, the datasets list and a dataset's page, against a fake server
const fs = require('fs');
const path = require('path');
const core = require('../analyzer_core');
window.ThermalAnalyzerCore = core;
const datasets = require('../datasets');
const conversions = require('../conversions');
window.ThermalAnalyzerConversions = conversions;
const dataset = require('../dataset');
const viewer = require('../viewer');
const Recolour = require('../recolour');

// A page's markup from its Django template, with the template tags filled in as the plugin does
function page(name) {
    const t = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', name), 'utf8');
    const body = t.slice(t.indexOf('{% block content %}') + 19, t.indexOf('{% endblock %}'));
    return body
        .replace(/<script[^>]*><\/script>/g, '')
        .replace('{% csrf_token %}', '<input name="csrfmiddlewaretoken" value="tok">')
        .replace(/\{\{ api \}\}/g, '/api/plugins/dji-thermal/')
        .replace(/\{\{ public \}\}/g, '/plugins/dji-thermal/')
        .replace(/\{\{ dataset\.id \}\}/g, '5')
        .replace(/\{\{ dataset\.name \}\}/g, 'Roof')
        .replace(/\{\{ conversion\.id \}\}/g, '9')
        .replace(/\{\{ conversion\.name \}\}/g, 'Nadir')
        .replace(/\{\{ basemaps\|json_script:"ta-basemaps" \}\}/g, '')
        .replace(/\{\{ display\|json_script:"ta-display" \}\}/g, '');
}

const jsonResponse = (data, ok = true) => Promise.resolve({ok, json: () => Promise.resolve(data)});
const flush = () => new Promise(r => setTimeout(r, 0));
// Lets the promises of a fetch and its JSON settle, with fake timers too
const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
afterEach(() => jest.useRealTimers());
const click = el => el.dispatchEvent(new MouseEvent("click", {bubbles: true}));
const change = el => el.dispatchEvent(new Event("change", {bubbles: true}));
// The pages' dialog, and pressing one of its buttons
const askDialog = () => document.querySelector(".ta-ask");
const press = label => click([].filter.call(askDialog().querySelectorAll("button"), b => b.textContent === label)[0]);

// A fake server: "METHOD url" (or just the url, for GET) to a list of responses, each answered once in turn and the
// last one again after that. Its calls are fetchFn.mock.calls.
function server(routes) {
    const left = {"GET /api/plugins/dji-thermal/preferences": [PREFERENCES]};
    Object.keys(routes).forEach(k => { left[k.indexOf(" ") > 0 ? k : "GET " + k] = [].concat(routes[k]); });
    return jest.fn((url, opts) => {
        const key = ((opts && opts.method) || "GET") + " " + url;
        const queue = left[key];
        if (!queue) return Promise.reject(new Error("unexpected " + key));
        const r = queue.length > 1 ? queue.shift() : queue[0];
        return typeof r === "function" ? r(url, opts) : jsonResponse(r);
    });
}
const calls = fetchFn => fetchFn.mock.calls.map(c => ((c[1] && c[1].method) || "GET") + " " + c[0]);

const DATASET = {
    id: 5, name: "Roof", project: {id: 2, name: "Warehouse"}, source: "upload", status: "ready", progress: 1, error: "",
    file_count: 3, size: 3 * 1048576, thermal: 2, not_thermal: 1, errors: 0, warnings: 1, infos: 0, cameras: ["M4T"],
    analyzed: true, analyzed_at: "2026-10-18T10:00:00Z", created_at: "2026-10-18T09:00:00Z", created_by: "ana",
    can_change: true, can_delete: true
};

const ANALYSIS = {
    version: "1.1.0",
    summary: {files: {thermal: 2, not_thermal: 1}, error: 0, warning: 1, info: 1},
    cameras: [{model: "M4T", serial: "SN1", width: 640, height: 512, frames: 2}],
    files: [
        {path: "thermal/b_T.JPG", kind: "thermal", time: "2026:10:12 18:30:10", alt: 22, pitch: -90, tmin: 15.2, tmax: 50.6, tmean: 22, distance: 5, lrf: 21.4, emissivity: 0.91, lat: 42.1},
        {path: "thermal/a_T.JPG", kind: "thermal", time: "2026:10:12 18:29:50", alt: 20, pitch: -45, tmin: 17.3, tmax: 31.5, tmean: 21.9, distance: 5, lrf: null, emissivity: 0.91, lat: null},
        {path: "rgb/a_V.JPG", kind: "not_thermal", reason: "not an R-JPEG", size: 4000000}
    ],
    findings: [
        {severity: "warning", code: "temperature_max_outlier", message: "1 image with an unusual <maximum>", files: ["thermal/b_T.JPG"], suggestion: "--replace-above"},
        {severity: "info", code: "oblique", message: "1 oblique frame", files: ["thermal/a_T.JPG"], suggestion: ""}
    ],
    webodm: {
        process_command: "dji-thermal-cli process -o temp_c:tiff --normalize",
        process_args: ["-o", "temp_c:tiff", "--normalize"],
        recommended: {"radiometric-calibration": {value: "none", reason: "already temperatures"}},
        consider: {"fast-orthophoto": {value: true, reason: "flat ground"}},
        notes: ["--normalize: drift"],
        coverage: {frames: 2, gsd_m: 0.0212, area_m2: 363.9, images_per_point_median: 3, area_seen_by_3_or_more_pct: 62.9, equivalent_overlap_pct: 42.3},
        odm_arguments: ["--radiometric-calibration", "none"]
    }
};

const DEFAULTS = {
    distance: "lrf", humidity: null, emissivity: null, reflected_temp: null, ambient_temp: null, unit: "C", range_min: null,
    range_max: null, palette: null, gimbal_yaw: null, gimbal_pitch: null, gimbal_roll: null, replace_above: null,
    replace_above_value: null, replace_below: null, replace_below_value: null, strip_location: false, normalize: false, harmonize: false,
    max_pitch: null, outputs: ["temp_c:tiff", "pseudo:png"], compression: "deflate", mosaics: true
};
const PREFERENCES = {
    settings: DEFAULTS, saved: false, defaults: DEFAULTS, palettes: ["whitehot", "ironred"],
    products: [
        {product: "temp_c", description: "float32 temperature in degrees C", formats: ["tiff", "exr"]},
        {product: "pseudo", description: "8-bit RGB pseudo-colour image", formats: ["png", "tiff"]},
        {product: "gray16", description: "uint16 grayscale view", formats: ["png", "tiff"]}
    ]
};
const CONVERSION = {
    id: 9, dataset: 5, name: "Nadir", settings: Object.assign({}, DEFAULTS, {emissivity: 0.95, normalize: true}),
    description: "temp_c tiff · normalized", status: "ready", progress: 1, error: "", converted: 2, skipped: 1,
    file_count: 2, size: 2097152, created_at: "2026-10-18T11:00:00Z", finished_at: "2026-10-18T11:01:00Z", created_by: "ana"
};

describe("analyzer core", () => {
    it("says which stage a normalization or a mosaic is at, and which mosaic", () => {
        const align = {stage: "align", step: 3, steps: 6, round: 2, rounds: 3, done: 812, total: 1840, unit: "pairs"};
        expect(core.stageText(align)).toBe("step 3 of 6, aligning (round 2/3), 812/1840 pairs");
        expect(core.stageText({stage: "write", step: 6, steps: 6, done: 1, total: 2, unit: "files"})).toBe("step 6 of 6, writing, 1/2 files");
        expect(core.stageText({})).toBe("");
        expect(core.stageText(undefined)).toBe("");
        expect(core.mosaicLabel({mosaic_progress: 0.4, stage: align}))
            .toBe("Building the mosaics: step 3 of 6, aligning (round 2/3), 812/1840 pairs…");
        expect(core.mosaicLabel({mosaic_progress: 0, stage: {}})).toBe("Building the mosaics…");
    });

    it("formats sizes, statuses and EXIF capture times", () => {
        expect(core.formatBytes(3 * 1048576)).toBe("3.0 MB");
        expect(core.formatBytes(512)).toBe("512 B");
        expect(core.statusLabel({status: "analyzing", progress: 0.42})).toBe("Analyzing 42%");
        expect(core.statusLabel({status: "new", analyzed: true})).toMatch(/analyze again/);
        expect(dataset.captureTime("2026:10:12 18:29:50")).toBe("2026-10-12 18:29:50");
        expect(core.escapeHtml('<b a="1">')).toBe("&lt;b a=&quot;1&quot;&gt;");
    });

    it("converts temperatures between units, and differences by scaling alone", () => {
        expect(core.convertTemp(100, "C", "F")).toBeCloseTo(212);
        expect(core.convertTemp(212, "F", "K")).toBeCloseTo(373.15);
        expect(core.convertTemp(0, "K", "C")).toBeCloseTo(-273.15);
        expect(core.convertTemp("", "C", "F")).toBe("");
        expect(core.convertDelta(10, "C", "F")).toBeCloseTo(18);
        expect(core.convertDelta(18, "F", "K")).toBeCloseTo(10);
        expect(core.convertDelta(10, "C", "K")).toBe(10);
    });

    it("shows temperatures in Fahrenheit with WebODM's imperial units, else in Celsius", () => {
        expect(core.userUnit()).toBe("C");
        expect(core.formatTemp(21.5, "C")).toBe("21.50 °C");
        window.localStorage.setItem("unit_system", "imperial");
        expect(core.formatTemp(21.5, "C")).toBe("70.70 °F");
        expect(core.formatDelta(-0.5, "C", 1, true)).toBe("-0.9 °F");
        expect(core.formatDelta(0.5, "C", 1, true)).toBe("+0.9 °F");
        expect(core.formatTemp(273.15, "K", 1)).toBe("32.0 °F");
        window.localStorage.setItem("unit_system", "metric");
        expect(core.userUnit()).toBe("C");
        window.localStorage.clear();
    });

    it("changes WebODM's units with the user's unit and tells the page, as WebODM's own selector does", () => {
        const heard = [];
        const listener = e => heard.push(e.detail);
        document.addEventListener("onUnitSystemChanged", listener);
        core.setUserUnit("F");
        expect(window.localStorage.getItem("unit_system")).toBe("imperial");
        expect(core.formatTemp(21.5, "C")).toBe("70.70 °F");
        core.setUserUnit("C");
        expect(core.userUnit()).toBe("C");
        expect(heard).toEqual(["imperial", "metric"]);
        document.removeEventListener("onUnitSystemChanged", listener);
        window.localStorage.clear();
    });

    it("makes a unit saved in the preferences before WebODM's, once, saving them again without it", async () => {
        const saved = [];
        const fetchFn = jest.fn((url, opts) => {
            saved.push(JSON.parse(opts.body));
            return jsonResponse(Object.assign({unit: null}, JSON.parse(opts.body)));
        });
        core.setPreferences({unit: "F", palette: "ironred"});
        expect(await core.migrateUnit(fetchFn, "/api/plugins/dji-thermal/", "tok")).toBe(true);
        expect(core.userUnit()).toBe("F");
        expect(saved).toEqual([{palette: "ironred"}]);
        expect(core.preferences()).toEqual({unit: null, palette: "ironred"});
        expect(await core.migrateUnit(fetchFn, "/api/plugins/dji-thermal/", "tok")).toBe(false);
        core.setPreferences({unit: "K", palette: null});
        await core.migrateUnit(fetchFn, "/api/plugins/dji-thermal/", "tok");
        expect(core.userUnit()).toBe("C");
        core.setPreferences(null);
        window.localStorage.clear();
    });

    it("uploads an image under its place in the folder chosen, without that folder's own name", () => {
        expect(core.uploadName({name: "x_T.JPG", webkitRelativePath: "Flight 3/thermal/x_T.JPG"})).toBe("thermal/x_T.JPG");
        expect(core.uploadName({name: "x_T.JPG", webkitRelativePath: ""})).toBe("x_T.JPG");
    });

    it("splits uploads into batches by count and size, a large image going alone", () => {
        const f = (size) => ({name: "a.JPG", size});
        expect(core.batches([f(1), f(1), f(1)], 2, 100).map(b => b.length)).toEqual([2, 1]);
        expect(core.batches([f(10), f(200), f(10)], 10, 100).map(b => b.length)).toEqual([1, 1, 1]);
    });

    it("uploads only the JPEGs, sends each one's path, retries a failed request and reports what could not be sent", async () => {
        class FD { constructor() { this.parts = []; } append(k, v, n) { this.parts.push([k, n || v]); } }
        const files = [{name: "a.JPG", size: 10, webkitRelativePath: "f/t/a.JPG"}, {name: "notes.txt", size: 1}, {name: "b.jpeg", size: 10}];
        let calls = 0;
        const fetchFn = jest.fn((url, opts) => {
            calls++;
            if (calls === 1) return Promise.resolve({ok: false, json: () => Promise.resolve({})});   // retried
            return jsonResponse({saved: opts.body.parts.filter(p => p[0] === "images").length});
        });
        const progress = jest.fn();
        const r = await core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD);
        expect(r).toEqual({saved: 2, failed: [], canceled: false});
        const body = fetchFn.mock.calls[1][1].body.parts;
        expect(body).toEqual([["images", "a.JPG"], ["paths", "t/a.JPG"], ["images", "b.jpeg"], ["paths", "b.jpeg"]]);
        expect(progress).toHaveBeenLastCalledWith({sent: 2, total: 2, bytesSent: 20, bytesTotal: 20});

        const failing = jest.fn(() => Promise.reject(new Error("offline")));
        expect(await core.uploadFiles(failing, "/up", "tok", files, null, FD)).toEqual({saved: 0, failed: [files[0], files[2]], canceled: false});
        expect(failing).toHaveBeenCalledTimes(3);
    });

    it("does not count a batch that failed as sent, so the progress stops short of the images missing", async () => {
        class FD { constructor() { this.parts = []; } append(k, v, n) { this.parts.push([k, n || v]); } }
        const files = Array.from({length: 12}, (_, i) => ({name: i + ".JPG", size: 1}));
        const fetchFn = jest.fn((url, opts) => {
            const names = opts.body.parts.filter(p => p[0] === "images").map(p => p[1]);
            if (names.includes("11.JPG")) return Promise.resolve({ok: false, json: () => Promise.resolve({})});
            return jsonResponse({saved: names.length});
        });
        const progress = jest.fn();
        const r = await core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD);
        expect(r.saved).toBe(10);
        expect(r.failed).toEqual(files.slice(10));
        expect(progress).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenLastCalledWith({sent: 10, total: 12, bytesSent: 10, bytesTotal: 12});
    });

    it("gives up on a request that never answers after its timeout, sends it again, then counts its images as failed", async () => {
        jest.useFakeTimers();
        class FD { append() {} }
        const files = [{name: "a.JPG", size: 1048576}];
        expect(core.batchTimeout(1048576)).toBe(30000 + 8192);
        const stalled = jest.fn(() => new Promise(() => {}));    // ignores its signal too
        let r = null;
        core.uploadFiles(stalled, "/up", "tok", files, null, FD).then(v => { r = v; });
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        expect(stalled.mock.calls[0][1].signal.aborted).toBe(true);
        expect(stalled).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        jest.advanceTimersByTime(core.batchTimeout(1048576));
        await ticks();
        expect(stalled).toHaveBeenCalledTimes(3);
        expect(r).toEqual({saved: 0, failed: files, canceled: false});

        // A request that answers late, but before its timeout, is not sent again
        let answer;
        const slow = jest.fn(() => new Promise(res => { answer = res; }));
        r = null;
        core.uploadFiles(slow, "/up", "tok", files, null, FD).then(v => { r = v; });
        await ticks();
        jest.advanceTimersByTime(core.batchTimeout(1048576) - 1);
        answer({ok: true, json: () => Promise.resolve({saved: 1})});
        await ticks();
        expect(slow).toHaveBeenCalledTimes(1);
        expect(r).toEqual({saved: 1, failed: [], canceled: false});
    });

    it("cancels an upload: aborts the requests in flight, sends no more, and returns every image not saved", async () => {
        class FD { append() {} }
        const files = Array.from({length: 40}, (_, i) => ({name: i + ".JPG", size: 1}));
        const fetchFn = jest.fn(() => new Promise(() => {}));
        const progress = jest.fn();
        const cancel = new AbortController();
        const upload = core.uploadFiles(fetchFn, "/up", "tok", files, progress, FD, {signal: cancel.signal});
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(3);       // PARALLEL requests, a batch still waiting
        cancel.abort();
        const r = await upload;
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(fetchFn.mock.calls.every(c => c[1].signal.aborted)).toBe(true);
        expect(r.canceled).toBe(true);
        expect(r.saved).toBe(0);
        expect(r.failed.length).toBe(40);
        expect(progress).not.toHaveBeenCalled();
    });

    it("finds the median of the values given, leaving out the missing ones", () => {
        expect(core.median([3, null, 1, 2])).toBe(2);
        expect(core.median([4, 1, undefined, 2, 3])).toBe(2.5);
        expect(core.median([null])).toBe(null);
    });
});

describe("the pages' dialog", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div class="ta-page"><button id="opener">Open</button></div>';
    });
    const shown = () => document.querySelector(".ta-page .ta-dialog.ta-ask");
    const button = label => [].find.call(shown().querySelectorAll("button"), b => b.textContent === label);
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true}));

    it("asks before doing something, with its own wording, in the page's theme", async () => {
        const opener = document.getElementById("opener");
        opener.focus();
        const answer = core.ask(document, "Delete <Roof>?", ["Its 2 conversions go with it.", "Tasks are kept."], "Delete", "danger");
        expect(shown().querySelector(".ta-dialog-inner").classList.contains("theme-secondary")).toBe(true);
        expect(shown().querySelector("h4").textContent).toBe("Delete <Roof>?");
        expect([].map.call(shown().querySelectorAll("p"), p => p.textContent)).toEqual(["Its 2 conversions go with it.", "Tasks are kept."]);
        expect(button("Delete").className).toContain("btn-danger");
        expect(document.activeElement).toBe(button("Delete"));
        click(button("Delete"));
        expect(await answer).toBe(true);
        expect(shown()).toBe(null);
        expect(document.activeElement).toBe(opener);

        const canceled = core.ask(document, "Delete?", "", "Delete", "danger");
        click(button("Cancel"));
        expect(await canceled).toBe(false);
        const dismissed = core.ask(document, "Delete?", "", "Delete", "danger");
        key(document.activeElement, "Escape");
        expect(await dismissed).toBe(false);
        const beside = core.ask(document, "Delete?", "", "Delete", "danger");
        click(shown());
        expect(await beside).toBe(false);
    });

    it("edits the preferences: the unit as WebODM's, and the palette of DJI's or WebODM's, saved for the user", async () => {
        const saved = [];
        const fetchFn = jest.fn((url, opts) => {
            if (opts && opts.method === "PUT") { saved.push(JSON.parse(opts.body)); return jsonResponse(Object.assign({unit: null, palettes: []}, JSON.parse(opts.body))); }
            return jsonResponse({unit: null, palette: "ironred", palettes: ["whitehot", "ironred"], colormaps: ["magma"]});
        });
        let edited = core.editPreferences(document, fetchFn, "/api/plugins/dji-thermal/", "tok");
        await flush();
        expect(shown().querySelector("h4").textContent).toBe("Preferences");
        const [unit, palette] = shown().querySelectorAll("select");
        expect([].map.call(unit.options, o => o.value)).toEqual(["C", "F"]);
        expect(unit.value).toBe("C");
        expect(palette.value).toBe("ironred");
        expect([].map.call(palette.options, o => o.textContent)).toEqual(["Each image's own", "DJI whitehot", "DJI ironred", "magma"]);
        unit.value = "F";
        palette.value = "magma";
        click(button("Save"));
        expect(await edited).toEqual({unit: null, palette: "magma"});
        expect(saved).toEqual([{palette: "magma"}]);
        expect(fetchFn.mock.calls[1][1].headers["X-CSRFToken"]).toBe("tok");
        expect(window.localStorage.getItem("unit_system")).toBe("imperial");
        expect(core.userUnit()).toBe("F");

        edited = core.editPreferences(document, fetchFn, "/api/plugins/dji-thermal/", "tok");
        await flush();
        click(button("Cancel"));
        expect(await edited).toBe(null);
        expect(saved.length).toBe(1);
        core.setPreferences(null);
        window.localStorage.clear();
    });

    it("asks for a new name, Enter renaming, and gives nothing back for the same name or a blank one", async () => {
        let answer = core.askName(document, "Rename dataset", "Roof");
        const field = shown().querySelector("input");
        expect(field.value).toBe("Roof");
        expect(document.activeElement).toBe(field);
        field.value = "  Roof east ";
        key(field, "Enter");
        expect(await answer).toBe("Roof east");

        answer = core.askName(document, "Rename dataset", "Roof");
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = core.askName(document, "Rename dataset", "Roof");
        shown().querySelector("input").value = " ";
        click(button("Rename"));
        expect(await answer).toBe(null);
        answer = core.askName(document, "Rename dataset", "Roof");
        shown().querySelector("input").value = "Other";
        key(shown().querySelector("input"), "Escape");
        expect(await answer).toBe(null);
    });
});

describe("datasets list", () => {
    beforeEach(() => {
        document.body.innerHTML = page('datasets.html', false);
    });

    it("shows a dataset's project, progress, files and problems, with the actions its permissions allow", () => {
        const row = datasets.datasetRow(DATASET, "/plugins/dji-thermal/");
        expect(row).toContain('href="/plugins/dji-thermal/dataset/5"');
        expect(row).toContain("Warehouse");
        expect(row).toContain("2 thermal · 1 other");
        expect(row).toContain('class="label label-warning"');
        expect(row).toContain('class="ta-rename"');
        expect(row).toContain('class="ta-delete"');

        const viewer = datasets.datasetRow(Object.assign({}, DATASET, {can_change: false, can_delete: false, name: "<i>x</i>"}), "/p/");
        expect(viewer).not.toContain("ta-rename");
        expect(viewer).not.toContain("ta-delete");
        expect(viewer).toContain("&lt;i&gt;x&lt;/i&gt;");

        const running = datasets.datasetRow(Object.assign({}, DATASET, {status: "analyzing", progress: 0.3}), "/p/");
        expect(running).toContain("width: 30%");
        expect(running).not.toContain("ta-analyze");
    });

    it("lists the datasets, filters them by project and polls while one is analyzed", async () => {
        jest.useFakeTimers();
        const other = Object.assign({}, DATASET, {id: 6, name: "Yard", project: {id: 3, name: "Depot"}, status: "analyzing", progress: 0.5});
        const fetchFn = jest.fn(() => jsonResponse({datasets: [DATASET, other], projects: [{id: 2, name: "Warehouse"}]}));
        datasets.init(document, fetchFn);
        await ticks();

        expect(fetchFn).toHaveBeenCalledWith("/api/plugins/dji-thermal/datasets", {credentials: "same-origin"});
        expect(document.querySelectorAll("#ta-body tr").length).toBe(2);
        const filter = document.getElementById("ta-project-filter");
        expect([].map.call(filter.options, o => o.textContent)).toEqual(["All projects", "Warehouse", "Depot"]);
        filter.value = "3";
        filter.dispatchEvent(new Event("change"));
        expect(document.querySelectorAll("#ta-body tr").length).toBe(1);

        jest.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("sorts by any column, both ways, with what has nothing to sort by last", () => {
        const a = Object.assign({}, DATASET, {id: 1, name: "b", size: 5, last_activity: "2026-10-20T00:00:00Z"});
        const b = Object.assign({}, DATASET, {id: 2, name: "A", size: 9, last_activity: null, analyzed: false});
        const c = Object.assign({}, DATASET, {id: 3, name: "c", size: 1, last_activity: "2026-10-21T00:00:00Z", errors: 2});
        const ids = (key, desc) => datasets.sortDatasets([a, b, c], key, desc).map(d => d.id);
        expect(ids("name", false)).toEqual([2, 1, 3]);
        expect(ids("name", true)).toEqual([3, 1, 2]);
        expect(ids("size", true)).toEqual([2, 1, 3]);
        expect(ids("activity", true)).toEqual([3, 1, 2]);
        expect(ids("activity", false)).toEqual([1, 3, 2]);
        expect(ids("problems", true)).toEqual([3, 1, 2]);
    });

    it("searches the datasets' and their projects' names, every word anywhere", () => {
        expect(datasets.matchesSearch(DATASET, "")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "roof")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "ware ROO")).toBe(true);
        expect(datasets.matchesSearch(DATASET, "yard")).toBe(false);
    });

    it("filters the list by the search and sorts it by the header clicked", async () => {
        const yard = Object.assign({}, DATASET, {id: 6, name: "Yard", project: {id: 3, name: "Depot"}, created_at: "2026-10-19T09:00:00Z",
                                                 conversion_count: 2, conversions_ready: 1, last_activity: "2026-10-21T08:00:00Z"});
        datasets.init(document, jest.fn(() => jsonResponse({datasets: [yard, DATASET], projects: []})));
        await flush();
        const names = () => [].map.call(document.querySelectorAll("#ta-body tr td:first-child a"), a => a.textContent);
        expect(names()).toEqual(["Yard", "Roof"]);
        const created = document.querySelector("th[data-sort=created]");
        expect(created.getAttribute("aria-sort")).toBe("descending");
        expect(document.querySelector("#ta-body tr").textContent).toContain("1 of 2 ready");

        const name = document.querySelector("th[data-sort=name]");
        click(name);
        expect(names()).toEqual(["Roof", "Yard"]);
        expect(name.getAttribute("aria-sort")).toBe("ascending");
        expect(name.querySelector(".fa-caret-up")).not.toBeNull();
        expect(created.getAttribute("aria-sort")).toBe("none");
        click(name);
        expect(names()).toEqual(["Yard", "Roof"]);

        const search = document.getElementById("ta-search");
        search.value = "depot";
        search.dispatchEvent(new Event("input"));
        expect(names()).toEqual(["Yard"]);
        search.value = "nothing";
        search.dispatchEvent(new Event("input"));
        expect(document.getElementById("ta-table").hidden).toBe(true);
        expect(document.getElementById("ta-message").textContent).toBe("No datasets match the search.");
    });

    it("opens New Dataset with the images dropped on the page, a dropped folder's read through", async () => {
        datasets.init(document, jest.fn(() => jsonResponse({datasets: [], projects: [{id: 2, name: "Warehouse"}]})));
        await flush();
        const drag = (type, dataTransfer) => {
            const e = new Event(type, {bubbles: true, cancelable: true});
            e.dataTransfer = dataTransfer;
            document.getElementById("ta-datasets").dispatchEvent(e);
            return e;
        };
        // A folder "flight" holding one image and a sub folder with another, read a part at a time
        const fileEntry = (path, size) => ({isFile: true, fullPath: path, file: ok => ok({name: path.split("/").pop(), size})});
        const folder = (path, children) => ({isFile: false, fullPath: path, createReader: () => {
            const parts = [children.slice(0, 1), children.slice(1)];
            return {readEntries: ok => ok(parts.shift() || [])};
        }});
        const tree = folder("/flight", [fileEntry("/flight/a_T.JPG", 4), folder("/flight/sub", [fileEntry("/flight/sub/b_T.JPG", 6)]),
                                        fileEntry("/flight/notes.txt", 1)]);
        const transfer = {types: ["Files"], items: [{webkitGetAsEntry: () => tree}], files: []};

        expect(drag("dragenter", transfer).defaultPrevented).toBe(true);
        expect(document.getElementById("ta-drop-hint").hidden).toBe(false);
        expect(drag("dragover", {types: ["text/plain"]}).defaultPrevented).toBe(false);
        drag("drop", transfer);
        expect(document.getElementById("ta-drop-hint").hidden).toBe(true);
        await flush();

        expect(document.getElementById("ta-new-dialog").hidden).toBe(false);
        expect(document.getElementById("ta-new-chosen").textContent).toBe("2 image(s), 10 B (1 other file(s) left out)");
        expect(document.getElementById("ta-new-name").value).toBe("flight");

        // Dropped images alone
        const files = await datasets.droppedFiles({files: [{name: "c_T.JPG", size: 3}]});
        expect(files.map(f => f.name)).toEqual(["c_T.JPG"]);
        const nested = await datasets.droppedFiles(transfer);
        expect(nested.map(f => core.uploadName(f))).toEqual(["a_T.JPG", "sub/b_T.JPG", "notes.txt"]);
    });

    it("needs a project to add a dataset to", async () => {
        const fetchFn = jest.fn(() => jsonResponse({datasets: [], projects: []}));
        datasets.init(document, fetchFn);
        await flush();
        expect(document.getElementById("ta-new").disabled).toBe(true);
        expect(document.getElementById("ta-new").title).toMatch(/Create a project/);
        expect(document.getElementById("ta-message").textContent).toMatch(/No datasets yet/);
    });

    it("asks for a name and images before creating a dataset", async () => {
        const fetchFn = jest.fn(() => jsonResponse({datasets: [], projects: [{id: 2, name: "Warehouse"}]}));
        datasets.init(document, fetchFn);
        await flush();
        click(document.getElementById("ta-new"));
        click(document.getElementById("ta-new-create"));
        expect(document.getElementById("ta-new-error").textContent).toMatch(/name/);
        document.getElementById("ta-new-name").value = "Flight 3";
        click(document.getElementById("ta-new-create"));
        expect(document.getElementById("ta-new-error").textContent).toMatch(/images/);
        expect(fetchFn.mock.calls.length).toBe(1);
    });

    it("says why a dataset could not be created", async () => {
        const fetchFn = jest.fn()
            .mockImplementationOnce(() => jsonResponse({datasets: [], projects: [{id: 2, name: "Warehouse"}]}))
            .mockImplementationOnce(() => jsonResponse({project: ["Choose a project you can add to"]}, false))
            .mockImplementation(() => jsonResponse({datasets: [], projects: [{id: 2, name: "Warehouse"}]}));
        datasets.init(document, fetchFn, jest.fn());
        await flush();
        click(document.getElementById("ta-new"));
        document.getElementById("ta-new-name").value = "Roof";
        // Choosing images
        const input = document.getElementById("ta-new-files");
        Object.defineProperty(input, "files", {value: [{name: "a_T.JPG", size: 5}]});
        input.dispatchEvent(new Event("change"));
        expect(document.getElementById("ta-new-chosen").textContent).toMatch(/1 image/);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        expect(document.getElementById("ta-new-error").textContent).toBe("Choose a project you can add to");
        expect(document.getElementById("ta-new-dialog").hidden).toBe(false);
    });
});

describe("datasets list actions and an upload that does not all arrive", () => {
    const LIST = {datasets: [DATASET], projects: [{id: 2, name: "Warehouse"}]};
    const API = "/api/plugins/dji-thermal/";
    beforeEach(() => {
        document.body.innerHTML = page('datasets.html', false);
    });

    // Opens New Dataset with images chosen: k_T.JPG goes in a request of its own (ten images to a request)
    async function choose(names) {
        await flush();
        click(document.getElementById("ta-new"));
        document.getElementById("ta-new-name").value = "Roof";
        const input = document.getElementById("ta-new-files");
        Object.defineProperty(input, "files", {value: names.map(n => new File(["x"], n))});
        change(input);
    }
    const NAMES = "abcdefghijk".split("").map(c => c + "_T.JPG");
    const paths = opts => opts.body.getAll("paths");

    it("shows a dataset being converted as such, polls until it is done, and labels its icon links", async () => {
        jest.useFakeTimers();
        const fetchFn = server({[API + "datasets"]: [{datasets: [Object.assign({}, DATASET, {busy: true})], projects: []}, LIST]});
        datasets.init(document, fetchFn);
        await ticks();
        expect(document.querySelector("#ta-body tr").textContent).toContain("Converting");
        expect(document.querySelector(".ta-delete").getAttribute("aria-label")).toBe("Delete");
        jest.runOnlyPendingTimers();
        await ticks();
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(document.querySelector("#ta-body tr").textContent).not.toContain("Converting");
        jest.runOnlyPendingTimers();
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("renames a dataset in the page's dialog", async () => {
        const fetchFn = server({[API + "datasets"]: LIST, ["PATCH " + API + "datasets/5"]: DATASET});
        datasets.init(document, fetchFn);
        await flush();
        click(document.querySelector(".ta-rename"));
        expect(document.getElementById("ta-ask-field").value).toBe("Roof");
        document.getElementById("ta-ask-field").value = " Roof east ";
        press("Rename");
        await flush();
        const patch = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PATCH")[0];
        expect(JSON.parse(patch[1].body)).toEqual({name: "Roof east"});
        expect(askDialog()).toBeNull();
    });

    it("says what deleting a dataset takes with it before deleting it", async () => {
        const d = Object.assign({}, DATASET, {conversion_count: 2, mosaic_count: 1, measurement_count: 14, task_count: 1});
        const fetchFn = server({[API + "datasets"]: {datasets: [d], projects: []}, ["DELETE " + API + "datasets/5"]: {}});
        datasets.init(document, fetchFn);
        await flush();
        click(document.querySelector(".ta-delete"));
        const text = askDialog().textContent;
        expect(text).toContain("“Roof” and its 3 images are deleted, with the task that holds them in the project.");
        expect(text).toContain("With it: 2 worksets, 1 mosaic and 14 measurements.");
        expect(text).toContain("WebODM tasks made from its worksets are kept");
        expect(core.deleteText(Object.assign({}, DATASET, {conversion_count: 2})).join(" ")).not.toContain("tasks");
        const kept = core.deleteText(Object.assign({}, DATASET, {parent: {images_count: 12, processed: true}})).join(" ");
        expect(kept).toContain("are deleted.");
        expect(kept).toContain("The dataset's task is kept as an ordinary WebODM task, “Roof”, with the 12 images sent to it and what it processed.");
        expect(text).toContain("cannot be undone");
        press("Cancel");
        await flush();
        expect(calls(fetchFn)).not.toContain("DELETE " + API + "datasets/5");

        click(document.querySelector(".ta-delete"));
        press("Delete");
        await flush();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/5");

    });

    it("stops when images could not be sent, and analyzes once they are sent again", async () => {
        let failing = true;
        const nav = jest.fn();
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: (url, opts) => failing && paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {}
        });
        datasets.init(document, fetchFn, nav);
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();

        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(document.getElementById("ta-new-error").textContent).toBe(
            "1 image could not be sent: k_T.JPG. 10 images arrived: send the others again, or analyze without them.");
        expect(document.getElementById("ta-new-create").hidden).toBe(true);
        expect(document.getElementById("ta-new-retry").hidden).toBe(false);
        expect(document.getElementById("ta-new-without").hidden).toBe(false);
        expect(document.getElementById("ta-new-cancel").disabled).toBe(false);

        failing = false;
        click(document.getElementById("ta-new-retry"));
        await flush(); await flush();
        const uploads = fetchFn.mock.calls.filter(c => c[0] === API + "datasets/8/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/plugins/dji-thermal/dataset/8");
    });

    it("analyzes without the images that could not be sent, and offers only to send them again when none arrived", async () => {
        const nav = jest.fn();
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: (url, opts) => paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + API + "datasets/8/analyze"]: {}
        });
        datasets.init(document, fetchFn, nav);
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        click(document.getElementById("ta-new-without"));
        await flush();
        expect(calls(fetchFn)).toContain("POST " + API + "datasets/8/analyze");
        expect(nav).toHaveBeenCalledWith("/plugins/dji-thermal/dataset/8");

        document.body.innerHTML = page('datasets.html', false);
        datasets.init(document, server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            ["POST " + API + "datasets/8/upload"]: () => jsonResponse({}, false)
        }), jest.fn());
        await choose(["a_T.JPG"]);
        click(document.getElementById("ta-new-create"));
        await flush(); await flush();
        expect(document.getElementById("ta-new-error").textContent).toMatch(/None arrived/);
        expect(document.getElementById("ta-new-retry").hidden).toBe(false);
        expect(document.getElementById("ta-new-without").hidden).toBe(true);
    });

    it("cancels an upload under way, deleting the new dataset with the images sent so far", async () => {
        const fetchFn = server({
            [API + "datasets"]: LIST, ["POST " + API + "datasets"]: Object.assign({}, DATASET, {id: 8}),
            // The requests hang until they are aborted
            ["POST " + API + "datasets/8/upload"]: () => new Promise(() => {}),
            ["DELETE " + API + "datasets/8"]: {}
        });
        datasets.init(document, fetchFn, jest.fn());
        await choose(NAMES);
        click(document.getElementById("ta-new-create"));
        await flush();
        expect(document.getElementById("ta-new-cancel").disabled).toBe(false);
        const leaving = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);

        click(document.getElementById("ta-new-cancel"));
        expect(askDialog().textContent).toContain("The images sent so far are deleted with the dataset.");
        press("Delete it");
        await flush(); await flush();
        expect(calls(fetchFn)).toContain("DELETE " + API + "datasets/8");
        expect(calls(fetchFn)).not.toContain("POST " + API + "datasets/8/analyze");
        expect(document.getElementById("ta-new-dialog").hidden).toBe(true);
        const after = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });
});

describe("a dataset's page", () => {
    beforeEach(() => {
        document.body.innerHTML = page('dataset.html');
        window.history.replaceState(null, "", "/");    // no tab linked by an earlier test's hash
    });

    it("sums up the frames, cameras, temperatures and capture times", () => {
        const o = dataset.overview(ANALYSIS);
        expect(o).toMatchObject({frames: 2, other: 1, tmin: 15.2, tmax: 50.6, first: "2026-10-12 18:29:50", last: "2026-10-12 18:30:10", altitude: 21, gps: 1});
        const html = dataset.overviewHtml(Object.assign({}, DATASET, {analysis: ANALYSIS}));
        expect(html).toContain("<strong>M4T</strong>");
        expect(html).toContain("640×512 · SN SN1");
        expect(html).toContain('15.2 °C <span class="ta-to">to</span> 50.6 °C');
        expect(html).toContain("1 of 2 with GPS");
        expect(html).toContain("18:29:50 – 18:30:10 · 20 s");
        expect(html).toContain("1 other file, not thermal frames");
        expect(html).toContain("dji-thermal-cli 1.1.0");
        expect(html).not.toContain("All frames");
    });

    it("gives each camera a row of its own, with a row for all of them", () => {
        const two = Object.assign({}, ANALYSIS, {
            cameras: ANALYSIS.cameras.concat([{model: "H20T", serial: "SN2", width: 640, height: 512, frames: 1}]),
            files: ANALYSIS.files.map(f => Object.assign({model: "M4T", serial: "SN1", width: 640, height: 512}, f)).concat([
                {path: "h20t/c_T.JPG", kind: "thermal", model: "H20T", serial: "SN2", width: 640, height: 512, tmin: 5, tmax: 12, lat: 42, alt: 40}])
        });
        const rows = dataset.summaryRows(two);
        expect(rows.map(r => [r.model, r.frames, r.tmax])).toEqual([["M4T", 2, 50.6], ["H20T", 1, 12]]);
        const html = dataset.overviewHtml(Object.assign({}, DATASET, {analysis: two}));
        expect(html).toContain("All frames");
        expect(html).toContain('data-camera="H20T|SN2|640|512"');
    });

    it("says how long the frames were taken over", () => {
        expect(dataset.duration("2026-10-22 16:32:53", "2026-10-22 16:40:04")).toBe("7 min 11 s");
        expect(dataset.duration("2026-10-22 16:32:53", "2026-10-22 18:02:53")).toBe("1 h 30 min");
        expect(dataset.duration("2026-10-22 16:32:53", "2026-10-22 16:32:53")).toBe("");
    });

    it("lists the files sorted, with the problems that name them, and filters them", () => {
        let html = dataset.filesHtml(ANALYSIS, {sort: "tmax", desc: true});
        expect(html.indexOf("thermal/b_T.JPG")).toBeLessThan(html.indexOf("thermal/a_T.JPG"));
        expect(html).toContain("5.0 m / 21.4 m");
        expect(html).toContain('title="1 image with an unusual &lt;maximum&gt;">temperature_max_outlier');
        expect(html).toContain("not an R-JPEG");

        html = dataset.filesHtml(ANALYSIS, {show: "thermal"});
        expect(html).not.toContain("rgb/a_V.JPG");
        expect(html).toContain("2 shown");
        html = dataset.filesHtml(ANALYSIS, {show: "flagged"});
        expect(html).toContain("2 shown");    // the outlier and the oblique frame
    });

    it("sorts missing values last either way", () => {
        const rows = [{v: 2}, {v: null}, {v: 1}];
        expect(dataset.sortRows(rows, "v").map(r => r.v)).toEqual([1, 2, null]);
        expect(dataset.sortRows(rows, "v", true).map(r => r.v)).toEqual([2, 1, null]);
    });

    it("shows the problems with what addresses them, and the WebODM plan", () => {
        const problems = dataset.problemsHtml(ANALYSIS);
        expect(problems).toContain("alert-warning");
        expect(problems).toContain("Replace temperatures above");
        expect(problems).toContain("<code>thermal/b_T.JPG</code>");
        expect(dataset.problemsHtml({findings: []})).toMatch(/no problems/);

        const plan = dataset.planHtml(ANALYSIS);
        expect(plan).toContain("2.1 cm/px");
        expect(plan).toContain("<code>radiometric-calibration</code>");
        expect(plan).toContain("--radiometric-calibration none");
        expect(plan).toContain("dji-thermal-cli process -o temp_c:tiff --normalize");
        expect(dataset.planHtml({})).toMatch(/No plan/);
    });

    it("says who can see the dataset", () => {
        const s = dataset.sharingHtml({owner: "ana", users: ["ana", "ben"], groups: ["Default", "Inspectors"], everyone: true});
        expect(s).toContain("ana (the project's owner), everyone (the Default group), group Inspectors, ben");
        expect(dataset.sharingHtml({owner: "ana", users: ["ana"], groups: [], everyone: false})).toContain("owner) only");
    });

    afterEach(() => { window.localStorage.clear(); delete navigator.clipboard; });

    it("filters the files by every word of a name, and shows thumbnails", () => {
        expect(dataset.fileRows(ANALYSIS, {filter: "T.jpg THERMAL"}).map(f => f.path)).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(dataset.fileRows(ANALYSIS, {filter: "a_ jpg"}).map(f => f.path)).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG"]);

        let html = dataset.filesHtml(ANALYSIS, {});
        expect(html).not.toContain("data-href");
        expect(html).not.toContain("ta-thumb");
        html = dataset.filesHtml(ANALYSIS, {thumbs: "/t?file="});
        expect(html).toContain('<img loading="lazy" alt="" src="/t?file=rgb%2Fa_V.JPG">');
    });

    it("filters while typing through the polls, and remembers the thumbnails", async () => {
        jest.useFakeTimers();
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {status: "analyzing", progress: 0.5, analysis: ANALYSIS})});
        dataset.init(document, fetchFn);
        await ticks();
        const tab = document.getElementById("ta-tab-files");

        const filter = tab.querySelector(".ta-files-filter");
        filter.value = "rgb";
        filter.dispatchEvent(new Event("input", {bubbles: true}));
        expect(tab.querySelectorAll("tbody tr").length).toBe(1);
        expect(tab.querySelector(".ta-files-shown").textContent).toBe("1 shown");
        // An analysis running polls the dataset: the filter being typed in stays
        jest.runOnlyPendingTimers();
        await ticks();
        expect(calls(fetchFn).filter(c => c === "GET " + URL5).length).toBe(2);
        expect(tab.querySelector(".ta-files-filter")).toBe(filter);

        const thumbs = tab.querySelector(".ta-files-thumbs");
        thumbs.checked = true;
        change(thumbs);
        expect(tab.querySelector(".ta-thumb img").getAttribute("src")).toBe(URL5 + "/thumbnail?file=rgb%2Fa_V.JPG");
        expect(window.localStorage.getItem("thermalAnalyzer.thumbnails")).toBe("1");

        document.body.innerHTML = page('dataset.html');
        dataset.init(document, fetchFn);
        await ticks();
        expect(document.querySelector(".ta-files-thumbs").checked).toBe(true);
        // With a preferred DJI palette, thermal frames are drawn in it
        core.setPreferences({palette: "ironred"});
        document.body.innerHTML = page('dataset.html');
        dataset.init(document, fetchFn);
        await ticks();
        document.querySelector('#ta-tabs a[data-tab="files"]').click();
        expect(document.querySelector(".ta-thumb img").getAttribute("src")).toBe(URL5 + "/thumbnail?palette=ironred&file=rgb%2Fa_V.JPG");
        core.setPreferences(null);
        expect(document.querySelectorAll(".ta-thumb img").length).toBe(3);
        jest.clearAllTimers();    // no more polls into the next test's page
    });

    it("selects files on the Files tab and shows the one selected, or the one under the mouse, in a detail pane", async () => {
        window.localStorage.removeItem("thermalAnalyzer.hoverDetail");
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS})});
        dataset.init(document, fetchFn);
        await ticks();
        click(document.querySelector('#ta-tabs a[data-tab="files"]'));
        const tab = document.getElementById("ta-tab-files");
        const pane = () => tab.querySelector(".ta-file-detail");
        const row = p => tab.querySelector('tbody tr[data-path="' + p + '"]');
        const press = (el, keys) => el.dispatchEvent(new MouseEvent("click", Object.assign({bubbles: true}, keys)));
        const selected = () => [...tab.querySelectorAll("tbody tr.ta-selected")].map(r => r.getAttribute("data-path"));
        expect(pane().hidden).toBe(true);

        // Hover for Detail: the pane follows the mouse while nothing is selected
        row("thermal/a_T.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().hidden).toBe(true);
        tab.querySelector(".ta-files-hover").checked = true;
        change(tab.querySelector(".ta-files-hover"));
        expect(window.localStorage.getItem("thermalAnalyzer.hoverDetail")).toBe("1");
        row("thermal/a_T.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().hidden).toBe(false);
        expect(pane().querySelector(".ta-file-detail-head").textContent).toBe("a_T.JPG");
        expect(pane().querySelector(".close")).toBeNull();
        expect(pane().querySelector("img").getAttribute("src")).toBe(URL5 + "/thumbnail?size=large&file=thermal%2Fa_T.JPG");    // drawn in a palette
        expect(pane().querySelector(".ta-file-detail-actions a").getAttribute("href")).toBe(URL5 + "/files?file=thermal%2Fa_T.JPG&download=1");
        expect(pane().querySelector(".ta-file-detail-table").textContent).toContain("Max");

        // A click selects: the pane stays on it, whatever the mouse is over, until it is unselected
        press(row("thermal/b_T.JPG").querySelector("td:last-child"));
        expect(selected()).toEqual(["thermal/b_T.JPG"]);
        row("thermal/a_T.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().querySelector(".ta-file-detail-head strong").textContent).toBe("b_T.JPG");
        expect(pane().querySelector(".close")).not.toBeNull();
        press(row("thermal/b_T.JPG"));
        expect(selected()).toEqual([]);
        row("rgb/a_V.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().querySelector(".ta-file-detail-head").textContent).toBe("a_V.JPG");

        // Several: Ctrl/Cmd-click adds, Shift-click a range; the pane counts them and downloads them as a zip
        press(row("rgb/a_V.JPG"));
        press(row("thermal/b_T.JPG"), {metaKey: true});
        expect(selected().sort()).toEqual(["rgb/a_V.JPG", "thermal/b_T.JPG"]);
        expect(pane().textContent).toContain("2 images selected");
        press(row("rgb/a_V.JPG"));
        press(row("thermal/b_T.JPG"), {shiftKey: true});
        expect(selected()).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG", "thermal/b_T.JPG"]);
        const submit = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function () {
            this.sent = {action: this.getAttribute("action"), method: this.method,
                         files: [...this.querySelectorAll('input[name="file"]')].map(i => i.value)};
            submit.form = this;
        });
        click(pane().querySelector('[data-act="download-selected"]'));
        expect(submit.form.sent).toEqual({action: URL5 + "/files", method: "post", files: ["rgb/a_V.JPG", "thermal/a_T.JPG", "thermal/b_T.JPG"]});
        submit.mockRestore();
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(selected()).toEqual([]);
        window.localStorage.removeItem("thermalAnalyzer.hoverDetail");
        jest.clearAllTimers();
    });

    it("lists a file's details in the pane, leaving out what it doesn't have", () => {
        const rows = dataset.detailRows({path: "t/a_T.JPG", kind: "thermal", model: "M4T", serial: "SN1", width: 640, height: 512,
            size: 1048576, tmax: 50.56, lat: 41.1234567, warnings: ["odd"]}, [{code: "no_gps", message: "No GPS"}]);
        expect(rows).toEqual([["Kind", "Thermal"], ["Camera", "M4T · SN SN1"], ["Image size", "640 × 512 px"], ["File size", "1.0 MB"],
            ["Latitude", "41.1234567"], ["Max", "50.6 °C"], ["Warning", "odd"], ["no_gps", "No GPS"]]);
        expect(dataset.detailHtml(ANALYSIS, [], false, {files: "/f?file="})).toBe("");
    });

    it("shows a problem's file on the Files tab, filtered to it", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS})});
        dataset.init(document, fetchFn);
        await ticks();
        click(document.querySelector('#ta-tabs a[data-tab="problems"]'));
        document.querySelector('#ta-tab-files input[value="thermal"]').checked = true;
        change(document.querySelector('#ta-tab-files input[value="thermal"]'));

        click(document.querySelector('#ta-tab-problems a[data-file="thermal/b_T.JPG"] code'));
        const tab = document.getElementById("ta-tab-files");
        expect(tab.hidden).toBe(false);
        expect(document.getElementById("ta-tab-problems").hidden).toBe(true);
        expect(tab.querySelector(".ta-files-filter").value).toBe("thermal/b_T.JPG");
        expect(tab.querySelector('input[value="all"]').checked).toBe(true);
        expect([...tab.querySelectorAll("tbody tr")].map(r => r.className)).toEqual(["ta-kind-thermal"]);
    });

    it("opens the Files tab from the summary: a camera's frames, sorted by the figure clicked, or those without GPS", async () => {
        const analysis = Object.assign({}, ANALYSIS, {files: ANALYSIS.files.map(f => f.kind === "thermal" ?
            Object.assign({model: "M4T", serial: "SN1", width: 640, height: 512}, f) : f)});
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis})});
        dataset.init(document, fetchFn);
        await ticks();
        const tab = document.getElementById("ta-tab-files");
        const paths = () => [...tab.querySelectorAll("tbody tr td:first-child")].map(td => td.textContent);
        click(document.querySelector('#ta-tabs a[data-tab="problems"]'));

        click(document.querySelector('.ta-summary-link[data-files-sort="tmax"] .ta-figure'));
        expect(tab.hidden).toBe(false);
        expect(paths()).toEqual(["thermal/b_T.JPG", "thermal/a_T.JPG"]);
        expect(tab.querySelector(".ta-files-scope").textContent).toContain("M4T SN1");

        click(document.querySelector(".ta-gps-missing"));
        expect(paths()).toEqual(["thermal/a_T.JPG"]);
        expect(tab.querySelector(".ta-files-scope").textContent).toContain("without GPS");

        click(tab.querySelector('[data-act="scope-clear"]'));
        expect(paths()).toEqual(["rgb/a_V.JPG", "thermal/a_T.JPG", "thermal/b_T.JPG"]);
        expect(tab.querySelector(".ta-files-scope")).toBeNull();

        const row = document.querySelector("tr.ta-summary-row");
        row.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        expect(paths()).toEqual(["thermal/a_T.JPG", "thermal/b_T.JPG"]);
    });

    it("copies the plan's options and command, and offers to convert with it only to who can", async () => {
        navigator.clipboard = {writeText: jest.fn(() => Promise.resolve())};
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS})});
        dataset.init(document, fetchFn);
        await ticks();
        const buttons = document.querySelectorAll("#ta-tab-webodm .ta-copy");
        expect(buttons.length).toBe(2);
        click(buttons[0].querySelector("i"));
        click(buttons[1]);
        await flush();
        expect(navigator.clipboard.writeText.mock.calls).toEqual([["--radiometric-calibration none"],
                                                                  ["dji-thermal-cli process -o temp_c:tiff --normalize"]]);
        expect(buttons[1].textContent).toMatch(/Copied/);
        expect(document.getElementById("ta-plan-convert")).not.toBe(null);
        expect(dataset.planHtml(ANALYSIS, false)).not.toContain("ta-plan-convert");
    });

    it("loads the dataset, switches tabs and polls while it is analyzed", async () => {
        jest.useFakeTimers();
        const analyzing = Object.assign({}, DATASET, {status: "analyzing", progress: 0.4, analysis: {}, analyzed: false});
        const fetchFn = server({
            "/api/plugins/dji-thermal/datasets/5": [analyzing,
                Object.assign({}, DATASET, {analysis: ANALYSIS, sharing: {owner: "ana", users: [], groups: [], everyone: false}})]
        });
        dataset.init(document, fetchFn);
        await ticks();

        expect(fetchFn.mock.calls[0][0]).toBe("/api/plugins/dji-thermal/datasets/5");
        expect(document.getElementById("ta-status").innerHTML).toContain("40%");
        // Before the analysis, only the Convert tab: converting needs none
        expect(document.getElementById("ta-tabs").hidden).toBe(false);
        expect(document.querySelector('#ta-tabs a[data-tab="files"]').parentNode.hidden).toBe(true);
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-cancel").hidden).toBe(false);
        expect(document.getElementById("ta-add").hidden).toBe(true);

        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-tabs").hidden).toBe(false);
        // Still on the Worksets tab once analyzed, the other tabs shown beside it
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-tab-files").hidden).toBe(true);
        expect(document.querySelector('#ta-tabs a[data-tab="files"]').parentNode.hidden).toBe(false);
        expect(document.querySelector("#ta-tabs li a").getAttribute("data-tab")).toBe("convert");
        expect(document.getElementById("ta-cancel").hidden).toBe(true);
        expect(document.getElementById("ta-add").hidden).toBe(false);
        expect(document.getElementById("ta-problems-count").textContent).toBe("1");
        expect(document.getElementById("ta-sharing").hidden).toBe(false);

        click(document.querySelector('#ta-tabs a[data-tab="webodm"]'));
        expect(document.getElementById("ta-tab-webodm").hidden).toBe(false);
        expect(document.getElementById("ta-tab-files").hidden).toBe(true);
    });

    it("hides what a viewer cannot do", async () => {
        const fetchFn = jest.fn(() => jsonResponse(Object.assign({}, DATASET, {analysis: ANALYSIS, can_change: false, can_delete: false})));
        dataset.init(document, fetchFn);
        await flush();
        ["ta-add", "ta-analyze", "ta-rename", "ta-delete", "ta-sharing"].forEach(id =>
            expect(document.getElementById(id).hidden).toBe(true));
        expect(document.getElementById("ta-copy-link").hidden).toBe(false);
    });

    it("cancels a running analysis", async () => {
        const fetchFn = server({
            "/api/plugins/dji-thermal/datasets/5": Object.assign({}, DATASET, {status: "analyzing", analysis: {}}),
            "POST /api/plugins/dji-thermal/datasets/5/cancel": Object.assign({}, DATASET, {status: "canceled", analysis: {}})
        });
        dataset.init(document, fetchFn);
        await flush();
        click(document.getElementById("ta-cancel"));
        await flush();
        expect(calls(fetchFn)).toContain("POST /api/plugins/dji-thermal/datasets/5/cancel");
        expect(document.getElementById("ta-status").textContent).toMatch(/canceled/);
    });

    const URL5 = "/api/plugins/dji-thermal/datasets/5";
    const NAMES = "abcdefghijk".split("").map(c => c + "_T.JPG");
    const paths = opts => opts.body.getAll("paths");
    function addImages(names) {
        const input = document.getElementById("ta-add-files");
        Object.defineProperty(input, "files", {value: names.map(n => new File(["x"], n)), configurable: true});
        change(input);
    }

    it("renames, deletes and shares the link in the page's dialog", async () => {
        const nav = jest.fn();
        const d = Object.assign({}, DATASET, {analysis: ANALYSIS, conversion_count: 1, mosaic_count: 1, measurement_count: 0});
        const fetchFn = server({[URL5]: d,
                                ["PATCH " + URL5]: Object.assign({}, d, {name: "Roof east"}), ["DELETE " + URL5]: {}});
        dataset.init(document, fetchFn, nav);
        await flush();

        click(document.getElementById("ta-rename"));
        document.getElementById("ta-ask-field").value = "Roof east";
        press("Rename");
        await flush();
        expect(JSON.parse(fetchFn.mock.calls.find(c => c[1] && c[1].method === "PATCH")[1].body)).toEqual({name: "Roof east"});
        expect(document.getElementById("ta-name").textContent).toBe("Roof east");

        click(document.getElementById("ta-delete"));
        expect(askDialog().textContent).toContain("With it: 1 workset and 1 mosaic.");
        press("Delete");
        await flush();
        expect(calls(fetchFn)).toContain("DELETE " + URL5);
        expect(nav).toHaveBeenCalledWith("/plugins/dji-thermal/");

        // No clipboard here: the link is shown to copy by hand
        click(document.getElementById("ta-copy-link"));
        expect(document.getElementById("ta-ask-field").value).toBe(window.location.origin + "/plugins/dji-thermal/dataset/5");
        expect(document.getElementById("ta-ask-field").readOnly).toBe(true);
        press("Close");
        expect(askDialog()).toBeNull();
    });

    it("copies the dataset's link from the icon beside its name, ticked for a moment", async () => {
        navigator.clipboard = {writeText: jest.fn(() => Promise.resolve())};
        dataset.init(document, server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS})}));
        await flush();
        jest.useFakeTimers();
        const icon = document.getElementById("ta-copy-link");
        expect(icon.closest("h3")).not.toBeNull();
        expect(document.getElementById("ta-prefs")).toBeNull();
        click(icon);
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.origin + "/plugins/dji-thermal/dataset/5");
        expect(icon.innerHTML).toContain("fa-check");
        jest.advanceTimersByTime(2000);
        expect(icon.innerHTML).toContain("fa-link");
        jest.useRealTimers();
    });

    it("names the added images that could not be sent, and sends only them again", async () => {
        let failing = true;
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}),
            ["POST " + URL5 + "/upload"]: (url, opts) => failing && paths(opts).includes("k_T.JPG") ?
                jsonResponse({}, false) : jsonResponse({saved: paths(opts).length}),
            ["POST " + URL5 + "/analyze"]: Object.assign({}, DATASET, {analysis: ANALYSIS})
        });
        dataset.init(document, fetchFn);
        await flush();
        addImages(NAMES);
        await flush(); await flush();
        expect(calls(fetchFn)).toContain("POST " + URL5 + "/analyze");
        expect(document.getElementById("ta-add-failed").hidden).toBe(false);
        expect(document.getElementById("ta-add-failed-text").textContent).toBe("1 image could not be sent: k_T.JPG.");

        failing = false;
        click(document.getElementById("ta-add-retry"));
        await flush(); await flush();
        const uploads = fetchFn.mock.calls.filter(c => c[0] === URL5 + "/upload");
        expect(paths(uploads[uploads.length - 1][1])).toEqual(["k_T.JPG"]);
        expect(calls(fetchFn).filter(c => c === "POST " + URL5 + "/analyze").length).toBe(2);
        expect(document.getElementById("ta-add-failed").hidden).toBe(true);
    });

    it("cancels adding images, keeping those already sent", async () => {
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS}),
            // k_T.JPG's request hangs until it is aborted
            ["POST " + URL5 + "/upload"]: (url, opts) => paths(opts).includes("k_T.JPG") ?
                new Promise(() => {}) : jsonResponse({saved: paths(opts).length})
        });
        dataset.init(document, fetchFn);
        await flush();
        addImages(NAMES);
        await flush();
        expect(document.getElementById("ta-add-progress").hidden).toBe(false);
        expect(document.getElementById("ta-add").hidden).toBe(true);
        const leaving = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);

        click(document.getElementById("ta-add-cancel"));
        await flush(); await flush();
        expect(document.getElementById("ta-add-progress").hidden).toBe(true);
        expect(calls(fetchFn).filter(c => c.startsWith("DELETE") || c.endsWith("/analyze"))).toEqual([]);
        expect(document.getElementById("ta-add-failed-text").textContent).toBe(
            "Upload canceled: 10 images were sent and kept (analyze again to include them), 1 image was not sent.");
        expect(document.getElementById("ta-add").hidden).toBe(false);
        const after = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
    });
});

describe("a dataset's conversions", () => {
    const URL5 = "/api/plugins/dji-thermal/datasets/5";
    beforeEach(() => {
        document.body.innerHTML = page('dataset.html');
    });
    const form = () => document.getElementById("ta-convert-form");
    const input = name => form().querySelector('[name="' + name + '"]');

    afterEach(() => { window.localStorage.clear(); window.history.replaceState(null, "", "/"); });

    it("shows what the flight recorded beside each measurement parameter, in the user's unit", () => {
        const rec = conversions.recorded(Object.assign({}, ANALYSIS, {files: ANALYSIS.files.concat(
            [{path: "c_T.JPG", kind: "thermal", distance: 7, lrf: 20, humidity: 50, emissivity: 0.95, reflection: 20, ambient: 25}])}));
        expect(rec).toMatchObject({distance: 5, lrf: 20.7, emissivity: 0.91, reflection: 20});
        window.localStorage.setItem("unit_system", "imperial");
        // The files in kelvin: the form is still in the user's unit
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(Object.assign({}, DEFAULTS, {unit: "K"}), PREFERENCES, rec) + "</div>";
        const html = document.getElementById("f").innerHTML;
        expect(html).toContain("Recorded: 5.0 m; laser rangefinder: 20.7 m");
        expect(html).toContain("Reflected temperature (°F)");
        expect(html).toContain("Recorded: 68.0 °F");      // 20 °C
        expect(html).toContain("Recorded: 0.91");
        expect(html).toContain("Relative humidity (%)");
        expect(html).toContain("Colour range (°F)");
        expect(document.querySelector('[name="unit"]').value).toBe("K");
    });

    it("puts the colours first, above the outputs, the default naming the images' own palette", () => {
        const files = palettes => palettes.map((p, i) => ({path: i + "_T.JPG", kind: "thermal", palette: p}));
        const own = analysis => {
            document.body.innerHTML = '<div id="f">' + conversions.formHtml(DEFAULTS, PREFERENCES, conversions.recorded(analysis)) + "</div>";
            return document.querySelector('[name="palette"] option[value=""]').textContent;
        };
        expect(own({files: files(["ironred", "ironred"])})).toBe("Each image's own (ironred)");
        expect(own({files: files(["whitehot", "ironred", "ironred", ""])})).toBe("Each image's own (ironred on 2, whitehot on 1)");
        expect(own(ANALYSIS)).toBe("Each image's own");
        const sections = [].map.call(document.querySelectorAll("#f > .ta-section"), el => el.querySelector("h4").textContent);
        expect(sections).toEqual(["Colours", "Outputs", "Measurement", "Frames", "Adjustments"]);
        const colours = document.querySelector("#f > .ta-section");
        expect(colours.tagName).toBe("DIV");
        expect(colours.querySelector('[name="palette"]')).not.toBe(null);
        expect(colours.querySelector('[name="range_min"]')).not.toBe(null);
        expect([].map.call(document.querySelectorAll('[name="palette"] option'), o => o.value)).toEqual(["", "whitehot", "ironred"]);
    });

    it("shows the temperatures in the user's unit and reads them back in the files'", () => {
        window.localStorage.setItem("unit_system", "imperial");
        const s = Object.assign({}, DEFAULTS, {unit: "C", reflected_temp: 20, range_min: 10, range_max: 60,
            replace_above: 150, replace_above_value: "nodata", replace_below: -10, replace_below_value: 0});
        document.body.innerHTML = '<div id="ta-convert-form">' + conversions.formHtml(s, PREFERENCES, {}) + "</div>";
        expect(input("reflected_temp").value).toBe("68");
        expect(input("range_min").value).toBe("50");
        expect(input("range_max").value).toBe("140");
        expect(input("replace_above").value).toBe("302");
        expect(input("replace_below").value).toBe("14");
        expect(input("replace_below_value").value).toBe("32");
        expect(conversions.readForm(form())).toEqual(s);

        // What is typed is given in the files' unit, here kelvin
        input("unit").value = "K";
        input("ambient_temp").value = "77";
        const read = conversions.readForm(form());
        expect(read).toMatchObject({unit: "K", reflected_temp: 293.15, ambient_temp: 298.15, range_min: 283.15, replace_above_value: "nodata"});
    });

    it("chooses the user's unit for the files when the settings name none", () => {
        window.localStorage.setItem("unit_system", "imperial");
        document.body.innerHTML = '<div id="ta-convert-form">' + conversions.formHtml(Object.assign({}, DEFAULTS, {unit: undefined}), PREFERENCES, {}) + "</div>";
        expect(input("unit").value).toBe("F");
        expect(form().innerHTML).toContain("Reflected temperature (°F)");
    });

    it("reads the form back as the settings it shows", () => {
        const s = Object.assign({}, DEFAULTS, {distance: 12.5, emissivity: 0.95, palette: "ironred", range_min: 10, range_max: 60,
            replace_above: 150, replace_above_value: "nodata", normalize: true, max_pitch: -80, outputs: ["temp_c:exr", "gray16:png"]});
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(s, PREFERENCES, {}) + "</div>";
        const read = conversions.readForm(document.getElementById("f"));
        expect(read).toEqual(Object.assign({}, s));
        expect(conversions.formProblem(read)).toBe(null);
        expect(conversions.formProblem(Object.assign({}, read, {outputs: []}))).toMatch(/at least one output/);
        expect(conversions.formProblem(Object.assign({}, read, {distance: ""}))).toMatch(/distance/);
        expect(conversions.formProblem(Object.assign({}, read, {range_max: null}))).toMatch(/colour range/);
    });

    it("reads Harmonize as Normalize too, and a workset saved before Harmonize existed as harmonized when it normalized", () => {
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(Object.assign({}, DEFAULTS, {harmonize: true}), PREFERENCES, {}) + "</div>";
        expect(conversions.readForm(document.getElementById("f"))).toMatchObject({normalize: true, harmonize: true});
        const old = Object.assign({}, DEFAULTS, {normalize: true});
        delete old.harmonize;
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(old, PREFERENCES, {}) + "</div>";
        expect(document.querySelector('input[name="harmonize"]').checked).toBe(true);
    });

    it("fills the settings from the WebODM plan's process command", () => {
        const s = conversions.planSettings(["-o", "temp_c:tif,pseudo", "--max-pitch", "-80", "--normalize", "--emissivity", "0.9"], DEFAULTS);
        expect(s).toEqual(Object.assign({}, DEFAULTS, {outputs: ["temp_c:tiff", "pseudo"], max_pitch: -80, normalize: true, harmonize: true, emissivity: 0.9}));
        expect(DEFAULTS.normalize).toBe(false);
    });

    it("gives the plan's temperatures in the settings' unit, °C when the plan names no unit", () => {
        const f = Object.assign({}, DEFAULTS, {unit: "F"});
        expect(conversions.planSettings(["--reflected-temp", "20"], f).reflected_temp).toBe(68);
        expect(conversions.planSettings(["--unit", "k", "--ambient-temp", "293.15"], f).ambient_temp).toBe(68);
        expect(conversions.planSettings(["--unit", "F", "--ambient-temp", "68"], DEFAULTS).ambient_temp).toBe(20);
    });

    it("lists what settings change dji-thermal-cli's defaults, in the user's unit, and which leave the WebODM plan", () => {
        window.localStorage.setItem("unit_system", "imperial");
        const plan = conversions.planSettings(["-o", "temp_c:tiff", "-o", "pseudo", "--normalize"], DEFAULTS);
        const s = Object.assign({}, DEFAULTS, {emissivity: 0.95, reflected_temp: 20, range_min: 10, range_max: 60,
            outputs: ["temp_c:tiff", "pseudo:tiff"]});
        const diffs = conversions.differences(s, DEFAULTS, plan, "F");
        expect(diffs.map(d => [d.key, d.text, d.changed, d.offPlan])).toEqual([
            ["outputs", "temp_c TIFF, pseudo TIFF", true, false],   // the plan's pseudo names no format, so any one is on it
            ["emissivity", "emissivity 0.95", true, false],
            ["reflected_temp", "reflected 68 °F", true, false],
            ["normalize", "not normalized", false, true],
            ["range", "range 50 to 140 °F", true, false]
        ]);
        expect(conversions.differences(DEFAULTS, DEFAULTS, null, "C")).toEqual([]);
        // The same temperature in another unit is no change, but the unit is
        expect(conversions.differences(Object.assign({}, DEFAULTS, {unit: "K"}), DEFAULTS, null, "C").map(d => d.key)).toEqual(["unit"]);

        const chips = document.createElement("div");
        chips.innerHTML = conversions.chipsHtml(diffs, "the defaults");
        expect(chips.querySelectorAll(".ta-chip-changed").length).toBe(4);
        expect(chips.querySelector(".ta-chip-off-plan").getAttribute("title")).toBe("The WebODM plan: harmonized");
        expect(conversions.chipsHtml([], "the defaults")).toContain("the defaults");
    });

    it("puts a changed setting back to its default, in the files' unit", () => {
        const s = Object.assign({}, DEFAULTS, {unit: "K", range_min: 283.15, range_max: 333.15, emissivity: 0.95, gimbal_yaw: 10});
        expect(conversions.resetSetting(s, DEFAULTS, "range")).toEqual(Object.assign({}, s, {range_min: null, range_max: null}));
        expect(conversions.resetSetting(s, DEFAULTS, "gimbal").gimbal_yaw).toBe(null);
        const back = conversions.resetSetting(Object.assign({}, s, {reflected_temp: 293.15}), DEFAULTS, "unit");
        expect(back.unit).toBe("C");
        expect(back.reflected_temp).toBeCloseTo(20);
        expect(back.range_min).toBeCloseTo(10);
    });

    it("folds the form into a summary once the dataset has conversions, and marks and resets what changed", async () => {
        window.localStorage.setItem("unit_system", "imperial");
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        const summary = document.getElementById("ta-convert-summary");
        expect(form().hidden).toBe(true);
        // The form starts from the defaults: what it shows are the plan's settings it leaves
        expect([...summary.querySelectorAll(".ta-chip-off-plan")].map(c => c.getAttribute("data-key"))).toEqual(["outputs", "normalize"]);
        expect(summary.querySelector(".ta-chip-changed")).toBe(null);
        // Each card says what its conversion changed
        const card = document.querySelector('.ta-conversion[data-id="9"] .ta-conversion-chips');
        expect([...card.querySelectorAll(".ta-chip")].map(c => c.textContent)).toEqual(["emissivity 0.95", "normalized"]);

        expect(summary.querySelector('[data-act="edit"]').getAttribute("aria-expanded")).toBe("false");
        click(summary.querySelector('[data-act="edit"]'));
        expect(form().hidden).toBe(false);
        expect(summary.querySelector('[data-act="edit"]').getAttribute("aria-expanded")).toBe("true");
        // Closed again, the chips stay; open, the Outputs section's own chips show only when it is closed
        click(summary.querySelector('[data-act="edit"]'));
        expect(form().hidden).toBe(true);
        expect(summary.querySelectorAll(".ta-chip").length).toBe(2);
        click(summary.querySelector('[data-act="edit"]'));
        expect(form().querySelector("details.ta-section-outputs").open).toBe(false);
        expect([...form().querySelectorAll('[data-chips="outputs"] .ta-chip')].map(c => c.getAttribute("data-key"))).toEqual(["outputs"]);
        input("reflected_temp").value = "68";
        input("reflected_temp").dispatchEvent(new Event("input", {bubbles: true}));
        expect(summary.querySelector('[data-key="reflected_temp"]').textContent).toBe("reflected 68 °F");
        const field = input("reflected_temp").closest(".ta-field");
        expect(field.classList.contains("ta-changed")).toBe(true);
        // The plan harmonizes, the form does not: both its boxes are marked together
        expect(input("normalize").closest(".ta-normalize").classList.contains("ta-off-plan")).toBe(true);
        expect(input("harmonize").closest(".ta-normalize")).toBe(input("normalize").closest(".ta-normalize"));

        click(field.querySelector('[data-reset="reflected_temp"]'));
        expect(input("reflected_temp").value).toBe("");
        expect(input("reflected_temp").closest(".ta-field").classList.contains("ta-changed")).toBe(false);
        expect(summary.querySelector('[data-key="reflected_temp"]')).toBe(null);
        expect(form().hidden).toBe(false);
    });

    it("opens the Convert tab with the WebODM plan's settings, marked as changed, without converting", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(true);
        click(document.getElementById("ta-plan-convert"));
        expect(document.getElementById("ta-tab-convert").hidden).toBe(false);
        expect(document.getElementById("ta-tab-webodm").hidden).toBe(true);
        expect(input("normalize").checked).toBe(true);
        expect(document.querySelector('#ta-convert-summary [data-key="normalize"]').classList.contains("ta-chip-changed")).toBe(true);
        expect(document.querySelector("#ta-convert-summary .ta-chip-off-plan")).toBe(null);
        expect(calls(fetchFn).filter(c => c.indexOf("POST") === 0)).toEqual([]);
    });

    it("shows the recorded values once an analysis running when the page opened is done, keeping what was typed", async () => {
        jest.useFakeTimers();
        const analyzing = Object.assign({}, DATASET, {status: "analyzing", analysis: {}, analyzed: false, analyzed_at: null, conversions: []});
        const fetchFn = server({[URL5]: [analyzing, Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: []})]});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().innerHTML).toContain("Not recorded; laser rangefinder: none");
        input("humidity").value = "55";
        jest.runOnlyPendingTimers();
        await ticks();
        expect(form().innerHTML).toContain("Recorded: 5.0 m");
        expect(input("humidity").value).toBe("55");
    });

    it("fills the form with a workset's settings and the frame page's changed parameters, from its New workset with these", async () => {
        window.history.replaceState(null, "", "/?from=9&emissivity=0.8&humidity=40&palette=x#convert");
        expect(dataset.fromQuery(window.location.search)).toEqual({id: "9", changes: {emissivity: 0.8, humidity: 40}});
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(false);
        expect(input("emissivity").value).toBe("0.8");
        expect(input("humidity").value).toBe("40");
        // The rest is the workset's own
        expect(input("normalize").checked).toBe(true);
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/Nadir's settings with humidity 40, emissivity 0.8, from the frame page/);
        expect(calls(fetchFn).filter(c => c.indexOf("POST") === 0)).toEqual([]);
    });

    it("opens the form at once for a dataset without conversions", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(false);
        expect(document.querySelector('#ta-convert-summary [data-act="edit"]').getAttribute("aria-expanded")).toBe("true");
    });

    it("opens a conversion's menu, and closes it on another click or Esc", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        const toggle = () => document.querySelector('.ta-conversion[data-id="9"] [data-act="menu"]');
        const isOpen = () => toggle().parentNode.classList.contains("open");
        click(toggle());
        expect(isOpen()).toBe(true);
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        click(toggle());
        expect(isOpen()).toBe(false);
        click(toggle());
        click(document.body);
        expect(isOpen()).toBe(false);
        click(toggle());
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(isOpen()).toBe(false);
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
    });

    it("lists the conversions with their downloads, and each one's files", () => {
        const base = "/api/plugins/dji-thermal/datasets/5/conversions/";
        const running = Object.assign({}, CONVERSION, {id: 10, name: "Run", status: "converting", progress: 0.3});
        let html = conversions.listHtml([running, CONVERSION], true, base, null);
        expect(html).toContain("Converting 30%");
        const starting = Object.assign({}, running, {progress: 0, settings: Object.assign({}, DEFAULTS, {normalize: true})});
        expect(conversions.listHtml([starting], true, base, null)).toContain("Normalizing: reading the frames' recorded temperatures");
        const harmonizing = Object.assign({}, starting, {settings: Object.assign({}, DEFAULTS, {normalize: true, harmonize: true}),
                                                          stage: {stage: "frames", step: 2, steps: 5, done: 40, total: 217, unit: "files"}});
        expect(conversions.listHtml([harmonizing], true, base, null)).toContain("Harmonizing: step 2 of 5, reading frames, 40/217 files…");
        expect(html).toContain('href="' + base + '9/download"');
        expect(html).not.toContain(base + '10/download');
        expect(html).toContain("2 converted, 1 skipped");
        expect(html).toContain('data-act="cancel"');
        html = conversions.listHtml([CONVERSION], false, base, null);
        expect(html).not.toContain('data-act="delete"');
        expect(html).toContain('data-act="use"');
        expect(conversions.listHtml([], true, base)).toMatch(/No worksets yet/);

        const files = conversions.resultsHtml(Object.assign({}, CONVERSION, {results: {
            files: [{path: "a_T.JPG", ok: true, outputs: ["sub/a_T_temp_c.tiff"], notes: [], distance: 21.4, distance_source: "lrf"},
                    {path: "b_T.JPG", ok: false, reason: "oblique (gimbal pitch -45 above -80)", outputs: [], notes: []}],
            normalization: {ambient_c: 20, reflected_c: 20, frames: 2, without_offset: 0, offset_min: -0.2, offset_max: 0.3}}}), base);
        // The outputs are downloaded from the detail pane, not the table
        expect(files).not.toContain("9/download?file=");
        expect(files).toContain("oblique (gimbal pitch -45 above -80)");
        expect(files).toContain("Skipped: oblique (1).");
        expect(conversions.skipReasons([{ok: false, reason: "oblique (gimbal pitch -45 above -80)"}, {ok: false, reason: "no DJI thermal data found (not an R-JPEG)"},
            {ok: false, reason: "oblique (gimbal pitch -30 above -80)"}, {ok: true}])).toEqual([["oblique", 2], ["no DJI thermal data found", 1]]);
        expect(files).toContain('<td class="ta-num" title="lrf">21.4 m</td>');
        expect(files).toContain("offsets -0.20 to 0.30 °C");
    });

    it("shows each image's figures in a workset's Files, and how far measuring them is", () => {
        const c = Object.assign({}, CONVERSION, {results: {files: [{path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: [], distance: 16.4, distance_source: "rangefinder"}]},
            figures: {"a_T.JPG": {min: 10.04, max: 41.26, mean: 20, emissivity: 0.95, reflected: 19.44, ambient: 21, humidity: 50, distance: 16.4, distance_source: "rangefinder"}},
            figures_status: "ready"});
        document.body.innerHTML = conversions.resultsHtml(c, "/x/", {thumbs: "/thumb?file="});
        const cells = [...document.querySelectorAll(".ta-results tbody td")].map(td => td.textContent);
        expect(cells).toEqual(["", "a_T.JPG", "Converted", "10.0 °C", "41.3 °C", "0.95", "19.4 °C", "16.4 m"]);
        expect(document.querySelector(".ta-thumb img").getAttribute("src")).toBe("/thumb?file=a_T.JPG");
        expect(document.querySelector(".ta-figures-progress")).toBeNull();
        expect(conversions.resultsHtml(Object.assign({}, c, {figures: {}, figures_status: "measuring", figures_progress: 0.4}), "/x/"))
            .toContain("Measuring the frames for the table: 40%");
        expect(conversions.resultsHtml(Object.assign({}, c, {figures_status: "failed", figures_error: "no SDK"}), "/x/")).toMatch(/Could not measure the frames for the table: no SDK .*data-act="figures-again"/);
        // A workset converted before: its figures not measured yet, the columns empty
        document.body.innerHTML = conversions.resultsHtml(Object.assign({}, c, {figures: undefined}), "/x/");
        expect([...document.querySelectorAll(".ta-results tbody td")].map(td => td.textContent)[3]).toBe("");
    });

    it("details one image of a workset with its figures and downloads, or several with their zip", () => {
        const c = Object.assign({}, CONVERSION, {results: {files: [
            {path: "sub/a_T.JPG", ok: true, outputs: ["sub/a_T_temp_c.tiff", "sub/a_T_pseudo.png"], notes: ["a note"], offset_c: -0.5},
            {path: "b_T.JPG", ok: false, reason: "oblique", outputs: [], notes: []}]},
            figures: {"sub/a_T.JPG": {min: 10, max: 40, mean: 20, emissivity: 0.95, reflected: 19, ambient: 21, humidity: 50, distance: 16.4, distance_source: "rangefinder"}}});
        const urls = {picture: "/ds/thumbnail", palette: "iron_red", download: "/x/9/download", frameDownload: "/x/9/frame/download", frame: "/p/dataset/5/conversion/9/frame"};
        expect(conversions.resultDetailHtml(c, [], false, urls)).toBe("");
        document.body.innerHTML = conversions.resultDetailHtml(c, ["sub/a_T.JPG"], true, urls);
        expect(document.querySelector(".ta-file-detail-head strong").textContent).toBe("a_T.JPG");
        expect(document.querySelector('[data-act="detail-close"]')).not.toBeNull();
        expect(document.querySelector(".ta-file-detail-img").getAttribute("src")).toBe("/ds/thumbnail?size=large&palette=iron_red&file=sub%2Fa_T.JPG");
        const links = [...document.querySelectorAll(".ta-file-detail-actions a")].map(a => [a.textContent.trim(), a.getAttribute("href")]);
        expect(links).toEqual([["a_T_temp_c.tiff", "/x/9/download?file=sub%2Fa_T_temp_c.tiff"], ["a_T_pseudo.png", "/x/9/download?file=sub%2Fa_T_pseudo.png"],
            ["Temperatures (CSV)", "/x/9/frame/download?frame=sub%2Fa_T.JPG&kind=csv"], ["Temperatures (float TIFF)", "/x/9/frame/download?frame=sub%2Fa_T.JPG&kind=tiff"],
            ["Open frame", "/p/dataset/5/conversion/9/frame?frame=sub%2Fa_T.JPG"]]);
        const rows = Object.fromEntries([...document.querySelectorAll(".ta-file-detail-table tr")].map(tr => [tr.firstChild.textContent, tr.lastChild.textContent]));
        expect(rows).toMatchObject({Result: "Converted", Min: "10.0 °C", Max: "40.0 °C", Mean: "20.0 °C", Emissivity: "0.95", Reflected: "19.0 °C",
            Ambient: "21.0 °C", Humidity: "50 %", Distance: "16.4 m (rangefinder)", "Harmonizing offset": "-0.50 °C", Note: "a note"});
        // Hovered, not selected: no ×; a skipped image: its reason, nothing to download
        document.body.innerHTML = conversions.resultDetailHtml(c, ["b_T.JPG"], false, urls);
        expect(document.querySelector('[data-act="detail-close"]')).toBeNull();
        expect(document.querySelectorAll(".ta-file-detail-actions a").length).toBe(0);
        expect(document.querySelector(".ta-file-detail-table").textContent).toContain("oblique");
        // Several: their files as one zip
        document.body.innerHTML = conversions.resultDetailHtml(c, ["sub/a_T.JPG", "b_T.JPG"], true, urls);
        expect(document.querySelector('[data-act="download-selected"]').textContent).toContain("Download their 2 files");
    });

    it("converts with the form's settings, polls while it runs, and saves or resets the user's defaults", async () => {
        jest.useFakeTimers();
        const converting = Object.assign({}, CONVERSION, {id: 10, name: "Conversion 2", status: "converting", progress: 0.5});
        const fetchFn = server({
            [URL5]: [Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
                Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [converting, CONVERSION]}),
                Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [Object.assign({}, converting, {status: "ready"}), CONVERSION]})],
            "/api/plugins/dji-thermal/preferences": Object.assign({}, PREFERENCES, {settings: Object.assign({}, DEFAULTS, {emissivity: 0.9}), saved: true}),
            ["POST " + URL5 + "/conversions"]: converting,
            "PUT /api/plugins/dji-thermal/preferences": (u, o) => jsonResponse({settings: JSON.parse(o.body).settings, saved: true}),
            "DELETE /api/plugins/dji-thermal/preferences": {settings: DEFAULTS, saved: false}
        });
        dataset.init(document, fetchFn);
        await ticks();

        // The form starts from the user's saved defaults
        expect(document.getElementById("ta-convert-count").textContent).toBe("1");
        expect(document.getElementById("ta-convert-origin").textContent).toMatch(/your saved defaults/);
        expect(input("emissivity").value).toBe("0.9");
        expect(document.getElementById("ta-convert-plan").hidden).toBe(false);

        input("normalize").checked = true;
        document.getElementById("ta-convert-name").value = "Normalized";
        click(document.getElementById("ta-convert-start"));
        await ticks();
        const post = fetchFn.mock.calls.find(c => c[1] && c[1].method === "POST");
        expect(JSON.parse(post[1].body)).toMatchObject({name: "Normalized", settings: {emissivity: 0.9, normalize: true}});
        expect(document.getElementById("ta-conversions").innerHTML).toContain("Converting 50%");
        expect(document.querySelector('.ta-conversion[data-id="10"]').classList).toContain("ta-conversion-new");

        // Polled while it converts, and no longer once it is done
        jest.runOnlyPendingTimers();
        await ticks();
        expect(document.getElementById("ta-conversions").innerHTML).not.toContain("Converting");
        const loads = calls(fetchFn).filter(c => c === "GET " + URL5).length;
        jest.runOnlyPendingTimers();
        await ticks();
        expect(calls(fetchFn).filter(c => c === "GET " + URL5).length).toBe(loads);

        input("humidity").value = "60";
        click(document.getElementById("ta-convert-save"));
        await ticks();
        const put = fetchFn.mock.calls.find(c => c[1] && c[1].method === "PUT");
        expect(JSON.parse(put[1].body).settings.humidity).toBe(60);
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/Saved/);

        click(document.getElementById("ta-convert-reset"));
        expect(askDialog().textContent).toContain("Your saved defaults are forgotten.");
        press("Reset");
        await ticks();
        expect(input("emissivity").value).toBe("");
        expect(input("humidity").value).toBe("");
        expect(document.getElementById("ta-convert-origin").textContent).toMatch(/dji-thermal-cli's defaults/);

        // A conversion's settings, and the WebODM plan's, fill the form
        expect(dataset.framePage("/plugins/dji-thermal/", {id: 5, conversions: [
            {id: "a", status: "ready", created_at: "2026-10-01T00:00:00Z"}, {id: "b", status: "ready", created_at: "2026-10-03T00:00:00Z"},
            {id: "c", status: "failed", created_at: "2026-10-05T00:00:00Z"}]})).toBe("/plugins/dji-thermal/dataset/5/conversion/b/frame");
        expect(dataset.framePage("/plugins/dji-thermal/", {id: 5, conversions: []})).toBeNull();
        click(document.querySelector('.ta-conversion[data-id="9"] button[data-act="use"]'));
        expect(input("emissivity").value).toBe("0.95");
        expect(input("normalize").checked).toBe(true);
        click(document.getElementById("ta-convert-plan"));
        expect(input("emissivity").value).toBe("");
        expect(form().querySelector('input[name="output"][value="pseudo"]').checked).toBe(false);
    });

    it("shows a started conversion at once, before the dataset reloads", async () => {
        const started = Object.assign({}, CONVERSION, {id: 10, name: "Conversion 2", status: "converting", progress: 0});
        let reload;
        const fetchFn = server({
            [URL5]: [Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [CONVERSION]}),
                     () => new Promise(r => { reload = r; })],
            "/api/plugins/dji-thermal/preferences": PREFERENCES,
            ["POST " + URL5 + "/conversions"]: started
        });
        dataset.init(document, fetchFn);
        await ticks();
        click(document.getElementById("ta-convert-start"));
        await ticks();
        expect(reload).toBeDefined();   // the reload has not answered yet
        const card = document.querySelector('.ta-conversion[data-id="10"]');
        expect(card.classList).toContain("ta-conversion-new");
        expect(card.textContent).toContain("Conversion 2");
        expect(document.getElementById("ta-convert-count").textContent).toBe("2");
    });

    it("renames, cancels and deletes a conversion in the page's dialog, and says when the server refuses", async () => {
        const converting = Object.assign({}, CONVERSION, {status: "converting", progress: 0.2});
        const C9 = "/api/plugins/dji-thermal/datasets/5/conversions/9";
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [converting]}),
            "/api/plugins/dji-thermal/preferences": PREFERENCES,
            ["PATCH " + C9]: () => jsonResponse({name: ["Too long"]}, false),
            ["POST " + C9 + "/cancel"]: () => jsonResponse({error: "Already finished"}, false),
            ["DELETE " + C9]: () => jsonResponse({error: "Not allowed"}, false)
        });
        dataset.init(document, fetchFn);
        await ticks();
        const act = a => click(document.querySelector('.ta-conversion[data-id="9"] button[data-act="' + a + '"]'));
        const message = () => document.getElementById("ta-convert-message").textContent;
        expect(document.querySelector('button[data-act="delete"]').getAttribute("aria-label")).toBe("Delete " + CONVERSION.name);

        act("rename");
        document.getElementById("ta-ask-field").value = "New name";
        press("Rename");
        await ticks();
        expect(JSON.parse(fetchFn.mock.calls.find(c => c[1] && c[1].method === "PATCH")[1].body)).toEqual({name: "New name"});
        expect(message()).toContain("Too long");

        act("cancel");
        await ticks();
        expect(message()).toContain("Already finished");

        act("delete");
        expect(askDialog().textContent).toContain("Delete " + CONVERSION.name + " and its files?");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("DELETE " + C9);
        act("delete");
        press("Delete");
        await ticks();
        expect(calls(fetchFn)).toContain("DELETE " + C9);
        expect(message()).toContain("Not allowed");
    });

    it("refuses incomplete settings before sending them", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: []}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await flush();
        [].forEach.call(form().querySelectorAll('input[name="output"]'), c => { c.checked = false; });
        click(document.getElementById("ta-convert-start"));
        expect(document.getElementById("ta-convert-message").textContent).toMatch(/at least one output/);
        input("distance_mode").value = "fixed";
        change(input("distance_mode"));
        expect(input("distance").hidden).toBe(false);
        expect(calls(fetchFn).some(c => c.indexOf("POST") === 0)).toBe(false);
    });

    it("lets a viewer download the conversions but not convert or delete them", async () => {
        const fetchFn = server({
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, can_change: false, can_delete: false,
                                                conversions: [Object.assign({}, CONVERSION, {mosaic_files: ["harmonized/mosaic.tif"]})]}),
            "/api/plugins/dji-thermal/datasets/5/conversions/9": Object.assign({}, CONVERSION, {results: {files: [{path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: []},
                {path: "b_T.JPG", ok: true, outputs: ["b.tiff"], notes: []}]}})
        });
        dataset.init(document, fetchFn);
        await flush();
        expect(document.getElementById("ta-convert-settings").hidden).toBe(true);
        expect(calls(fetchFn)).not.toContain("GET /api/plugins/dji-thermal/preferences");
        const list = document.getElementById("ta-conversions");
        expect(list.innerHTML).toContain("/conversions/9/download");
        expect(list.innerHTML).not.toContain('data-act="delete"');

        // Files: out of the menu, a toggle in the workset's box, collapsed at first
        expect(list.querySelector('.dropdown-menu [data-act="files"]')).toBeNull();
        const toggle = () => list.querySelector('.ta-conversion-files-head button[data-act="files"]');
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        expect(list.querySelector('[data-files="9"]').hidden).toBe(true);
        expect(list.querySelector(".ta-conversion-tasks, .ta-conversion-task").compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        click(toggle());
        await flush();
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(list.querySelector('[data-files="9"]').hidden).toBe(false);
        expect(JSON.parse(window.localStorage.getItem("dji-thermal-analyzer:files-shown:5"))).toEqual([9]);
        // The detail pane: none at first, then the image under the mouse, then the one clicked, kept while hovering others
        const files = list.querySelector('[data-files="9"]');
        const pane = () => files.querySelector(".ta-file-detail");
        expect(pane().hidden).toBe(true);
        const row = path => files.querySelector('.ta-results tbody tr[data-path="' + path + '"]');
        row("a_T.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().hidden).toBe(false);
        expect(pane().innerHTML).toContain("/conversions/9/download?file=a.tiff");
        expect(pane().querySelector('[data-act="detail-close"]')).toBeNull();
        click(row("a_T.JPG").children[1]);
        expect(row("a_T.JPG").classList.contains("ta-selected")).toBe(true);
        row("b_T.JPG").dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
        expect(pane().querySelector("strong").textContent).toBe("a_T.JPG");
        // Ctrl-click adds one: both downloaded as a zip, a form posted with their files
        row("b_T.JPG").children[1].dispatchEvent(new MouseEvent("click", {bubbles: true, ctrlKey: true}));
        expect(pane().textContent).toContain("2 images selected");
        const submit = jest.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function () {
            expect(this.getAttribute("action")).toBe("/api/plugins/dji-thermal/datasets/5/conversions/9/download");
            expect([...this.querySelectorAll('input[name="file"]')].map(i => i.value)).toEqual(["a.tiff", "b.tiff"]);
        });
        click(pane().querySelector('[data-act="download-selected"]'));
        expect(submit).toHaveBeenCalledTimes(1);
        submit.mockRestore();
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(row("a_T.JPG").classList.contains("ta-selected")).toBe(false);
        click(toggle());
        expect(list.querySelector('[data-files="9"]').hidden).toBe(true);
        expect(window.localStorage.getItem("dji-thermal-analyzer:files-shown:5")).toBeNull();
        // The mosaics' files: their own toggle, remembered apart from the Files'
        const mosaics = () => list.querySelector('button[data-act="mosaic-files"]');
        click(mosaics());
        expect(list.querySelector(".ta-mosaic-files").hidden).toBe(false);
        expect(JSON.parse(window.localStorage.getItem("dji-thermal-analyzer:mosaics-shown:5"))).toEqual([9]);
        expect(window.localStorage.getItem("dji-thermal-analyzer:files-shown:5")).toBeNull();
        click(mosaics());
        expect(window.localStorage.getItem("dji-thermal-analyzer:mosaics-shown:5")).toBeNull();
    });

    it("sorts a workset's files by any column but the thumbnail, ascending or descending, the figures' headers aligned with them", () => {
        const c = Object.assign({}, CONVERSION, {figures: {"a_T.JPG": {max: 30}, "b_T.JPG": {max: 50}}, results: {files: [
            {path: "b_T.JPG", ok: true, outputs: ["b.tiff"], notes: []},
            {path: "c_T.JPG", ok: false, reason: "not thermal", outputs: [], notes: []},
            {path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: []}]}});
        const order = view => {
            document.body.innerHTML = conversions.resultsHtml(c, "/x/", view);
            return [...document.querySelectorAll(".ta-results tbody tr td:first-child")].map(td => td.textContent);
        };
        expect(order()).toEqual(["a_T.JPG", "b_T.JPG", "c_T.JPG"]);
        expect(order({sort: "path", desc: true})).toEqual(["c_T.JPG", "b_T.JPG", "a_T.JPG"]);
        expect(order({sort: "result", desc: true})).toEqual(["c_T.JPG", "b_T.JPG", "a_T.JPG"]);
        expect(document.querySelector('.ta-results th[data-sort="result"] .fa-caret-down')).not.toBeNull();
        expect(order({sort: "max", desc: true})).toEqual(["b_T.JPG", "a_T.JPG", "c_T.JPG"]);
        expect([...document.querySelectorAll(".ta-results th")].map(th => th.getAttribute("data-sort")))
            .toEqual(["path", "result", "min", "max", "emissivity", "reflected", "distance"]);
        expect([...document.querySelectorAll(".ta-results th.ta-num")].map(th => th.getAttribute("data-sort")))
            .toEqual(["min", "max", "emissivity", "reflected", "distance"]);
    });
});

describe("a conversion's mosaics on the dataset page", () => {
    const URL5 = "/api/plugins/dji-thermal/datasets/5";
    const C9 = URL5 + "/conversions/9";
    beforeEach(() => { document.body.innerHTML = page('dataset.html'); });
    afterEach(() => { window.localStorage.clear(); window.history.replaceState(null, "", "/"); });
    const card = () => document.querySelector('.ta-conversion[data-id="9"]');

    it("says how the mosaics are going, and only when there is something to say", () => {
        const building = conversions.mosaicHtml(Object.assign({}, CONVERSION, {mosaic_status: "building", mosaic_progress: 0.4,
            mosaic_stage: {stage: "composite", step: 3, steps: 4, done: 5, total: 12, unit: "frames"}}));
        expect(building).toContain("width: 40%");
        expect(building).toContain("Building the mosaics: step 3 of 4, compositing, 5/12 frames");
        expect(conversions.mosaicHtml(Object.assign({}, CONVERSION, {mosaic_status: "failed", mosaic_error: "No <frames>"})))
            .toContain("The mosaics failed: No &lt;frames&gt;");
        expect(conversions.mosaicHtml(Object.assign({}, CONVERSION, {mosaic_status: "canceled"}))).toContain("canceled");
        expect(conversions.mosaicHtml(Object.assign({}, CONVERSION, {mosaic_status: "ready"}))).toBe("");
        expect(conversions.mosaicHtml(CONVERSION)).toBe("");
    });

    it("links a conversion with mosaics to its viewer, and offers to build them", () => {
        const viewerUrl = "/plugins/dji-thermal/dataset/5/conversion/9";
        const el = document.createElement("div");
        el.innerHTML = conversions.actionsHtml(Object.assign({}, CONVERSION, {mosaic_status: "ready"}), true, C9.replace(/9$/, ""), null, viewerUrl);
        expect(el.firstChild.textContent).toContain("View mosaics");
        expect(el.firstChild.getAttribute("href")).toBe(viewerUrl);
        expect(el.querySelector(".dropdown-menu").textContent).toContain("Download all");
        expect(el.querySelector('[data-act="mosaics"]').textContent).toContain("Build mosaics again");

        el.innerHTML = conversions.actionsHtml(CONVERSION, true, C9.replace(/9$/, ""), null, viewerUrl);
        expect(el.firstChild.textContent).toContain("Download all");
        expect(el.querySelector('[data-act="mosaics"]').textContent.trim()).toBe("Build mosaics");

        el.innerHTML = conversions.actionsHtml(Object.assign({}, CONVERSION, {mosaic_status: "building"}), true, C9.replace(/9$/, ""), null, viewerUrl);
        expect(el.firstChild.getAttribute("data-act")).toBe("cancel");
        expect(el.firstChild.getAttribute("title")).toBe("Stop building the mosaics");
        expect(el.querySelector('[data-act="mosaics"]')).toBe(null);
        expect(el.querySelector('a[href="' + viewerUrl + '"]').textContent).toContain("Mosaics");

        // Who cannot change the dataset can look, not build
        el.innerHTML = conversions.actionsHtml(Object.assign({}, CONVERSION, {mosaic_status: "ready"}), false, C9.replace(/9$/, ""), null, viewerUrl);
        expect(el.firstChild.textContent).toContain("View mosaics");
        expect(el.querySelector('[data-act="mosaics"]')).toBe(null);
    });

    it("links a workset's mosaics to WebODM's map of its project, only when the project has a map", () => {
        const el = document.createElement("div");
        const ready = Object.assign({}, CONVERSION, {mosaic_status: "ready", dataset: "d-1", id: "abc123", project: 4});
        el.innerHTML = conversions.actionsHtml(Object.assign({}, ready, {project_map: true}), false, C9.replace(/9$/, ""), null, "/viewer");
        const link = [...el.querySelectorAll(".dropdown-menu a")].find(a => a.textContent.includes("Open on WebODM's map"));
        expect(link.getAttribute("href")).toBe("/map/project/4/?dt-mosaic=d-1%2Fabc123");
        // WebODM shows no map of a project without a finished orthophoto or elevation model
        el.innerHTML = conversions.actionsHtml(Object.assign({}, ready, {project_map: false}), false, C9.replace(/9$/, ""), null, "/viewer");
        expect(el.textContent).not.toContain("Open on WebODM's map");
        el.innerHTML = conversions.actionsHtml(Object.assign({}, ready, {project_map: true, mosaic_status: "building"}), true, C9.replace(/9$/, ""), null, "/viewer");
        expect(el.textContent).not.toContain("Open on WebODM's map");
    });

    it("builds the mosaics of a conversion without them, and polls until they are built", async () => {
        jest.useFakeTimers();
        const d = mosaic => Object.assign({}, DATASET, {analysis: ANALYSIS, defaults: DEFAULTS,
            conversions: [Object.assign({}, CONVERSION, mosaic)]});
        const fetchFn = server({
            [URL5]: [d({mosaic_status: ""}), d({mosaic_status: "building", mosaic_progress: 0.5}), d({mosaic_status: "ready"})],
            ["POST " + C9 + "/mosaics"]: Object.assign({}, CONVERSION, {mosaic_status: "building"})
        });
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="mosaics"]'));
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + C9 + "/mosaics");
        expect(card().innerHTML).toContain("Building the mosaics");
        jest.runOnlyPendingTimers();
        await ticks();
        expect(card().querySelector(".ta-conversion-actions a").textContent).toContain("View mosaics");
        expect(card().querySelector(".ta-conversion-actions a").getAttribute("href")).toBe("/plugins/dji-thermal/dataset/5/conversion/9");
        // Built: no more polling
        const n = fetchFn.mock.calls.length;
        jest.runOnlyPendingTimers();
        await ticks();
        expect(fetchFn.mock.calls.length).toBe(n);
    });

    it("reads the mosaics option from the form, on by default", () => {
        document.body.innerHTML = '<div id="f">' + conversions.formHtml(DEFAULTS, PREFERENCES, {}) + "</div>";
        const box = document.querySelector('[name="mosaics"]');
        expect(box.checked).toBe(true);
        box.checked = false;
        const read = conversions.readForm(document.getElementById("f"));
        expect(read.mosaics).toBe(false);
        expect(conversions.differences(read, DEFAULTS, null, "C").map(d => [d.key, d.text])).toEqual([["mosaics", "no mosaics"]]);
    });

    it("lists the mosaics' files in a section of their own below the Files, by mosaic, collapsed at first", () => {
        const c = Object.assign({}, CONVERSION, {results: {files: [{path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: []}]},
            mosaic_files: ["as_converted/mosaic.tif", "harmonized/mosaic.tif", "harmonized/report.json"]});
        expect(conversions.resultsHtml(c, C9.replace(/9$/, ""))).not.toContain("mosaic.tif");
        document.body.innerHTML = conversions.listHtml([c], true, C9.replace(/9$/, ""), [9], null, null, null, null, null, null, []);
        const head = document.querySelector('button[data-act="mosaic-files"]');
        expect(head.getAttribute("aria-expanded")).toBe("false");
        expect(head.parentNode.textContent).toBe(" Mosaics 3 files");
        expect(document.querySelector('[data-files="9"]').compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const files = document.querySelector(".ta-mosaic-files");
        expect(files.hidden).toBe(true);
        expect([...files.children].map(d => d.querySelector("strong").textContent)).toEqual(["As converted:", "Harmonized:"]);
        expect(files.querySelector('a[title="harmonized/mosaic.tif"]').getAttribute("href")).toBe(C9 + "/download?mosaic=harmonized%2Fmosaic.tif");
        expect(files.lastChild.textContent).toBe("Harmonized:  mosaic.tif  report.json");
        document.body.innerHTML = conversions.listHtml([c], true, "/x/", [], null, null, null, null, null, null, [9]);
        expect(document.querySelector(".ta-mosaic-files").hidden).toBe(false);
        expect(conversions.listHtml([Object.assign({}, c, {mosaic_files: []})], true, "/x/", [])).not.toContain("mosaic-files");
    });
});

describe("a task made from a conversion", () => {
    const URL5 = "/api/plugins/dji-thermal/datasets/5";
    const C9 = URL5 + "/conversions/9";
    const INFO = {
        options: [{name: "radiometric-calibration", value: "none", reason: "already temperatures", recommended: true},
                  {name: "orthophoto-resolution", value: 6.2, reason: "the frames' GSD", recommended: true},
                  {name: "fast-orthophoto", value: true, reason: "flat ground", recommended: false}],
        problems: [], warnings: ["Not normalized: the frames' offsets show as seams where ODM blends them"],
        frames: 12, project: {id: 1, name: "First Project"}, name: "Roof - Conversion 1",
        process_args: ["--normalize", "--outputs", "temp_c:tiff"], can_create: true
    };
    const TASK = {id: "77", name: "Roof - Conversion 1", project: 1, status: null, processing_node: null, last_error: "", images_count: 12};
    beforeEach(() => { document.body.innerHTML = page('dataset.html'); });
    afterEach(() => { window.localStorage.clear(); window.history.replaceState(null, "", "/"); });
    const card = () => document.querySelector('.ta-conversion[data-id="9"]');
    const d = extra => Object.assign({}, DATASET, {analysis: ANALYSIS, defaults: DEFAULTS, conversions: [Object.assign({}, CONVERSION, extra)]});

    it("is offered in a finished conversion's menu to those who can change the dataset", () => {
        const el = document.createElement("div");
        el.innerHTML = conversions.actionsHtml(CONVERSION, true, C9.replace(/9$/, ""), null, null);
        expect(el.querySelector('[data-act="task"]').textContent).toContain("Create task");
        el.innerHTML = conversions.actionsHtml(CONVERSION, false, C9.replace(/9$/, ""), null, null);
        expect(el.querySelector('[data-act="task"]')).toBe(null);
        el.innerHTML = conversions.actionsHtml(Object.assign({}, CONVERSION, {status: "converting"}), true, C9.replace(/9$/, ""), null, null);
        expect(el.querySelector('[data-act="task"]')).toBe(null);
    });

    it("lists the tasks made from a conversion, each linked to the dashboard with its status", () => {
        const html = conversions.tasksHtml({tasks: [TASK, Object.assign({}, TASK, {id: "78", name: "B<2>", status: 40, processing_node: 1})]});
        expect(html).toContain('href="/dashboard/?project_task_open=1&amp;project_task_expanded=77"');
        expect(html).toContain("(waiting for a processing node)");
        expect(html).toContain("B&lt;2&gt;</a> (completed)");
        expect(conversions.taskStatusLabel(Object.assign({}, TASK, {last_error: "Out of memory"}))).toBe("failed");
        expect(conversions.taskStatusLabel(Object.assign({}, TASK, {processing_node: 3}))).toBe("queued");
        expect(conversions.tasksHtml({tasks: []})).toBe("");
    });

    it("shows only what stops a task when something does", () => {
        const html = conversions.taskHtml(Object.assign({}, INFO, {problems: ["The conversion stripped the frames' location: ODM needs it to place them"]}));
        expect(html).toContain("stripped the frames&#39; location");
        expect(html).not.toContain('data-act="task-create"');
    });

    it("ticks the plan's recommended options, keeps what was typed and refuses a ticked option without a value", () => {
        const el = document.createElement("div");
        el.innerHTML = conversions.taskHtml(INFO);
        expect(el.querySelector(".ta-task-warnings").textContent).toContain("Not normalized");
        expect(el.querySelector('[data-act="task-plan"]')).not.toBe(null);
        const boxes = el.querySelectorAll('input[name="task-option"]');
        expect([].map.call(boxes, b => b.checked)).toEqual([true, true, false]);
        expect(el.querySelector('[name="task-name"]').value).toBe("Roof - Conversion 1");
        boxes[2].checked = true;
        el.querySelector('[name="task-value-1"]').value = "5";
        let form = conversions.readTaskForm(el, INFO);
        expect(form.problem).toBe(null);
        expect(form.data).toEqual({name: "Roof - Conversion 1", options: [
            {name: "radiometric-calibration", value: "none"}, {name: "orthophoto-resolution", value: 5}, {name: "fast-orthophoto", value: true}]});

        // Drawn again from the draft, as typed
        el.innerHTML = conversions.taskHtml(INFO, form.draft);
        expect([].map.call(el.querySelectorAll('input[name="task-option"]'), b => b.checked)).toEqual([true, true, true]);
        expect(el.querySelector('[name="task-value-1"]').value).toBe("5");

        el.querySelector('[name="task-value-0"]').value = " ";
        form = conversions.readTaskForm(el, INFO);
        expect(form.problem).toBe("Give radiometric-calibration a value, or untick it.");
    });

    it("creates the task from the panel, says it waits for a processing node and lists it on the conversion", async () => {
        const fetchFn = server({
            [URL5]: [d({}), d({tasks: [TASK]})],
            [C9 + "/task"]: INFO,
            ["POST " + C9 + "/task"]: TASK
        });
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="task"]'));
        await ticks();
        expect(card().querySelector(".ta-conversion-task").textContent).toContain("New task from 12 temperature TIFFs, in First Project");
        card().querySelector('[name="task-name"]').value = "Roof thermal";
        click(card().querySelector('[data-act="task-create"]'));
        await ticks();
        const post = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "POST")[0];
        expect(JSON.parse(post[1].body)).toEqual({name: "Roof thermal", options: [
            {name: "radiometric-calibration", value: "none"}, {name: "orthophoto-resolution", value: 6.2}]});
        expect(document.getElementById("ta-convert-message").textContent).toContain("waiting for a processing node");
        expect(card().querySelector(".ta-conversion-task").innerHTML).toBe("");
        expect(card().querySelector(".ta-conversion-tasks a").getAttribute("href")).toBe("/dashboard/?project_task_open=1&project_task_expanded=77");
    });

    it("says why the task was not created, in the panel", async () => {
        const fetchFn = server({
            [URL5]: d({}),
            [C9 + "/task"]: INFO,
            ["POST " + C9 + "/task"]: () => Promise.resolve({ok: false, status: 400, json: () => Promise.resolve({error: "The conversion's TIFFs are no longer on the server"})})
        });
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="task"]'));
        await ticks();
        click(card().querySelector('[data-act="task-create"]'));
        await ticks();
        expect(card().querySelector(".ta-task-message").textContent).toContain("no longer on the server");
    });

    it("says deleting a conversion keeps the tasks made from it", async () => {
        const fetchFn = server({[URL5]: d({tasks: [TASK]})});
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="delete"]'));
        await ticks();
        expect(document.body.textContent).toContain("The WebODM task made from it is kept, with its images.");
    });

    const PARENT = {id: "50", project: 1, name: "Thermal dataset: Roof", images_count: 5, status: 40, processing_node: 1,
                    last_error: "", processed: true, busy: false, conversion: "", sent_at: null, sent_by: null};

    it("names the WebODM task the dataset is kept in under its title, linked to it, when it is a task of its own or holds images", async () => {
        const subtitle = async extra => {
            document.body.innerHTML = page('dataset.html');
            dataset.init(document, server({[URL5]: Object.assign(d({}), extra)}));
            await ticks();
            return document.getElementById("ta-subtitle");
        };
        let el = await subtitle({parent: PARENT});
        expect(el.textContent).toContain("WebODM task  Thermal dataset: Roof");
        expect(el.querySelector("a").getAttribute("href")).toBe("/dashboard/?project_task_open=1&project_task_expanded=50");
        el = await subtitle({in_task: true, parent: Object.assign({}, PARENT, {name: "Roof", images_count: 0})});
        expect(el.querySelector("a").textContent).toBe(" Roof");
        el = await subtitle({parent: Object.assign({}, PARENT, {images_count: 0})});
        expect(el.textContent).not.toContain("WebODM task");
    });

    it("sends a conversion to the dataset's task once what it replaces is confirmed, then links to it", async () => {
        const sent = Object.assign({}, PARENT, {images_count: 12, status: null, processing_node: null, processed: false, conversion: "9"});
        const fetchFn = server({
            [URL5]: [Object.assign(d({}), {parent: PARENT}), Object.assign(d({}), {parent: sent})],
            [C9 + "/task"]: INFO,
            ["POST " + C9 + "/parent"]: sent
        });
        dataset.init(document, fetchFn);
        await ticks();
        expect(card().querySelector('[data-act="parent"]').textContent).toContain("Use for parent task");
        click(card().querySelector('[data-act="parent"]'));
        await ticks();
        const text = askDialog().textContent;
        expect(text).toContain("Send Nadir's 12 temperature TIFFs to the dataset's task, Thermal dataset: Roof?");
        expect(text).toContain("They replace the 5 images sent there before, and what the task processed from them");
        expect(text).toContain("Note: Not normalized");
        press("Replace");
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + C9 + "/parent");
        const msg = document.getElementById("ta-convert-message");
        expect(msg.textContent).toContain("12 TIFFs of Nadir are in the dataset's task, waiting for a processing node");
        expect(msg.querySelector("a").getAttribute("href")).toBe("/dashboard/?project_task_open=1&project_task_expanded=50");
        expect(card().querySelector(".ta-conversion-tasks").textContent).toContain("In the dataset's task: Thermal dataset: Roof (12 images, waiting for a processing node)");
    });

    it("does not send a conversion to the dataset's task while it processes, nor when nothing is confirmed", async () => {
        let fetchFn = server({[URL5]: Object.assign(d({}), {parent: Object.assign({}, PARENT, {busy: true})})});
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="parent"]'));
        await ticks();
        expect(document.getElementById("ta-convert-message").textContent).toContain("processing in WebODM");
        expect(calls(fetchFn)).not.toContain("GET " + C9 + "/task");

        document.body.innerHTML = page('dataset.html');
        fetchFn = server({[URL5]: Object.assign(d({}), {parent: Object.assign({}, PARENT, {images_count: 0, processed: false})}), [C9 + "/task"]: INFO});
        dataset.init(document, fetchFn);
        await ticks();
        click(card().querySelector('[data-act="parent"]'));
        await ticks();
        expect(askDialog().textContent).not.toContain("replace");
        press("Cancel");
        await ticks();
        expect(calls(fetchFn)).not.toContain("POST " + C9 + "/parent");
    });

    it("calls the action that fills the form Copy settings to form", () => {
        const el = document.createElement("div");
        el.innerHTML = conversions.actionsHtml(CONVERSION, true, C9.replace(/9$/, ""), null, null);
        expect(el.querySelector('[data-act="use"]').textContent).toContain("Copy settings to form");
    });
});

describe("the mosaic viewer", () => {
    const C9 = "/api/plugins/dji-thermal/datasets/5/conversions/9";
    const BOUNDS = [10.0, 45.0, 10.001, 45.001];
    const tab = (name, kind, stats) => ({tab: name, kind, bounds: BOUNDS, minzoom: 15, maxzoom: 21, stats});
    const TEMPS = {min: 10.2, max: 48.9, percentiles: [12.34, 40.06]};
    // A mosaic's histogram, for the equalization
    const HISTOGRAM = {counts: [1, 0, 3, 2], edges: [0, 10, 20, 30, 40]};
    const INFERNO = Array.from({length: 256}, (_, i) => ((i << 24) | (0 << 16) | ((255 - i) << 8) | 255) >>> 0);
    const VIEWER = Object.assign({}, CONVERSION, {
        dataset_name: "Roof", unit: "C", flown: ["2026:10:12 18:29:50", "2026:10:12 18:30:10"], built_at: "2026-10-18T11:05:00Z",
        stripped: false, frames: ["a_T.JPG", "b_T.JPG"], mosaic_status: "ready", can_change: true,
        tabs: [tab("as_converted", "as_converted", TEMPS), tab("harmonized", "harmonized", TEMPS),
               tab("source_frame", "as_converted", TEMPS), tab("view_angle", "as_converted", {min: 0, max: 14, percentiles: [1, 12]})],
        kinds: {
            as_converted: {frames: 2, oblique: 1, unusable: 0, width: 400, height: 300, gsd_m: 0.021, files: ["mosaic.tif"],
                           normalization: null, report: {}},
            harmonized: {frames: 2, oblique: 1, unusable: 0, width: 400, height: 300, gsd_m: 0.021, files: ["mosaic.tif", "report.json"],
                         normalization: [18, 12.5], report: {radiometric_seams: {pixels: 100, median_abs_c: 0.2, p95_abs_c: 0.9},
                         misalignment: {pairs: 3, median_m: 0.05, p90_m: 0.12}, frame_offsets: {offset_c: {min: -0.5, max: 0.7}, normalized: true}}}
        },
        palettes: [{key: "inferno", label: "Inferno", color_map: INFERNO}, {key: "dji_ironred", label: "Iron red (DJI)", color_map: INFERNO}],
        default_palette: "dji_ironred"
    });

    // A Leaflet stand-in: the map and the tile layers the viewer made
    function fakeLeaflet() {
        const L = {maps: [], tiles: []};
        const layer = extra => Object.assign({addTo(m) { (m.layers = m.layers || []).push(this); return this; }}, extra);
        L.map = el => {
            const handlers = {};
            const m = {el, layers: [], fitted: null, on(ev, f) { handlers[ev] = f; return m; }, fire(ev, e) { handlers[ev](e); },
                       fitBounds(b) { m.fitted = b; }, removeLayer(l) { m.layers = m.layers.filter(x => x !== l); }};
            L.maps.push(m);
            return m;
        };
        L.tileLayer = (url, opts) => {
            const t = layer({url, opts, setUrl(u) { t.url = u; }});
            if (url.indexOf("/mosaics/") >= 0) L.tiles.push(t);
            return t;
        };
        L.tileLayer.wms = (url, opts) => layer({url, opts, wms: true});
        // The mosaic's tiles, coloured from their values (recolour.js)
        L.gridLayer = opts => {
            const t = layer({opts, on() { return t; }, getTileSize: () => ({x: 256, y: 256})});
            L.tiles.push(t);
            return t;
        };
        L.layerGroup = () => layer({group: true, clearLayers() { this.layers = []; }});
        L.circleMarker = (latlng, opts) => layer({marker: latlng, opts});
        L.polygon = (points, opts) => layer({polygon: points, opts});
        L.control = {layers: (bases) => layer({bases}), scale: () => layer({})};
        return L;
    }

    beforeEach(() => { document.body.innerHTML = page('viewer.html'); });
    afterEach(() => { window.localStorage.clear(); });
    const $ = id => document.getElementById(id);
    // How a mosaic layer's tiles are coloured now, and a value tile's URL
    const drawn = t => t.__dtValues.style();
    const valuesOf = t => t.__dtValues.url({z: 18, x: 1, y: 2});
    const start = (fetchFn, L, basemaps) => viewer.init({doc: document, fetchFn, loadLeaflet: () => Promise.resolve(L), basemaps: basemaps || []});

    it("works out a tab's starting range, in the user's unit, and reads a typed one back", () => {
        expect(viewer.defaultRange({tab: "harmonized", stats: TEMPS}, "C")).toEqual([12.3, 40.1]);
        window.localStorage.setItem("unit_system", "imperial");
        // 12.34 °C is 54.21 °F, 40.06 °C 104.11 °F: rounded outwards in °F, kept in °C
        const r = viewer.defaultRange({tab: "harmonized", stats: TEMPS}, "C");
        expect(viewer.shownRange("harmonized", r, "C").map(x => Math.round(x * 100) / 100)).toEqual([54.2, 104.2]);
        expect(viewer.defaultRange({tab: "view_angle", stats: {percentiles: [1.04, 12.01]}}, "C")).toEqual([1, 12.1]);
        expect(viewer.defaultRange({tab: "view_angle"}, "C")).toEqual([0, 1]);
        expect(viewer.parseRange("32", "212", "harmonized", "C")).toEqual({range: [0, 100]});
        expect(viewer.parseRange("5", "60", "view_angle", "C")).toEqual({range: [5, 60]});
        expect(viewer.parseRange("", "1", "harmonized", "C").error).toMatch(/minimum and a maximum/);
        expect(viewer.parseRange("3", "3", "harmonized", "C").error).toMatch(/above the minimum/);
        expect(viewer.styleGroup("as_converted")).toBe(viewer.styleGroup("harmonized"));
    });

    it("marks round values on the colour scale", () => {
        expect(viewer.scaleTicks(12.3, 40.1, 5).map(t => t.label)).toEqual(["15", "20", "25", "30", "35", "40"]);
        expect(viewer.scaleTicks(0, 1, 5).map(t => t.label)).toEqual(["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
        expect(viewer.scaleTicks(-1, 1, 4).map(t => t.label)).toEqual(["-1.0", "-0.5", "0.0", "0.5", "1.0"]);
        expect(viewer.scaleTicks(0, 10, 5)[0].at).toBe(0);
        expect(viewer.scaleTicks(3, 3, 5)).toEqual([]);
        expect(viewer.gradientCss(INFERNO)).toMatch(/^linear-gradient\(to right, rgb\(0,0,255\), /);
    });

    it("says the colour scale's own lowest and highest values at its ends, and round values between that don't crowd them", () => {
        const scale = require("../scale.js");
        const marks = (lo, hi) => scale.rangeTicks(lo, hi, 5).map(t => [t.label, Math.round(t.at * 100)]);
        // The request's example: 55 to 105 °F
        expect(marks(55, 105)).toEqual([["55", 0], ["70", 30], ["80", 50], ["90", 70], ["105", 100]]);
        expect(marks(12.34, 40.06)).toEqual([["12.3", 0], ["20", 28], ["25", 46], ["30", 64], ["35", 82], ["40.1", 100]]);
        expect(marks(0, 1).map(m => m[0])).toEqual(["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
        expect(scale.rangeTicks(3, 3, 5)).toEqual([]);
    });

    it("says when the frames were flown", () => {
        expect(viewer.takenText(["2026:10:12 18:29:50", "2026:10:12 18:30:10"])).toBe("2026-10-12 18:29–18:30");
        expect(viewer.takenText(["2026:10:12 18:29:50", "2026:10:13 09:00:00"])).toBe("2026-10-12 18:29 – 2026-10-13 09:00");
        expect(viewer.takenText(["2026:10:12 18:29:50"])).toBe("2026-10-12 18:29");
        expect(viewer.takenText([])).toBe("");
    });

    it("asks for a tile's values once, and again when the mosaic is built again", () => {
        expect(viewer.valuesUrl(C9, "harmonized", {z: 18, x: 1, y: 2}, "2026-10-18T11:05:00Z"))
            .toBe(C9 + "/mosaics/harmonized/values/18/1/2.png?v=2026-10-18T11%3A05%3A00Z");
        expect(viewer.valuesUrl(C9, "source_frame", {z: 3, x: 4, y: 5}, "x")).toBe(C9 + "/mosaics/source_frame/values/3/4/5.png?v=x");
    });

    it("describes the values under the cursor and the mosaic's report", () => {
        window.localStorage.setItem("unit_system", "imperial");
        const el = document.createElement("div");
        el.innerHTML = viewer.readoutHtml({valid: true, temperature: 20, frame: "a_T.JPG", view_angle: 3.21}, "C");
        expect(el.textContent).toContain("68.00 °F");
        expect(el.textContent).toContain("a_T.JPG");
        expect(el.textContent).toContain("3.2°");
        expect(el.textContent).not.toContain("Frame pixel");
        el.innerHTML = viewer.readoutHtml({valid: true, temperature: 20, frame: "a_T.JPG", view_angle: 3.21, frame_pixel: [353, 256]}, "C");
        expect(el.textContent).toContain("Frame pixel");
        expect(el.textContent).toContain("x 353, y 256");
        expect(el.querySelector("#ta-viewer-follow")).toBeNull();
        el.innerHTML = viewer.readoutHtml({valid: true, temperature: 20, frame: "a_T.JPG"}, "C", true);
        expect(el.querySelector("#ta-viewer-follow").textContent).toBe("Follow the cursor");
        el.innerHTML = viewer.readoutHtml({valid: false, reason: "outside_raster"}, "C", true);
        expect(el.textContent).toContain("Outside the mosaic");
        expect(el.querySelector("#ta-viewer-follow")).not.toBeNull();
        expect(viewer.readoutHtml({valid: false, reason: "outside_raster"}, "C")).toContain("Outside the mosaic");
        expect(viewer.readoutHtml({valid: false, reason: "nodata"}, "C")).toContain("No data here");

        el.innerHTML = viewer.reportHtml(VIEWER.kinds.harmonized, "harmonized", C9);
        const text = el.textContent;
        expect(text).toContain("2 placed, 1 oblique left out");
        expect(text).toContain("400 × 300 px at 2.1 cm");
        expect(text).toContain("median 0.36 °F, 95% under 1.62 °F");
        expect(text).toContain("median 5.0 cm, 90% under 12.0 cm (3 overlapping pairs)");
        expect(text).toContain("-0.90 to 1.26 °F, removed");
        expect(text).toContain("ambient 64.4 °F, reflected 54.5 °F");
        expect(el.querySelector('a[href="' + C9 + '/download?mosaic=harmonized%2Freport.json"]')).not.toBe(null);
    });

    it("makes WebODM's base layers, its default one shown, and a None", () => {
        const L = fakeLeaflet();
        const b = viewer.baseLayers(L, [{label: "Streets", url: "https://s/{z}/{x}/{y}.png", maxzoom: 19},
                                        {label: "Satellite", url: "https://a/{z}/{x}/{y}.jpg", default: true},
                                        {label: "WMS", url: "https://w", type: "wms", layers: "1"}]);
        expect(Object.keys(b.layers)).toEqual(["Streets", "Satellite", "WMS", "None"]);
        expect(b.shown).toBe(b.layers.Satellite);
        expect(b.layers.Streets.opts.maxNativeZoom).toBe(19);
        expect(b.layers.WMS.wms).toBe(true);
        const none = viewer.baseLayers(L, []);
        expect(none.shown).toBe(none.layers.None);
        expect(viewer.baseLayers(L, [{label: "A", url: "a"}, {label: "B", url: "b"}]).shown.url).toBe("a");
    });

    it("shows a tab per mosaic, with the palette and range changed live", async () => {
        window.localStorage.setItem("unit_system", "imperial");
        const L = fakeLeaflet();
        const fetchFn = server({[C9 + "/mosaics"]: VIEWER,
                                [C9 + "/mosaics/harmonized/point?lon=10.0005&lat=45.0005"]: {valid: true, temperature: 30, frame: "b_T.JPG", view_angle: 2},
                                "PUT /api/plugins/dji-thermal/display": (u, o) => jsonResponse(Object.assign({unit: null}, JSON.parse(o.body)))});
        await start(fetchFn, L, [{label: "Streets", url: "https://s/{z}/{x}/{y}.png"}]);
        await ticks();
        expect($("ta-viewer-main").hidden).toBe(false);
        expect($("ta-viewer-subtitle").textContent).toContain("Roof");
        expect($("ta-viewer-subtitle").textContent).toContain("flown 2026-10-12 18:29–18:30");
        expect([...$("ta-viewer-tabs").querySelectorAll("a")].map(a => a.textContent)).toEqual(["Mosaic", "Harmonized", "Source frame", "View angle"]);
        const map = L.maps[0];
        expect(map.fitted).toEqual([[45.0, 10.0], [45.001, 10.001]]);
        expect(valuesOf(L.tiles[0])).toBe(C9 + "/mosaics/as_converted/values/18/1/2.png?v=2026-10-18T11%3A05%3A00Z");
        expect(drawn(L.tiles[0])).toMatchObject({palette: "dji_ironred", colors: INFERNO, shares: null, sharpen: 0, isotherm: null,
                                                 seams: false});
        // rounded outwards in °F, kept in °C
        expect(drawn(L.tiles[0]).range.map(x => x.toFixed(1))).toEqual(["12.3", "40.1"]);
        expect($("ta-viewer-palette").value).toBe("dji_ironred");
        // 12.3 to 40.1 °C is 54.2 to 104.2 °F
        expect([...$("ta-viewer-scale").querySelectorAll(".ta-tick")].map(t => t.textContent)).toEqual(["54.2", "70", "80", "90", "104.2"]);

        // Harmonized shares the palette and range of the temperatures
        click($("ta-viewer-tabs").querySelector('[data-tab="harmonized"]'));
        await ticks();
        const t = L.tiles[L.tiles.length - 1];
        expect(valuesOf(t)).toContain("/mosaics/harmonized/values/");
        expect(map.layers.filter(l => L.tiles.indexOf(l) >= 0)).toEqual([t]);
        $("ta-viewer-palette").value = "inferno";
        change($("ta-viewer-palette"));
        expect(drawn(t).palette).toBe("inferno");
        // A temperature palette chosen is the user's, everywhere
        const put = fetchFn.mock.calls.filter(c => c[1] && c[1].method === "PUT");
        expect(put.map(c => JSON.parse(c[1].body))).toEqual([{palette: "inferno"}]);
        $("ta-viewer-min").value = "32";
        $("ta-viewer-max").value = "212";
        change($("ta-viewer-max"));
        expect(drawn(t).range).toEqual([0, 100]);
        $("ta-viewer-max").value = "20";
        change($("ta-viewer-max"));
        expect($("ta-viewer-range-error").textContent).toMatch(/above the minimum/);
        expect(drawn(t).range).toEqual([0, 100]);
        click($("ta-viewer-auto"));
        expect(drawn(t).range.map(x => x.toFixed(1))).toEqual(["12.3", "40.1"]);

        // The view angles keep their own; the source frames are drawn over the temperatures, in their palette and range
        click($("ta-viewer-tabs").querySelector('[data-tab="view_angle"]'));
        await ticks();
        expect(drawn(L.tiles[L.tiles.length - 1])).toMatchObject({palette: "inferno", range: [1, 12], seams: false});
        click($("ta-viewer-tabs").querySelector('[data-tab="source_frame"]'));
        await ticks();
        expect($("ta-viewer-palette").value).toBe("inferno");
        const frames = L.tiles[L.tiles.length - 1];
        expect(valuesOf(frames)).toContain("/mosaics/source_frame/values/");
        expect(drawn(frames)).toMatchObject({palette: "inferno", seams: true});
        expect(drawn(frames).range.map(x => x.toFixed(1))).toEqual(["12.3", "40.1"]);
        click($("ta-viewer-tabs").querySelector('[data-tab="harmonized"]'));
        await ticks();
        expect($("ta-viewer-palette").value).toBe("inferno");

        // The values under the cursor, once it rests
        jest.useFakeTimers();
        map.fire("mousemove", {latlng: {lng: 10.0005, lat: 45.0005}});
        jest.advanceTimersByTime(200);
        await ticks();
        expect($("ta-viewer-readout").textContent).toContain("86.00 °F");
        expect($("ta-viewer-readout").textContent).toContain("b_T.JPG");
        expect(L.maps.length).toBe(1);
    });

    it("builds missing mosaics and follows them until they are built", async () => {
        jest.useFakeTimers();
        const none = Object.assign({}, CONVERSION, {mosaic_status: "", can_change: true, tabs: [], kinds: {}, dataset_name: "Roof"});
        const fetchFn = server({[C9 + "/mosaics"]: [none, Object.assign({}, none, {mosaic_status: "building", mosaic_progress: 0.3}), VIEWER],
                                ["POST " + C9 + "/mosaics"]: Object.assign({}, CONVERSION, {mosaic_status: "building"})});
        const L = fakeLeaflet();
        start(fetchFn, L);
        await ticks();
        expect($("ta-viewer-main").hidden).toBe(true);
        expect($("ta-viewer-status").textContent).toContain("no mosaics");
        expect($("ta-viewer-build").hidden).toBe(false);
        expect(L.maps.length).toBe(0);
        click($("ta-viewer-build"));
        await ticks();
        expect(calls(fetchFn)).toContain("POST " + C9 + "/mosaics");
        expect($("ta-viewer-status").textContent).toContain("Building the mosaics");
        expect($("ta-viewer-cancel").hidden).toBe(false);
        expect($("ta-viewer-build").hidden).toBe(true);
        jest.runOnlyPendingTimers();
        await ticks();
        expect($("ta-viewer-main").hidden).toBe(false);
        expect($("ta-viewer-cancel").hidden).toBe(true);
        expect($("ta-viewer-build").textContent).toContain("Build again");
        expect(L.tiles.length).toBe(1);
    });

    it("lets viewers look but not build", async () => {
        const fetchFn = server({[C9 + "/mosaics"]: Object.assign({}, VIEWER, {can_change: false})});
        await start(fetchFn, fakeLeaflet());
        await ticks();
        expect($("ta-viewer-main").hidden).toBe(false);
        expect($("ta-viewer-build").hidden).toBe(true);
        expect($("ta-viewer-cancel").hidden).toBe(true);
    });

    it("shows the frames that saw a point clicked, drawn as the tab draws the mosaic, with a crosshair on the point", async () => {
        const L = fakeLeaflet();
        const frame = (index, file, x, source) => ({index, file, x, y: 255.5, width: 640, height: 512, view_angle: 2.25 + index,
            source, footprint: [[10, 45], [10.001, 45], [10.001, 45.001], [10, 45.001]]});
        const at = "?lon=10.0005&lat=45.0005";
        const fetchFn = server({[C9 + "/mosaics"]: VIEWER,
                                [C9 + "/mosaics/as_converted/frames" + at]: {frames: [frame(1, "b_T.JPG", 319.5, true), frame(0, "a_T.JPG", 63.5, false)], models: true},
                                [C9 + "/mosaics/view_angle/frames" + at]: {frames: [frame(1, "b_T.JPG", 319.5, true), frame(0, "a_T.JPG", 63.5, false)], models: true},
                                [C9 + "/mosaics/harmonized/frames" + at]: {frames: [], models: true},
                                [C9 + "/mosaics/as_converted/point" + at]: {valid: true, temperature: 30, frame: "b_T.JPG"},
                                [C9 + "/mosaics/view_angle/point" + at]: {valid: true, frame: "b_T.JPG", view_angle: 3},
                                [C9 + "/mosaics/harmonized/point" + at]: {valid: true, temperature: 30, frame: "b_T.JPG"}});
        await start(fetchFn, L);
        await ticks();
        // After the "None" base layer: the frames window's footprint, then the kept point's marker
        const map = L.maps[0], groups = map.layers.filter(l => l.group), picked = groups[1], kept = groups[2];
        expect($("ta-viewer-pip").hidden).toBe(true);
        map.fire("click", {latlng: {lng: 10.0005, lat: 45.0005}});
        await ticks();
        const pip = $("ta-viewer-pip"), img = () => pip.querySelector("img");
        expect(pip.hidden).toBe(false);
        expect(pip.textContent).toContain("Frame 1 of 2 that saw this point");
        expect(pip.textContent).toContain("b_T.JPG");
        expect(pip.textContent).toContain("comes from this frame");
        expect(img().getAttribute("src")).toBe(C9 + "/mosaics/as_converted/frames/1.png?v=2026-10-18T11%3A05%3A00Z&color_map=dji_ironred&rescale=12.3,40.1");
        // The pixel's centre: (319.5 + 0.5) / 640 across, (255.5 + 0.5) / 512 down
        expect(pip.querySelector(".ta-pip-mark").getAttribute("style")).toBe("left: 50.00%; top: 50.00%;");
        expect(picked.layers.map(l => l.polygon && "footprint")).toEqual(["footprint"]);
        expect(picked.layers[0].polygon[0]).toEqual([45, 10]);
        expect(kept.layers.map(l => l.marker)).toEqual([{lng: 10.0005, lat: 45.0005}]);
        expect(pip.querySelector('[data-pip="prev"]').disabled).toBe(true);
        // The frame on its own page, in a new tab
        const open = pip.querySelector('[data-pip="open"]');
        expect(open.getAttribute("href")).toBe("/plugins/dji-thermal/dataset/5/conversion/9/frame?frame=b_T.JPG");
        expect(open.getAttribute("target")).toBe("_blank");

        // The next frame; a palette changed redraws it
        click(pip.querySelector('[data-pip="next"]'));
        expect(pip.textContent).toContain("Frame 2 of 2");
        expect(pip.textContent).not.toContain("comes from this frame");
        expect(pip.querySelector('[data-pip="next"]').disabled).toBe(true);
        expect(pip.querySelector(".ta-pip-mark").getAttribute("style")).toBe("left: 10.00%; top: 50.00%;");
        $("ta-viewer-palette").value = "inferno";
        change($("ta-viewer-palette"));
        expect(img().getAttribute("src")).toContain("/frames/0.png?");
        expect(img().getAttribute("src")).toContain("color_map=inferno");

        // Another tab finds the frames for its mosaic, keeping the frame shown, in its own palette and range
        click($("ta-viewer-tabs").querySelector('[data-tab="view_angle"]'));
        await ticks();
        expect(pip.textContent).toContain("Frame 2 of 2");
        expect(img().getAttribute("src")).toContain("/mosaics/view_angle/frames/0.png?");
        expect(img().getAttribute("src")).toContain("rescale=1,12");
        click($("ta-viewer-tabs").querySelector('[data-tab="harmonized"]'));
        await ticks();
        expect(pip.textContent).toContain("No frame saw this point");
        expect(picked.layers.length).toBe(0);

        // A frame that cannot be drawn says so; closed, the window and its marks go
        click($("ta-viewer-tabs").querySelector('[data-tab="as_converted"]'));
        await ticks();
        img().dispatchEvent(new Event("error"));
        expect(pip.textContent).toContain("Could not draw this frame");
        click(pip.querySelector('[data-pip="close"]'));
        expect(pip.hidden).toBe(true);
        expect(picked.layers.length).toBe(0);
        // The point stays kept, and marked
        expect(kept.layers.length).toBe(1);
    });

    it("a click keeps the readout on its point until Follow the cursor or Esc", async () => {
        const L = fakeLeaflet();
        const at = "?lon=10.0005&lat=45.0005", elsewhere = "?lon=10.0002&lat=45.0002";
        const fetchFn = server({[C9 + "/mosaics"]: VIEWER,
                                [C9 + "/mosaics/as_converted/frames" + at]: {frames: [], models: true},
                                [C9 + "/mosaics/view_angle/frames" + at]: {frames: [], models: true},
                                [C9 + "/mosaics/as_converted/point" + at]: {valid: true, temperature: 30, frame: "b_T.JPG"},
                                [C9 + "/mosaics/view_angle/point" + at]: {valid: true, frame: "b_T.JPG", view_angle: 3},
                                [C9 + "/mosaics/as_converted/point" + elsewhere]: {valid: true, temperature: 20, frame: "a_T.JPG"}});
        await start(fetchFn, L);
        await ticks();
        const map = L.maps[0], kept = map.layers.filter(l => l.group)[2], readout = () => $("ta-viewer-readout").textContent;
        const hover = async latlng => {
            map.fire("mousemove", {latlng});
            jest.advanceTimersByTime(200);
            await ticks();
        };
        jest.useFakeTimers();
        map.fire("click", {latlng: {lng: 10.0005, lat: 45.0005}});
        await ticks();
        expect(readout()).toContain("b_T.JPG");
        expect($("ta-viewer-follow")).not.toBeNull();
        expect(kept.layers.length).toBe(1);

        // The cursor moving on leaves it; another tab reads the kept point for its mosaic
        await hover({lng: 10.0002, lat: 45.0002});
        expect(readout()).toContain("b_T.JPG");
        expect(calls(fetchFn)).not.toContain("GET " + C9 + "/mosaics/as_converted/point" + elsewhere);
        click($("ta-viewer-tabs").querySelector('[data-tab="view_angle"]'));
        await ticks();
        expect(readout()).toContain("3.0°");
        expect($("ta-viewer-follow")).not.toBeNull();
        click($("ta-viewer-tabs").querySelector('[data-tab="as_converted"]'));
        await ticks();

        // Follow the cursor lets go: the hint, no marker, and the readout follows the cursor again
        click($("ta-viewer-follow"));
        expect(readout()).toBe(viewer.READOUT_HINT);
        expect(kept.layers.length).toBe(0);
        await hover({lng: 10.0002, lat: 45.0002});
        expect(readout()).toContain("a_T.JPG");
        expect($("ta-viewer-follow")).toBeNull();

        // So does Esc, but not while typing in a field
        map.fire("click", {latlng: {lng: 10.0005, lat: 45.0005}});
        await ticks();
        $("ta-viewer-min").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(readout()).toContain("b_T.JPG");
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(readout()).toBe(viewer.READOUT_HINT);
        expect(kept.layers.length).toBe(0);
    });

    it("ports dji-thermal-ui's image adjustments: the sliders' range, gamma, the query and the colour bar's curve", () => {
        expect(viewer.slidRange([10, 30], 0, 0)).toEqual([10, 30]);
        expect(viewer.slidRange([10, 30], 0.5, 0)).toEqual([0, 20]);
        expect(viewer.slidRange([10, 30], 0, 1)).toEqual([15, 25]);
        expect(viewer.sliderPositions([10, 30], [15, 25])).toEqual({brightness: 0, contrast: 1});
        expect(viewer.sliderPositions([10, 30], [0, 20])).toEqual({brightness: 0.5, contrast: 0});
        expect(viewer.sliderPositions([10, 30], [29, 29.5])).toEqual({brightness: -0.46, contrast: 2});
        expect([viewer.sliderGamma(1), viewer.gammaSlider(2), viewer.sliderGamma(-5)]).toEqual([2, 1, 0.2]);
        expect(viewer.adjustQuery({gamma: 1, equalize: false, sharpen: 0})).toBe("");
        expect(viewer.adjustQuery({gamma: 2, equalize: true, sharpen: 1.5})).toBe("&gamma=2&equalize=1&sharpen=1.5");
        const t = viewer.toneShares(2);
        expect([t.length, t[0], t[64]]).toEqual([65, 0, 1]);
        expect(t[16]).toBeCloseTo(0.5);
        const scale = require("../scale");
        expect(scale.gradientCss([0x000000ff, 0xffffffff], [0, 0.5, 1])).toBe("linear-gradient(to right, rgb(0,0,0), rgb(128,128,128), rgb(255,255,255))");
        expect(scale.gradientCss([0x000000ff, 0xffffffff]).match(/rgb\(/g).length).toBe(16);
    });

    it("turns an isotherm typed in the user's unit into the server's, in the mosaic's unit", () => {
        window.localStorage.setItem("unit_system", "imperial");
        expect(viewer.isothermParam("", "", "", "C")).toEqual({value: ""});
        expect(viewer.isothermParam("above", "104", "", "C")).toEqual({value: "above,40"});
        expect(viewer.isothermParam("below", "32", "", "C")).toEqual({value: "below,0"});
        expect(viewer.isothermParam("between", "50", "68", "C")).toEqual({value: "between,10,20"});
        expect(viewer.isothermParam("above", "", "", "C").error).toMatch(/needs a temperature/);
        expect(viewer.isothermParam("between", "50", "", "C").error).toMatch(/needs two temperatures/);
        expect(viewer.isothermParam("between", "68", "50", "C").error).toMatch(/above the first/);
    });

    it("draws the image as the Image section says: the sliders, Equalized, Reset, and the frames' pictures too", async () => {
        const L = fakeLeaflet();
        const at = "?lon=10.0005&lat=45.0005";
        const fetchFn = server({[C9 + "/mosaics"]: VIEWER,
                                [C9 + "/mosaics/as_converted/histogram"]: HISTOGRAM,
                                [C9 + "/mosaics/as_converted/point" + at]: {valid: true, temperature: 30, frame: "b_T.JPG"},
                                [C9 + "/mosaics/as_converted/frames" + at]: {frames: [{index: 1, file: "b_T.JPG", x: 3.5, y: 2.5,
                                    width: 8, height: 6, view_angle: 2, source: true}], models: true},
                                [C9 + "/mosaics/view_angle/point" + at]: {valid: true, frame: "b_T.JPG", view_angle: 2},
                                [C9 + "/mosaics/view_angle/frames" + at]: {frames: [], models: true}});
        await start(fetchFn, L);
        await ticks();
        const tile = () => drawn(L.tiles[L.tiles.length - 1]);
        const recoloured = jest.spyOn(L.tiles[0], "recolour");
        const slide = (id, value, done) => {
            $(id).value = value;
            $(id).dispatchEvent(new Event("input", {bubbles: true}));
            if (done) $(id).dispatchEvent(new Event("change", {bubbles: true}));
        };
        expect([tile().range, tile().shares]).toEqual([[12.3, 40.1], null]);

        // Brightness moves the range: the boxes and the tiles follow while it moves, with no requests
        const asked = fetchFn.mock.calls.length;
        slide("ta-viewer-brightness", "0.5", false);
        expect([$("ta-viewer-min").value, $("ta-viewer-max").value]).toEqual(["-1.6", "26.2"]);
        expect(tile().range).toEqual([-1.6, 26.2]);
        expect(recoloured).toHaveBeenCalled();
        expect(fetchFn.mock.calls.length).toBe(asked);
        slide("ta-viewer-brightness", "0.5", true);
        expect(tile().range).toEqual([-1.6, 26.2]);

        // Gamma: its value, the colour bar and the tiles while it moves
        const legend = () => document.querySelector(".ta-viewer-legend").style.background;
        const linear = legend();
        slide("ta-viewer-gamma", "1", false);
        expect($("ta-viewer-gamma-value").textContent).toBe("2.00");
        expect(legend()).not.toBe(linear);
        expect(tile().shares[16]).toBeCloseTo(0.5, 12);
        slide("ta-viewer-gamma", "1", true);
        // Sharpening too
        slide("ta-viewer-sharpen", "2", false);
        expect(tile().sharpen).toBe(2);

        // Equalized: the tiles and the colour bar along the curve of the mosaic's histogram, asked for once
        $("ta-viewer-tone").value = "equalize";
        change($("ta-viewer-tone"));
        await ticks();
        const curve = Recolour.curveShares(-1.6, 26.2, {gamma: 2}, Recolour.equalization(HISTOGRAM, -1.6, 26.2));
        expect(tile().shares).toEqual(curve);
        expect(legend().match(/rgb\(/g).length).toBe(Recolour.CURVE_SAMPLES);
        slide("ta-viewer-brightness", "0", true);
        expect(tile().shares).toEqual(Recolour.curveShares(12.3, 40.1, {gamma: 2}, Recolour.equalization(HISTOGRAM, 12.3, 40.1)));
        expect(calls(fetchFn).filter(c => c.endsWith("/histogram"))).toHaveLength(1);
        slide("ta-viewer-brightness", "0.5", true);

        // The frames window's picture is drawn the same way
        L.maps[0].fire("click", {latlng: {lng: 10.0005, lat: 45.0005}});
        await ticks();
        expect($("ta-viewer-pip").querySelector("img").getAttribute("src")).toContain("rescale=-1.6,26.2&gamma=2&equalize=1&sharpen=2");

        // The isotherm: its fields shown for its mode, no error before a temperature is typed, then drawn in the tiles
        // and the frames window's picture
        $("ta-viewer-iso-mode").value = "above";
        change($("ta-viewer-iso-mode"));
        expect([$("ta-viewer-iso-a").hidden, $("ta-viewer-iso-b").hidden, $("ta-viewer-iso-hint").hidden]).toEqual([false, true, false]);
        expect($("ta-viewer-iso-error").textContent).toBe("");
        expect(tile().isotherm).toBeNull();
        $("ta-viewer-iso-a").value = "30";
        change($("ta-viewer-iso-a"));
        await ticks();
        expect(tile().isotherm).toEqual([30, 3e38]);
        expect($("ta-viewer-pip").querySelector("img").getAttribute("src")).toContain("&isotherm=above%2C30");

        // View angle: no Equalized, no isotherm
        click($("ta-viewer-tabs").querySelector('[data-tab="view_angle"]'));
        await ticks();
        expect([...$("ta-viewer-tone").options].map(o => o.value)).toEqual(["linear"]);
        expect($("ta-viewer-iso-mode")).toBeNull();
        expect(tile().isotherm).toBeNull();

        // Back on the temperatures the isotherm is still there; None removes it
        click($("ta-viewer-tabs").querySelector('[data-tab="as_converted"]'));
        await ticks();
        expect($("ta-viewer-iso-mode").value).toBe("above");
        $("ta-viewer-iso-mode").value = "";
        change($("ta-viewer-iso-mode"));
        expect($("ta-viewer-iso-a").hidden).toBe(true);
        expect(tile().isotherm).toBeNull();

        // Reset: the Auto range, no adjustments
        click($("ta-viewer-reset"));
        expect(tile()).toMatchObject({range: [12.3, 40.1], shares: null, sharpen: 0, isotherm: null});
        expect([$("ta-viewer-gamma-value").textContent, $("ta-viewer-tone").value, $("ta-viewer-brightness").value]).toEqual(["1.00", "linear", "0"]);
    });

    it("asks for the mosaics to be built again when they have no frame positions", () => {
        const el = document.createElement("div");
        el.innerHTML = viewer.pipHtml({frames: [], models: false, at: 0}, "");
        expect(el.textContent).toContain("build them again");
        expect(el.querySelector("img")).toBeNull();
    });

    it("says why there is nothing to show", () => {
        expect(viewer.statusHtml({status: "converting"}).text).toContain("being converted");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "failed", mosaic_error: "No <frames>"}).text).toContain("No &lt;frames&gt;");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "canceled"}).text).toContain("canceled");
        expect(viewer.statusHtml({status: "failed", mosaic_status: ""}).text).toContain("were not converted");
        expect(viewer.statusHtml({status: "ready", mosaic_status: "ready"}).text).toBe("");
    });
});
