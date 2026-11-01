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

    // The list beside the frame: the switch between lists once the mosaics placed frames (sizes: each list's count),
    // and the frames, the one shown marked
    function listHtml(frames, current, list, sizes, maxPitch, built) {
        var out = "";
        if (sizes) {
            out += '<div class="ta-frame-lists" role="group" aria-label="Which frames">' + LISTS.map(function (l, i) {
                return '<button type="button" class="btn btn-default' + (list === l[0] ? " active" : "") + '" data-list="' + l[0] + '"' +
                    (list === l[0] ? ' aria-pressed="true"' : "") + (sizes[i] ? "" : " disabled") + ">" + esc(l[1]) + " " + sizes[i] + "</button>";
            }).join("") + "</div>";
        }
        out += '<div class="ta-message">' + core.count(frames.length, "frame", "frames") + "</div>";
        return out + '<ol class="ta-frame-items">' + frames.map(function (f) {
            var tag = frameTag(f, list, maxPitch, built), about = [timeText(f.time).slice(11), tag].filter(Boolean).join(" · ");
            return '<li><button type="button" data-path="' + esc(f.path) + '" title="' + esc(f.path + (tag ? " (" + tag + ")" : "")) + '"' +
                (f.path === current ? ' aria-current="true"' : "") + ">" + esc(fileName(f.path)) +
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

    // The values under the cursor (point: {x, y, inside}): as converted, and with the parameters changed beside it
    function readoutHtml(point, tiles, unit) {
        if (!point) return '<span class="ta-message">' + READOUT_HINT + "</span>";
        if (!point.inside) return '<span class="ta-message">Outside the frame.</span>';
        var t = valueAt(tiles[0], point.x, point.y), rows = [["x, y", Math.floor(point.x) + ", " + Math.floor(point.y)],
            [tiles[1] ? "As converted" : "Temperature", t === null ? "no data" : core.formatTemp(t, unit)]];
        if (tiles[1]) {
            var c = valueAt(tiles[1], point.x, point.y);
            rows.push(["Parameters changed", c === null ? "no data" : core.formatTemp(c, unit)]);
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
        // The frame as converted and with the changes: figures (info) and values (tiles), each pane's
        var infos = [null, null], tiles = [null, null], changes = {}, typed = {}, changeError = null, withChanges = false;
        var style = null, L = null, maps = [null, null], canvases = [null, null], overlays = [null, null], fitted = false;
        var point = null, drawing = null, syncing = false, n = 0;

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
            map.on("mousemove", function (e) {
                var x = e.latlng.lng, y = -e.latlng.lat, t = tiles[0];
                point = {x: x, y: y, inside: !!t && x >= 0 && y >= 0 && x < t.width && y < t.height};
                showReadout();
            });
            map.on("mouseout", function () { point = null; showReadout(); });
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

        function showReadout() { $("ta-frame-readout").innerHTML = readoutHtml(point, tiles, unit()); }

        function showParams() {
            $("ta-frame-params").innerHTML = paramsHtml(infos[0], typed, changes, changeError,
                                                        newWorksetUrl(publicUrl, dataset, cid, changes));
        }

        function showList() {
            var frames = shown(), built = all.some(inMosaic);
            var sizes = built ? LISTS.map(function (l) { return listFrames(all, l[0]).length; }) : null;
            $("ta-frame-list").innerHTML = listHtml(frames, frame, list, sizes, meta.max_pitch, meta.built);
            var at = $("ta-frame-list").querySelector("[aria-current=true]");
            if (at && at.scrollIntoView) at.scrollIntoView({block: "nearest"});
            var i = frames.map(function (f) { return f.path; }).indexOf(frame);
            $("ta-frame-prev").disabled = i <= 0;
            $("ta-frame-next").disabled = i < 0 || i >= frames.length - 1;
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
            $("ta-frame-title-0").hidden = $("ta-frame-pane-1").hidden = !tiles[1];
            $("ta-viewer-controls").innerHTML = Viewer.controlsHtml(current(), style, meta.palettes || [], unit());
            $("ta-frame-info").innerHTML = infoHtml(f, meta);
            $("ta-frame-download").innerHTML = downloadHtml(!!tiles[1], withChanges && !!tiles[1]);
            showParams();
            showReadout();
            return ctx.loadLeaflet().then(function (leaflet) {
                L = leaflet;
                showPane(0);
                if (tiles[1] || maps[1]) showPane(1);
                if (maps[1]) maps[1].invalidateSize();
                recolour();
            });
        }

        function choose(rel) {
            frame = rel;
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
                if (!all.some(inMosaic) || !listFrames(all, list).length) list = "";
                var paths = shown().map(function (f) { return f.path; });
                if (!paths.length) return status("The dataset has no thermal frames to show.", "text-muted");
                var wanted = asked.get("frame");
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
                             palettes: function () { return meta.palettes || []; }, recolour: recolour, restyle: recolour,
                             // A palette is the user's, everywhere (DJI's keys carry the viewer's prefix)
                             onPalette: function (key) {
                                 core.savePalette(fetchFn, page.getAttribute("data-api"), csrf, key.replace(/^dji_/, "")).catch(function () {});
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
            if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !frame || e.altKey || e.ctrlKey || e.metaKey ||
                /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || "")) return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        });

        return load();
    }

    var api = {CHANGES: CHANGES, listFrames: listFrames, frameTag: frameTag, changesQuery: changesQuery, frameApiUrl: frameApiUrl,
               listHtml: listHtml, changeStarts: changeStarts, readChanges: readChanges, changesTyped: changesTyped,
               newWorksetUrl: newWorksetUrl, paramsHtml: paramsHtml, infoHtml: infoHtml, valueAt: valueAt, readoutHtml: readoutHtml,
               downloadHtml: downloadHtml, canvasOverlay: canvasOverlay, timeText: timeText, init: init};
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
