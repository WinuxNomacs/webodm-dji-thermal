// The 3D Thermal Inspector, on WebODM's 3D page of a task whose model holds temperatures (a DJI Thermal Task's, or a
// workset's). The model (model3d.js) and the point cloud (pointcloud3d.js: each point the temperature of the model's
// nearest surface) are *sources* of temperatures (see model3d.js for what a source answers), each coloured in the
// user's palette from them, as the 2D map colours the orthophoto (recolour.js); the panel's *tools* (TOOLS: Hover, ΔT,
// Pin) read the one shown where the pointer is (a ray cast at the model with mesh_index.js, or the point Potree picks). The panel is the 2D Inspector's where that makes sense in 3D (inspector.js's exported helpers draw
// its colour scale, Image section, Manual Corrections and isotherm): no regions, lines or overlays. Pins and ΔTs are
// kept in the browser for the task; the task's saved 2D pins are shown on the model, read only. A click in Hover (or a
// pin dropped, or a pin's name clicked) opens the photos that saw that spot beside the panel (frames3d.js).
// main.js adds it through PluginsAPI.ModelView.addActionButton, which hands it WebODM's Potree viewer; the task is the
// page's (its data-modelview element's data-task).
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var DEFAULT_PALETTE = "magma";      // WebODM's own for a thermal orthophoto, without the user's or the task's
    var HOVER_MS = 80;                  // the readout reads where the pointer rests, not every point it crosses
    var CLICK_PX = 5;                   // a press let go this close is a click, farther a drag of the view
    var MEASUREMENTS_PREFIX = "dji-thermal-inspector3d:measurements:";
    var FIELDS = "a, button, input, select, textarea, label";
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);
    var Scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale.js") : null);
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions.js") : null);
    var Inspector = root.ThermalInspector || (typeof require !== "undefined" ? require("./inspector.js") : null);
    var Model3D = root.ThermalModel3D || (typeof require !== "undefined" ? require("./model3d.js") : null);
    var MeshIndex = root.ThermalMeshIndex || (typeof require !== "undefined" ? require("./mesh_index.js") : null);
    var PointCloud3D = root.ThermalPointCloud3D || (typeof require !== "undefined" ? require("./pointcloud3d.js") : null);
    var Frames3D = root.ThermalFrames3D || (typeof require !== "undefined" ? require("./frames3d.js") : null);

    // The tools, in the panel's order: each its button (icon, name, what it does) and the hint shown while it's chosen;
    // click(inspector, spot) when the model is clicked with it (spot: {point, reading}). A tool is added here.
    var TOOLS = {
        hover: {icon: "fa fa-mouse-pointer", name: "Hover", title: "Hover: read the temperature under the pointer (or where tapped); click: the photos that saw it", hint: "",
                click: function (inspector, spot) { inspector.showReading(spot); inspector.showFrames(spot); }},
        delta: {icon: Regions.TOOLS.delta.icon, name: "ΔT", label: true, title: "ΔT: click two spots, the second's temperature less the first's",
                hint: "Click the first spot on the model, then the second: ΔT is the second's temperature less the first's. Esc cancels.",
                click: function (inspector, spot) { inspector.deltaSpot(spot); }},
        pin: {icon: Regions.TOOLS.pin.icon, name: "Pin", title: "Pin: click the model to keep a point and its temperature",
              hint: "Click the model to pin a point and its temperature.",
              click: function (inspector, spot) { inspector.addPin(spot); inspector.showFrames(spot); }}
    };
    var TOOL_ORDER = ["hover", "delta", "pin"];

    // What a reading that has no temperature says
    var REASONS = {outside: "Not on the model", nodata: "No temperature here", loading: "Loading the model's temperatures…",
                   building: "Preparing the model…", far: "No temperature: no model surface within 25 cm of this point",
                   unplaced: "Not on the model"};
    // A point of the cloud far from the model: which photos saw it can't be told (the model is what says which hid it)
    var FAR_FRAMES = "This point is more than 25 cm from the model's surface, so which photos saw it can't be told.";

    function escapeHtml(t) {
        return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, function (c) {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }
    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i] || {};
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
    }
    function shownTemp(celsius, unit) { return unit === "F" ? celsius * 1.8 + 32 : celsius; }
    function typedTemp(value, unit) { return Math.round((unit === "F" ? (value - 32) / 1.8 : value) * 1e6) / 1e6; }
    function roundShown(celsius, unit) { return Math.round(shownTemp(celsius, unit) * 10) / 10; }
    function formatSigned(celsius, unit) {
        if (typeof celsius !== "number" || !isFinite(celsius)) return "";
        return (celsius > 0 ? "+" : "") + (unit === "F" ? celsius * 1.8 : celsius).toFixed(2) + " °" + unit;
    }
    function formatLength(m, unit) {
        var imperial = unit === "F";
        return (imperial ? m * 3.2808399 : m).toFixed(m >= 100 ? 0 : 2) + (imperial ? " ft" : " m");
    }
    function distance(a, b) { return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2)); }

    // The page's task ({id, project, available_assets, epsg, ...}), from WebODM's 3D page, or null
    function taskOf(doc) {
        var el = doc && doc.querySelector("[data-modelview]");
        try {
            var task = el && JSON.parse(el.getAttribute("data-task"));
            return task && task.id && task.project != null ? task : null;
        } catch (e) {
            return null;
        }
    }

    // The palette the model opens in: the user's (the Analyzer's preference), else the task's (chosen in DJI Thermal
    // Task), else WebODM's for a thermal orthophoto; each only if it's one the plugin draws (display: the preferences,
    // with the palette lists, or null on a public page)
    function openingPalette(display, description) {
        var names = Inspector.paletteOptions(display).map(function (o) { return o[0]; });
        var known = function (name) { return !!name && (!display || names.indexOf(name) !== -1); };
        if (display && known(display.palette)) return display.palette;
        if (known(description && description.palette)) return description.palette;
        return DEFAULT_PALETTE;
    }

    // Auto's range (°C): the model's 2nd to 98th percentile, rounded outwards to a tenth in the user's unit (as the 2D
    // Inspector's of an orthophoto)
    function autoRange(description, unit) {
        var r = description && description.range;
        if (!r || !isFinite(r.low) || !isFinite(r.high)) return null;
        var lo = Math.floor(shownTemp(r.low, unit) * 10) / 10, hi = Math.ceil(shownTemp(r.high, unit) * 10) / 10;
        return [typedTemp(lo, unit), typedTemp(hi > lo ? hi : lo + 1, unit)];
    }

    // How values over a range read once shown (f: monotonic), as the straight line through its ends (scale.bandsOf's)
    function linearOver(f, range) {
        var a = f(range[0]), b = f(range[1]), scale = (b - a) / ((range[1] - range[0]) || 1);
        return {scale: scale, offset: a - scale * range[0]};
    }

    // An isotherm (inspector.js's: limits as shown, corrected) as a source paints it: {rgb, limits: [low, high]} in
    // the textures' own temperatures, or null when it's off
    function isothermPaint(iso, fix) {
        if (!Inspector.validIsotherm(iso)) return null;
        var raw = Inspector.rawIsotherm(iso, fix), hex = Inspector.ISOTHERM_COLORS[iso.color];
        return {rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)],
                limits: [iso.mode === "below" ? null : raw.low, iso.mode === "above" ? null : raw.high]};
    }

    // How the sources are coloured, as recolour.js takes it: look {colors, range: [low, high] (°C), adjust}, with
    // Stepped's bands (steps) and the isotherm painted over (isotherm: isothermPaint's); null until the palette's
    // colours have come
    function styleOf(look, steps, isotherm) {
        if (!look.colors || !look.range) return null;
        var adjust = look.adjust || {};
        return {colors: look.colors, range: look.range, shares: Recolour.drawnShares(look.range[0], look.range[1], adjust),
                steps: steps || null, sharpen: adjust.sharpen || 0, isotherm: null, seams: false, isothermPaint: isotherm || null};
    }

    // Pins and ΔTs, numbered P1, P2… and D1, D2… in the order made: the next label of a kind
    function nextLabel(list, kind) {
        var prefix = kind === "pin" ? "P" : "D", top = 0;
        list.forEach(function (m) {
            var n = m.kind === kind ? parseInt(String(m.label).slice(1), 10) : 0;
            if (n > top) top = n;
        });
        return prefix + (top + 1);
    }
    function loadMeasurements(storage, key) {
        try {
            var v = JSON.parse(storage.getItem(key) || "[]");
            return Array.isArray(v) ? v.filter(function (m) { return m && (m.kind === "pin" || m.kind === "delta"); }) : [];
        } catch (e) { return []; }
    }
    function saveMeasurements(storage, key, list) {
        try {
            if (list.length) storage.setItem(key, JSON.stringify(list));
            else storage.removeItem(key);
        } catch (e) { /* kept for this page only */ }
    }

    // A ΔT's value (°C), the second spot's temperature less the first's as shown (temp: a reading's, corrected), or null
    function deltaOf(m, temp) {
        var a = temp(m.first), b = temp(m.second);
        return typeof a === "number" && typeof b === "number" ? b - a : null;
    }

    // The measurements as CSV, a row each, in the user's unit, where they are in the model's coordinates (x, y, z: the
    // task's projection, epsg); temp: a reading's temperature shown (°C, corrected)
    function measurementsCsv(list, unit, temp, epsg) {
        var u = unit.toLowerCase();
        var cell = function (v) {
            var s = String(v === null || v === undefined ? "" : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        var t = function (c) { return typeof c === "number" ? shownTemp(c, unit).toFixed(3) : ""; };
        var xyz = function (p) { return p ? [p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3)] : ["", "", ""]; };
        var rows = [["label", "shape", "x", "y", "z", "temperature_" + u, "first_spot_" + u, "second_spot_" + u, "delta_t_" + u,
                     "distance_m", "epsg"]];
        list.forEach(function (m) {
            if (m.kind === "pin") rows.push([m.label, "pin"].concat(xyz(m.point), [t(temp(m)), "", "", "", "", epsg || ""]));
            else {
                var d = deltaOf(m, temp);
                rows.push([m.label, "delta"].concat(xyz(m.second.point), ["", t(temp(m.first)), t(temp(m.second)),
                           d === null ? "" : (unit === "F" ? d * 1.8 : d).toFixed(3), m.length.toFixed(3), epsg || ""]));
            }
        });
        return rows.map(function (r) { return r.map(cell).join(","); }).join("\n") + "\n";
    }

    // -- the panel's parts --------------------------------------------------------------------------------------------

    function readoutHtml(r, unit, temp) {
        if (!r) return '<span class="text-muted">Move the pointer over the model.</span>';
        if (!r.valid) return '<span class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperature here") + "</span>";
        return '<span class="dt-inspector-temp">' + escapeHtml(Inspector.formatTemp(temp(r), unit)) + "</span>";
    }

    function measurementsHtml(state, unit, temp) {
        var list = state.measurements;
        if (!list.length) return '<div class="text-muted dt-inspector-hint">Choose Pin and click the model to keep a point\'s temperature, or ΔT to compare two spots.</div>';
        var muted = function (text) { return '<span class="text-muted">' + escapeHtml(text) + "</span>"; };
        var shown = list.filter(function (m) { return m.id === state.shown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + list.map(function (m) {
            var value;
            if (m.kind === "pin") value = typeof temp(m) === "number" ? escapeHtml(Inspector.formatTemp(temp(m), unit)) : muted(REASONS[m.reason] || "none");
            else {
                var d = deltaOf(m, temp);
                value = d === null ? muted("none") : escapeHtml(formatSigned(d, unit)) + " " + muted("ΔT");
            }
            return '<tr data-measurement="' + escapeHtml(m.id) + '"' + (m === shown ? ' class="active"' : "") + '><td><i class="' +
                TOOLS[m.kind].icon + '"></i> <a href="javascript:void(0)" data-act="goto" title="Look at it">' + escapeHtml(m.label) +
                "</a></td><td>" + value + '</td><td class="text-right"><a href="javascript:void(0)" data-act="remove" title="Remove">' +
                '<i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" +
            (shown && shown.kind === "delta" ? deltaHtml(shown, unit, temp) : "") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle-measurements">' +
            (state.measurementsVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv-measurements"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear-measurements"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    // A ΔT's figures: each spot's temperature, ΔT and the distance between the spots, in 3D
    function deltaHtml(m, unit, temp) {
        var spot = function (r) { return typeof temp(r) === "number" ? Inspector.formatTemp(temp(r), unit) : REASONS[r.reason] || "No temperature here"; };
        var d = deltaOf(m, temp);
        var rows = [["First spot", spot(m.first)], ["Second spot", spot(m.second)], ["ΔT", d === null ? "" : formatSigned(d, unit)],
                    ["Distance", formatLength(m.length, unit)]];
        return '<div class="dt-inspector-shown"><strong>' + escapeHtml(m.label) + '</strong> <span class="text-muted">ΔT</span>' +
            '<table class="table table-condensed dt-inspector-stats dt-inspector-delta-figures"><tbody>' + rows.filter(function (r) { return r[1]; }).map(function (r) {
                return "<tr><td>" + escapeHtml(r[0]) + '</td><td class="text-right">' + escapeHtml(r[1]) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
    }

    // The task's saved 2D pins, read only: their names, values as saved, and whether they're on the model
    function savedHtml(state, unit) {
        return '<table class="table table-condensed dt-inspector-pins"><tbody>' + state.saved.map(function (s) {
            var v = s.values || {}, value = typeof v.temperature === "number" ? escapeHtml(Inspector.formatTemp(v.temperature, unit)) :
                '<span class="text-muted">none</span>';
            return '<tr data-saved="' + escapeHtml(s.id) + '"><td><i class="' + TOOLS.pin.icon + '"></i> ' +
                (s.point ? '<a href="javascript:void(0)" data-act="goto-saved" title="Look at it">' + escapeHtml(s.name) + "</a>" :
                    escapeHtml(s.name) + ' <span class="text-muted">(' + REASONS.unplaced.toLowerCase() + ")</span>") +
                "</td><td>" + value + "</td></tr>";
        }).join("") + '</tbody></table><div class="text-muted dt-inspector-hint">Saved on the 2D map, with their values as saved.</div>' +
            '<div class="dt-inspector-actions"><button type="button" class="btn btn-default btn-xs" data-act="toggle-saved">' +
            (state.savedVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button></div>";
    }

    // The panel: s, the colour scale's state (inspector.js scaleHtml's); temp, a reading's temperature shown
    function panelHtml(state, s, temp) {
        var unit = Inspector.userUnit(), options = Inspector.paletteOptions(state.display);
        if (state.palette && !options.some(function (o) { return o[0] === state.palette; })) options = options.concat([[state.palette, state.palette]]);
        var tool = TOOLS[state.mode];
        return '<div class="dt-inspector-top"><div class="dt-inspector-head"><strong><i class="fa fa-thermometer-half"></i> Thermal Inspector</strong>' +
            '<a href="javascript:void(0)" class="dt-inspector-close" data-act="close" title="Close"><i class="fa fa-times"></i></a></div>' +
            '<div class="btn-group btn-group-xs dt-inspector-modes">' + TOOL_ORDER.map(function (k) {
                var t = TOOLS[k];
                return '<button type="button" class="btn btn-' + (state.mode === k ? "primary" : "default") + '" data-mode="' + k + '" title="' +
                    escapeHtml(t.title) + '" aria-label="' + escapeHtml(t.name) + '"><i class="' + t.icon + '"></i>' + (t.label ? " " + escapeHtml(t.name) : "") + "</button>";
            }).join("") + "</div>" +
            (tool.hint ? '<div class="text-muted dt-inspector-hint">' + escapeHtml(tool.hint) + "</div>" : "") +
            (state.pending ? '<div class="text-muted dt-inspector-hint">First spot: ' + escapeHtml(readoutText(state.pending.reading, unit, temp)) + "</div>" : "") +
            (state.notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.notice) + "</div>" : "") +
            '<div class="dt-inspector-pointer"><strong>Pointer Info</strong>' +
            '<label class="dt-inspector-check"><input type="checkbox" data-act="pointer-temperature"' + (state.pointerTemperature ? " checked" : "") +
            "> Temperature On Pointer</label></div>" +
            '<div class="dt-inspector-readout">' + readoutHtml(state.readout, unit, temp) + "</div>" +
            (options.length ? '<label class="dt-inspector-label">Palette <select class="form-control input-sm" data-act="palette">' +
                options.map(function (o) {
                    return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === state.palette ? " selected" : "") + ">" + escapeHtml(o[1]) + "</option>";
                }).join("") + "</select></label>" : "") + Inspector.scaleHtml(s, state, unit).replace(">This layer: ", ">This model: ") + "</div>" +
            Inspector.correctionHtml(state.correction, unit, [{name: "This model", baseline: state.baseline}], state.correctionNotice,
                                     state.baseline) +
            Inspector.imageHtml(s) +
            '<div class="dt-inspector-section"><strong>Isotherm</strong>' + Inspector.isothermHtml(state.isotherm, unit) +
            (state.isothermNotice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.isothermNotice) + "</div>" : "") + "</div>" +
            '<div class="dt-inspector-section"><strong>Measurements</strong>' + measurementsHtml(state, unit, temp) + "</div>" +
            (state.saved.length ? '<div class="dt-inspector-section"><strong>Saved measurements</strong>' + savedHtml(state, unit) + "</div>" : "");
    }
    function readoutText(r, unit, temp) {
        return r && r.valid ? Inspector.formatTemp(temp(r), unit) : REASONS[r && r.reason] || "No temperature here";
    }

    // The 3D Inspector on a viewer. deps (for tests): {fetchFn, document, storage, THREE, path, setInterval,
    // clearInterval, setTimeout, requestAnimationFrame, save (the palette preference), download, Worker, Potree,
    // scriptUrl (a plugin script's URL: main.js's)}. A Promise of the inspector, or null when the page's model doesn't
    // hold temperatures
    function create(viewer, deps) {
        deps = deps || {};
        var doc = deps.document || root.document, fetchFn = deps.fetchFn || root.fetch.bind(root);
        var storage = deps.storage || root.localStorage, THREE = deps.THREE || root.THREE;
        var later = deps.setTimeout || root.setTimeout.bind(root);
        var frame = deps.requestAnimationFrame || (root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (fn) { return later(fn, 16); });
        var task = taskOf(doc);
        if (!task) return Promise.resolve(null);
        var publicPage = /^\/public\//.test((deps.path !== undefined ? deps.path : root.location && root.location.pathname) || "");
        var model = Model3D.source(viewer, {fetchFn: fetchFn, THREE: THREE, document: doc, task: task,
                                            setInterval: deps.setInterval, clearInterval: deps.clearInterval});
        var scriptUrl = deps.scriptUrl || (root.DjiThermalScripts && root.DjiThermalScripts.url) || function (name) { return "/plugins/dji-thermal/" + name; };
        var cloud = PointCloud3D.source(viewer, model, {Worker: deps.Worker, Potree: deps.Potree, script: scriptUrl("pointcloud3d_worker.js"),
                                                        indexScript: scriptUrl("mesh_index.js")});
        var sources = [model, cloud];
        var key = MEASUREMENTS_PREFIX + task.id, ikey = Inspector.isothermKey([task.id]);
        var state = {open: false, mode: "hover", readout: null, notice: "", pending: null, display: null, palette: "",
                     pointerTemperature: true, legendVisible: true, correction: {on: false}, correctionNotice: "", baseline: null,
                     isotherm: Inspector.loadIsotherm(storage, ikey), isothermNotice: "", rangeError: "",
                     measurements: loadMeasurements(storage, key), measurementsVisible: true, shown: null,
                     saved: [], savedVisible: true, camera: null};
        var look = {colors: null, range: null, adjust: Scale.defaultAdjust()};
        var description = null, index = null, building = null, savedRaw = [];
        var area, panel, legend, cursor, markers, svg, panelMove, frames, framesMove, hoverTimer = null, detached = false;
        var press = null;

        function readJson(r) { return r.json().then(function (data) { return {ok: r.ok, data: data}; }); }
        function csrfToken() {
            var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
            return m ? decodeURIComponent(m[1]) : "";
        }

        // -- temperatures as shown: corrected with Manual Corrections, when the model records what it was measured with

        function fix() {
            var c = state.correction;
            if (!c.on || !Inspector.validCorrection(c) || !state.baseline) return null;
            return {wanted: {emissivity: c.emissivity, reflected: c.reflected}, baseline: state.baseline};
        }
        function temp(r) {
            return r && typeof r.temperature === "number" ? Inspector.corrected(r.temperature, fix()) : null;
        }

        // -- the look: palette, range, Image ------------------------------------------------------------------------

        function bandsOf() {
            if (!look.range) return null;
            var f = fix(), unit = Inspector.userUnit();
            return Scale.bandsOf(look.adjust, look.range, linearOver(function (v) { return shownTemp(Inspector.corrected(v, f), unit); }, look.range));
        }
        function scaleState() {
            if (!look.range) return null;
            return {name: "", colors: look.colors, range: look.range, auto: autoRange(description, Inspector.userUnit()),
                    extent: description ? [description.range.min, description.range.max] : null, adjust: look.adjust,
                    shares: Recolour.drawnShares(look.range[0], look.range[1], look.adjust), steps: Scale.stepsOf(bandsOf(), look.range),
                    bands: bandsOf(), fix: fix()};
        }
        function restyle() {
            var style = styleOf(look, Scale.stepsOf(bandsOf(), look.range), isothermPaint(state.isotherm, fix()));
            if (style) sources.forEach(function (s) { s.restyle(style); });
            if (frames) frames.restyle();
            renderLegend();
        }
        function setLook(range, adjust) {
            look.range = range;
            look.adjust = adjust;
            state.rangeError = "";
            restyle();
            render();
        }

        function usePalette(name) {
            state.palette = name;
            return fetchFn(API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/palette?name=" +
                           encodeURIComponent(name), {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (!r.ok || state.palette !== name) return;
                look.colors = r.data.color_map;
                restyle();
                render();
            });
        }
        function choosePalette(name) {
            usePalette(name);
            if (publicPage) return;
            (deps.save || function (body) {
                return fetchFn(API + "display", {method: "PUT", credentials: "same-origin",
                    headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken()}, body: JSON.stringify(body)});
            })({palette: name});
        }

        // The user's preferences (palette, legend, Temperature On Pointer), never asked for on a public page
        function loadDisplay() {
            if (publicPage) return Promise.resolve(null);
            return fetchFn(API + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
                return r.ok ? r.data : null;
            }, function () { return null; });
        }

        // -- reading the model --------------------------------------------------------------------------------------

        // The model's meshes indexed (WebODM's model, or the plugin's own copy while the point cloud is shown: a second
        // or two for a million triangles), then the point cloud's points looked up on it: a Promise of the index, or
        // of null when the model can't be had
        function indexed() {
            if (!building) {
                building = model.meshes().then(function (meshes) {
                    if (!meshes.length || detached) return null;
                    return new Promise(function (resolve) {
                        // After the panel says so: the build holds the page
                        later(function () {
                            index = MeshIndex.build(meshes);
                            resolve(index);
                        }, 30);
                    });
                });
                building.then(function (built) {
                    if (!built) return;
                    cloud.start(built);
                    placeSaved();
                    if (state.open) render();
                });
            }
            return building;
        }

        // What's under the pointer (clientX, clientY): {point, reading}; the reading says why there's no temperature
        function spotAt(x, y) {
            if (!index) {
                indexed();
                return {point: null, reading: {valid: false, reason: "building"}};
            }
            var canvas = viewer.renderer.domElement, rect = canvas.getBoundingClientRect();
            if (!model.shown()) {
                if (!cloud.shown()) return {point: null, reading: {valid: false, reason: "outside"}};
                return cloud.spotAt(new THREE.Vector2(x - rect.left, y - rect.top), viewer.scene.getActiveCamera());
            }
            var ndc = new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
            var raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(ndc, viewer.scene.getActiveCamera());
            var hit = MeshIndex.raycast(index, raycaster.ray.origin, raycaster.ray.direction, function (m) { return m.visible !== false; });
            if (!hit) return {point: null, reading: {valid: false, reason: "outside"}};
            return {point: hit.point, reading: model.reading(hit), hit: hit};
        }

        // The surface's normal at a spot: its hit's triangle, or the model's surface nearest to the point (a point of the
        // cloud, a pin), or null
        function normalAt(spot) {
            if (!index || !spot || !spot.point) return null;
            return Frames3D.surfaceNormal(index, spot.hit || MeshIndex.closest(index, spot.point, PointCloud3D.LIMIT));
        }

        function onPointerMove(e) {
            if (!state.open) return;
            var x = e.clientX, y = e.clientY;
            if (hoverTimer) return;
            hoverTimer = later(function () {
                hoverTimer = null;
                var spot = spotAt(x, y);
                state.readout = spot.reading;
                renderReadout();
                showCursor(x, y, spot.reading);
            }, HOVER_MS);
        }
        function onPointerLeave() {
            if (cursor) cursor.style.display = "none";
        }
        function onPointerDown(e) {
            press = e.button ? null : {x: e.clientX, y: e.clientY};
        }
        function onPointerUp(e) {
            var p = press;
            press = null;
            if (!p || !state.open || e.button || Math.abs(e.clientX - p.x) > CLICK_PX || Math.abs(e.clientY - p.y) > CLICK_PX) return;
            var tool = TOOLS[state.mode];
            if (!tool.click) return;
            var spot = spotAt(e.clientX, e.clientY);
            if (state.mode === "hover") return tool.click(api, spot);       // a tap reads, where nothing hovers
            if (!spot.point) {
                state.notice = REASONS[spot.reading.reason] || "Not on the model";
                return render();
            }
            state.notice = "";
            tool.click(api, spot);
        }
        function onKey(e) {
            if (e.key === "Escape" && state.pending) {
                state.pending = null;
                drawMarkers();
                render();
            }
        }

        // The temperature beside the pointer, with Temperature On Pointer
        function showCursor(x, y, reading) {
            if (!cursor) return;
            if (!state.pointerTemperature || !reading || !reading.valid) { cursor.style.display = "none"; return; }
            var r = area.getBoundingClientRect();
            cursor.textContent = Inspector.formatTemp(temp(reading), Inspector.userUnit());
            cursor.style.left = (x - r.left + 14) + "px";
            cursor.style.top = (y - r.top + 14) + "px";
            cursor.style.display = "";
        }

        // -- measurements --------------------------------------------------------------------------------------------

        function newId() { return String(Date.now()) + Math.floor(Math.random() * 1000); }
        function kept() { saveMeasurements(storage, key, state.measurements); }

        var api = {
            showReading: function (spot) {
                state.readout = spot.reading;
                renderReadout();
            },
            // The photos that saw a spot of the model, beside the panel; none off the model. A point of the cloud is read
            // at the model's surface nearest to it (where its temperature comes from: it may lie a little inside)
            showFrames: function (spot) {
                if (!frames || !spot || !spot.point) return;
                if (spot.reading && spot.reading.reason === "far") return frames.note(FAR_FRAMES);
                var at = spot.hit && spot.hit.point ? spot.hit.point : spot.point;
                frames.show(at, normalAt(spot), spot.reading && spot.reading.valid ? spot.reading.temperature : null);
            },
            addPin: function (spot) {
                var r = spot.reading;
                var pin = {id: newId(), kind: "pin", label: nextLabel(state.measurements, "pin"), point: spot.point,
                           temperature: r.valid ? r.temperature : null, reason: r.valid ? null : r.reason};
                state.measurements.push(pin);
                kept();
                drawMarkers();
                render();
                return pin;
            },
            deltaSpot: function (spot) {
                var read = {point: spot.point, temperature: spot.reading.valid ? spot.reading.temperature : null,
                            reason: spot.reading.valid ? null : spot.reading.reason};
                if (!state.pending) {
                    state.pending = {point: spot.point, reading: spot.reading, read: read};
                } else {
                    var m = {id: newId(), kind: "delta", label: nextLabel(state.measurements, "delta"), first: state.pending.read, second: read,
                             length: distance(state.pending.point, spot.point)};
                    state.pending = null;
                    state.measurements.push(m);
                    state.shown = m.id;
                    kept();
                }
                drawMarkers();
                render();
            }
        };

        function downloadCsv(name, text) {
            if (deps.download) return deps.download(name, text);
            var a = doc.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], {type: "text/csv"}));
            a.download = name;
            doc.body.appendChild(a);
            a.click();
            doc.body.removeChild(a);
            later(function () { URL.revokeObjectURL(a.href); }, 1000);
        }

        // The view turned to look at a point
        function lookAt(p) {
            if (p && viewer.scene && viewer.scene.view && viewer.scene.view.lookAt) viewer.scene.view.lookAt(new THREE.Vector3(p.x, p.y, p.z));
        }

        // The saved 2D pins placed on the model: each at the model's top surface above it (a ray down from over the model)
        function placeSaved() {
            if (!index) return;
            var top = index.tris.origin[2] + index.bounds[5] + 10;
            state.saved = savedRaw.map(function (s) {
                var hit = MeshIndex.raycast(index, {x: s.x, y: s.y, z: top}, {x: 0, y: 0, z: -1});
                return assign({}, s, {point: hit ? hit.point : null});
            });
            drawMarkers();
            render();
        }

        // -- markers: pins, ΔTs and saved pins, drawn over the 3D view where their points are on screen -------------

        function screenOf(p) {
            var camera = viewer.scene.getActiveCamera(), v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
            if (v.z > 1 || v.z < -1) return null;
            var w = area.clientWidth, h = area.clientHeight;
            return {x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h};
        }
        function marker(cls, label, title) {
            return '<div class="dt-inspector3d-marker ' + cls + '" title="' + escapeHtml(title || label) + '"><span>' + escapeHtml(label) + "</span></div>";
        }
        // The markers' elements made again (what's measured changed); placed every frame (placeMarkers)
        function drawMarkers() {
            if (!markers) return;
            var unit = Inspector.userUnit(), html = "", lines = "";
            if (state.measurementsVisible) {
                state.measurements.forEach(function (m) {
                    if (m.kind === "pin") html += marker("dt-pin", m.label, m.label + (typeof temp(m) === "number" ? ": " + Inspector.formatTemp(temp(m), unit) : ""));
                    else {
                        var d = deltaOf(m, temp);
                        html += marker("dt-spot", m.label + "a") + marker("dt-spot dt-spot-end", m.label + (d === null ? "" : " " + formatSigned(d, unit)));
                        lines += '<line class="dt-inspector3d-line"></line>';
                    }
                });
            }
            if (state.pending) html += marker("dt-spot", "…");
            if (state.savedVisible) state.saved.forEach(function (s) { if (s.point) html += marker("dt-saved", s.name); });
            if (state.camera) {
                html += marker("dt-camera", "Photo", "Where the photo shown was taken from");
                lines += '<line class="dt-inspector3d-line dt-inspector3d-camera-line"></line>';
            }
            markers.innerHTML = html;
            svg.innerHTML = lines;
            placeMarkers();
        }
        function points() {
            var out = [];
            if (state.measurementsVisible) {
                state.measurements.forEach(function (m) {
                    if (m.kind === "pin") out.push(m.point);
                    else out.push(m.first.point, m.second.point);
                });
            }
            if (state.pending) out.push(state.pending.point);
            if (state.savedVisible) state.saved.forEach(function (s) { if (s.point) out.push(s.point); });
            if (state.camera) out.push(cameraPoint());
            return out;
        }
        function cameraPoint() {
            var c = state.camera.camera;
            return {x: c[0], y: c[1], z: c[2]};
        }
        function placeMarkers() {
            if (!markers) return;
            var els = markers.children, at = points(), lines = svg.children, li = 0;
            for (var i = 0; i < els.length && i < at.length; i++) {
                var s = screenOf(at[i]);
                els[i].style.display = s ? "" : "none";
                if (s) els[i].style.transform = "translate(" + Math.round(s.x) + "px, " + Math.round(s.y) + "px)";
            }
            function join(line, a, b) {
                if (!line) return;
                line.setAttribute("visibility", a && b ? "visible" : "hidden");
                if (a && b) {
                    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
                    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
                }
            }
            if (state.measurementsVisible) {
                state.measurements.forEach(function (m) {
                    if (m.kind !== "pin") join(lines[li++], screenOf(m.first.point), screenOf(m.second.point));
                });
            }
            if (state.camera) join(lines[li++], screenOf(state.camera.point), screenOf(cameraPoint()));
        }
        function everyFrame() {
            if (detached) return;
            cloud.tick();
            if (markers && markers.children.length) placeMarkers();
            if (legend) legend.hidden = !legendShown();
            frame(everyFrame);
        }

        // -- the legend ------------------------------------------------------------------------------------------------

        function legendShown() { return !!(state.legendVisible && look.colors && look.range && (model.shown() || cloud.loaded())); }
        function renderLegend() {
            if (!legend) return;
            var unit = Inspector.userUnit(), s = scaleState();
            var label = ((state.display && state.display.palettes) || []).indexOf(state.palette) !== -1 ? "DJI " + state.palette : state.palette;
            legend.innerHTML = s ? Inspector.legendHtml(look.colors, look.range, label, unit, state.isotherm, s.fix, s.extent, s.shares, s.steps) : "";
            legend.hidden = !legendShown();
        }

        // -- the panel --------------------------------------------------------------------------------------------------

        function render() {
            if (!panel) return;
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            var active = doc.activeElement, act = active && panel.contains(active) && /^(number|text)$/.test(active.type || "") &&
                active.getAttribute("data-act");
            panel.innerHTML = panelHtml(state, scaleState(), temp);
            var again = act && panel.querySelector('[data-act="' + act + '"]');
            if (again) again.focus();
            if (panelMove) panelMove.keep();
        }
        function renderReadout() {
            var el = state.open && panel.querySelector(".dt-inspector-readout");
            if (el) el.innerHTML = readoutHtml(state.readout, Inspector.userUnit(), temp);
        }

        function setMode(mode) {
            if (!TOOLS[mode]) return;
            state.mode = mode;
            state.pending = null;
            state.notice = "";
            viewer.renderer.domElement.classList.toggle("dt-inspector3d-picking", mode !== "hover");
            drawMarkers();
            render();
        }

        function open() {
            state.open = true;
            indexed();
            render();
        }
        function close() {
            state.open = false;
            state.readout = null;
            setMode("hover");
            if (cursor) cursor.style.display = "none";
            if (panelMove) panelMove.reset();
            if (frames) frames.close();
            render();
        }

        function typedRange() {
            var unit = Inspector.userUnit(), f = fix();
            var lo = parseFloat(panel.querySelector('[data-act="range-min"]').value), hi = parseFloat(panel.querySelector('[data-act="range-max"]').value);
            if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
            if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
            var raw = function (v) { return Math.round(Inspector.uncorrected(typedTemp(v, unit), f) * 1e4) / 1e4; };
            return {range: [raw(lo), raw(hi)]};
        }

        function slide(input) {
            var name = input.getAttribute("data-act").slice("image-".length), next = assign({}, look.adjust), range = look.range;
            if (name === "brightness" || name === "contrast") {
                var auto = autoRange(description, Inspector.userUnit());
                if (!auto) return;
                var value = function (k) { return parseFloat(panel.querySelector('[data-act="image-' + k + '"]').value) || 0; };
                range = Scale.slidRange(auto, value("brightness"), value("contrast"));
            } else if (name === "gamma") next.gamma = Scale.sliderGamma(input.value);
            else next.sharpen = Math.round((parseFloat(input.value) || 0) * 100) / 100;
            look.range = range;
            look.adjust = next;
            restyle();
            showScaleValues();
        }
        // The scale and the fields beside the sliders as the model is drawn, without drawing the panel again (the
        // slider moved keeps its place)
        function showScaleValues() {
            var s = scaleState(), unit = Inspector.userUnit(), box = panel.querySelector(".dt-inspector-scale");
            if (!s || !box) return;
            var field = function (act) { return panel.querySelector('[data-act="' + act + '"]'); };
            box.querySelector(".dt-inspector-scale-bar").innerHTML = Inspector.legendHtml(s.colors, s.range, "", unit, state.isotherm, s.fix, null, s.shares, s.steps)
                .replace(/^<div class="dt-legend-title">.*?<\/div>/, "");
            var shown = function (c) { return roundShown(Inspector.corrected(c, s.fix), unit); };
            if (field("range-min")) field("range-min").value = shown(s.range[0]);
            if (field("range-max")) field("range-max").value = shown(s.range[1]);
            if (field("image-gamma-value")) field("image-gamma-value").textContent = s.adjust.gamma.toFixed(2);
            if (field("image-sharpen-value")) field("image-sharpen-value").textContent = Number(s.adjust.sharpen).toFixed(1);
        }

        function isothermInput(what, value) {
            var iso = assign({}, state.isotherm), unit = Inspector.userUnit();
            if (what === "color") iso.color = value;
            else if (what === "mode") {
                if (value === "off") return isothermChanged({mode: "off", color: iso.color});
                var f = fix(), range = look.range && look.range.map(function (c) { return Inspector.corrected(c, f); });
                var start = Inspector.defaultIsotherm(value, range, iso.color, unit);
                iso = assign(start, {low: typeof iso.low === "number" && value !== "below" ? iso.low : start.low,
                                     high: typeof iso.high === "number" && value !== "above" ? iso.high : start.high});
                if (value === "above") delete iso.high;
                if (value === "below") delete iso.low;
                if (value === "between" && !(iso.low <= iso.high)) iso.high = Math.max(iso.low, range ? typedTemp(roundShown(range[1], unit), unit) : iso.low);
                iso.mode = value;
            } else {
                var typed = parseFloat(value);
                if (!isFinite(typed)) { state.isothermNotice = "Enter a temperature"; return render(); }
                iso[what] = typedTemp(typed, unit);
            }
            if (!Inspector.validIsotherm(iso)) { state.isothermNotice = "The lower limit must not be above the upper one"; return render(); }
            isothermChanged(iso);
        }
        function isothermChanged(iso) {
            state.isotherm = iso;
            state.isothermNotice = "";
            try {
                if (Inspector.validIsotherm(iso)) storage.setItem(ikey, JSON.stringify(iso));
                else storage.removeItem(ikey);
            } catch (e) { /* kept for this page only */ }
            restyle();
            render();
        }

        function correctionInput(what, value) {
            var c = assign({}, state.correction), unit = Inspector.userUnit(), before = fix();
            state.correctionNotice = "";
            if (what === "on") c = value ? assign({on: true}, state.baseline || {}) : {on: false};
            else {
                var typed = parseFloat(value);
                if (!isFinite(typed)) { state.correctionNotice = "Enter a number"; return render(); }
                c[what] = what === "reflected" ? typedTemp(typed, unit) : typed;
                if (!Inspector.validCorrection(c)) {
                    state.correctionNotice = what === "emissivity" ? "The emissivity is between 0.1 and 1" :
                        "The reflected temperature is between " + Inspector.formatTemp(-100, unit) + " and " + Inspector.formatTemp(1000, unit);
                    return render();
                }
            }
            state.correction = c;
            // The scale keeps the temperatures it shows, so the colours change with the correction (as in 2D)
            var range = Inspector.keptRange(look.range, before, fix());
            if (range) look.range = range;
            restyle();
            if (frames) frames.refresh();
            drawMarkers();
            render();
        }

        function onPanelClick(e) {
            var mode = e.target.closest("[data-mode]");
            if (mode) return setMode(mode.getAttribute("data-mode"));
            var act = e.target.closest("[data-act]"), what = act && act.getAttribute("data-act");
            if (what === "close") return close();
            if (what === "range-narrow" || what === "range-wider") return setLook(Scale.spanRange(look.range, what === "range-wider" ? 1 : -1), look.adjust);
            if (what === "range-raise" || what === "range-lower") {
                return setLook(Scale.shiftRange(look.range, what === "range-raise" ? 1 : -1, description ? [description.range.min, description.range.max] : null), look.adjust);
            }
            if (what === "range-auto") return setLook(autoRange(description, Inspector.userUnit()) || look.range, look.adjust);
            if (what === "image-reset") return setLook(autoRange(description, Inspector.userUnit()) || look.range, Scale.defaultAdjust());
            if (what === "toggle-measurements") { state.measurementsVisible = !state.measurementsVisible; drawMarkers(); return render(); }
            if (what === "toggle-saved") { state.savedVisible = !state.savedVisible; drawMarkers(); return render(); }
            if (what === "clear-measurements") { state.measurements = []; state.shown = null; kept(); drawMarkers(); return render(); }
            if (what === "csv-measurements") return downloadCsv("thermal-3d-measurements.csv", measurementsCsv(state.measurements, Inspector.userUnit(), temp, task.epsg));
            var row = e.target.closest("[data-measurement]");
            var m = row && state.measurements.filter(function (x) { return x.id === row.getAttribute("data-measurement"); })[0];
            if (m) {
                if (what === "remove") {
                    state.measurements = state.measurements.filter(function (x) { return x !== m; });
                    kept();
                    drawMarkers();
                    return render();
                }
                state.shown = m.id;
                if (what === "goto") {
                    lookAt(m.kind === "pin" ? m.point : m.second.point);
                    if (m.kind === "pin") api.showFrames({point: m.point, reading: {valid: typeof m.temperature === "number", temperature: m.temperature}});
                }
                return render();
            }
            var srow = e.target.closest("[data-saved]");
            var s = srow && state.saved.filter(function (x) { return String(x.id) === srow.getAttribute("data-saved"); })[0];
            if (s && what === "goto-saved") {
                lookAt(s.point);
                api.showFrames({point: s.point, reading: model.reading(MeshIndex.closest(index, s.point, PointCloud3D.LIMIT) || {})});
            }
        }
        function onPanelInput(e) {
            var what = e.target.getAttribute("data-act") || "";
            if (/^image-(brightness|contrast|gamma|sharpen)$/.test(what)) slide(e.target);
        }
        function onPanelChange(e) {
            var what = e.target.getAttribute("data-act") || "";
            if (what === "palette") return choosePalette(e.target.value);
            if (what === "pointer-temperature") {
                state.pointerTemperature = e.target.checked;
                if (!state.pointerTemperature && cursor) cursor.style.display = "none";
                if (!publicPage) (deps.save || function (body) {
                    return fetchFn(API + "display", {method: "PUT", credentials: "same-origin",
                        headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken()}, body: JSON.stringify(body)});
                })({pointer_temperature: state.pointerTemperature});
                return;
            }
            if (what.indexOf("isotherm-") === 0) return isothermInput(what.slice("isotherm-".length), e.target.value);
            if (what.indexOf("correction-") === 0) return correctionInput(what.slice("correction-".length), what === "correction-on" ? e.target.checked : e.target.value);
            if (what === "range-min" || what === "range-max") {
                var r = typedRange();
                if (r.error) { state.rangeError = r.error; return render(); }
                return setLook(r.range, look.adjust);
            }
            if (what === "image-tone" || what === "image-step") {
                var change = what === "image-tone" ? {tone: e.target.value === "stepped" ? "stepped" : "linear"} : {step: Scale.typedStep(e.target.value)};
                return setLook(look.range, assign({}, look.adjust, change));
            }
            if (/^image-(brightness|contrast|gamma|sharpen)$/.test(what)) { slide(e.target); render(); }
        }

        function onUnits() { drawMarkers(); renderLegend(); render(); if (frames) frames.refresh(); }

        // The panel, legend, pointer label and markers, over the 3D view
        function mount() {
            area = viewer.renderArea || viewer.renderer.domElement.parentNode;
            var overlay = doc.createElement("div");
            overlay.className = "dt-inspector3d";
            overlay.innerHTML = '<svg class="dt-inspector3d-lines"></svg><div class="dt-inspector3d-markers"></div>' +
                '<div class="dt-inspector-cursor" style="display: none"></div><div class="dt-legend dt-inspector3d-legend" hidden></div>' +
                '<div class="dt-inspector-panel dt-inspector3d-panel" hidden></div>' +
                '<div class="dt-inspector-frames dt-inspector3d-frames" hidden></div>';
            area.appendChild(overlay);
            svg = overlay.querySelector(".dt-inspector3d-lines");
            markers = overlay.querySelector(".dt-inspector3d-markers");
            cursor = overlay.querySelector(".dt-inspector-cursor");
            legend = overlay.querySelector(".dt-legend");
            panel = overlay.querySelector(".dt-inspector-panel");
            panel.addEventListener("click", onPanelClick);
            panel.addEventListener("change", onPanelChange);
            panel.addEventListener("input", onPanelInput);
            frames = Frames3D.create(overlay.querySelector(".dt-inspector3d-frames"), {
                fetchFn: fetchFn, task: task, raycast: MeshIndex.raycast, index: function () { return index; },
                style: function () { return styleOf(look, Scale.stepsOf(bandsOf(), look.range), isothermPaint(state.isotherm, fix())); },
                corrected: function (c) { return Inspector.corrected(c, fix()); },
                format: function (c) { return Inspector.formatTemp(c, Inspector.userUnit()); },
                changed: function (shown) {
                    state.camera = shown;
                    if (!shown && framesMove) framesMove.reset();
                    drawMarkers();
                }
            });
            if (Inspector.movable) {
                panelMove = Inspector.movable(panel, area, function (t) { return !!t.closest(".dt-inspector-head") && !t.closest(FIELDS); }, null, doc);
                Inspector.movable(legend, area, function () { return true; }, null, doc);
                framesMove = Inspector.movable(frames.element, area, function (t) { return !!t.closest(".ta-pip-head") && !t.closest(FIELDS); }, null, doc);
            }
            var canvas = viewer.renderer.domElement;
            canvas.addEventListener("pointermove", onPointerMove);
            canvas.addEventListener("pointerleave", onPointerLeave);
            canvas.addEventListener("pointerdown", onPointerDown);
            canvas.addEventListener("pointerup", onPointerUp);
            doc.addEventListener("keydown", onKey);
            doc.addEventListener("onUnitSystemChanged", onUnits);
            doc.addEventListener("djiThermalUnitChanged", onUnits);
            return overlay;
        }

        return model.ready.then(function (found) {
            if (!found) return null;
            description = found;
            state.baseline = found.baseline || null;
            look.range = autoRange(found, Inspector.userUnit()) || [found.range.low, found.range.high];
            var overlay = mount();
            frame(everyFrame);
            fetchFn(API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/model/saved", {credentials: "same-origin"})
                .then(readJson).then(function (r) {
                    savedRaw = r.ok ? r.data.pins || [] : [];
                    placeSaved();
                }, function () {});
            indexed();          // the point cloud coloured as soon as it can be
            drawMarkers();
            return loadDisplay().then(function (d) {
                state.display = d;
                if (d) {
                    state.legendVisible = d.legend !== false;
                    state.pointerTemperature = d.pointer_temperature !== false;
                }
                return usePalette(openingPalette(d, found));
            }).then(function () {
                return assign(api, {
                    task: task, sources: sources, look: look, state: state, description: found,
                    toggle: function () { return state.open ? close() : open(); },
                    open: open, close: close, setMode: setMode, spotAt: spotAt, indexed: indexed,
                    detach: function () {
                        detached = true;
                        sources.forEach(function (s) { s.detach(); });
                        var canvas = viewer.renderer.domElement;
                        canvas.removeEventListener("pointermove", onPointerMove);
                        canvas.removeEventListener("pointerleave", onPointerLeave);
                        canvas.removeEventListener("pointerdown", onPointerDown);
                        canvas.removeEventListener("pointerup", onPointerUp);
                        doc.removeEventListener("keydown", onKey);
                        doc.removeEventListener("onUnitSystemChanged", onUnits);
                        doc.removeEventListener("djiThermalUnitChanged", onUnits);
                        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    }
                });
            });
        });
    }

    var api = {create: create, taskOf: taskOf, openingPalette: openingPalette, styleOf: styleOf, autoRange: autoRange,
               isothermPaint: isothermPaint, nextLabel: nextLabel, deltaOf: deltaOf, measurementsCsv: measurementsCsv,
               panelHtml: panelHtml, TOOLS: TOOLS, TOOL_ORDER: TOOL_ORDER, REASONS: REASONS, DEFAULT_PALETTE: DEFAULT_PALETTE};
    root.ThermalInspector3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
