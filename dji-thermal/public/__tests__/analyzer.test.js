// The Thermal Analyzer's pages: the shared core, the datasets list and a dataset's page, against a fake server
const fs = require('fs');
const path = require('path');
const core = require('../analyzer_core');
window.ThermalAnalyzerCore = core;
const datasets = require('../datasets');
const conversions = require('../conversions');
window.ThermalAnalyzerConversions = conversions;
const dataset = require('../dataset');

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
        .replace(/\{\{ dataset\.name \}\}/g, 'Roof');
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
    replace_above_value: null, replace_below: null, replace_below_value: null, strip_location: false, normalize: false,
    max_pitch: null, outputs: ["temp_c:tiff", "pseudo:png"], compression: "deflate"
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
        expect(document.querySelector("#ta-body tr").textContent).toContain("1/2");

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
        expect(text).toContain("With it: 2 conversions, 1 mosaic and 14 measurements.");
        expect(text).toContain("WebODM tasks made from its conversions are kept");
        expect(core.deleteText(Object.assign({}, DATASET, {conversion_count: 2})).join(" ")).not.toContain("tasks");
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
        expect(html).toContain("M4T · 640×512 · SN1 · 2 frame(s)");
        expect(html).toContain("15.2 °C to 50.6 °C");
        expect(html).toContain("dji-thermal-cli 1.1.0");
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
        expect(problems).toContain("--replace-above");
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
        expect(document.querySelectorAll(".ta-thumb img").length).toBe(3);
        jest.clearAllTimers();    // no more polls into the next test's page
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
        expect(document.getElementById("ta-tab-files").hidden).toBe(false);    // the files once analyzed
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
        expect(askDialog().textContent).toContain("With it: 1 conversion and 1 mosaic.");
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
        expect(html).toContain("Embedded 5.0 m, rangefinder 20.7 m");
        expect(html).toContain("Reflected temperature (°F)");
        expect(html).toContain("recorded 68.0 °F");      // 20 °C
        expect(html).toContain("recorded 0.91");
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

    it("fills the settings from the WebODM plan's process command", () => {
        const s = conversions.planSettings(["-o", "temp_c:tif,pseudo", "--max-pitch", "-80", "--normalize", "--emissivity", "0.9"], DEFAULTS);
        expect(s).toEqual(Object.assign({}, DEFAULTS, {outputs: ["temp_c:tiff", "pseudo"], max_pitch: -80, normalize: true, emissivity: 0.9}));
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
            ["outputs", "temp_c:tiff, pseudo:tiff", true, false],   // the plan's pseudo names no format, so any one is on it
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
        expect(chips.querySelector(".ta-chip-off-plan").getAttribute("title")).toBe("The WebODM plan: normalized");
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

        click(summary.querySelector('[data-act="edit"]'));
        expect(form().hidden).toBe(false);
        expect(summary.querySelector('[data-act="edit"]')).toBe(null);
        input("reflected_temp").value = "68";
        input("reflected_temp").dispatchEvent(new Event("input", {bubbles: true}));
        expect(summary.querySelector('[data-key="reflected_temp"]').textContent).toBe("reflected 68 °F");
        const field = input("reflected_temp").closest(".ta-field");
        expect(field.classList.contains("ta-changed")).toBe(true);
        // The plan normalizes, the form does not
        expect(input("normalize").closest(".checkbox").classList.contains("ta-off-plan")).toBe(true);

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
        expect(form().innerHTML).toContain("Embedded not recorded");
        input("humidity").value = "55";
        jest.runOnlyPendingTimers();
        await ticks();
        expect(form().innerHTML).toContain("Embedded 5.0 m");
        expect(input("humidity").value).toBe("55");
    });

    it("opens the form at once for a dataset without conversions", async () => {
        const fetchFn = server({[URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, conversions: [], defaults: DEFAULTS}),
                                "/api/plugins/dji-thermal/preferences": PREFERENCES});
        dataset.init(document, fetchFn);
        await ticks();
        expect(form().hidden).toBe(false);
        expect(document.querySelector('#ta-convert-summary [data-act="edit"]')).toBe(null);
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
        expect(conversions.listHtml([starting], true, base, null)).toContain("Normalizing: comparing the frames' overlaps");
        const normalizing = Object.assign({}, starting, {stage: {stage: "frames", step: 2, steps: 5, done: 40, total: 217, unit: "files"}});
        expect(conversions.listHtml([normalizing], true, base, null)).toContain("Normalizing: step 2 of 5, reading frames, 40/217 files…");
        expect(html).toContain('href="' + base + '9/download"');
        expect(html).not.toContain(base + '10/download');
        expect(html).toContain("2 converted, 1 skipped");
        expect(html).toContain('data-act="cancel"');
        html = conversions.listHtml([CONVERSION], false, base, null);
        expect(html).not.toContain('data-act="delete"');
        expect(html).toContain('data-act="use"');
        expect(conversions.listHtml([], true, base)).toMatch(/No conversions yet/);

        const files = conversions.resultsHtml(Object.assign({}, CONVERSION, {results: {
            files: [{path: "a_T.JPG", ok: true, outputs: ["sub/a_T_temp_c.tiff"], notes: [], distance: 21.4, distance_source: "lrf"},
                    {path: "b_T.JPG", ok: false, reason: "oblique (gimbal pitch -45 above -80)", outputs: [], notes: []}],
            normalization: {ambient_c: 20, reflected_c: 20, frames: 2, without_offset: 0, offset_min: -0.2, offset_max: 0.3}}}), base);
        expect(files).toContain('href="' + base + '9/download?file=sub%2Fa_T_temp_c.tiff">a_T_temp_c.tiff</a>');
        expect(files).toContain("oblique (gimbal pitch -45 above -80)");
        expect(files).toContain("Skipped: oblique (1).");
        expect(conversions.skipReasons([{ok: false, reason: "oblique (gimbal pitch -45 above -80)"}, {ok: false, reason: "no DJI thermal data found (not an R-JPEG)"},
            {ok: false, reason: "oblique (gimbal pitch -30 above -80)"}, {ok: true}])).toEqual([["oblique", 2], ["no DJI thermal data found", 1]]);
        expect(files).toContain("distance 21.4 m (lrf)");
        expect(files).toContain("offsets -0.20 to 0.30 °C");
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
            [URL5]: Object.assign({}, DATASET, {analysis: ANALYSIS, can_change: false, can_delete: false, conversions: [CONVERSION]}),
            "/api/plugins/dji-thermal/datasets/5/conversions/9": Object.assign({}, CONVERSION, {results: {files: [{path: "a_T.JPG", ok: true, outputs: ["a.tiff"], notes: []}]}})
        });
        dataset.init(document, fetchFn);
        await flush();
        expect(document.getElementById("ta-convert-settings").hidden).toBe(true);
        expect(calls(fetchFn)).not.toContain("GET /api/plugins/dji-thermal/preferences");
        const list = document.getElementById("ta-conversions");
        expect(list.innerHTML).toContain("/conversions/9/download");
        expect(list.innerHTML).not.toContain('data-act="delete"');

        click(list.querySelector('button[data-act="files"]'));
        await flush();
        expect(list.querySelector('[data-files="9"]').innerHTML).toContain("a.tiff");
    });
});
