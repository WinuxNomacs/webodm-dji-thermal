// A workset's frames one at a time (frame.html): the frames listed beside it (all of them, in the mosaic, oblique),
// the frame as the workset measured it and, beside it, measured again by dji-thermal-cli with some of its parameters
// changed; coloured in the browser from its values (recolour.js) with the mosaic viewer's palette, range, Image and
// Isotherm controls (viewer.js), the values under the cursor, its figures and its temperatures to download. The frame
// and the list are kept in the URL; ← and → step through the list. Leaflet is WebODM's own, in pixels.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale") : null);
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour") : null);
    var Viewer = root.ThermalAnalyzerViewer || (typeof require !== "undefined" ? require("./viewer") : null);
    var Inspector = root.ThermalInspector || (typeof require !== "undefined" ? require("./inspector") : null);
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var READOUT_HINT = "Move the cursor over the frame.";

    // The parameters a frame can be measured again with: [field, label, step, a temperature, what the SDK says it
    // measured with (info.params, °C), what the camera recorded (info.recorded)]
    var CHANGES = [
        ["distance", "Distance (m)", "0.1", false, "distance", "lrf"],
        ["humidity", "Humidity (%)", "1", false, "humidity", "humidity"],
        ["emissivity", "Emissivity", "0.01", false, "emissivity", "emissivity"],
        ["reflected_temp", "Reflected temperature", "0.1", true, "reflection", "reflection"],
        ["ambient_temp", "Ambient temperature", "0.1", true, "ambient_temp", "ambient"]
    ];
    // Each change's limits, as the server checks them (a temperature: above absolute zero)
    var LIMITS = {distance: [0.1, 1000, "The distance is between 0.1 and 1000 m"],
                  humidity: [0, 100, "The humidity is between 0 and 100 %"],
                  emissivity: [0.1, 1, "The emissivity is between 0.1 and 1"]};
    var DISTANCE_SOURCES = {rangefinder: "the rangefinder's", embedded: "the one the frame records", option: "the workset's"};
    // The list's choices once the mosaics placed frames: all of them, those in the mosaic and those left out
    var LISTS = [["", "All"], ["mosaic", "In the mosaic"], ["oblique", "Oblique"]];
    var THUMBS_KEY = "thermalAnalyzer.frameThumbnails";    // the list's Thumbnails box, remembered per browser ("0": off)

    function inMosaic(f) { return f.mosaic !== null && f.mosaic !== undefined; }

    // The frames of a list: those the mosaics placed, or those they left out; all of them for none, or while the
    // mosaics placed none
    function listFrames(frames, list) {
        if (!frames.some(inMosaic)) return frames;
        if (list === "mosaic") return frames.filter(inMosaic);
        if (list === "oblique") return frames.filter(function (f) { return !inMosaic(f); });
        return frames;
    }

    // What the list says of a frame beside its time: not converted, or why the mosaics left it out (oblique above
    // their pitch limit, else unusable); nothing before the mosaics are built
    function frameTag(f, list, maxPitch, built) {
        var oblique = typeof f.pitch === "number" && f.pitch > maxPitch;
        if (!f.converted) return built && oblique ? "oblique, " + core.formatNumber(f.pitch, 0, "°") + ", not converted" : "not converted";
        if (!built) return "";
        if (inMosaic(f)) return list === "mosaic" ? "" : "in the mosaic";
        return oblique ? "oblique, " + core.formatNumber(f.pitch, 0, "°") : "left out as unusable";
    }

    // The changes as a query ("&emissivity=0.9...")
    function changesQuery(changes) {
        return Object.keys(changes || {}).map(function (k) { return "&" + k + "=" + encodeURIComponent(changes[k]); }).join("");
    }

    // A frame's API URL (what: "frame", "frame/values", "frame/download"), measured with the changes
    function frameApiUrl(base, what, rel, changes) {
        return base + "/" + what + "?frame=" + encodeURIComponent(rel) + changesQuery(changes);
    }

    // A frame's name, without its folders
    function fileName(rel) { return String(rel || "").split("/").pop(); }

    // When a frame was taken, as recorded ("YYYY:MM:DD HH:MM:SS"): "2026-09-18 08:44:12"
    function timeText(t) {
        var m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d:\d\d:\d\d)/.exec(t || "");
        return m ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] : "";
    }

    // The thumbnails' URL, followed by a frame's path: the dataset's thumbnail of it, at the list's size, in the
    // palette given (the workset's, else the user's preferred; one of WebODM's or none: its embedded picture); a
    // workset's frames even in a dataset never analyzed
    function thumbsUrl(api, dataset, cid, palette) {
        return api + "datasets/" + dataset + "/thumbnail?workset=" + encodeURIComponent(cid) + "&size=list&" +
            (palette ? "palette=" + encodeURIComponent(palette) + "&" : "") + "file=";
    }

    // The list beside the frame: the switch between lists once the mosaics placed frames (sizes: each list's count),
    // the Thumbnails box, and the frames, the one shown marked, each with its thumbnail when thumbs (their URL) is given
    function listHtml(frames, current, list, sizes, maxPitch, built, thumbs) {
        var out = "";
        if (sizes) {
            out += '<div class="ta-frame-lists" role="group" aria-label="Which frames">' + LISTS.map(function (l, i) {
                return '<button type="button" class="btn btn-default' + (list === l[0] ? " active" : "") + '" data-list="' + l[0] + '"' +
                    (list === l[0] ? ' aria-pressed="true"' : "") + (sizes[i] ? "" : " disabled") + ">" + esc(l[1]) + " " + sizes[i] + "</button>";
            }).join("") + "</div>";
        }
        out += '<div class="ta-frame-list-head"><span class="ta-message">' + core.count(frames.length, "frame", "frames") + "</span>" +
            '<label class="ta-frame-thumbs-box"><input type="checkbox" data-thumbs' + (thumbs ? " checked" : "") + "> Thumbnails</label></div>";
        return out + '<ol class="ta-frame-items">' + frames.map(function (f) {
            var tag = frameTag(f, list, maxPitch, built), about = [timeText(f.time).slice(11), tag].filter(Boolean).join(" · ");
            return '<li><button type="button" data-path="' + esc(f.path) + '" title="' + esc(f.path + (tag ? " (" + tag + ")" : "")) + '"' +
                (f.path === current ? ' aria-current="true"' : "") + ">" +
                (thumbs ? '<img class="ta-frame-thumb" loading="lazy" alt="" src="' + esc(thumbs + encodeURIComponent(f.path)) + '">' : "") +
                esc(fileName(f.path)) +
                (about ? '<span class="ta-frame-item-about">' + esc(about) + "</span>" : "") + "</button></li>";
        }).join("") + "</ol>";
    }

    // A parameter as the panel shows it: a temperature (°C) in the user's unit, the emissivity to 2 digits
    function paramText(field, isTemp, value) {
        if (value === null || value === undefined) return "";
        return core.formatNumber(isTemp ? core.convertTemp(value, "C") : value, field === "emissivity" ? 2 : 1);
    }

    // Where each change field starts: what the frame was measured with, as shown
    function changeStarts(info) {
        var p = (info && info.params) || {}, out = {};
        CHANGES.forEach(function (c) { out[c[0]] = paramText(c[0], c[3], p[c[4]]); });
        return out;
    }

    // The changes typed ({field: text}) checked against where each field started (starts): {changes} (those moved,
    // the temperatures in the workset's unit) or {error, field}
    function readChanges(typed, starts, unit) {
        var out = {};
        for (var i = 0; i < CHANGES.length; i++) {
            var c = CHANGES[i], f = c[0], t = String(typed[f] === undefined ? "" : typed[f]).trim(), start = starts[f];
            if (t === "" || t === start || (start !== undefined && start !== "" && Number(t) === Number(start))) continue;
            var n = Number(t);
            if (isNaN(n)) return {error: c[1] + ": not a number", field: f};
            if (c[3]) {
                var kept = Math.round(core.convertTemp(n, core.userUnit(), unit) * 10000) / 10000;
                if (core.convertTemp(n, core.userUnit(), "K") <= 0) return {error: "A temperature is above absolute zero", field: f};
                out[f] = kept;
            } else {
                if (n < LIMITS[f][0] || n > LIMITS[f][1]) return {error: LIMITS[f][2], field: f};
                out[f] = n;
            }
        }
        return {changes: out};
    }

    // The changes as the fields show them (the temperatures in the user's unit)
    function changesTyped(changes, unit) {
        var out = {};
        CHANGES.forEach(function (c) {
            var v = (changes || {})[c[0]];
            if (v !== undefined) out[c[0]] = String(c[3] ? Math.round(core.convertTemp(v, unit) * 100) / 100 : v);
        });
        return out;
    }

    // The Worksets tab of the dataset with its form filled in with the workset's settings and these changes
    function newWorksetUrl(publicUrl, dataset, cid, changes) {
        return publicUrl + "dataset/" + dataset + "?from=" + encodeURIComponent(cid) + changesQuery(changes) + "#convert";
    }

    // The parameters: as the camera recorded them, as the frame was measured with them, and to change to (each field
    // starts at what it was measured with, so its arrows step from there; Enter measures again)
    function paramsHtml(info, typed, changes, error, newUrl) {
        var params = (info && info.params) || {}, rec = (info && info.recorded) || {}, starts = changeStarts(info);
        var any = Object.keys(changes || {}).length > 0, symbol = core.unitSymbol(core.userUnit());
        var rows = CHANGES.map(function (c) {
            var recorded = c[0] === "distance" && (rec.lrf === null || rec.lrf === undefined) ? rec.distance : rec[c[5]];
            var value = typed[c[0]] !== undefined ? typed[c[0]] : starts[c[0]];
            return "<tr" + (error && error.field === c[0] ? ' class="has-error"' : "") + "><td>" + esc(c[1] + (c[3] ? " (" + symbol + ")" : "")) +
                "</td><td>" + esc(paramText(c[0], c[3], recorded)) + "</td><td>" + esc(paramText(c[0], c[3], params[c[4]])) + "</td>" +
                '<td><input type="number" class="form-control input-sm" name="' + c[0] + '" step="' + c[2] + '" value="' + esc(value) + '"></td></tr>';
        }).join("");
        var source = info && info.distance_source ? '<p class="ta-message">The distance is ' + esc(DISTANCE_SOURCES[info.distance_source] ||
            info.distance_source) + ".</p>" : "";
        return '<table class="table table-condensed ta-viewer-values ta-params"><thead><tr><th></th>' +
            '<th title="As the camera recorded them (the distance: the rangefinder\'s)">Recorded</th><th>Measured with</th><th>Change to</th></tr></thead>' +
            "<tbody>" + rows + "</tbody></table>" + source +
            '<div class="text-danger" id="ta-frame-change-error">' + esc((error && error.error) || "") + "</div>" +
            '<div class="ta-frame-download"><button type="button" class="btn btn-primary btn-sm" id="ta-frame-apply"><i class="fa fa-refresh"></i> Measure again</button>' +
            (any ? '<button type="button" class="btn btn-default btn-sm" id="ta-frame-clear">Clear</button>' +
                '<a class="btn btn-default btn-sm" id="ta-frame-new-workset" href="' + esc(newUrl) + '" title="The Worksets tab, its form filled in with this workset\'s settings and these parameters">' +
                '<i class="fa fa-play"></i> New workset with these</a>' : "") + "</div>" +
            '<p class="ta-message">dji-thermal-cli measures the frame again with the parameters changed: exact, as a workset converted with them would.</p>';
    }

    // The frame's size, range and mean, what normalizing did to it, and what dji-thermal-cli noted
    function infoHtml(info, meta) {
        if (!info) return "";
        var s = info.stats, unit = info.unit, rows = [["Size", info.width + " × " + info.height + " px"]];
        if (s) {
            rows.push(["Range", core.formatTemp(s.min, unit, 1) + " to " + core.formatTemp(s.max, unit, 1)]);
            rows.push(["Mean", core.formatTemp(s.mean, unit)]);
        } else {
            rows.push(["Temperatures", "none"]);
        }
        if (meta.harmonized) {
            rows.push(["Harmonized", info.offset_known ? (info.offset ? core.formatDelta(-info.offset, unit, 2, true) + " applied" : "no offset") :
                "its offset is not known: shown without it"]);
        } else if (meta.normalized) {
            rows.push(["Normalized", "the flight's ambient and reflected temperatures"]);
        }
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + ((info.notes || []).length ? '<p class="ta-message">' + esc(info.notes.join("; ")) + "</p>" : "");
    }

    // A frame's value at a pixel (its values in the unit), null outside it or where it has none
    function valueAt(tile, x, y) {
        if (!tile) return null;
        var col = Math.floor(x), row = Math.floor(y);
        if (col < 0 || row < 0 || col >= tile.width || row >= tile.height) return null;
        var v = tile.values[row * tile.width + col];
        return isNaN(v) ? null : v;
    }

    // A frame's value at a pixel less the median of the values around it, over size_m at pixel_m metres a pixel (the
    // frame's info: about 2 m, as the mosaic viewer's), null where it has none or its ground resolution isn't known
    function surroundingsAt(tile, x, y, info) {
        var v = valueAt(tile, x, y);
        if (v === null || !info || !(info.pixel_m > 0)) return null;
        var half = Math.max(1, Math.round((info.size_m || 2) / 2 / info.pixel_m)), col = Math.floor(x), row = Math.floor(y), around = [];
        for (var r = Math.max(0, row - half); r <= Math.min(tile.height - 1, row + half); r++) {
            for (var c = Math.max(0, col - half); c <= Math.min(tile.width - 1, col + half); c++) {
                var a = tile.values[r * tile.width + c];
                if (!isNaN(a)) around.push(a);
            }
        }
        around.sort(function (p, q) { return p - q; });
        var n = around.length, median = n % 2 ? around[(n - 1) / 2] : (around[n / 2 - 1] + around[n / 2]) / 2;
        return v - median;
    }

    // The values under the cursor (point: {x, y, inside}): as converted, and with the parameters changed beside it;
    // each one's difference from its surroundings (infos: the frames' figures, their ground resolution)
    function readoutHtml(point, tiles, unit, infos) {
        if (!point) return '<span class="ta-message">' + READOUT_HINT + "</span>";
        if (!point.inside) return '<span class="ta-message">Outside the frame.</span>';
        infos = infos || [];
        var delta = function (i, label) {
            var d = surroundingsAt(tiles[i], point.x, point.y, infos[i] || infos[0]);
            if (d !== null) rows.push([label, core.formatDelta(d, unit, 2, true)]);
        };
        var t = valueAt(tiles[0], point.x, point.y), rows = [["x, y", Math.floor(point.x) + ", " + Math.floor(point.y)],
            [tiles[1] ? "As converted" : "Temperature", t === null ? "no data" : core.formatTemp(t, unit)]];
        delta(0, Viewer.DELTA_LABEL);
        if (tiles[1]) {
            var c = valueAt(tiles[1], point.x, point.y);
            rows.push(["Parameters changed", c === null ? "no data" : core.formatTemp(c, unit)]);
            delta(1, Viewer.DELTA_LABEL + ", changed");
            if (c !== null && t !== null) rows.push(["Difference", core.formatDelta(c - t, unit, 2, true)]);
        }
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }

    // The downloads: the frame as shown (PNG), its temperatures (CSV, TIFF); measured as converted or, with the
    // parameters changed, either way
    function downloadHtml(changed, withChanges) {
        var choice = changed ? '<div class="radio-inline-group" role="radiogroup" aria-label="Measured">' +
            '<label class="radio-inline"><input type="radio" name="ta-frame-measured" value=""' + (withChanges ? "" : " checked") + "> As converted</label>" +
            '<label class="radio-inline"><input type="radio" name="ta-frame-measured" value="1"' + (withChanges ? " checked" : "") + "> With the parameters changed</label></div>" : "";
        return choice + '<div class="ta-frame-download">' +
            '<button type="button" class="btn btn-default btn-sm" id="ta-frame-png" title="The frame as it is drawn here, at its own size"><i class="fa fa-image"></i> PNG</button>' +
            '<button type="button" class="btn btn-default btn-sm" data-download="csv" title="Each pixel\'s temperature, a row per row of pixels"><i class="fa fa-table"></i> CSV</button>' +
            '<button type="button" class="btn btn-default btn-sm" data-download="tiff" title="The temperatures as a 32-bit float TIFF, without a location"><i class="fa fa-file"></i> TIFF</button></div>' +
            '<p class="ta-message">The temperatures in the workset\'s unit; the PNG in the palette, range and image adjustments shown.</p>';
    }

    // The tools drawn on the frame, as the Thermal Inspector's (regions.js): [shape, icon, name]
    var TOOLS = ["pin", "line", "rectangle", "circle", "polygon"].map(function (k) { return [k, Regions.TOOLS[k].icon, Regions.TOOLS[k].name]; });
    var LABELS = {pin: "P", line: "L"};         // a pin's label, P1…, a line's L1…, the rest R1…
    var REASONS = {outside_raster: "Outside the frame", nodata: "No data here", too_few_points: "A polygon needs three corners",
                   self_intersecting: "The polygon's edges cross", no_area: "The polygon has no area", line_too_short: "A line needs two points"};
    var CIRCLE_SEGMENTS = 64;

    // A shape drawn on a pane (regions.js's GeoJSON, in the map's [lng, lat]) in the frame's pixels ([x, y], y down)
    function toPixels(geometry) {
        var flip = function (c) { return [c[0], -c[1]]; };
        if (geometry.type === "Point") return {type: "Point", coordinates: flip(geometry.coordinates)};
        if (geometry.type === "LineString") return {type: "LineString", coordinates: geometry.coordinates.map(flip)};
        return {type: "Polygon", coordinates: geometry.coordinates.map(function (ring) { return ring.map(flip); })};
    }

    // A circle drawn on a pane ({lat, lng, radius} in the map's units) as a polygon in the frame's pixels
    function circlePixels(circle) {
        var ring = [];
        for (var i = 0; i < CIRCLE_SEGMENTS; i++) {
            var a = 2 * Math.PI * i / CIRCLE_SEGMENTS;
            ring.push([circle.lng + circle.radius * Math.cos(a), -circle.lat + circle.radius * Math.sin(a)]);
        }
        ring.push(ring[0].slice());
        return {type: "Polygon", coordinates: [ring]};
    }

    // A pixel ([x, y]) as a place on a pane
    function latLng(c) { return [-c[1], c[0]]; }

    // The isotherm shown (an isotherm value in the workset's unit, as viewer.js keeps it) as a region asks for it:
    // {low, high} in °C, either null; null for none
    function isothermLimits(value, unit) {
        var r = Recolour.isothermRange(value);
        if (!r) return null;
        var c = function (v) { return Math.round(core.convertTemp(v, unit, "C") * 1e4) / 1e4; };
        return {low: r[0] > -1e38 ? c(r[0]) : null, high: r[1] < 1e38 ? c(r[1]) : null};
    }

    // The changes a measurement was made with, in words: "emissivity 0.8, reflected temperature 30.0 °C"
    function changesText(changes, unit) {
        return CHANGES.filter(function (c) { return (changes || {})[c[0]] !== undefined; }).map(function (c) {
            var v = changes[c[0]];
            return c[1].replace(/ \(.*\)$/, "").toLowerCase() + " " + (c[3] ? core.formatTemp(v, unit, 1) : core.formatNumber(v, c[0] === "emissivity" ? 2 : 1));
        }).join(", ");
    }

    // A measurement's value in a list: a pin's temperature, a region's or line's mean (°C)
    function itemValue(res, unit, loading) {
        if (loading) return '<span class="text-muted">…</span>';
        if (!res) return "";
        if (res.error) return '<span class="text-danger">' + esc(res.error) + "</span>";
        var s = res.statistics;
        if (!s) return '<span class="text-muted">' + esc(REASONS[res.reason] || "none") + "</span>";
        return s.count === 1 && !res.profile ? esc(core.formatTemp(s.mean, "C", 2)) : esc(core.formatTemp(s.mean, "C", 2)) + ' <span class="text-muted">mean</span>';
    }

    // What a measurement found, in full: the Inspector's statistics (sizes in pixels); a pin's own temperature
    function detailHtml(res, Inspector) {
        if (!res) return "";
        if (res.error) return '<div class="text-danger">' + esc(res.error) + "</div>";
        if (!res.statistics) return '<div class="text-muted">' + esc(REASONS[res.reason] || "No temperatures here") + "</div>";
        if (res.statistics.count === 1 && !res.profile) return "";
        return Inspector.statisticsHtml(res, Inspector.userUnit(), true, true);
    }

    // The Measure section: the tools, the shapes drawn on this frame (state: {tool, items, shown, form, canChange,
    // changed, message}), the one shown in full
    function measureHtml(state, Inspector) {
        var tools = '<div class="btn-group btn-group-sm dt-inspector-modes" role="group" aria-label="Draw">' + TOOLS.map(function (t) {
            return '<button type="button" class="btn btn-default' + (state.tool === t[0] ? " active" : "") + '" data-tool="' + t[0] + '" title="' +
                t[2] + '"' + (state.tool === t[0] ? ' aria-pressed="true"' : "") + '><i class="' + t[1] + '"></i></button>';
        }).join("") + "</div>";
        var hint = state.message ? '<div class="text-danger dt-inspector-hint">' + esc(state.message) + "</div>" :
            state.tool === "pin" ? '<div class="text-muted dt-inspector-hint">Click the frame to pin a pixel.</div>' :
            state.tool ? '<div class="text-muted dt-inspector-hint">' + (state.tool === "polygon" || state.tool === "line" ?
                "Click each point; double-click or Enter to finish, Esc to cancel." : "Press and drag on the frame; Esc to cancel.") + "</div>" : "";
        var items = state.items, shown = items.filter(function (i) { return i.id === state.shown; })[0];
        var rows = items.length ? '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + items.map(function (i) {
            return '<tr data-item="' + i.id + '"' + (i === shown ? ' class="active"' : "") + '><td><i class="' + TOOLS.filter(function (t) { return t[0] === i.shape; })[0][1] +
                '"></i> <a href="javascript:void(0)" data-act="show">' + esc(i.label) + "</a></td><td>" + itemValue(i.res, "C", i.loading) +
                '</td><td class="text-right">' + (state.canChange && i.res && i.res.statistics ?
                    '<a href="javascript:void(0)" data-act="save" title="Save it, named, for everyone who can view the project"><i class="fa fa-save"></i></a>' : "") +
                '<a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" : '<div class="text-muted dt-inspector-hint">Choose a tool, then draw on the frame to read its temperatures.</div>';
        return tools + hint + rows + Inspector.formHtml(state.form, "region") +
            (shown ? '<div class="dt-inspector-shown"><strong>' + esc(shown.label) + "</strong>" + detailHtml(shown.res, Inspector) + "</div>" : "") +
            (state.changed && items.length ? '<div class="text-muted dt-inspector-hint">Measured with the parameters changed.</div>' : "");
    }

    // The measurements saved on this frame (state: {saved, savedShown, form, canChange})
    function savedHtml(state, Inspector) {
        if (!state.saved.length) {
            return '<div class="text-muted dt-inspector-hint">' + (state.canChange ? "None yet: a measurement's Save keeps it here for everyone who can view the project." : "None.") + "</div>";
        }
        var shown = state.saved.filter(function (m) { return m.id === state.savedShown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + state.saved.map(function (m) {
            var tool = TOOLS.filter(function (t) { return t[0] === m.shape; })[0] || TOOLS[0];
            return '<tr data-saved="' + esc(m.id) + '"' + (m === shown ? ' class="active"' : "") + '><td><i class="' + tool[1] + '"></i> ' +
                '<a href="javascript:void(0)" data-act="show">' + esc(m.name) + "</a></td><td>" + itemValue(m.values, "C") + '</td><td class="text-right">' +
                (state.canChange ? '<a href="javascript:void(0)" data-act="edit" title="Rename it or change its comment"><i class="fa fa-pencil-alt"></i></a>' +
                    '<a href="javascript:void(0)" data-act="delete" title="Delete it for everyone"><i class="fa fa-times"></i></a>' : "") + "</td></tr>";
        }).join("") + "</tbody></table>" + Inspector.formHtml(state.form, "saved") +
            (shown ? '<div class="dt-inspector-shown"><strong>' + esc(shown.name) + "</strong>" +
                (shown.comment ? '<div class="dt-inspector-hint">' + esc(shown.comment) + "</div>" : "") +
                detailHtml(shown.values, Inspector) +
                '<div class="text-muted dt-inspector-hint">' + (Object.keys(shown.changes || {}).length ? "Measured with " + esc(changesText(shown.changes, state.unit)) + ". " : "As converted. ") +
                "Saved by " + esc(shown.created_by) + ", " + esc(core.formatDate(shown.created_at)) + ".</div></div>" : "");
    }

    // A Leaflet layer of a canvas over bounds, as an image overlay is (Leaflet 1.3 has no canvas overlay)
    function canvasOverlay(L, canvas, bounds) {
        var Overlay = L.ImageOverlay.extend({
            _initImage: function () {
                var img = this._image = canvas;
                L.DomUtil.addClass(img, "leaflet-image-layer");
                if (this._zoomAnimated) L.DomUtil.addClass(img, "leaflet-zoom-animated");
                img.onselectstart = L.Util.falseFn;
                img.onmousemove = L.Util.falseFn;
            }
        });
        return new Overlay("", bounds, {interactive: false});
    }

    // ctx: {doc, fetchFn, loadLeaflet (resolves to Leaflet), location, history}
    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn;
        var page = doc.getElementById("ta-frame");
        if (!page) return;
        var $ = function (i) { return doc.getElementById(i); };
        var publicUrl = page.getAttribute("data-public"), dataset = page.getAttribute("data-dataset"), cid = page.getAttribute("data-id");
        var base = page.getAttribute("data-api") + "datasets/" + dataset + "/conversions/" + cid;
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var asked = new root.URLSearchParams((ctx.location || {}).search || "");
        var meta = null, all = [], list = asked.get("list") || "", frame = null;
        var thumbsOn = true;
        try { thumbsOn = !root.localStorage || root.localStorage.getItem(THUMBS_KEY) !== "0"; } catch (e) { thumbsOn = true; }
        // The frame as converted and with the changes: figures (info) and values (tiles), each pane's
        var infos = [null, null], tiles = [null, null], changes = {}, typed = {}, changeError = null, withChanges = false;
        var style = null, L = null, maps = [null, null], canvases = [null, null], overlays = [null, null], fitted = false;
        var point = null, drawing = null, syncing = false, n = 0;
        // Temperature On Pointer: each pane's temperature beside the pointer, as the user chose (off until they do)
        var labels = [null, null];
        var pointerOn = core.bindPointerTemperature(doc, fetchFn, page.getAttribute("data-api"), csrf, function (on) {
            pointerOn = on;
            if (!on) labels.forEach(function (l) { if (l) l.hide(); });
        });
        // The tools: the one on, the shapes drawn on each frame (kept while the page is open), the one shown in full,
        // the measurements saved on the frame and the form naming one
        var tool = null, drawTool = null, drawn = {}, counts = {}, shownItem = null, saved = [], savedShown = null, form = null;
        var message = "", groups = [null, null], marker = null, savedAsked = 0, ids = 0;

        function status(text, cls) {
            $("ta-frame-status").className = "ta-status" + (cls ? " " + cls : "");
            $("ta-frame-status").innerHTML = text;
        }

        function changed() { return Object.keys(changes).length > 0; }
        function shown() { return listFrames(all, list); }
        function current() { return {tab: "frame", stats: infos[0] && infos[0].stats}; }
        function unit() { return meta.unit; }

        // The equalization's curve, from the frame's own histogram, for the range shown
        function loadCurve() {
            var h = infos[0] && infos[0].stats && infos[0].stats.histogram;
            style.curve = style.adjust.equalize && h ?
                Recolour.curveShares(style.range[0], style.range[1], style.adjust, Recolour.equalization(h, style.range[0], style.range[1])) : null;
        }

        function drawStyle() {
            var p = (meta.palettes || []).filter(function (x) { return x.key === style.palette; })[0];
            if (!p) return null;
            return {palette: style.palette, colors: p.color_map, range: style.range, shares: scale.adjustShares(style.adjust, style.curve),
                    sharpen: style.adjust.sharpen, isotherm: Recolour.isothermRange(style.isotherm && style.isotherm.value), seams: false};
        }

        function showScale() {
            var p = (meta.palettes || []).filter(function (x) { return x.key === style.palette; })[0];
            $("ta-viewer-scale").innerHTML = Viewer.legendHtml(p && p.color_map, Viewer.shownRange("frame", style.range, unit()),
                                                               scale.adjustShares(style.adjust, style.curve));
        }

        // Each pane's canvas coloured from its values, once a frame (as a slider moves)
        function draw() {
            var s = drawStyle();
            [0, 1].forEach(function (i) {
                var tile = tiles[i], canvas = canvases[i];
                if (!tile || !canvas || !s) return;
                var c = canvas.getContext("2d"), image = c.createImageData(tile.width, tile.height);
                Recolour.colour(tile, s, image.data);
                c.putImageData(image, 0, 0);
            });
        }
        function recolour() {
            loadCurve();
            showScale();
            if (drawing) return;
            var later = root.requestAnimationFrame || function (f) { return root.setTimeout(f, 16); };
            drawing = later(function () { drawing = null; draw(); });
        }

        // A pane's map, in the frame's pixels (y downwards: the map's latitude is -y); the panes move together
        function pane(i) {
            if (maps[i]) return maps[i];
            var map = maps[i] = L.map($("ta-frame-map-" + i), {crs: L.CRS.Simple, minZoom: -4, maxZoom: 6, zoomSnap: 0.25,
                                                              attributionControl: false, keyboard: false});
            labels[i] = core.pointerLabel(doc, $("ta-frame-map-" + i));
            map.on("mousemove", function (e) {
                var x = e.latlng.lng, y = -e.latlng.lat, t = tiles[0];
                point = {x: x, y: y, inside: !!t && x >= 0 && y >= 0 && x < t.width && y < t.height};
                showReadout();
                // The pane's own temperature there: as converted, or with the parameters changed
                var value = pointerOn ? valueAt(tiles[i], x, y) : null;
                labels[i].show(value === null ? "" : core.formatTemp(value, unit()), e.containerPoint);
            });
            map.on("mouseout", function () { point = null; showReadout(); labels[i].hide(); });
            if (i === 0) {
                map.on("click", function (e) {
                    if (tool === "pin") add("pin", {type: "Point", coordinates: [e.latlng.lng, -e.latlng.lat]}, null);
                });
            }
            map.on("move", function () {
                var other = maps[1 - i];
                if (syncing || !other) return;
                syncing = true;
                other.setView(map.getCenter(), map.getZoom(), {animate: false});
                syncing = false;
            });
            if (i === 1 && maps[0]) map.setView(maps[0].getCenter(), maps[0].getZoom(), {animate: false});
            return map;
        }

        // A pane's canvas, the size of its values, on its map
        function showPane(i) {
            var tile = tiles[i];
            if (!tile) {
                if (overlays[i]) maps[i].removeLayer(overlays[i]);
                overlays[i] = null;
                return;
            }
            var map = pane(i), bounds = [[-tile.height, 0], [0, tile.width]];
            if (!canvases[i]) canvases[i] = doc.createElement("canvas");
            canvases[i].width = tile.width;
            canvases[i].height = tile.height;
            if (!overlays[i]) overlays[i] = canvasOverlay(L, canvases[i], bounds).addTo(map);
            else overlays[i].setBounds(L.latLngBounds(bounds));
            map.invalidateSize();
            if (i === 0 && !fitted) {
                map.fitBounds(bounds);
                fitted = true;
            }
        }

        function showReadout() { $("ta-frame-readout").innerHTML = readoutHtml(point, tiles, unit(), infos); }

        function items() { return drawn[frame] || (drawn[frame] = []); }
        function limits() { return style ? isothermLimits(style.isotherm && style.isotherm.value, unit()) : null; }
        // What a shape is measured with: the changes applied and the isotherm shown
        function measuredWith() { return JSON.stringify([changes, limits()]); }

        function showMeasure() {
            $("ta-frame-measure").innerHTML = measureHtml({tool: tool, items: items(), shown: shownItem, form: form, canChange: meta.can_change,
                                                           changed: changed(), message: message}, Inspector);
        }
        function showSaved() {
            $("ta-frame-saved").innerHTML = savedHtml({saved: saved, savedShown: savedShown, form: form, canChange: meta.can_change, unit: unit()}, Inspector);
        }

        // The shapes on both panes: those drawn (the one shown bolder) and those saved (dashed, green)
        function drawShapes() {
            if (!L) return;
            var shapes = items().map(function (i) { return {g: i.geometry, circle: i.circle, shown: i.id === shownItem, color: "#ff9800"}; })
                .concat(saved.map(function (m) { return {g: m.geometry, circle: m.circle, shown: m.id === savedShown, color: "#2e7d32", dash: "5 4"}; }));
            [0, 1].forEach(function (i) {
                if (!maps[i]) return;
                if (!groups[i]) groups[i] = L.layerGroup().addTo(maps[i]);
                groups[i].clearLayers();
                shapes.forEach(function (sh) {
                    var o = {color: sh.color, weight: sh.shown ? 3 : 2, dashArray: sh.dash, fillOpacity: sh.shown ? 0.15 : 0.05, interactive: false};
                    var g = sh.g;
                    if (!g) return;
                    var layer = g.type === "Point" ? L.circleMarker(latLng(g.coordinates), {radius: 5, color: "#000", weight: 1, fillColor: sh.color, fillOpacity: 1, interactive: false}) :
                        sh.circle ? L.circle([sh.circle.lat, sh.circle.lng], Object.assign({radius: sh.circle.radius}, o)) :
                        g.type === "LineString" ? L.polyline(g.coordinates.map(latLng), o) : L.polygon(g.coordinates[0].map(latLng), o);
                    layer.addTo(groups[i]);
                });
            });
        }

        // A shape measured on the frame (with the changes and the isotherm); a reply for one changed since is dropped
        function measureItem(item) {
            var mine = item.asked = (item.asked || 0) + 1, rel = frame;
            item.loading = true;
            item.with = measuredWith();
            var body = {frame: rel, changes: changes, geometry: item.geometry, isotherm: limits()};
            return fetchFn(base + "/frame/region", {method: "POST", credentials: "same-origin",
                                                    headers: {"Content-Type": "application/json", "X-CSRFToken": csrf}, body: JSON.stringify(body)})
                .then(core.readJson).then(function (r) {
                    if (mine !== item.asked) return;
                    item.loading = false;
                    item.res = r.ok ? r.data : {error: core.errorText(r.data, "Could not measure it.")};
                    if (rel === frame) showMeasure();
                }, function () {
                    if (mine !== item.asked) return;
                    item.loading = false;
                    item.res = {error: "Could not measure it."};
                    if (rel === frame) showMeasure();
                });
        }
        // The shapes measured with other changes or another isotherm, measured again
        function remeasure() {
            var now = measuredWith();
            items().forEach(function (i) { if (i.with !== now) measureItem(i); });
        }

        function add(shape, geometry, circle) {
            var key = LABELS[shape] || "R";
            counts[key] = (counts[key] || 0) + 1;
            var item = {id: "i" + (++ids), label: key + counts[key], shape: shape, geometry: geometry, circle: circle};
            items().push(item);
            shownItem = item.id;
            message = "";
            measureItem(item);
            drawShapes();
            showMeasure();
        }

        // A tool on (the same again: off); a pin is a click, the others regions.js's drawing on the first pane
        function setTool(name) {
            if (drawTool) drawTool.cancel();
            drawTool = null;
            tool = name === tool ? null : name;
            message = "";
            if (tool && tool !== "pin" && maps[0]) {
                var drawing = tool;
                drawTool = new Regions.DrawTool(L, maps[0], {shape: tool, doc: doc,
                    onFinish: function (r) {
                        maps[0].removeLayer(r.layer);
                        drawTool = null;
                        tool = null;
                        var circle = r.circle ? {lat: r.circle.lat, lng: r.circle.lng, radius: r.circle.radius} : null;
                        add(drawing, circle ? circlePixels(circle) : toPixels(r.geometry), circle);
                    },
                    onCancel: function () { drawTool = null; tool = null; showMeasure(); },
                    onInvalid: function (reason) { message = REASONS[reason] || reason; showMeasure(); }});
                drawTool.start();
            }
            if (maps[0] && !drawTool) maps[0].getContainer().style.cursor = tool === "pin" ? "crosshair" : "";
            showMeasure();
        }

        // The measurements saved on the frame
        function loadSaved() {
            var mine = ++savedAsked, rel = frame;
            return fetchFn(base + "/frame/measurements?frame=" + encodeURIComponent(rel), {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (mine !== savedAsked || !r.ok) return;
                saved = r.data.measurements || [];
                if (!saved.some(function (m) { return m.id === savedShown; })) savedShown = null;
                showSaved();
                drawShapes();
            });
        }

        function send(url, method, body) {
            return fetchFn(url, {method: method, credentials: "same-origin", headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
                                 body: body === undefined ? undefined : JSON.stringify(body)}).then(function (r) {
                return r.status === 204 ? {ok: true, data: {}} : core.readJson(r);
            }, core.unreachable);
        }

        // The form's Save: a drawn shape saved (then out of the drawn ones), or a saved one renamed
        function submitForm() {
            var name = (doc.querySelector("[data-form=name]") || {}).value || "", comment = (doc.querySelector("[data-form=comment]") || {}).value || "";
            form.name = name;
            form.comment = comment;
            form.busy = true;
            form.error = "";
            var request;
            if (form.kind === "saved") {
                request = send(base + "/frame/measurements/" + form.id, "PATCH", {name: name, comment: comment});
            } else {
                var item = items().filter(function (i) { return i.id === form.id; })[0];
                request = send(base + "/frame/measurements", "POST", {name: name, comment: comment, shape: item.shape, frame: frame, changes: changes,
                                                                     geometry: item.geometry, circle: item.circle, isotherm: limits()});
            }
            showMeasure();
            showSaved();
            return request.then(function (r) {
                if (!r.ok) {
                    form.busy = false;
                    form.error = core.errorText(r.data, "Could not save it.");
                } else {
                    if (form.kind !== "saved") {
                        drawn[frame] = items().filter(function (i) { return i.id !== form.id; });
                        savedShown = r.data.id;
                        shownItem = null;
                    }
                    form = null;
                    loadSaved();
                }
                showMeasure();
                showSaved();
                drawShapes();
            });
        }

        // A line's profile hovered: its point marked on the frame
        function markProfile(e) {
            var svg = e.target.closest ? e.target.closest("svg[data-act=profile]") : null;
            var res = svg && (svg.closest("#ta-frame-saved") ? (saved.filter(function (m) { return m.id === savedShown; })[0] || {}).values :
                (items().filter(function (i) { return i.id === shownItem; })[0] || {}).res);
            if (marker) maps[0].removeLayer(marker);
            marker = null;
            if (!res || !res.profile || !maps[0]) return;
            var box = svg.getBoundingClientRect(), share = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1)));
            var at = res.profile.points[Inspector.profileIndex(res.profile, share)];
            marker = L.circleMarker(latLng(at), {radius: 5, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 1, interactive: false}).addTo(maps[0]);
        }

        function showParams() {
            $("ta-frame-params").innerHTML = paramsHtml(infos[0], typed, changes, changeError,
                                                        newWorksetUrl(publicUrl, dataset, cid, changes));
        }

        function showList() {
            var frames = shown(), built = all.some(inMosaic);
            var sizes = built ? LISTS.map(function (l) { return listFrames(all, l[0]).length; }) : null;
            var thumbs = thumbsOn ? thumbsUrl(page.getAttribute("data-api"), dataset, cid, meta.frames_palette || core.preferences().palette) : null;
            $("ta-frame-list").innerHTML = listHtml(frames, frame, list, sizes, meta.max_pitch, meta.built, thumbs);
            $("ta-frame-list").classList.toggle("ta-frame-list-thumbs", !!thumbs);
            scrollList();
            var i = frames.map(function (f) { return f.path; }).indexOf(frame);
            $("ta-frame-prev").disabled = i <= 0;
            $("ta-frame-next").disabled = i < 0 || i >= frames.length - 1;
        }

        // The frame shown, centred in the list when it's out of view (the list scrolled, not the page); nothing while
        // the page is hidden, before the first frame is drawn
        function scrollList() {
            var box = $("ta-frame-list"), at = box.querySelector("[aria-current=true]");
            if (!at || $("ta-frame-main").hidden) return;
            var b = box.getBoundingClientRect(), r = at.getBoundingClientRect();
            if (r.top >= b.top && r.bottom <= b.bottom) return;
            box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
        }

        // The frame and list in the URL, so a link or a reload comes back to them
        function keepUrl() {
            if (!ctx.history) return;
            ctx.history.replaceState(null, "", "?frame=" + encodeURIComponent(frame) + (list ? "&list=" + encodeURIComponent(list) : ""));
        }

        // The frame's figures and values, as converted and with the changes; a reply for a frame or changes no longer
        // shown is dropped
        function measure() {
            var mine = ++n, rel = frame, wanted = [{}, changed() ? changes : null];
            status("Measuring the frame…", "text-muted");
            return Promise.all(wanted.map(function (c) {
                if (!c) return Promise.resolve([null, null]);
                return Promise.all([
                    fetchFn(frameApiUrl(base, "frame", rel, c), {credentials: "same-origin"}).then(core.readJson),
                    Recolour.fetchValues(frameApiUrl(base, "frame/values", rel, c), fetchFn)
                ]);
            })).then(function (found) {
                if (mine !== n) return;
                var failed = found.filter(function (f) { return f[0] && !f[0].ok; })[0];
                if (failed) return status(esc(core.errorText(failed[0].data, "Could not measure the frame.")), "text-danger");
                status("", "");
                infos = found.map(function (f) { return f[0] ? f[0].data : null; });
                tiles = found.map(function (f) { return f[1]; });
                if (!style) {
                    style = {palette: meta.default_palette, range: Viewer.defaultRange(current(), unit()), adjust: scale.defaultAdjust(),
                             curve: null, isotherm: {mode: "", a: "", b: "", value: ""}};
                }
                render();
            }, function () {
                if (mine === n) status("Could not measure the frame.", "text-danger");
            });
        }

        function render() {
            var f = infos[0];
            $("ta-frame-name").textContent = fileName(frame);
            var entry = all.filter(function (x) { return x.path === frame; })[0] || {};
            $("ta-frame-subtitle").textContent = [meta.dataset_name, meta.name, timeText(entry.time), frame !== fileName(frame) ? frame : ""]
                .filter(Boolean).join(" · ");
            $("ta-frame-main").hidden = false;
            scrollList();
            $("ta-frame-title-0").hidden = $("ta-frame-pane-1").hidden = !tiles[1];
            $("ta-viewer-controls").innerHTML = Viewer.controlsHtml(current(), style, meta.palettes || [], unit());
            $("ta-frame-info").innerHTML = infoHtml(f, meta);
            $("ta-frame-download").innerHTML = downloadHtml(!!tiles[1], withChanges && !!tiles[1]);
            showParams();
            showReadout();
            showMeasure();
            return ctx.loadLeaflet().then(function (leaflet) {
                L = leaflet;
                showPane(0);
                if (tiles[1] || maps[1]) showPane(1);
                if (maps[1]) maps[1].invalidateSize();
                recolour();
                drawShapes();
                remeasure();
            });
        }

        function choose(rel) {
            if (drawTool) drawTool.cancel();
            drawTool = null;
            tool = null;
            shownItem = savedShown = form = null;
            frame = rel;
            loadSaved();
            typed = changesTyped(changes, unit());
            changeError = null;
            keepUrl();
            showList();
            return measure();
        }

        function step(by) {
            var paths = shown().map(function (f) { return f.path; }), i = paths.indexOf(frame) + by;
            if (i >= 0 && i < paths.length) choose(paths[i]);
        }

        function load() {
            return fetchFn(base + "/frames", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return status(esc(core.errorText(r.data, "Could not load the frames.")), "text-danger");
                meta = r.data;
                all = meta.frames || [];
                var wanted = asked.get("frame");
                // All of them when the list asked for is empty or hasn't the frame asked for
                if (!all.some(inMosaic) || !listFrames(all, list).some(function (f) { return f.path === wanted || !wanted; })) list = "";
                var paths = shown().map(function (f) { return f.path; });
                if (!paths.length) return status("The dataset has no thermal frames to show.", "text-muted");
                return choose(paths.indexOf(wanted) >= 0 ? wanted : paths[0]);
            }, function () { status("Could not load the frames.", "text-danger"); });
        }

        // Measure again with the parameters typed; Clear goes back to the frame as converted
        function apply() {
            var r = readChanges(typed, changeStarts(infos[0]), unit());
            changeError = r.error ? r : null;
            if (r.error) return showParams();
            changes = r.changes;
            if (!changed()) withChanges = false;
            measure();
        }

        Viewer.bindControls({doc: doc, el: $("ta-viewer-controls"), current: current, style: function () { return style; }, unit: unit,
                             palettes: function () { return meta.palettes || []; }, recolour: recolour,
                             restyle: function () { recolour(); remeasure(); },
                             // A palette is the user's, everywhere (DJI's keys carry the viewer's prefix)
                             onPalette: function (key) {
                                 // the list's thumbnails follow it, unless they are in the workset's palette
                                 core.savePalette(fetchFn, page.getAttribute("data-api"), csrf, key.replace(/^dji_/, ""))
                                     .then(function () { if (thumbsOn && !meta.frames_palette) showList(); }, function () {});
                             }});

        $("ta-frame-list").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button") : null;
            if (!b || b.disabled) return;
            if (b.hasAttribute("data-list")) {
                list = b.getAttribute("data-list");
                var paths = shown().map(function (f) { return f.path; });
                if (paths.indexOf(frame) < 0) return choose(paths[0]);
                keepUrl();
                return showList();
            }
            if (b.hasAttribute("data-path")) choose(b.getAttribute("data-path"));
        });
        $("ta-frame-list").addEventListener("change", function (e) {
            if (!e.target.hasAttribute("data-thumbs")) return;
            thumbsOn = e.target.checked;
            try { if (root.localStorage) root.localStorage.setItem(THUMBS_KEY, thumbsOn ? "1" : "0"); } catch (err) { /* not kept */ }
            showList();
        });

        $("ta-frame-prev").addEventListener("click", function () { step(-1); });
        $("ta-frame-next").addEventListener("click", function () { step(1); });

        $("ta-frame-params").addEventListener("input", function (e) {
            if (e.target.name) typed[e.target.name] = e.target.value;
        });
        $("ta-frame-params").addEventListener("keydown", function (e) {
            if (e.key === "Enter" && e.target.name) {
                e.preventDefault();
                apply();
            }
        });
        $("ta-frame-params").addEventListener("click", function (e) {
            if (e.target.closest && e.target.closest("#ta-frame-apply")) return apply();
            if (e.target.closest && e.target.closest("#ta-frame-clear")) {
                changes = {};
                typed = {};
                changeError = null;
                withChanges = false;
                measure();
            }
        });

        $("ta-frame-measure").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("[data-tool], [data-act]") : null;
            if (!b) return;
            if (b.hasAttribute("data-tool")) return setTool(b.getAttribute("data-tool"));
            var act = b.getAttribute("data-act"), row = b.closest("[data-item]");
            if (act === "form-save") return submitForm();
            if (act === "form-cancel") { form = null; return showMeasure(); }
            var item = row && items().filter(function (i) { return i.id === row.getAttribute("data-item"); })[0];
            if (!item) return;
            if (act === "show") shownItem = shownItem === item.id ? null : item.id;
            if (act === "remove") {
                drawn[frame] = items().filter(function (i) { return i !== item; });
                if (shownItem === item.id) shownItem = null;
            }
            if (act === "save") form = {kind: "region", id: item.id, label: item.label, name: item.label, comment: "", busy: false, error: ""};
            showMeasure();
            showSaved();
            drawShapes();
        });

        $("ta-frame-saved").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("[data-act]") : null;
            if (!b) return;
            var act = b.getAttribute("data-act"), row = b.closest("[data-saved]");
            if (act === "form-save") return submitForm();
            if (act === "form-cancel") { form = null; return showSaved(); }
            var m = row && saved.filter(function (x) { return x.id === row.getAttribute("data-saved"); })[0];
            if (!m) return;
            if (act === "show") savedShown = savedShown === m.id ? null : m.id;
            if (act === "edit") form = {kind: "saved", id: m.id, name: m.name, comment: m.comment || "", busy: false, error: ""};
            if (act === "delete") {
                return core.ask(doc, "Delete “" + m.name + "”?", "It is deleted for everyone who can view the project.", "Delete", "danger").then(function (yes) {
                    if (!yes) return;
                    return send(base + "/frame/measurements/" + m.id, "DELETE").then(function () { return loadSaved(); });
                });
            }
            showSaved();
            showMeasure();
            drawShapes();
        });

        [$("ta-frame-measure"), $("ta-frame-saved")].forEach(function (el) {
            el.addEventListener("mousemove", markProfile);
            el.addEventListener("mouseleave", function () { if (marker) maps[0].removeLayer(marker); marker = null; });
        });

        $("ta-frame-download").addEventListener("change", function (e) {
            if (e.target.name === "ta-frame-measured") withChanges = e.target.value === "1";
        });
        $("ta-frame-download").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button") : null;
            if (!b) return;
            var i = withChanges && tiles[1] ? 1 : 0, stem = fileName(frame).replace(/\.[^.]*$/, "") + (i ? "-changed" : "");
            if (b.hasAttribute("data-download")) {
                ctx.location.assign(frameApiUrl(base, "frame/download", frame, i ? changes : {}) + "&kind=" + b.getAttribute("data-download"));
                return;
            }
            if (b.id === "ta-frame-png" && canvases[i] && canvases[i].toBlob) {
                canvases[i].toBlob(function (blob) {
                    var a = doc.createElement("a");
                    a.href = root.URL.createObjectURL(blob);
                    a.download = stem + ".png";
                    doc.body.appendChild(a);
                    a.click();
                    doc.body.removeChild(a);
                    root.setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 1000);
                }, "image/png");
            }
        });

        // ← and → step through the list, but not while typing in a field
        doc.addEventListener("keydown", function (e) {
            if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !frame || drawTool || e.altKey || e.ctrlKey || e.metaKey ||
                /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || "")) return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        });

        return load();
    }

    var api = {CHANGES: CHANGES, listFrames: listFrames, frameTag: frameTag, changesQuery: changesQuery, frameApiUrl: frameApiUrl,
               listHtml: listHtml, thumbsUrl: thumbsUrl, changeStarts: changeStarts, readChanges: readChanges, changesTyped: changesTyped,
               newWorksetUrl: newWorksetUrl, paramsHtml: paramsHtml, infoHtml: infoHtml, valueAt: valueAt, surroundingsAt: surroundingsAt, readoutHtml: readoutHtml,
               downloadHtml: downloadHtml, canvasOverlay: canvasOverlay, timeText: timeText, toPixels: toPixels, circlePixels: circlePixels,
               isothermLimits: isothermLimits, changesText: changesText, measureHtml: measureHtml, savedHtml: savedHtml, init: init};
    root.ThermalAnalyzerFrame = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch && window.PluginsAPI) {
    (function () {
        var page = document.getElementById("ta-frame");
        if (!page) return;
        window.ThermalAnalyzerFrame.init({
            doc: document, fetchFn: window.fetch.bind(window), location: window.location, history: window.history,
            loadLeaflet: function () { return window.ThermalAnalyzerViewer.loadLeaflet(page.getAttribute("data-public")); }
        });
    })();
}
