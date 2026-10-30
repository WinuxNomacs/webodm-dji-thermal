// A conversion's mosaics on a map (viewer.html), over WebODM's base layers: a tab per mosaic (as converted, harmonized,
// and the as-converted mosaic's source frames, over its temperatures, and view angles), its palette and range changed live through the tile
// URL with its colour scale, the values under the cursor, and what dji-thermal-cli reports about the mosaic. Leaflet is
// WebODM's own, from the plugin's build (thermal/Leaflet.js).
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var HOVER_MS = 120;         // the readout asks for the point the cursor rests on, not every point it crosses
    var TAB_LABELS = {as_converted: "Mosaic", harmonized: "Harmonized", source_frame: "Source frame",
                      view_angle: "View angle"};
    var TAB_HINTS = {
        as_converted: "Each pixel is one frame's own temperature, as the frames were converted.",
        harmonized: "Normalized: one ambient and reflected temperature for every frame, and each frame's offset against " +
            "its neighbours removed (camera drift between recalibrations).",
        source_frame: "Where each frame was placed: the mosaic, with a line where one frame meets the next (each pixel " +
            "comes from the frame that saw it closest to straight down).",
        view_angle: "How far from straight down each pixel was seen, in degrees."
    };

    function tabLabel(tab) { return TAB_LABELS[tab] || tab; }

    // The source frames are shown over the as-converted temperatures
    function isTemperature(tab) { return tab === "as_converted" || tab === "harmonized" || tab === "source_frame"; }

    // The tabs that share a palette and range: the temperature mosaics show the same scale, to compare them
    function styleGroup(tab) { return isTemperature(tab) ? "temperature" : tab; }

    // A temperature in the mosaic's unit as the user types it, and back
    function shownTemp(x, unit) { return Math.round(core.convertTemp(x, unit) * 100) / 100; }
    function typedTemp(x, unit) { return Math.round(core.convertTemp(x, core.userUnit(), unit) * 10000) / 10000; }

    // A tab's starting range: its 2nd to 98th percentile, rounded outwards to a tenth; for a temperature, rounded in
    // the user's unit and kept in the mosaic's
    function defaultRange(tab, unit) {
        var p = tab && tab.stats && tab.stats.percentiles;
        if (!p || p.length < 2) return [0, 1];
        var temperature = isTemperature(tab.tab);
        var shown = temperature ? function (x) { return core.convertTemp(x, unit); } : Number;
        var kept = temperature ? function (x) { return typedTemp(x, unit); } : Number;
        var lo = Math.floor(shown(p[0]) * 10) / 10, hi = Math.ceil(shown(p[1]) * 10) / 10;
        return hi > lo ? [kept(lo), kept(hi)] : [kept(lo), kept(lo + 1)];
    }

    // The range typed (a temperature's in the user's unit), in the mosaic's: {range} or {error}
    function parseRange(minText, maxText, tab, unit) {
        var lo = parseFloat(minText), hi = parseFloat(maxText);
        if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
        if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
        return {range: isTemperature(tab) ? [typedTemp(lo, unit), typedTemp(hi, unit)] : [lo, hi]};
    }

    // A tab's range as shown: a temperature's in the user's unit
    function shownRange(tab, range, unit) {
        return isTemperature(tab) ? range.map(function (x) { return core.convertTemp(x, unit); }) : range.slice();
    }

    function colorCss(encoded) {
        var c = encoded >>> 0;
        return "rgb(" + ((c >>> 24) & 255) + "," + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + ")";
    }

    // A palette as a CSS gradient, from 16 of its colours
    function gradientCss(encoded) {
        if (!encoded || !encoded.length) return "";
        var stops = [];
        for (var i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
        return "linear-gradient(to right, " + stops.join(", ") + ")";
    }

    // Round values to mark on a colour scale from lo to hi (as shown), about count of them: each with its label and
    // where it sits on the scale (0 to 1)
    function scaleTicks(lo, hi, count) {
        if (!(hi > lo)) return [];
        var rough = (hi - lo) / (count || 5), mag = Math.pow(10, Math.floor(Math.log10(rough)));
        // The round step nearest the rough one (as a ratio)
        var m = [1, 2, 2.5, 5, 10].reduce(function (best, x) {
            return Math.abs(Math.log(x * mag / rough)) < Math.abs(Math.log(best * mag / rough)) ? x : best;
        }), step = m * mag;
        var digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0));
        var out = [];
        for (var i = Math.ceil(lo / step - 1e-9); i <= Math.floor(hi / step + 1e-9); i++) {
            var value = i * step || 0;   // not -0
            out.push({value: value, label: value.toFixed(digits).replace(/^-(0\.?0*)$/, "$1"), at: (value - lo) / (hi - lo)});
        }
        return out;
    }

    // A colour scale: the palette's gradient over the range shown ([lo, hi]), marked with round values
    function legendHtml(encoded, shown) {
        if (!encoded) return "";
        var ticks = scaleTicks(shown[0], shown[1], 5).map(function (t) {
            var end = t.at < 0.1 ? " ta-tick-start" : t.at > 0.9 ? " ta-tick-end" : "";
            return '<span class="ta-tick' + end + '" style="left: ' + (t.at * 100).toFixed(1) + '%;">' + esc(t.label) + "</span>";
        }).join("");
        return '<div class="ta-viewer-legend" style="background: ' + gradientCss(encoded) + ';"></div>' +
            '<div class="ta-legend-ticks">' + ticks + "</div>";
    }

    // When frames were taken, from their recorded times ("YYYY:MM:DD HH:MM:SS"): "2026-09-18 08:44–09:02", or the
    // first and last in full when they are on different days; "" when none is known
    function takenText(times) {
        var t = (times || []).map(function (s) {
            var m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/.exec(s || "");
            return m ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] : null;
        }).filter(Boolean).sort();
        if (!t.length) return "";
        var first = t[0], last = t[t.length - 1];
        if (first === last) return first;
        return first.slice(0, 10) === last.slice(0, 10) ? first + "–" + last.slice(11) : first + " – " + last;
    }

    // A tab's tile URL template (base: the conversion's API URL) with its palette and range; the build time makes a
    // mosaic built again a new URL, so the browser keeps tiles no longer than the mosaic they show
    function tileUrl(base, tab, style, builtAt) {
        var query = ["v=" + encodeURIComponent(builtAt || ""), "color_map=" + encodeURIComponent(style.palette),
                     "rescale=" + style.range[0] + "," + style.range[1]];
        return base + "/mosaics/" + tab + "/tiles/{z}/{x}/{y}.png?" + query.join("&");
    }

    function tabsHtml(tabs, current) {
        return tabs.map(function (t) {
            return '<li class="' + (t.tab === current ? "active" : "") + '"><a href="#' + esc(t.tab) + '" data-tab="' +
                esc(t.tab) + '">' + esc(tabLabel(t.tab)) + "</a></li>";
        }).join("");
    }

    // The tab's palette, colour scale and range
    function controlsHtml(tab, style, palettes, unit) {
        var out = '<p class="ta-viewer-hint">' + esc(TAB_HINTS[tab.tab] || "") + "</p>";
        var temperature = isTemperature(tab.tab);
        var symbol = temperature ? core.unitSymbol(core.userUnit()) : "°";
        var shown = function (x) { return temperature ? shownTemp(x, unit) : x; };
        var current = palettes.filter(function (p) { return p.key === style.palette; })[0];
        out += '<div class="form-group"><label for="ta-viewer-palette">Palette</label><select class="form-control input-sm" id="ta-viewer-palette">' +
            palettes.map(function (p) {
                return '<option value="' + esc(p.key) + '"' + (p.key === style.palette ? " selected" : "") + ">" + esc(p.label) + "</option>";
            }).join("") + "</select></div>";
        out += '<div class="ta-scale" id="ta-viewer-scale">' + legendHtml(current && current.color_map, shownRange(tab.tab, style.range, unit)) + "</div>";
        out += '<div class="ta-viewer-range">' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-min" value="' + shown(style.range[0]) + '" title="Minimum">' +
            "<span>to</span>" +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-max" value="' + shown(style.range[1]) + '" title="Maximum">' +
            "<span>" + esc(symbol) + "</span>" +
            '<button type="button" class="btn btn-default btn-sm" id="ta-viewer-auto" title="The 2nd to 98th percentile of this mosaic">Auto</button></div>';
        out += '<div class="ta-viewer-range-error text-danger" id="ta-viewer-range-error"></div>';
        var s = tab.stats;
        if (s) out += '<div class="ta-message">This mosaic: ' +
            core.formatNumber(temperature ? core.convertTemp(s.min, unit) : s.min, 1) + " to " +
            core.formatNumber(temperature ? core.convertTemp(s.max, unit) : s.max, 1, " " + symbol) + "</div>";
        return out;
    }

    // The values under the cursor
    function readoutHtml(res, unit) {
        if (!res || !res.valid) return '<span class="ta-message">' + (res && res.reason === "outside_raster" ?
            "Outside the mosaic." : "No data here.") + "</span>";
        var rows = [["Temperature", res.temperature === null || res.temperature === undefined ? "no data" : core.formatTemp(res.temperature, unit)]];
        if (res.frame !== null && res.frame !== undefined) rows.push(["Frame", res.frame]);
        if (res.view_angle !== null && res.view_angle !== undefined) rows.push(["View angle", core.formatNumber(res.view_angle, 1, "°")]);
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }

    // What dji-thermal-cli reports about a mosaic, then its files to download (base: the conversion's API URL)
    function reportHtml(kind, kindName, base) {
        if (!kind) return "";
        var r = kind.report || {}, rows = [];
        rows.push(["Frames", kind.frames + " placed" + (kind.oblique ? ", " + kind.oblique + " oblique left out" : "") +
            (kind.unusable ? ", " + kind.unusable + " unusable" : "")]);
        rows.push(["Size", kind.width + " × " + kind.height + " px at " + core.formatNumber(kind.gsd_m * 100, 1, " cm")]);
        var seams = r.radiometric_seams;
        if (seams && seams.pixels) rows.push(["Seams", "median " + core.formatDelta(seams.median_abs_c, "C") + ", 95% under " +
            core.formatDelta(seams.p95_abs_c, "C")]);
        var mis = r.misalignment;
        if (mis && mis.pairs) rows.push(["Misalignment", "median " + core.formatNumber(mis.median_m * 100, 1, " cm") + ", 90% under " +
            core.formatNumber(mis.p90_m * 100, 1, " cm") + " (" + mis.pairs + " overlapping pairs)"]);
        var off = r.frame_offsets;
        if (off && off.offset_c && off.offset_c.min !== undefined) {
            rows.push(["Frame offsets", core.formatNumber(core.convertDelta(off.offset_c.min, "C"), 2) + " to " + core.formatDelta(off.offset_c.max, "C") +
                (off.normalized ? ", removed" : "")]);
        }
        var h = r.heights;
        if (h && h.range_m) {
            rows.push(["Heights", core.formatNumber(h.range_m[0], 1) + " to " + core.formatNumber(h.range_m[1], 1, " m") +
                " above the ground plane" + (h.cells ? ", measured in " + h.observed_cells + " of " + h.cells + " cells" : "")]);
        } else if (h && h.method === "plane") {
            rows.push(["Heights", "a ground plane" + (h.reason ? " (" + h.reason + ")" : "")]);
        }
        if (kind.normalization) rows.push(["Normalized to", "ambient " + core.formatTemp(kind.normalization[0], "C", 1) +
            ", reflected " + core.formatTemp(kind.normalization[1], "C", 1)]);
        var files = (kind.files || []).map(function (f) {
            return '<li><a href="' + esc(base + "/download?mosaic=" + encodeURIComponent(kindName + "/" + f)) + '">' +
                '<i class="fa fa-download"></i> ' + esc(f) + "</a></li>";
        }).join("");
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (row) {
            return "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + (files ? '<ul class="ta-viewer-files">' + files + "</ul>" : "");
    }

    // The status line above the map: the mosaics being built, failed, canceled or not built
    function statusHtml(v) {
        if (v.status === "converting") return {text: "The images are being converted: the mosaics are built next, if asked for.", cls: "text-muted"};
        if (v.mosaic_status === "building") {
            var pct = Math.round((v.mosaic_progress || 0) * 100);
            return {text: '<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' + Math.max(pct, 3) +
                '%;"></div></div> ' + esc(core.mosaicLabel({stage: v.mosaic_stage})), cls: ""};
        }
        if (v.mosaic_status === "failed") return {text: '<i class="fa fa-exclamation-triangle"></i> The mosaics failed: ' + esc(v.mosaic_error), cls: "text-danger"};
        if (v.mosaic_status === "canceled") return {text: "Building the mosaics was canceled.", cls: "text-muted"};
        if (v.status !== "ready") return {text: "The images were not converted: there is nothing to make mosaics of.", cls: "text-muted"};
        if (v.mosaic_status !== "ready") return {text: "This workset has no mosaics.", cls: "text-muted"};
        return {text: "", cls: ""};
    }

    // The map's base layers from WebODM's (as its own map makes them), the default one shown: {layers, shown}
    function baseLayers(L, basemaps) {
        var layers = {}, shown = null;
        (basemaps || []).forEach(function (bm) {
            var opts = {attribution: bm.attribution || bm.label, maxZoom: (bm.maxzoom || 21) + 99, maxNativeZoom: bm.maxzoom || 21,
                        minZoom: bm.minzoom || 0, subdomains: bm.subdomains || []};
            var layer = bm.type === "wms" ? L.tileLayer.wms(bm.url, Object.assign(opts, {layers: bm.layers || "0",
                styles: bm.styles || "default", format: bm.format || "image/png", transparent: (bm.format || "image/png") === "image/png"})) :
                L.tileLayer(bm.url, opts);
            layers[bm.label] = layer;
            if (bm["default"] || !shown) shown = shown && !bm["default"] ? shown : layer;
        });
        layers.None = L.layerGroup();
        return {layers: layers, shown: shown || layers.None};
    }

    // ctx: {doc, fetchFn, loadLeaflet (resolves to Leaflet), basemaps (WebODM's)}
    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn;
        var page = doc.getElementById("ta-viewer");
        if (!page) return;
        var $ = function (i) { return doc.getElementById(i); };
        var base = page.getAttribute("data-api") + "datasets/" + page.getAttribute("data-dataset") + "/conversions/" +
            page.getAttribute("data-id");
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        var v = null, tab = null, styles = {}, map = null, L = null, layer = null, timer = null, hover = null, fitted = false;
        var mapReady = null;

        function status(s) {
            $("ta-viewer-status").className = "ta-status" + (s.cls ? " " + s.cls : "");
            $("ta-viewer-status").innerHTML = s.text;
        }

        function current() { return (v.tabs || []).filter(function (t) { return t.tab === tab; })[0]; }

        // The tab's palette and range, those of its group (the temperature tabs share theirs)
        function style() {
            var g = styleGroup(tab);
            if (!styles[g]) styles[g] = {palette: isTemperature(tab) ? v.default_palette : "inferno", range: defaultRange(current(), v.unit)};
            return styles[g];
        }

        function ensureMap() {
            if (mapReady) return mapReady;
            mapReady = ctx.loadLeaflet().then(function (leaflet) {
                L = leaflet;
                map = L.map($("ta-viewer-map"), {maxZoom: 26});
                var bases = baseLayers(L, ctx.basemaps);
                bases.shown.addTo(map);
                L.control.layers(bases.layers, {}, {position: "topright"}).addTo(map);
                L.control.scale({imperial: false}).addTo(map);
                map.on("mousemove", function (e) {
                    if (hover) root.clearTimeout(hover);
                    hover = root.setTimeout(function () { readout(e.latlng); }, HOVER_MS);
                });
                map.on("mouseout", function () { if (hover) root.clearTimeout(hover); });
                return map;
            });
            return mapReady;
        }

        function readout(latlng) {
            var askedTab = tab;
            return fetchFn(base + "/mosaics/" + tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat, {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
                    if (askedTab !== tab) return;
                    $("ta-viewer-readout").innerHTML = r.ok ? readoutHtml(r.data, v.unit) : '<span class="text-danger">' +
                        esc(core.errorText(r.data, "Could not read the mosaic here.")) + "</span>";
                });
        }

        function showLayer() {
            var t = current();
            var url = tileUrl(base, tab, style(), v.built_at);
            if (layer) map.removeLayer(layer);
            layer = L.tileLayer(url, {maxZoom: 26, maxNativeZoom: (t.maxzoom || 20) + 1, minZoom: 0,
                                      bounds: t.bounds ? [[t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]]] : undefined});
            layer.addTo(map);
            if (!fitted && t.bounds) {
                map.fitBounds([[t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]]]);
                fitted = true;
            }
        }

        function renderTab() {
            var t = current();
            $("ta-viewer-tabs").innerHTML = tabsHtml(v.tabs, tab);
            $("ta-viewer-controls").innerHTML = controlsHtml(t, style(), v.palettes || [], v.unit);
            $("ta-viewer-report").innerHTML = reportHtml(v.kinds[t.kind], t.kind, base);
            $("ta-viewer-readout").innerHTML = '<span class="ta-message">Move the cursor over the mosaic.</span>';
            return ensureMap().then(showLayer);
        }

        // Only the scale and the tiles, as the palette or range changes
        function restyle() {
            var p = (v.palettes || []).filter(function (x) { return x.key === style().palette; })[0];
            $("ta-viewer-scale").innerHTML = legendHtml(p && p.color_map, shownRange(tab, style().range, v.unit));
            if (layer) layer.setUrl(tileUrl(base, tab, style(), v.built_at));
        }

        function render(data) {
            var builtBefore = v && v.built_at;
            v = data;
            var taken = takenText(v.flown);
            $("ta-viewer-subtitle").innerHTML = esc(v.dataset_name) + (v.description ? " · " + esc(v.description) : "") +
                (taken ? " · flown " + esc(taken) : "") + (v.stripped ? " · <span title=\"The downloads have no location: the map reads a located copy\">location stripped</span>" : "");
            status(statusHtml(v));
            var busy = v.status === "converting" || v.mosaic_status === "building";
            $("ta-viewer-build").hidden = !v.can_change || busy || v.status !== "ready";
            $("ta-viewer-build").innerHTML = '<i class="fa fa-th"></i> ' + (v.mosaic_status === "ready" ? "Build again" : "Build mosaics");
            $("ta-viewer-cancel").hidden = !v.can_change || !busy;
            var ready = v.mosaic_status === "ready" && (v.tabs || []).length;
            $("ta-viewer-main").hidden = !ready;
            if (timer) root.clearTimeout(timer);
            timer = busy ? root.setTimeout(load, POLL_MS) : null;
            if (!ready) return Promise.resolve();
            if (builtBefore !== v.built_at) styles = {};
            if (!tab || !current()) tab = v.tabs[0].tab;
            return renderTab();
        }

        function load() {
            return fetchFn(base + "/mosaics", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return status({text: esc(core.errorText(r.data, "Could not load the mosaics.")), cls: "text-danger"});
                return render(r.data);
            }, function () { status({text: "Could not load the mosaics.", cls: "text-danger"}); });
        }

        function post(url, failure) {
            return fetchFn(url, {method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": csrf}})
                .then(core.readJson).then(function (r) {
                    if (!r.ok) return status({text: esc(core.errorText(r.data, failure)), cls: "text-danger"});
                    return load();
                });
        }

        $("ta-viewer-tabs").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-tab]") : null;
            if (!a) return;
            e.preventDefault();
            tab = a.getAttribute("data-tab");
            renderTab();
        });

        $("ta-viewer-controls").addEventListener("change", function (e) {
            if (e.target.id === "ta-viewer-palette") {
                style().palette = e.target.value;
                return restyle();
            }
            if (e.target.id === "ta-viewer-min" || e.target.id === "ta-viewer-max") {
                var r = parseRange($("ta-viewer-min").value, $("ta-viewer-max").value, tab, v.unit);
                $("ta-viewer-range-error").textContent = r.error || "";
                if (r.error) return;
                style().range = r.range;
                restyle();
            }
        });

        $("ta-viewer-controls").addEventListener("click", function (e) {
            if (e.target.id !== "ta-viewer-auto") return;
            style().range = defaultRange(current(), v.unit);
            $("ta-viewer-controls").innerHTML = controlsHtml(current(), style(), v.palettes || [], v.unit);
            restyle();
        });

        $("ta-viewer-build").addEventListener("click", function () { post(base + "/mosaics", "Could not build the mosaics."); });
        $("ta-viewer-cancel").addEventListener("click", function () { post(base + "/cancel", "Could not cancel."); });

        return load();
    }

    // Leaflet from the plugin's build, through WebODM's module loader. Its format is given: the loader guesses another
    // from Leaflet's own module wrapper inside the build, and then finds no define
    function loadLeaflet(publicUrl) {
        var name = publicUrl.replace(/^\/plugins\//, "") + "build/Leaflet.js", meta = {};
        meta[name] = {format: "amd"};
        root.PluginsAPI.SystemJS.config({meta: meta});
        return root.PluginsAPI.SystemJS.import(name).then(function (m) { return m["default"] || m; });
    }

    var api = {tabLabel: tabLabel, styleGroup: styleGroup, defaultRange: defaultRange, parseRange: parseRange, shownRange: shownRange,
               gradientCss: gradientCss, scaleTicks: scaleTicks, legendHtml: legendHtml, takenText: takenText, tileUrl: tileUrl,
               tabsHtml: tabsHtml, controlsHtml: controlsHtml, readoutHtml: readoutHtml, reportHtml: reportHtml, statusHtml: statusHtml,
               baseLayers: baseLayers, loadLeaflet: loadLeaflet, init: init};
    root.ThermalAnalyzerViewer = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch && window.PluginsAPI) {
    (function () {
        var page = document.getElementById("ta-viewer");
        if (!page) return;
        var basemaps = document.getElementById("ta-basemaps");
        window.ThermalAnalyzerViewer.init({
            doc: document, fetchFn: window.fetch.bind(window),
            loadLeaflet: function () { return window.ThermalAnalyzerViewer.loadLeaflet(page.getAttribute("data-public")); },
            basemaps: basemaps ? JSON.parse(basemaps.textContent) : []
        });
    })();
}
