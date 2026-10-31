// What the Thermal Analyzer's pages share: formatting, a dataset's status, uploading images in batches, and the
// pages' dialog. Plain functions (the dialog aside, DOM-free), so Jest can test them.
(function (root) {
    var STATUS_LABELS = {new: "Not analyzed", analyzing: "Analyzing", ready: "Analyzed", failed: "Failed", canceled: "Canceled"};
    var SEVERITY_LABELS = {error: "Error", warning: "Warning", info: "Note"};
    var KIND_LABELS = {thermal: "Thermal", not_thermal: "Not thermal", not_jpeg: "Not a JPEG", corrupt: "Damaged",
                       unreadable: "Unreadable", unsupported: "Unsupported camera"};

    var BATCH_FILES = 10;               // images per upload request
    var BATCH_BYTES = 40 * 1024 * 1024; // or fewer, when they are large
    var PARALLEL = 3;                   // requests at once
    var RETRIES = 2;                    // a failed request is sent again this many times

    function escapeHtml(t) {
        return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, function (c) {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }

    // Rows (objects) sorted by a key, missing values last either way
    function sortRows(rows, key, desc) {
        var copy = rows.slice();
        copy.sort(function (a, b) {
            var x = a[key], y = b[key];
            var xm = x === null || x === undefined || x === "", ym = y === null || y === undefined || y === "";
            if (xm || ym) return xm === ym ? 0 : (xm ? 1 : -1);    // missing values last either way
            var c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
            return desc ? -c : c;
        });
        return copy;
    }

    function formatBytes(n) {
        if (n === null || n === undefined || isNaN(n)) return "";
        var units = ["B", "KB", "MB", "GB", "TB"], i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
    }

    function formatDate(iso) {
        if (!iso) return "";
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : d.toLocaleString();
    }

    function formatNumber(v, digits, unit) {
        if (v === null || v === undefined || isNaN(v)) return "";
        return Number(v).toFixed(digits) + (unit || "");
    }

    // Temperatures: a conversion's values are in the unit its files were written in (C, F or K); they are shown, and
    // typed, in the user's own: WebODM's units (its unit_system, kept in the browser), Fahrenheit when imperial, else
    // Celsius. It is one setting for the Analyzer, the Thermal Inspector and WebODM's own pages.
    var UNIT_SYMBOLS = {C: "°C", F: "°F", K: "K"};
    var UNIT_SCALE = {C: 1, F: 1.8, K: 1};
    var UNIT_ZERO = {C: 0, F: 32, K: 273.15};   // 0 °C in each unit

    // The user's display preferences ({unit, palette}, null for not chosen), as the page was given them
    // (analyzer_pages.common, in #ta-display). The unit is one saved before WebODM's units were the user's unit: it
    // becomes WebODM's once (migrateUnit)
    var display = readDisplay();
    function readDisplay() {
        var el = root.document && root.document.getElementById("ta-display");
        var p;
        try { p = el ? JSON.parse(el.textContent) : null; } catch (e) { p = null; }
        return {unit: (p && p.unit) || null, palette: (p && p.palette) || null};
    }
    function preferences() { return display; }
    function setPreferences(p) { display = {unit: (p && p.unit) || null, palette: (p && p.palette) || null}; }

    function unitOf(u) { return UNIT_SYMBOLS[u] ? u : "C"; }
    function userUnit() {
        var system;
        try { system = root.localStorage && root.localStorage.getItem("unit_system"); } catch (e) { system = null; }
        return system === "imperial" ? "F" : "C";
    }
    // The user's unit changed (C or F), as WebODM's unit selector does it: saved in the browser, and announced to
    // the page's listeners (onUnitSystemChanged); other tabs hear of it through the storage event
    function setUserUnit(u) {
        var system = u === "F" ? "imperial" : "metric";
        try { root.localStorage.setItem("unit_system", system); } catch (e) { return; }
        if (root.document && typeof root.CustomEvent === "function") {
            root.document.dispatchEvent(new root.CustomEvent("onUnitSystemChanged", {detail: system}));
        }
    }
    function unitSymbol(u) { return UNIT_SYMBOLS[unitOf(u)]; }

    function blankNumber(v) { return v === null || v === undefined || v === "" || isNaN(v); }

    // A temperature from one unit to another (to: the user's when left out)
    function convertTemp(v, from, to) {
        if (blankNumber(v)) return v;
        from = unitOf(from);
        to = to === undefined ? userUnit() : unitOf(to);
        if (from === to) return Number(v);
        return (Number(v) - UNIT_ZERO[from]) / UNIT_SCALE[from] * UNIT_SCALE[to] + UNIT_ZERO[to];
    }

    // A difference of temperatures (a range, ΔT, a standard deviation, an offset): scaled, never shifted
    function convertDelta(v, from, to) {
        if (blankNumber(v)) return v;
        from = unitOf(from);
        to = to === undefined ? userUnit() : unitOf(to);
        return Number(v) / UNIT_SCALE[from] * UNIT_SCALE[to];
    }

    // A temperature in the unit `from`, as the user sees it: "21.50 °F"
    function formatTemp(v, from, digits) {
        return formatNumber(convertTemp(v, from), digits === undefined ? 2 : digits, " " + unitSymbol(userUnit()));
    }

    // A difference in the unit `from`, as the user sees it; signed: with its + when positive
    function formatDelta(v, from, digits, signed) {
        if (blankNumber(v)) return "";
        var d = convertDelta(v, from);
        return (signed && d > 0 ? "+" : "") + formatNumber(d, digits === undefined ? 2 : digits, " " + unitSymbol(userUnit()));
    }

    function statusLabel(d) {
        var label = STATUS_LABELS[d.status] || d.status;
        if (d.status === "analyzing") label += " " + Math.round((d.progress || 0) * 100) + "%";
        if (d.status === "new" && d.analyzed) label = "Images changed: analyze again";
        return label;
    }

    function severityLabel(s) { return SEVERITY_LABELS[s] || s; }
    function kindLabel(k) { return KIND_LABELS[k] || k; }

    // The path an image is uploaded under: its name, or its place in the folder chosen (without that folder's own name)
    function uploadName(file) {
        var rel = file.webkitRelativePath || "";
        var parts = rel.split("/").filter(function (p) { return p; });
        return parts.length > 1 ? parts.slice(1).join("/") : file.name;
    }

    function isImage(file) { return /\.jpe?g$/i.test(file.name || ""); }

    // The upload requests: at most BATCH_FILES images and BATCH_BYTES each (a larger image goes alone)
    function batches(files, maxFiles, maxBytes) {
        maxFiles = maxFiles || BATCH_FILES;
        maxBytes = maxBytes || BATCH_BYTES;
        var out = [], cur = [], bytes = 0;
        files.forEach(function (f) {
            if (cur.length && (cur.length >= maxFiles || bytes + f.size > maxBytes)) {
                out.push(cur);
                cur = [];
                bytes = 0;
            }
            cur.push(f);
            bytes += f.size;
        });
        if (cur.length) out.push(cur);
        return out;
    }

    // How long one upload request may take before it is given up on (and sent again): a base, plus its size at a slow
    // connection's speed. A request dropped on the way (browser, WSL relay, Docker proxy) would otherwise wait forever.
    var TIMEOUT_BASE_MS = 30000;
    var TIMEOUT_BYTES_PER_MS = 128;     // 128 KB/s
    function batchTimeout(bytes) { return TIMEOUT_BASE_MS + Math.round((bytes || 0) / TIMEOUT_BYTES_PER_MS); }

    // Uploads images to a dataset, PARALLEL requests at a time. onProgress({sent, total, bytesSent, bytesTotal}).
    // options.signal: an AbortSignal that cancels the upload (the requests in flight are aborted, no more are sent).
    // Resolves to {saved, failed, canceled} (failed: the images that were not saved, as the Files given, to send
    // them again; when canceled, those not sent too).
    function uploadFiles(fetchFn, url, csrf, files, onProgress, FormDataClass, options) {
        FormDataClass = FormDataClass || root.FormData;
        options = options || {};
        var signal = options.signal;
        var images = files.filter(isImage);
        var queue = batches(images);
        var total = images.length;
        var bytesTotal = images.reduce(function (s, f) { return s + f.size; }, 0);
        var state = {sent: 0, bytesSent: 0, saved: 0, failed: []};

        function canceled() { return !!(signal && signal.aborted); }

        // One request, given up on after its timeout or when the upload is canceled: resolves to its response
        function request(batch) {
            var body = new FormDataClass();
            // The server is sent each image's place in the folder chosen apart: a file's own name loses it
            batch.forEach(function (f) {
                body.append("images", f, f.name);
                body.append("paths", uploadName(f));
            });
            var controller = root.AbortController ? new root.AbortController() : null;
            var timer = null, stop = null;
            var opts = {method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": csrf}, body: body};
            if (controller) opts.signal = controller.signal;
            // Settles even when fetchFn ignores the abort: a stalled request must never hold the upload up
            var givenUp = new Promise(function (resolve, reject) {
                stop = function (why) {
                    if (controller) controller.abort();
                    reject(new Error(why));
                };
                timer = root.setTimeout(function () { stop("upload timed out"); }, batchTimeout(batch.reduce(function (s, f) { return s + f.size; }, 0)));
                if (signal) signal.addEventListener("abort", onCancel);
            });
            function onCancel() { stop("upload canceled"); }
            function done() {
                root.clearTimeout(timer);
                if (signal) signal.removeEventListener("abort", onCancel);
            }
            var sent = fetchFn(url, opts).then(function (res) {
                if (!res.ok) throw new Error("upload failed: " + res.status);
                return res.json();
            });
            return Promise.race([sent, givenUp]).then(function (r) { done(); return r; },
                                                       function (e) { done(); throw e; });
        }

        // One batch, sent again up to RETRIES times: resolves to the number of images saved (null when it failed)
        function send(batch, attempt) {
            return request(batch)
                .then(function (r) { return r.saved || 0; })
                .catch(function () {
                    if (attempt < RETRIES && !canceled()) return send(batch, attempt + 1);
                    batch.forEach(function (f) { state.failed.push(f); });
                    return null;
                });
        }

        function sendBatch(batch) {
            return send(batch, 0).then(function (saved) {
                // A batch that failed is not counted as sent: the progress never reaches 100% with images missing
                if (saved === null) return;
                state.saved += saved;
                state.sent += batch.length;
                state.bytesSent += batch.reduce(function (s, f) { return s + f.size; }, 0);
                if (onProgress && !canceled()) onProgress({sent: state.sent, total: total, bytesSent: state.bytesSent, bytesTotal: bytesTotal});
            });
        }

        function worker() {
            if (canceled()) return Promise.resolve();
            var next = queue.shift();
            return next ? sendBatch(next).then(worker) : Promise.resolve();
        }

        var workers = [];
        for (var i = 0; i < PARALLEL; i++) workers.push(worker());
        return Promise.all(workers).then(function () {
            // Canceled: the batches never sent are not saved either
            queue.forEach(function (batch) { batch.forEach(function (f) { state.failed.push(f); }); });
            return {saved: state.saved, failed: state.failed, canceled: canceled()};
        });
    }

    // What an upload could not send, naming the first few images
    function failedText(files, shown) {
        shown = shown || 5;
        var names = files.slice(0, shown).map(function (f) { return f.webkitRelativePath || f.name; });
        var more = files.length - names.length;
        return files.length + (files.length === 1 ? " image" : " images") + " could not be sent: " + names.join(", ") +
            (more ? " and " + more + " more" : "") + ".";
    }

    function count(n, one, many) { return n + " " + (n === 1 ? one : many); }

    // What deleting a dataset (a summary of it, or its detail) takes with it, paragraph by paragraph
    function deleteText(d) {
        var kept = d.parent && d.parent.images_count;
        var out = ["“" + d.name + "” and its " + count(d.file_count, "image", "images") + " are deleted" +
            (kept ? "." : ", with the task that holds them in the project.")];
        var with_ = [];
        if (d.conversion_count) with_.push(count(d.conversion_count, "workset", "worksets"));
        if (d.mosaic_count) with_.push(count(d.mosaic_count, "mosaic", "mosaics"));
        if (d.measurement_count) with_.push(count(d.measurement_count, "measurement", "measurements"));
        if (with_.length) {
            out.push("With it: " + with_.slice(0, -1).join(", ") + (with_.length > 1 ? " and " : "") + with_[with_.length - 1] + ".");
        }
        if (kept) {
            out.push("The dataset's task is kept as an ordinary WebODM task, “" + d.name + "”, with the " + count(d.parent.images_count, "image", "images") +
                " sent to it" + (d.parent.processed ? " and what it processed" : "") + ".");
        }
        if (d.task_count) out.push("The WebODM tasks made from its worksets are kept.");
        out.push("This cannot be undone.");
        return out;
    }

    function median(values) {
        var v = values.filter(function (x) { return x !== null && x !== undefined && !isNaN(x); }).sort(function (a, b) { return a - b; });
        if (!v.length) return null;
        var m = Math.floor(v.length / 2);
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    }

    // The pages' dialog, in place of the browser's prompt and confirm: themed as the page is. opts: title, text (a
    // paragraph, or a list of them), field ({label, value, readonly}: a text field), selects ([{name, label, value,
    // options: [[value, label]], help}]), buttons ([{label, value, style: "primary" | "danger" | "default"}], left to
    // right). Resolves to {button, value, selects}: the value of the button pressed (null when dismissed: Escape, or a
    // click beside it), the field's text and each select's value by name.
    function dialog(doc, opts) {
        var host = doc.querySelector(".ta-page") || doc.body;
        var buttons = opts.buttons || [{label: "OK", value: true, style: "primary"}];
        var paragraphs = [].concat(opts.text || []);
        var el = doc.createElement("div");
        el.className = "ta-dialog ta-ask";
        el.innerHTML = '<div class="ta-dialog-inner theme-secondary" role="dialog" aria-modal="true" aria-labelledby="ta-ask-title">' +
            '<h4 id="ta-ask-title">' + escapeHtml(opts.title) + "</h4>" +
            paragraphs.map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("") +
            (opts.field ? '<div class="form-group">' + (opts.field.label ? '<label for="ta-ask-field">' + escapeHtml(opts.field.label) + "</label>" : "") +
                '<input type="text" id="ta-ask-field" class="form-control input-sm" maxlength="255"' +
                (opts.field.readonly ? " readonly" : "") + (opts.field.label ? "" : ' aria-label="' + escapeHtml(opts.title) + '"') + "></div>" : "") +
            (opts.selects || []).map(function (sel, i) {
                return '<div class="form-group"><label for="ta-ask-select-' + i + '">' + escapeHtml(sel.label) + "</label>" +
                    '<select id="ta-ask-select-' + i + '" class="form-control input-sm" data-name="' + escapeHtml(sel.name) + '">' +
                    sel.options.map(function (o) {
                        return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === (sel.value || "") ? " selected" : "") + ">" + escapeHtml(o[1]) + "</option>";
                    }).join("") + "</select>" + (sel.help ? '<p class="help-block">' + escapeHtml(sel.help) + "</p>" : "") + "</div>";
            }).join("") +
            '<div class="ta-dialog-actions">' + buttons.map(function (b, i) {
                return '<button type="button" class="btn btn-' + (b.style || "default") + ' btn-sm" data-button="' + i + '">' +
                    escapeHtml(b.label) + "</button>";
            }).join("") + "</div></div>";
        host.appendChild(el);
        var field = el.querySelector("#ta-ask-field");
        if (field) field.value = opts.field.value || "";
        var main = buttons.filter(function (b) { return b.style === "primary" || b.style === "danger"; })[0];
        var before = doc.activeElement;

        return new Promise(function (resolve) {
            function close(value) {
                doc.removeEventListener("keydown", onKey, true);
                if (el.parentNode) el.parentNode.removeChild(el);
                if (before && before.focus) before.focus();
                var selects = {};
                [].forEach.call(el.querySelectorAll("select[data-name]"), function (sel) { selects[sel.getAttribute("data-name")] = sel.value; });
                resolve({button: value, value: field ? field.value : undefined, selects: selects});
            }
            function onKey(e) {
                if (e.key === "Escape") { e.preventDefault(); close(null); }
                else if (e.key === "Enter" && e.target === field && main) { e.preventDefault(); close(main.value); }
            }
            doc.addEventListener("keydown", onKey, true);
            el.addEventListener("click", function (e) {
                if (e.target === el) return close(null);
                var b = e.target.closest ? e.target.closest("button[data-button]") : null;
                if (b) close(buttons[Number(b.getAttribute("data-button"))].value);
            });
            if (field) { field.focus(); field.select(); }
            else {
                var focus = el.querySelector('button[data-button="' + buttons.indexOf(main) + '"]') || el.querySelector("button");
                focus.focus();
            }
        });
    }

    // Asks before doing something: resolves to true when it is to be done
    function ask(doc, title, text, label, style) {
        return dialog(doc, {title: title, text: text, buttons: [{label: "Cancel", value: false},
                                                                {label: label || "OK", value: true, style: style || "primary"}]})
            .then(function (r) { return r.button === true; });
    }

    // Asks for a new name: resolves to it, trimmed, or null when the dialog is dismissed or the name is blank or unchanged
    function askName(doc, title, name) {
        return dialog(doc, {title: title, field: {label: "Name", value: name},
                            buttons: [{label: "Cancel", value: false}, {label: "Rename", value: true, style: "primary"}]})
            .then(function (r) {
                var v = (r.value || "").trim();
                return r.button === true && v && v !== name ? v : null;
            });
    }

    // The display preferences saved for the user (api: the plugin's API URL): resolves to them
    function saveDisplay(fetchFn, api, csrf, body) {
        return fetchFn(api + "display", {method: "PUT", credentials: "same-origin",
            headers: {"Content-Type": "application/json", "X-CSRFToken": csrf}, body: JSON.stringify(body)})
            .then(readJson).then(function (r) {
                if (!r.ok) throw new Error(errorText(r.data, "Could not save the preferences"));
                setPreferences(r.data);
                return preferences();
            });
    }

    // The palette chosen anywhere (the viewer, the map) is the user's: saved as their preference
    function savePalette(fetchFn, api, csrf, palette) {
        return saveDisplay(fetchFn, api, csrf, {palette: palette || null});
    }

    // A unit saved in the preferences before WebODM's units were the user's unit becomes WebODM's (Kelvin: metric),
    // and the preferences are saved again without it. Resolves to true when there was one.
    function migrateUnit(fetchFn, api, csrf) {
        if (!display.unit) return Promise.resolve(false);
        setUserUnit(display.unit === "F" ? "F" : "C");
        return saveDisplay(fetchFn, api, csrf, {palette: display.palette}).then(function () { return true; },
                                                                                  function () { return true; });
    }

    // The palettes the preferences offer: DJI's, then WebODM's colour maps, as [value, label]
    function paletteOptions(data) {
        return (data.palettes || []).map(function (p) { return [p, "DJI " + p]; })
            .concat((data.colormaps || []).map(function (p) { return [p, p]; }));
    }

    // The Preferences dialog (the gear on each page): the unit (WebODM's own) and the palette used throughout the
    // Analyzer and on WebODM's map. Resolves to the preferences saved, or null when dismissed or not saved.
    function editPreferences(doc, fetchFn, api, csrf) {
        return fetchFn(api + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
            if (!r.ok) throw new Error(errorText(r.data, "Could not read the preferences"));
            return dialog(doc, {title: "Preferences", selects: [
                {name: "unit", label: "Temperature unit", value: userUnit(),
                 options: [["C", "Celsius (°C), with WebODM's metric units"], ["F", "Fahrenheit (°F), with WebODM's imperial units"]],
                 help: "The same setting as WebODM's units: changing it here changes it on WebODM's map, and back."},
                {name: "palette", label: "Palette", value: r.data.palette || "",
                 options: [["", "Each image's own"]].concat(paletteOptions(r.data)),
                 help: "Temperatures are drawn in it: the viewer's mosaics and WebODM's map; DJI's also new worksets and the Files tab's thumbnails."}
            ], buttons: [{label: "Cancel", value: false}, {label: "Save", value: true, style: "primary"}]});
        }).then(function (d) {
            if (d.button !== true) return null;
            setUserUnit(d.selects.unit);
            return saveDisplay(fetchFn, api, csrf, {palette: d.selects.palette || null});
        });
    }

    // The gear (#ta-prefs) of a page: the dialog, then the page drawn again in the preferences saved; the same when
    // the unit changes in another tab. A unit saved before becomes WebODM's first.
    function bindPreferences(doc, win) {
        var page = doc.querySelector(".ta-page");
        if (!page) return;
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var api = page.getAttribute("data-api");
        migrateUnit(win.fetch.bind(win), api, csrf);
        if (win.addEventListener) {
            win.addEventListener("storage", function (e) {
                if (e.key === "unit_system") win.location.reload();
            });
        }
        var button = doc.getElementById("ta-prefs");
        if (!button) return;
        button.addEventListener("click", function () {
            editPreferences(doc, win.fetch.bind(win), api, csrf).then(function (saved) {
                if (saved) win.location.reload();
            }, function (e) {
                dialog(doc, {title: "Preferences", text: e.message});
            });
        });
    }

    function readJson(res) {
        return res.json().then(function (data) { return {ok: res.ok, data: data}; },
                               function () { return {ok: res.ok, data: {}}; });
    }

    // The first message of a DRF error ({field: ["message"]} or {detail: "message"})
    function errorText(data, fallback) {
        if (data) {
            for (var k in data) {
                var v = data[k];
                if (Array.isArray(v) && v.length) return String(v[0]);
                if (typeof v === "string" && v) return v;
            }
        }
        return fallback;
    }

    // A normalization's or a mosaic's stage, as the jobs save it from dji-thermal-cli's "mosaic" events:
    // "step 2 of 5, aligning (round 2/3), 812/1840 pairs"; "" before the first
    var STAGES = {ambient: "reading ambient temperatures", frames: "reading frames", align: "aligning",
                  composite: "compositing", check: "checking alignment", write: "writing"};
    function stageText(s) {
        if (!s || !s.stage) return "";
        return "step " + s.step + " of " + s.steps + ", " + (STAGES[s.stage] || s.stage) +
            (s.round ? " (round " + s.round + "/" + s.rounds + ")" : "") + ", " + s.done + "/" + s.total + " " + s.unit;
    }

    // A conversion's mosaics being built (both from one layout) and their stage
    function mosaicLabel(c) {
        var stage = stageText(c.stage);
        return "Building the mosaics" + (stage ? ": " + stage : "") + "…";
    }

    var api = {
        escapeHtml: escapeHtml, formatBytes: formatBytes, formatDate: formatDate, formatNumber: formatNumber,
        statusLabel: statusLabel, severityLabel: severityLabel, kindLabel: kindLabel, uploadName: uploadName,
        isImage: isImage, batches: batches, uploadFiles: uploadFiles, readJson: readJson, errorText: errorText,
        unitOf: unitOf, userUnit: userUnit, unitSymbol: unitSymbol, convertTemp: convertTemp, convertDelta: convertDelta,
        formatTemp: formatTemp, formatDelta: formatDelta, stageText: stageText, mosaicLabel: mosaicLabel,
        batchTimeout: batchTimeout, failedText: failedText, median: median, count: count, deleteText: deleteText, dialog: dialog, ask: ask, askName: askName,
        preferences: preferences, setPreferences: setPreferences, editPreferences: editPreferences, bindPreferences: bindPreferences,
        setUserUnit: setUserUnit, savePalette: savePalette, migrateUnit: migrateUnit, paletteOptions: paletteOptions, sortRows: sortRows
    };
    root.ThermalAnalyzerCore = api;
    if (root.document && root.fetch) {
        if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", function () { bindPreferences(root.document, root); });
        else bindPreferences(root.document, root);
    }
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
