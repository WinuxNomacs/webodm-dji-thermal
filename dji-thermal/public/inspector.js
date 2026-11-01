// The Thermal Inspector: a control on WebODM's 2D map for thermal orthophotos (a single lwir band). The temperature
// under the cursor, points pinned with theirs and regions drawn with their statistics (both kept in the browser, for
// the same tasks; regions drawn by regions.js), isotherms (the temperatures above, below or between limits painted
// over the thermal layers, also kept in the browser), the thermal layer's palette, which is the user's everywhere (the
// Analyzer's preference), and a legend of its palette and range (scale.js). Temperatures come from the plugin's API
// (inspector_api.py) in °C and are shown in WebODM's units (°F when imperial). The project's workset mosaics can be
// laid on the map too (the Analyzer's tiles, above WebODM's layers, swiped against them with WebODM's own split
// control): a thermal layer like the orthophotos, read through the Analyzer's API. main.js adds it through
// PluginsAPI.Map.willAddControls, with WebODM's own Leaflet, to every map; its button shows when the map has a thermal
// orthophoto or the project has mosaics.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var HOVER_MS = 80;              // the readout asks for the point the cursor rests on, not every point it crosses
    var DRAWN_CLICK_MS = 500;       // the click Leaflet fires after a rectangle or circle is dragged is part of it
    var PINS_PREFIX = "dji-thermal-inspector:pins:";
    var REGIONS_PREFIX = "dji-thermal-inspector:regions:";
    var ISOTHERM_PREFIX = "dji-thermal-inspector:isotherm:";
    var LEGEND_KEY = "dji-thermal-inspector:legend";
    var ISOTHERM_MODES = {off: "Off", above: "Above", below: "Below", between: "Between"};
    var ISOTHERM_COLORS = {red: "e53935", orange: "fb8c00", yellow: "fdd835", green: "43a047", blue: "1e88e5", magenta: "d81b60"};
    var SHAPES = {rectangle: "far fa-square", circle: "far fa-circle", polygon: "fa fa-draw-polygon"};
    var SHAPE_NAMES = {rectangle: "Rectangle", circle: "Circle", polygon: "Polygon"};
    var SQ_FT_PER_SQ_M = 10.7639104;
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions.js") : null);
    var Scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale.js") : null);
    var META = root.Symbol ? root.Symbol["for"]("meta") : "meta";      // where WebODM's map keeps a layer's metadata
    // A thermal layer's tiles: WebODM's, or the plugin's in one of DJI's palettes
    var TILE_URL = /\/api\/(?:plugins\/dji-thermal\/)?projects\/(\d+)\/tasks\/([^/]+)\/(?:orthophoto|inspector)\/tiles\//;
    var WEBODM_TILES = /\/api\/projects\/(\d+\/tasks\/[^/]+)\/orthophoto\/tiles\//;
    var PLUGIN_TILES = /\/api\/plugins\/dji-thermal\/projects\/(\d+\/tasks\/[^/]+)\/inspector\/tiles\//;
    var MOSAIC_PARAM = "dt-mosaic";     // a link's ?dt-mosaic=<dataset>/<workset>[/<tab>]: laid on the map, the panel open
    var MOSAIC_Z = 1000;                // above WebODM's layers (its z-indexes are below 100)
    var MOSAIC_TABS = {as_converted: "Mosaic", harmonized: "Harmonized", source_frame: "Source frame"};
    var DJI_PREFIX = "dji_";            // a DJI palette's key among a mosaic's palettes
    var REASONS = {excluded: "Outside the task's crop", outside_raster: "Outside the orthophoto", nodata: "No data here",
                   too_few_points: "A polygon needs three corners", self_intersecting: "The polygon's edges cross",
                   no_area: "The polygon has no area"};

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i] || {};
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
    }

    function escapeHtml(t) {
        return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, function (c) {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }

    // WebODM's units (its unit_system, kept in the browser): one setting with the Analyzer's
    function userUnit() {
        var system;
        try { system = root.localStorage && root.localStorage.getItem("unit_system"); } catch (e) { system = null; }
        return system === "imperial" ? "F" : "C";
    }
    function shownTemp(celsius, unit) { return (unit || userUnit()) === "F" ? celsius * 1.8 + 32 : celsius; }
    function formatTemp(celsius, unit) {
        if (celsius === null || celsius === undefined || isNaN(celsius)) return "";
        unit = unit || userUnit();
        return shownTemp(Number(celsius), unit).toFixed(2) + " °" + unit;
    }
    // A difference of temperatures (a standard deviation)
    function formatDelta(celsius, unit) {
        unit = unit || userUnit();
        return (unit === "F" ? celsius * 1.8 : celsius).toFixed(2) + " °" + unit;
    }
    // A temperature typed in the user's unit, in °C (to a millionth: no 30.999999999999996 in a tile URL)
    function typedTemp(value, unit) { return Math.round(((unit || userUnit()) === "F" ? (value - 32) / 1.8 : value) * 1e6) / 1e6; }
    function roundShown(celsius, unit) { return Math.round(shownTemp(celsius, unit) * 10) / 10; }
    function formatArea(m2, unit) {
        var imperial = (unit || userUnit()) === "F";
        var v = imperial ? m2 * SQ_FT_PER_SQ_M : m2;
        return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + (imperial ? " ft²" : " m²");
    }

    // The task a layer of WebODM's map shows, when it is a thermal orthophoto: {project, task, layer}; a workset mosaic
    // laid on the map: {project, mosaic (laidMosaic's), layer}; else null
    function thermalLayer(layer) {
        if (layer && layer.__dtMosaic) return {project: layer.__dtMosaic.project, mosaic: layer.__dtMosaic, layer: layer};
        var meta = layer && layer[META];
        var url = layer && layer._url;
        if (!meta || !meta.raster || typeof url !== "string") return null;
        var m = TILE_URL.exec(url);
        var bands = (meta.task && meta.task.orthophoto_bands) || [];
        if (!m || !bands[0] || String(bands[0].description || "").toLowerCase() !== "lwir") return null;
        return {project: m[1], task: m[2], layer: layer};
    }

    // The thermal orthophotos on the map, shown (or hidden in WebODM's layer panel too, with hidden), topmost last (as
    // WebODM finds the layer a click is on)
    function thermalLayers(map, hidden) {
        var found = [];
        Object.keys(map._layers || {}).forEach(function (k) {
            var t = thermalLayer(map._layers[k]);
            if (t && map.hasLayer(t.layer) && (hidden || !(t.layer.isHidden && t.layer.isHidden()))) found.push(t);
        });
        return found.sort(function (a, b) { return ((a.layer.options || {}).zIndex || 0) - ((b.layer.options || {}).zIndex || 0); });
    }

    function thermalLayerAt(map, latlng) {
        var at = thermalLayers(map).filter(function (t) {
            var bounds = t.layer.options && t.layer.options.bounds;
            return !bounds || bounds.contains(latlng);
        });
        return at.length ? at[at.length - 1] : null;
    }

    // A thermal layer's API: the Inspector's of its task, or the Analyzer's of its mosaic tab
    function inspectorUrl(t, what) {
        if (t.mosaic) return mosaicBase(t.mosaic) + "/mosaics/" + t.mosaic.tab + "/" + what;
        return API + "projects/" + t.project + "/tasks/" + t.task + "/inspector/" + what;
    }
    function pointUrl(t, latlng) {
        return inspectorUrl(t, "point") + "?lon=" + Number(latlng.lng).toFixed(8) + "&lat=" + Number(latlng.lat).toFixed(8);
    }
    // The colours of a palette for the legend: the task's, or for a mosaic the project's
    function paletteUrl(t, name) {
        return (t.mosaic ? API + "projects/" + t.project + "/inspector/palette" : inspectorUrl(t, "palette")) + "?name=" + encodeURIComponent(name);
    }

    // -- workset mosaics ---------------------------------------------------------------------------------------------

    // A temperature in a mosaic's unit (C, F or K) in °C
    function toCelsius(v, unit) { return unit === "F" ? (v - 32) / 1.8 : unit === "K" ? v - 273.15 : v; }

    // The project a map shows: its tasks' (args.tiles), else its URL's (/map/project/<id>/, a project without tasks);
    // none on WebODM's public maps, which have no workset mosaics
    function projectOf(tiles, path) {
        if (/^\/public\//.test(path || "")) return null;
        var found = (tiles || []).map(function (t) { return t.meta && t.meta.task && t.meta.task.project; }).filter(Boolean)[0];
        if (found) return String(found);
        var m = /^\/map\/project\/(\d+)\//.exec(path || "");
        return m ? m[1] : null;
    }

    // The mosaic a link asks for: {dataset, workset, tab} or null
    function linkedMosaic(search) {
        var m = new RegExp("[?&]" + MOSAIC_PARAM + "=([^&]*)").exec(search || "");
        var parts = m ? decodeURIComponent(m[1]).split("/") : [];
        if (parts.length < 2 || !parts[0] || !parts[1]) return null;
        return {dataset: parts[0], workset: parts[1], tab: MOSAIC_TABS[parts[2]] ? parts[2] : null};
    }

    function mosaicId(m) { return m.dataset.id + "/" + m.workset.id; }
    function mosaicBase(m) { return API + "datasets/" + m.dataset + "/conversions/" + m.workset; }

    // A mosaic's palette key for the Inspector's palette (DJI's by name, or one of WebODM's colour maps), when the
    // workset has it, else its own default; and the palette's name back, for the legend
    function paletteKey(m, palette, display) {
        var keys = m.palettes || [];
        var dji = ((display && display.palettes) || []).indexOf(palette) !== -1;
        if (dji && keys.indexOf(DJI_PREFIX + palette) !== -1) return DJI_PREFIX + palette;
        if (!dji && palette && keys.indexOf(palette) !== -1) return palette;
        return m.default_palette;
    }
    function keyPalette(key) { return String(key || "").indexOf(DJI_PREFIX) === 0 ? key.slice(DJI_PREFIX.length) : key; }

    // A tab's range in the mosaic's unit: its 2nd to 98th percentile rounded outwards to a tenth (as the Analyzer's
    // viewer starts), [0, 1] without them
    function mosaicRange(tab) {
        var p = tab && tab.stats && tab.stats.percentiles;
        if (!p || p.length < 2) return [0, 1];
        var lo = Math.floor(p[0] * 10) / 10, hi = Math.ceil(p[1] * 10) / 10;
        return hi > lo ? [lo, hi] : [lo, lo + 1];
    }

    // What a mosaic laid on the map draws: {project, dataset, workset, tab, unit, built_at, key, range (its unit), name}
    function laidMosaic(project, m, tab, palette, display) {
        var t = (m.tabs || []).filter(function (x) { return x.tab === tab; })[0] || m.tabs[0];
        return {project: String(project), dataset: m.dataset.id, workset: m.workset.id, tab: t.tab, unit: m.unit || "C",
                built_at: m.built_at || "", key: paletteKey(m, palette, display), range: mosaicRange(t),
                name: m.dataset.name + " › " + m.workset.name, bounds: t.bounds, maxzoom: t.maxzoom};
    }

    function mosaicTileUrl(info) {
        return mosaicBase(info) + "/mosaics/" + info.tab + "/tiles/{z}/{x}/{y}.png?v=" + encodeURIComponent(info.built_at) +
            "&color_map=" + encodeURIComponent(info.key) + "&rescale=" + info.range[0] + "," + info.range[1];
    }
    function mosaicIsothermUrl(info, iso) {
        if (!validIsotherm(iso)) return "";
        var params = [];
        if (iso.mode !== "below") params.push("low=" + iso.low);
        if (iso.mode !== "above") params.push("high=" + iso.high);
        params.push("color=" + ISOTHERM_COLORS[iso.color]);
        return mosaicBase(info) + "/mosaics/" + info.tab + "/isotherm/{z}/{x}/{y}.png?" + params.join("&");
    }

    // A thermal layer's range (°C) and palette, for the legend and the isotherm's starting limits
    function layerRange(t) {
        if (!t) return null;
        if (t.mosaic) return t.mosaic.range.map(function (v) { return toCelsius(v, t.mosaic.unit); });
        return rangeOf(t.layer._url);
    }
    function layerPalette(t) { return !t ? "" : t.mosaic ? keyPalette(t.mosaic.key) : paletteOf(t.layer._url); }

    // The panel's Workset mosaics: each workset of the project's datasets, with a tickbox laying it on the map; once
    // laid, its tab, opacity, Swipe (WebODM's split control) and Zoom to
    function mosaicsHtml(state) {
        if (!state.mosaics || !state.mosaics.length) return "";
        return '<div class="dt-inspector-section"><strong>Workset mosaics</strong>' + state.mosaics.map(function (m) {
            var id = mosaicId(m), laid = state.laid[id];
            var head = '<label class="dt-inspector-check dt-inspector-mosaic-name"><input type="checkbox" data-act="mosaic-on"' + (laid ? " checked" : "") +
                "> " + escapeHtml(m.dataset.name) + ' <span class="text-muted">›</span> ' + escapeHtml(m.workset.name) + "</label>";
            if (!laid) return '<div class="dt-inspector-mosaic" data-mosaic="' + escapeHtml(id) + '">' + head + "</div>";
            var info = laid.layer.__dtMosaic;
            return '<div class="dt-inspector-mosaic" data-mosaic="' + escapeHtml(id) + '">' + head +
                '<div class="dt-inspector-mosaic-controls"><select class="form-control input-sm" data-act="mosaic-tab" title="Which mosaic">' +
                m.tabs.map(function (t) {
                    return '<option value="' + t.tab + '"' + (t.tab === info.tab ? " selected" : "") + ">" + escapeHtml(MOSAIC_TABS[t.tab] || t.tab) + "</option>";
                }).join("") + "</select>" +
                '<input type="range" min="0" max="100" step="5" value="' + laid.opacity + '" data-act="mosaic-opacity" title="Opacity: ' + laid.opacity + '%">' +
                '<button type="button" class="btn btn-' + (laid.swipe ? "primary" : "default") + ' btn-xs" data-act="mosaic-swipe" title="' +
                (laid.swipe ? "Stop swiping" : "Show it on the right of a divider, WebODM's layers on the left") + '"><i class="fa fa-columns"></i> Swipe</button>' +
                '<a href="javascript:void(0)" data-act="mosaic-zoom" title="Zoom to it"><i class="fa fa-search-plus"></i></a></div></div>';
        }).join("") + "</div>";
    }

    // A tile URL with one parameter set (or removed, with no value), its others kept
    function withParam(url, key, value) {
        var q = url.indexOf("?");
        var base = q === -1 ? url : url.slice(0, q);
        var params = (q === -1 ? "" : url.slice(q + 1)).split("&").filter(function (p) {
            return p && p.split("=")[0] !== key;
        });
        if (value) params.push(key + "=" + encodeURIComponent(value));
        return base + (params.length ? "?" + params.join("&") : "");
    }
    function withColorMap(url, name) { return withParam(url, "color_map", name); }
    function paramOf(url, key) {
        var m = new RegExp("[?&]" + key + "=([^&]*)").exec(url || "");
        return m ? decodeURIComponent(m[1]) : "";
    }
    function colorMapOf(url) { return paramOf(url, "color_map"); }

    // A thermal layer's tile URL in a palette: one of DJI's (display.palettes) drawn by the plugin's tiles, one of
    // WebODM's colour maps by WebODM's; the range, size and crop kept
    function withPalette(url, name, display) {
        if (((display && display.palettes) || []).indexOf(name) !== -1) {
            url = url.replace(WEBODM_TILES, API + "projects/$1/inspector/tiles/");
            return withParam(withParam(url, "color_map", ""), "palette", name);
        }
        url = url.replace(PLUGIN_TILES, "/api/projects/$1/orthophoto/tiles/");
        return withColorMap(withParam(url, "palette", ""), name);
    }
    function paletteOf(url) { return PLUGIN_TILES.test(url || "") ? paramOf(url, "palette") : colorMapOf(url); }
    // The range (°C) a thermal layer is drawn over, [lo, hi], or null
    function rangeOf(url) {
        var p = paramOf(url, "rescale").split(",").map(parseFloat);
        return p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && p[0] < p[1] ? p : null;
    }

    // Isotherms: {mode: off, above, below or between, low and high (°C, as the mode uses them), color (a name of
    // ISOTHERM_COLORS)}, remembered in the browser for the same tasks
    function isothermKey(tasks) { return ISOTHERM_PREFIX + tasks.slice().sort().join(","); }
    function validIsotherm(iso) {
        if (!iso || !ISOTHERM_MODES[iso.mode] || iso.mode === "off" || !ISOTHERM_COLORS[iso.color]) return false;
        var low = iso.mode !== "below", high = iso.mode !== "above";
        if (low && !(typeof iso.low === "number" && isFinite(iso.low))) return false;
        if (high && !(typeof iso.high === "number" && isFinite(iso.high))) return false;
        return !(low && high) || iso.low <= iso.high;
    }
    function loadIsotherm(storage, key) {
        var iso;
        try { iso = JSON.parse(storage.getItem(key) || "null"); } catch (e) { iso = null; }
        return validIsotherm(iso) ? iso : {mode: "off", color: "red"};
    }
    function saveIsotherm(storage, key, iso) {
        try {
            if (validIsotherm(iso)) storage.setItem(key, JSON.stringify(iso));
            else storage.removeItem(key);
        } catch (e) { /* kept for this page only */ }
    }
    // Limits to start a mode from, within the range the layer shows (°C)
    function defaultIsotherm(mode, range, color, unit) {
        var lo = range ? range[0] : 0, hi = range ? range[1] : 40;
        var at = function (f) { return typedTemp(roundShown(lo + (hi - lo) * f, unit), unit); };
        var iso = {mode: mode, color: color || "red"};
        if (mode === "above" || mode === "between") iso.low = at(mode === "above" ? 0.7 : 0.3);
        if (mode === "below" || mode === "between") iso.high = at(mode === "below" ? 0.3 : 0.7);
        return iso;
    }
    // The tiles of a thermal layer's isotherm (its URL either WebODM's or the plugin's), its size and crop kept
    function isothermUrl(url, iso) {
        var m = TILE_URL.exec(url || "");
        if (!m || !validIsotherm(iso)) return "";
        var q = url.indexOf("?"), rest = url.slice(m.index + m[0].length, q === -1 ? url.length : q).replace(/\.(png|jpe?g|webp)$/, "");
        var params = [];
        if (paramOf(url, "size")) params.push("size=" + encodeURIComponent(paramOf(url, "size")));
        if (paramOf(url, "crop") === "1") params.push("crop=1");
        if (iso.mode !== "below") params.push("low=" + iso.low);
        if (iso.mode !== "above") params.push("high=" + iso.high);
        params.push("color=" + ISOTHERM_COLORS[iso.color]);
        return API + "projects/" + m[1] + "/tasks/" + m[2] + "/inspector/isotherm/" + rest + "?" + params.join("&");
    }
    function describeIsotherm(iso, unit) {
        if (!validIsotherm(iso)) return "";
        if (iso.mode === "above") return "Above " + formatTemp(iso.low, unit);
        if (iso.mode === "below") return "Below " + formatTemp(iso.high, unit);
        return "Between " + formatTemp(iso.low, unit) + " and " + formatTemp(iso.high, unit);
    }

    // The legend: the palette's colours (encoded, as the palette API gives them) over the range (°C), marked in the
    // user's unit, with the part an isotherm paints
    function legendHtml(colors, range, label, unit, iso) {
        if (!colors || !colors.length || !range) return "";
        unit = unit || userUnit();
        var lo = shownTemp(range[0], unit), hi = shownTemp(range[1], unit);
        var ticks = Scale.scaleTicks(lo, hi, 4).map(function (t) {
            var end = t.at < 0.1 ? " dt-tick-start" : t.at > 0.9 ? " dt-tick-end" : "";
            return '<span class="dt-tick' + end + '" style="left: ' + (t.at * 100).toFixed(1) + '%;">' + escapeHtml(t.label) + "</span>";
        }).join("");
        var mark = "";
        if (validIsotherm(iso)) {
            var from = iso.mode === "below" ? range[0] : Math.max(iso.low, range[0]);
            var to = iso.mode === "above" ? range[1] : Math.min(iso.high, range[1]);
            if (to > from || (to === from && iso.mode === "between")) {
                mark = '<div class="dt-legend-isotherm" title="' + escapeHtml(describeIsotherm(iso, unit)) + '" style="left: ' +
                    ((from - range[0]) / (range[1] - range[0]) * 100).toFixed(1) + "%; width: " +
                    ((to - from) / (range[1] - range[0]) * 100).toFixed(1) + "%; border-color: #" + ISOTHERM_COLORS[iso.color] + ';"></div>';
            }
        }
        return '<div class="dt-legend-title">' + escapeHtml(label) + ' <span class="text-muted">°' + unit + "</span></div>" +
            '<div class="dt-legend-bar" style="background: ' + Scale.gradientCss(colors) + ';">' + mark + "</div>" +
            '<div class="dt-legend-ticks">' + ticks + "</div>";
    }

    // Pins: {id, label, lat, lng, temperature (°C) or null, reason}, remembered in the browser for the same tasks;
    // regions likewise: {id, label, shape, geometry (GeoJSON, lon/lat), circle ({lat, lng, radius}) for circles,
    // statistics (°C, as the region API gives them) or null, reason, pixel_size, resampled}
    function pinsKey(tasks) { return PINS_PREFIX + tasks.slice().sort().join(","); }
    function regionsKey(tasks) { return REGIONS_PREFIX + tasks.slice().sort().join(","); }
    function loadPins(storage, key) {
        try {
            var v = JSON.parse(storage.getItem(key) || "[]");
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function savePins(storage, key, pins) {
        try {
            if (pins.length) storage.setItem(key, JSON.stringify(pins));
            else storage.removeItem(key);
        } catch (e) { /* kept for this page only */ }
    }

    function csvCell(v) {
        var s = String(v === null || v === undefined ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function pinsCsv(pins, unit) {
        var rows = [["label", "latitude", "longitude", "temperature_" + unit.toLowerCase()]];
        pins.forEach(function (p) {
            rows.push([p.label, p.lat.toFixed(8), p.lng.toFixed(8),
                       p.temperature === null || p.temperature === undefined ? "" : shownTemp(p.temperature, unit).toFixed(3)]);
        });
        return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
    }

    function regionArea(r) {
        return r.statistics && r.pixel_size ? r.statistics.count * r.pixel_size * r.pixel_size : null;
    }

    // One row per region with statistics
    function regionsCsv(regions, unit) {
        var u = unit.toLowerCase();
        var rows = [["label", "shape", "pixels", "area_m2"].concat(["min", "max", "mean", "std", "median", "p2", "p98"].map(function (s) { return s + "_" + u; }))
            .concat(["coldest_latitude", "coldest_longitude", "hottest_latitude", "hottest_longitude"])];
        regions.forEach(function (r) {
            var s = r.statistics;
            if (!s) return;
            var t = function (c) { return c === null || c === undefined ? "" : shownTemp(c, unit).toFixed(3); };
            var p = s.percentiles || {};
            rows.push([r.label, r.shape, s.count, regionArea(r) === null ? "" : regionArea(r).toFixed(3),
                       t(s.min), t(s.max), t(s.mean), (unit === "F" ? s.std * 1.8 : s.std).toFixed(3), t(s.median), t(p["2"]), t(p["98"]),
                       s.min_location[1].toFixed(8), s.min_location[0].toFixed(8), s.max_location[1].toFixed(8), s.max_location[0].toFixed(8)]);
        });
        return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
    }

    // The statistics of a region: a table and its histogram
    function statisticsHtml(r, unit) {
        if (r.loading) return '<div class="text-muted"><i class="fa fa-spinner fa-spin"></i> Reading the region…</div>';
        if (r.error) return '<div class="text-danger">' + escapeHtml(r.error) + "</div>";
        var s = r.statistics;
        if (!s) return '<div class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperatures in this region") + "</div>";
        var p = s.percentiles || {};
        var rows = [["Minimum", formatTemp(s.min, unit)], ["Maximum", formatTemp(s.max, unit)], ["Mean", formatTemp(s.mean, unit)],
                    ["Median", formatTemp(s.median, unit)], ["Std. deviation", formatDelta(s.std, unit)],
                    ["2nd percentile", formatTemp(p["2"], unit)], ["98th percentile", formatTemp(p["98"], unit)],
                    ["Pixels", String(s.count)]];
        if (regionArea(r) !== null) rows.push(["Area", formatArea(regionArea(r), unit)]);
        return '<table class="table table-condensed dt-inspector-stats"><tbody>' + rows.filter(function (row) { return row[1]; }).map(function (row) {
            return "<tr><td>" + escapeHtml(row[0]) + '</td><td class="text-right">' + escapeHtml(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + histogramHtml(s.histogram, unit) +
            (r.resampled ? '<div class="text-muted dt-inspector-hint">A large region: read at a reduced resolution.</div>' : "");
    }

    var HIST_W = 240, HIST_H = 48;
    function histogramHtml(h, unit) {
        if (!h || !h.counts || !h.counts.length) return "";
        var top = Math.max.apply(null, h.counts) || 1, bw = HIST_W / h.counts.length;
        return '<div class="dt-inspector-histogram"><svg viewBox="0 0 ' + HIST_W + " " + HIST_H + '" preserveAspectRatio="none" width="100%" height="' + HIST_H + '">' +
            h.counts.map(function (c, i) {
                var height = c / top * HIST_H;
                return '<rect x="' + (i * bw).toFixed(2) + '" y="' + (HIST_H - height).toFixed(2) + '" width="' + Math.max(bw - 0.5, 0.5).toFixed(2) +
                    '" height="' + height.toFixed(2) + '"><title>' + escapeHtml(formatTemp(h.edges[i], unit) + " – " + formatTemp(h.edges[i + 1], unit) + ": " + c) + "</title></rect>";
            }).join("") + '</svg><div class="dt-inspector-range"><span>' + escapeHtml(formatTemp(h.edges[0], unit)) + "</span><span>" +
            escapeHtml(formatTemp(h.edges[h.edges.length - 1], unit)) + "</span></div></div>";
    }

    function regionsHtml(state, unit) {
        var regions = state.regions;
        if (!regions.length) return '<div class="text-muted dt-inspector-hint">Choose a shape, then draw on the map to read a region\'s temperatures.</div>';
        var shown = regions.filter(function (r) { return r.id === state.shown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + regions.map(function (r) {
            var s = r.statistics;
            return '<tr data-region="' + escapeHtml(r.id) + '"' + (r === shown ? ' class="active"' : "") + '><td><i class="' + SHAPES[r.shape] + '"></i> ' +
                '<a href="javascript:void(0)" data-act="goto" title="Show on the map">' + escapeHtml(r.label) + "</a></td><td>" +
                (s ? escapeHtml(formatTemp(s.mean, unit)) + ' <span class="text-muted">mean</span>' :
                    '<span class="text-muted">' + escapeHtml(r.loading ? "…" : REASONS[r.reason] || "none") + "</span>") +
                '</td><td class="text-right"><a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" +
            (shown ? '<div class="dt-inspector-shown"><strong>' + escapeHtml(shown.label) + "</strong> " +
                '<span class="text-muted">' + escapeHtml(SHAPE_NAMES[shown.shape] || "") + "</span>" + statisticsHtml(shown, unit) + "</div>" : "") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle-regions">' + (state.regionsVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv-regions"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear-regions"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    function readoutHtml(r, unit) {
        if (!r) return '<span class="text-muted">Move the cursor over a thermal layer.</span>';
        if (r.error) return '<span class="text-danger">' + escapeHtml(r.error) + "</span>";
        if (!r.valid) return '<span class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperature here") + "</span>";
        return '<span class="dt-inspector-temp">' + escapeHtml(formatTemp(r.temperature, unit)) + "</span>";
    }

    function pinsHtml(pins, unit, visible) {
        if (!pins.length) return '<div class="text-muted dt-inspector-hint">Choose Pin, then click the map to keep a point\'s temperature.</div>';
        return '<table class="table table-condensed dt-inspector-pins"><tbody>' + pins.map(function (p) {
            return '<tr data-pin="' + escapeHtml(p.id) + '"><td><a href="javascript:void(0)" data-act="goto" title="Show on the map">' +
                escapeHtml(p.label) + "</a></td><td>" +
                (p.temperature === null || p.temperature === undefined ? '<span class="text-muted">' + escapeHtml(REASONS[p.reason] || "none") + "</span>" :
                    escapeHtml(formatTemp(p.temperature, unit))) +
                '</td><td class="text-right"><a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle">' + (visible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    // The palettes to choose from ({palettes: DJI's, colormaps: WebODM's}, as the display API gives them): DJI's, then
    // WebODM's colour maps, as [value, label], as the Analyzer's Preferences list them
    function paletteOptions(display) {
        return ((display && display.palettes) || []).map(function (p) { return [p, "DJI " + p]; })
            .concat(((display && display.colormaps) || []).map(function (c) { return [c, c]; }));
    }
    function paletteNames(display) { return paletteOptions(display).map(function (o) { return o[0]; }); }

    function isothermHtml(iso, unit) {
        var input = function (key, value) {
            return '<input type="number" step="0.1" class="form-control input-sm" data-act="isotherm-' + key + '" value="' +
                (typeof value === "number" ? roundShown(value, unit) : "") + '">';
        };
        var limits = iso.mode === "off" ? "" : '<div class="dt-inspector-isotherm-limits">' +
            (iso.mode !== "below" ? input("low", iso.low) : "") + (iso.mode === "between" ? '<span class="text-muted">to</span>' : "") +
            (iso.mode !== "above" ? input("high", iso.high) : "") + '<span class="text-muted">°' + unit + "</span>" +
            '<select class="form-control input-sm" data-act="isotherm-color" title="Colour">' + Object.keys(ISOTHERM_COLORS).map(function (c) {
                return '<option value="' + c + '"' + (c === iso.color ? " selected" : "") + ">" + c + "</option>";
            }).join("") + "</select></div>";
        return '<div class="dt-inspector-isotherm"><select class="form-control input-sm" data-act="isotherm-mode">' +
            Object.keys(ISOTHERM_MODES).map(function (m) {
                return '<option value="' + m + '"' + (m === iso.mode ? " selected" : "") + ">" + ISOTHERM_MODES[m] + "</option>";
            }).join("") + "</select>" + limits + "</div>";
    }

    function panelHtml(state) {
        var unit = userUnit();
        var options = paletteOptions(state.display);
        var current = state.palette;
        // One of WebODM's other colour maps, chosen in its layer panel
        if (current && options.length && !options.some(function (o) { return o[0] === current; })) options = options.concat([[current, current]]);
        return '<div class="dt-inspector-head"><strong><i class="fa fa-thermometer-half"></i> Thermal Inspector</strong>' +
            '<a href="javascript:void(0)" class="dt-inspector-close" data-act="close" title="Close"><i class="fa fa-times"></i></a></div>' +
            '<div class="btn-group btn-group-xs dt-inspector-modes">' +
            ["hover", "pin", "rectangle", "circle", "polygon"].map(function (m) {
                var label = m === "hover" ? '<i class="fa fa-mouse-pointer"></i> Hover' : m === "pin" ? '<i class="fa fa-map-pin"></i> Pin' :
                    '<i class="' + SHAPES[m] + '"></i>';
                return '<button type="button" class="btn btn-' + (state.mode === m ? "primary" : "default") + '" data-mode="' + m + '"' +
                    (SHAPES[m] ? ' title="Draw a region: ' + SHAPE_NAMES[m].toLowerCase() + '"' : "") + ">" + label + "</button>";
            }).join("") + "</div>" +
            (state.mode === "polygon" ? '<div class="text-muted dt-inspector-hint">Click the corners; double-click or Enter finishes, Esc cancels.</div>' : "") +
            (state.notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.notice) + "</div>" : "") +
            '<div class="dt-inspector-readout">' + readoutHtml(state.readout, unit) + "</div>" +
            (options.length ? '<label class="dt-inspector-label">Palette <select class="form-control input-sm" data-act="palette">' +
                options.map(function (o) {
                    return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === current ? " selected" : "") + ">" + escapeHtml(o[1]) + "</option>";
                }).join("") + "</select></label>" : "") +
            '<label class="dt-inspector-label dt-inspector-check"><input type="checkbox" data-act="legend"' + (state.legendVisible ? " checked" : "") +
            "> Legend on the map</label>" +
            mosaicsHtml(state) +
            '<div class="dt-inspector-section"><strong>Isotherm</strong>' + isothermHtml(state.isotherm, unit) +
            (state.isothermNotice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.isothermNotice) + "</div>" : "") + "</div>" +
            '<div class="dt-inspector-section"><strong>Pinned points</strong>' + pinsHtml(state.pins, unit, state.pinsVisible) + "</div>" +
            '<div class="dt-inspector-section"><strong>Regions</strong>' + regionsHtml(state, unit) + "</div>";
    }

    function csrfToken(doc) {
        var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
        return m ? decodeURIComponent(m[1]) : "";
    }

    function readJson(res) {
        return res.json().then(function (data) { return {ok: res.ok, data: data}; },
                               function () { return {ok: res.ok, data: {}}; });
    }

    // The control on a map: args as WebODM's willAddControls gives them ({map, tiles}); deps for tests ({fetch,
    // storage, doc, pluginsApi, save})
    function create(args, L, deps) {
        deps = deps || {};
        var map = args.map;
        var doc = deps.doc || root.document;
        var fetchFn = deps.fetch || root.fetch.bind(root);
        var storage = deps.storage || root.localStorage;
        var plugins = deps.pluginsApi || root.PluginsAPI;
        var tasks = (args.tiles || []).map(function (t) { return t.meta && t.meta.task && t.meta.task.id; }).filter(Boolean);
        var key = pinsKey(tasks), rkey = regionsKey(tasks), ikey = isothermKey(tasks);
        var regions = loadPins(storage, rkey).filter(function (r) { return r && r.geometry && SHAPES[r.shape]; });
        var state = {open: false, mode: "hover", readout: null, pins: loadPins(storage, key), pinsVisible: true,
                     regions: regions, regionsVisible: true, shown: regions.length ? regions[regions.length - 1].id : null,
                     notice: "", display: null, palette: "", isotherm: loadIsotherm(storage, ikey), isothermNotice: "",
                     legendVisible: legendShown(), mosaics: null, laid: {}};
        var project = projectOf(args.tiles, deps.path !== undefined ? deps.path : root.location && root.location.pathname);
        var search = deps.search !== undefined ? deps.search : root.location && root.location.search;
        var container, panel, cursor, pinLayer, regionLayer, legend, tool = null, timer = null, seq = 0, applying = false, drawnAt = 0;
        var overlays = [], colors = {};     // the isotherm's layer over each thermal layer; each palette's colours

        function render() {
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            panel.innerHTML = panelHtml(state);
            // Within the map, above its bottom controls
            var room = map.getContainer().clientHeight - container.offsetTop - 60;
            if (room > 0) panel.style.maxHeight = Math.max(160, room) + "px";
        }

        function legendShown() {
            try { return storage.getItem(LEGEND_KEY) !== "0"; } catch (e) { return true; }
        }

        // -- isotherms and the legend ------------------------------------------------------------------------------

        // An overlay clipped as its thermal layer is: WebODM's divider clips the one layer on its right (a mosaic
        // swiped, or an orthophoto from WebODM's layer panel), by its container's style
        function mirrorClip(o) {
            var src = o.layer.getContainer && o.layer.getContainer(), dst = o.overlay.getContainer && o.overlay.getContainer();
            if (!src || !dst || !root.MutationObserver) return;
            var copy = function () { dst.style.clip = src.style.clip; };
            o.observer = new root.MutationObserver(copy);
            o.observer.observe(src, {attributes: true, attributeFilter: ["style"]});
            copy();
        }

        // An isotherm layer over each thermal layer on the map, hidden and clipped with it
        function drawIsotherms() {
            var wanted = validIsotherm(state.isotherm) ? thermalLayers(map, true) : [];
            overlays = overlays.filter(function (o) {
                var kept = wanted.some(function (t) { return t.layer === o.layer; });
                if (!kept) {
                    if (o.observer) o.observer.disconnect();
                    map.removeLayer(o.overlay);
                }
                return kept;
            });
            wanted.forEach(function (t) {
                var url = t.mosaic ? mosaicIsothermUrl(t.mosaic, state.isotherm) : isothermUrl(t.layer._url, state.isotherm);
                var o = overlays.filter(function (x) { return x.layer === t.layer; })[0];
                if (!o) {
                    // The thermal layer's tiling as Leaflet set it up (detectRetina already applied)
                    var options = assign({}, t.layer.options, {opacity: 1, detectRetina: false, zIndex: ((t.layer.options || {}).zIndex || 0) + 1});
                    o = {layer: t.layer, overlay: L.tileLayer(url, options)};
                    overlays.push(o);
                    o.overlay.addTo(map);
                    mirrorClip(o);
                } else if (o.overlay._url !== url) o.overlay.setUrl(url);
                var c = o.overlay.getContainer && o.overlay.getContainer();
                if (c) c.style.display = t.layer.isHidden && t.layer.isHidden() ? "none" : "";
            });
        }

        // The legend of the topmost thermal layer shown: its palette (its colours asked for once) and range
        function renderLegend() {
            if (!legend) return;
            var layers = thermalLayers(map), t = layers[layers.length - 1];
            var range = layerRange(t), name = layerPalette(t);
            if (!state.legendVisible || !range || !name) { legend.hidden = true; return; }
            if (colors[name] === undefined) {
                colors[name] = null;
                fetchFn(paletteUrl(t, name), {credentials: "same-origin"}).then(readJson).then(function (r) {
                    colors[name] = r.ok && r.data.color_map ? r.data.color_map : false;
                    renderLegend();
                }, function () { colors[name] = false; });
            }
            if (!colors[name]) { legend.hidden = true; return; }
            var label = ((state.display && state.display.palettes) || []).indexOf(name) !== -1 ? "DJI " + name : name;
            legend.innerHTML = legendHtml(colors[name], range, label, userUnit(), state.isotherm);
            legend.hidden = false;
        }

        function isothermChanged(iso) {
            state.isotherm = iso;
            state.isothermNotice = "";
            saveIsotherm(storage, ikey, iso);
            drawIsotherms();
            renderLegend();
            render();
        }

        // A change in the isotherm's part of the panel: limits typed in the user's unit
        function isothermInput(what, value) {
            var iso = assign({}, state.isotherm), unit = userUnit();
            var layers = thermalLayers(map), t = layers[layers.length - 1];
            if (what === "color") iso.color = value;
            else if (what === "mode") {
                if (value === "off") return isothermChanged({mode: "off", color: iso.color});
                var range = layerRange(t);
                var start = defaultIsotherm(value, range, iso.color, unit);
                iso = assign(start, {low: typeof iso.low === "number" && value !== "below" ? iso.low : start.low,
                                     high: typeof iso.high === "number" && value !== "above" ? iso.high : start.high});
                if (value === "above") delete iso.high;
                if (value === "below") delete iso.low;
                // A lower limit kept, the upper one at least the top of the range
                if (value === "between" && !(iso.low <= iso.high)) iso.high = Math.max(iso.low, range ? typedTemp(roundShown(range[1], unit), unit) : iso.low);
                iso.mode = value;
            } else {
                var typed = parseFloat(value);
                if (!isFinite(typed)) { state.isothermNotice = "Enter a temperature"; return render(); }
                iso[what] = typedTemp(typed, unit);
            }
            if (!validIsotherm(iso)) { state.isothermNotice = "The lower limit must not be above the upper one"; return render(); }
            isothermChanged(iso);
        }

        // A reading changes only the readout, so the panel's buttons stay as they are while used
        function renderReadout() {
            var el = state.open && panel.querySelector(".dt-inspector-readout");
            if (el) el.innerHTML = readoutHtml(state.readout, userUnit());
        }

        function drawPins() {
            pinLayer.clearLayers();
            if (!state.pinsVisible) return;
            state.pins.forEach(function (p) {
                var marker = L.circleMarker([p.lat, p.lng], {radius: 5, color: "#fff", weight: 2, fillColor: "#d9534f", fillOpacity: 1});
                marker.bindTooltip(p.label + (p.temperature === null || p.temperature === undefined ? "" : ": " + formatTemp(p.temperature)),
                                   {permanent: true, direction: "right", className: "dt-inspector-tip"});
                pinLayer.addLayer(marker);
            });
        }

        function pinsChanged() {
            savePins(storage, key, state.pins);
            drawPins();
            render();
        }

        // -- regions -----------------------------------------------------------------------------------------------

        function latLngs(r) { return r.geometry.coordinates[0].map(function (c) { return [c[1], c[0]]; }); }
        function regionBounds(r) { return L.latLngBounds(latLngs(r)); }

        function extremeMarker(r, which) {
            var s = r.statistics, loc = s[which + "_location"], hot = which === "max";
            return L.circleMarker([loc[1], loc[0]], {radius: 4, color: "#fff", weight: 2, fillColor: hot ? "#d9534f" : "#337ab7", fillOpacity: 1})
                .bindTooltip(r.label + (hot ? " hottest: " : " coldest: ") + formatTemp(s[which]), {direction: "top", className: "dt-inspector-tip"});
        }

        function drawRegions() {
            regionLayer.clearLayers();
            if (!state.regionsVisible) return;
            state.regions.forEach(function (r) {
                var style = r.id === state.shown ? Regions.STYLE : {color: Regions.STYLE.color, weight: 1, opacity: 0.8, fillOpacity: 0.05};
                var shape = r.circle ? L.circle([r.circle.lat, r.circle.lng], assign({radius: r.circle.radius, interactive: false}, style)) :
                    L.polygon(latLngs(r), assign({interactive: false}, style));
                shape.bindTooltip(r.label, {permanent: true, direction: "center", className: "dt-inspector-tip"});
                regionLayer.addLayer(shape);
                if (r.statistics) {
                    regionLayer.addLayer(extremeMarker(r, "min"));
                    regionLayer.addLayer(extremeMarker(r, "max"));
                }
            });
        }

        function regionsChanged() {
            savePins(storage, rkey, state.regions.map(function (r) {
                var kept = assign({}, r);
                delete kept.loading;
                delete kept.error;
                return kept;
            }));
            drawRegions();
            render();
        }

        // The statistics of a region, from the thermal orthophoto at its centre
        function measure(r) {
            var t = thermalLayerAt(map, regionBounds(r).getCenter()) || thermalLayers(map)[0];
            if (!t) {
                assign(r, {loading: false, statistics: null, reason: "outside_raster"});
                return Promise.resolve(regionsChanged());
            }
            r.loading = true;
            r.error = null;
            return fetchFn(inspectorUrl(t, "region"), {method: "POST", credentials: "same-origin",
                headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken(doc)},
                body: JSON.stringify({geometry: r.geometry})}).then(readJson).then(function (res) {
                if (!res.ok) return {error: (res.data && (res.data.error || res.data.detail)) || "Could not read the region"};
                return res.data;
            }, function () { return {error: "Could not read the region"}; }).then(function (data) {
                r.loading = false;
                if (data.error) r.error = data.error;
                else assign(r, {statistics: data.statistics || null, reason: data.reason || null, pixel_size: data.pixel_size,
                                resampled: !!data.resampled});
                if (state.regions.indexOf(r) !== -1) regionsChanged();
            });
        }

        function regionDrawn(shape, drawn) {
            drawnAt = Date.now();
            map.removeLayer(drawn.layer);       // drawn again with the others
            var n = state.regions.reduce(function (m, r) { return Math.max(m, Number(String(r.label).replace(/\D/g, "")) || 0); }, 0) + 1;
            var r = {id: String(Date.now()) + "r" + n, label: "R" + n, shape: shape, geometry: drawn.geometry, statistics: null, reason: null};
            if (drawn.circle) r.circle = drawn.circle;
            state.regions.push(r);
            state.shown = r.id;
            state.regionsVisible = true;
            setMode("hover");
            return measure(r);
        }

        function setMode(mode) {
            if (tool) { tool.stop(); tool = null; }
            state.mode = mode;
            state.notice = "";
            map.getContainer().style.cursor = mode === "pin" ? "crosshair" : "";
            if (SHAPES[mode] && Regions) {
                tool = new Regions.DrawTool(L, map, {shape: mode, doc: doc,
                    onFinish: function (drawn) { regionDrawn(mode, drawn); },
                    onCancel: function () { tool = null; setMode("hover"); },
                    onInvalid: function (reason) { state.notice = REASONS[reason] || "Not a region"; render(); }});
                tool.start();
            }
            render();
        }

        // The temperature at a point of a thermal layer, in °C (a mosaic's in its unit; a frame's alone isn't one)
        function query(t, latlng) {
            return fetchFn(pointUrl(t, latlng), {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (!r.ok) return {error: (r.data && (r.data.error || r.data.detail)) || "Could not read the temperature"};
                if (t.mosaic) {
                    var c = typeof r.data.temperature === "number" ? toCelsius(r.data.temperature, t.mosaic.unit) : null;
                    return assign({}, r.data, {temperature: c, valid: c !== null, reason: c !== null ? null : r.data.reason || "nodata"});
                }
                return r.data;
            }, function () { return {error: "Could not read the temperature"}; });
        }

        function onMove(e) {
            if (!state.open) return;
            var t = thermalLayerAt(map, e.latlng);
            if (timer) clearTimeout(timer);
            var mine = ++seq;
            if (!t) {
                state.readout = null;
                cursor.style.display = "none";
                return renderReadout();
            }
            timer = setTimeout(function () {
                query(t, e.latlng).then(function (r) {
                    if (mine !== seq || !state.open) return;
                    state.readout = r;
                    renderReadout();
                    var text = r && r.valid ? formatTemp(r.temperature) : "";
                    cursor.textContent = text;
                    cursor.style.display = text ? "" : "none";
                    if (text) {
                        var pt = map.latLngToContainerPoint(e.latlng);
                        cursor.style.left = (pt.x + 14) + "px";
                        cursor.style.top = (pt.y + 14) + "px";
                    }
                });
            }, HOVER_MS);
        }

        function onOut() {
            seq++;
            if (timer) clearTimeout(timer);
            cursor.style.display = "none";
        }

        // A click while pinning pins the point and is not WebODM's (no popup), nor is one while drawing
        function onClick(e) {
            if (Date.now() - drawnAt < DRAWN_CLICK_MS) return true;
            if (!state.open || state.mode === "hover") return false;
            if (state.mode !== "pin") return true;
            var t = thermalLayerAt(map, e.latlng);
            if (!t) return true;
            var n = state.pins.reduce(function (m, p) { return Math.max(m, Number(String(p.label).replace(/\D/g, "")) || 0); }, 0) + 1;
            var pin = {id: String(Date.now()) + n, label: "P" + n, lat: e.latlng.lat, lng: e.latlng.lng, temperature: null, reason: null};
            query(t, e.latlng).then(function (r) {
                pin.temperature = r && r.valid ? r.temperature : null;
                pin.reason = r && !r.valid ? (r.reason || "error") : null;
                state.pins.push(pin);
                pinsChanged();
            });
            return true;
        }

        // The thermal layers' palette: the user's preference, applied as each layer comes
        function applyPalette(t) {
            if (!state.palette) return;
            if (t.mosaic) return restyleMosaic(t.layer, {key: paletteKey(mosaicOf(t.mosaic), state.palette, state.display)});
            var url = withPalette(t.layer._url, state.palette, state.display);
            if (url === t.layer._url) return;
            applying = true;
            t.layer.setUrl(url, true);
            if (t.layer._removeAllTiles) t.layer._removeAllTiles();
            if (t.layer.redraw) t.layer.redraw();
            applying = false;
        }

        // WebODM's layer panel sets the URL from its own colour map (its list shows what it was given) and range: a
        // colour map chosen there is the user's (saved when it is one of the palettes offered, else drawn on this page
        // only); a range alone keeps the user's palette, DJI's too
        function watch(t) {
            if (t.mosaic || t.layer.__dtWatched) return;
            t.layer.__dtWatched = true;
            t.layer.__dtPanelMap = colorMapOf(t.layer._url);
            var setUrl = t.layer.setUrl;
            t.layer.setUrl = function (url) {
                var args = Array.prototype.slice.call(arguments);
                if (!applying) {
                    var chosen = colorMapOf(url);
                    if (chosen && chosen !== t.layer.__dtPanelMap) {
                        t.layer.__dtPanelMap = chosen;
                        if (paletteNames(state.display).indexOf(chosen) !== -1) choosePalette(chosen, t.layer);
                        else showPalette(chosen, t.layer);
                    }
                    if (state.palette) args[0] = withPalette(url, state.palette, state.display);
                }
                var out = setUrl.apply(this, args);
                drawIsotherms();
                renderLegend();
                return out;
            };
            ["show", "hide"].forEach(function (name) {
                var original = t.layer[name];
                if (typeof original !== "function") return;
                t.layer[name] = function () {
                    var out = original.apply(this, arguments);
                    drawIsotherms();
                    renderLegend();
                    return out;
                };
            });
        }

        function onLayerAdd(e) {
            var t = thermalLayer(e.layer);
            if (!t) return;
            watch(t);
            applyPalette(t);
            drawIsotherms();
            renderLegend();
        }

        function onLayerRemove(e) {
            if (!thermalLayer(e.layer)) return;
            drawIsotherms();
            renderLegend();
        }

        // -- workset mosaics on the map -----------------------------------------------------------------------------

        function mosaicOf(info) {
            return (state.mosaics || []).filter(function (m) { return m.dataset.id === info.dataset && m.workset.id === info.workset; })[0] || {};
        }

        // A mosaic laid on the map drawn with changes ({tab, key}): its tile URL, and a tab's own range
        function restyleMosaic(layer, change) {
            var info = layer.__dtMosaic, m = mosaicOf(info);
            var next = change.tab && change.tab !== info.tab ? laidMosaic(project, m, change.tab, state.palette, state.display) : assign({}, info, change);
            layer.__dtMosaic = next;
            var url = mosaicTileUrl(next);
            if (url !== layer._url) layer.setUrl(url);
            drawIsotherms();
            renderLegend();
        }

        function layMosaic(m, tab) {
            var id = mosaicId(m);
            if (state.laid[id]) return state.laid[id];
            var info = laidMosaic(project, m, tab, state.palette, state.display);
            var b = info.bounds;
            var layer = L.tileLayer(mosaicTileUrl(info), {maxZoom: 26, maxNativeZoom: (info.maxzoom || 20) + 1, minZoom: 0, tileSize: 256,
                zIndex: MOSAIC_Z + Object.keys(state.laid).length, bounds: b ? L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]) : undefined});
            layer.__dtMosaic = info;
            state.laid[id] = {layer: layer, opacity: 100, swipe: false};
            layer.addTo(map);
            return state.laid[id];
        }

        function liftMosaic(id) {
            var laid = state.laid[id];
            if (!laid) return;
            if (laid.swipe) swipe(laid, false);
            delete state.laid[id];
            map.removeLayer(laid.layer);
        }

        // On the right of WebODM's split control (PluginsAPI.Map.sideBySideChanged, as its own layer panel does)
        function swipe(laid, on) {
            if (!plugins || !plugins.Map || !plugins.Map.sideBySideChanged) return;
            laid.swipe = on;
            plugins.Map.sideBySideChanged(laid.layer, on);
        }

        function zoomTo(laid) {
            var b = laid.layer.options.bounds;
            if (b) map.fitBounds(b);
        }

        function onMosaicInput(row, what, value) {
            var m = (state.mosaics || []).filter(function (x) { return mosaicId(x) === row.getAttribute("data-mosaic"); })[0];
            if (!m) return;
            var id = mosaicId(m), laid = state.laid[id];
            if (what === "on") {
                if (value) zoomTo(layMosaic(m));
                else liftMosaic(id);
            } else if (!laid) return;
            else if (what === "tab") restyleMosaic(laid.layer, {tab: value});
            else if (what === "opacity") { laid.opacity = Number(value); laid.layer.setOpacity(laid.opacity / 100); }
            else if (what === "swipe") swipe(laid, !laid.swipe);
            else if (what === "zoom") return zoomTo(laid);
            render();
        }

        // The button shows when the map has a thermal orthophoto or the project has mosaics
        function showButton() {
            container.style.display = hasThermal(args.tiles) || (state.mosaics && state.mosaics.length) ? "" : "none";
        }

        function showPalette(name, except) {
            state.palette = name;
            thermalLayers(map).forEach(function (t) { if (t.layer !== except) applyPalette(t); });
            render();
        }

        function choosePalette(name, except) {
            showPalette(name, except);
            (deps.save || function (palette) {
                return fetchFn(API + "display", {method: "PUT", credentials: "same-origin",
                    headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken(doc)},
                    body: JSON.stringify({palette: palette})});
            })(name);
        }

        function onPanelClick(e) {
            var mode = e.target.closest("[data-mode]");
            if (mode) return setMode(mode.getAttribute("data-mode"));
            var act = e.target.closest("[data-act]");
            var what = act && act.getAttribute("data-act");
            var mrow = e.target.closest("[data-mosaic]");
            if (mrow && (what === "mosaic-swipe" || what === "mosaic-zoom")) return onMosaicInput(mrow, what.slice("mosaic-".length));
            // A click anywhere on a region's row shows its statistics (measured again if they never came)
            var rrow = e.target.closest("[data-region]");
            var region = rrow && state.regions.filter(function (r) { return r.id === rrow.getAttribute("data-region"); })[0];
            if (region) {
                if (what === "goto") map.fitBounds(regionBounds(region), {maxZoom: map.getZoom()});
                if (what === "remove") {
                    state.regions = state.regions.filter(function (r) { return r !== region; });
                    if (state.shown === region.id) state.shown = state.regions.length ? state.regions[state.regions.length - 1].id : null;
                } else {
                    state.shown = region.id;
                    if (!region.statistics && !region.loading) measure(region);
                }
                return regionsChanged();
            }
            if (!act) return;
            var row = act.closest("[data-pin]");
            var pin = row && state.pins.filter(function (p) { return p.id === row.getAttribute("data-pin"); })[0];
            if (what === "close") close();
            else if (what === "goto" && pin) map.panTo([pin.lat, pin.lng]);
            else if (what === "remove" && pin) { state.pins = state.pins.filter(function (p) { return p !== pin; }); pinsChanged(); }
            else if (what === "toggle") { state.pinsVisible = !state.pinsVisible; drawPins(); render(); }
            else if (what === "clear") { state.pins = []; pinsChanged(); }
            else if (what === "csv") download("thermal-points.csv", pinsCsv(state.pins, userUnit()));
            else if (what === "toggle-regions") { state.regionsVisible = !state.regionsVisible; drawRegions(); render(); }
            else if (what === "clear-regions") { state.regions = []; state.shown = null; regionsChanged(); }
            else if (what === "csv-regions") download("thermal-regions.csv", regionsCsv(state.regions, userUnit()));
        }

        function download(name, text) {
            var a = doc.createElement("a");
            a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(text);
            a.download = name;
            doc.body.appendChild(a);
            a.click();
            doc.body.removeChild(a);
        }

        function onPanelChange(e) {
            var what = e.target.getAttribute("data-act") || "";
            if (what === "palette") choosePalette(e.target.value);
            else if (what === "legend") {
                state.legendVisible = e.target.checked;
                try { storage.setItem(LEGEND_KEY, state.legendVisible ? "1" : "0"); } catch (err) { /* this page only */ }
                renderLegend();
            } else if (what.indexOf("isotherm-") === 0) isothermInput(what.slice("isotherm-".length), e.target.value);
            else if (what.indexOf("mosaic-") === 0) {
                onMosaicInput(e.target.closest("[data-mosaic]"), what.slice("mosaic-".length), what === "mosaic-on" ? e.target.checked : e.target.value);
            }
        }

        function open() {
            state.open = true;
            container.classList.add("open");
            render();
        }

        function close() {
            setMode("hover");
            state.open = false;
            state.readout = null;
            container.classList.remove("open");
            onOut();
            render();
        }

        function onUnits() { drawPins(); drawRegions(); renderLegend(); render(); }

        var Control = L.Control.extend({
            options: {position: "topright"},
            onAdd: function () {
                container = L.DomUtil.create("div", "leaflet-bar leaflet-control dt-inspector");
                container.innerHTML = '<a href="javascript:void(0)" class="dt-inspector-button" title="Thermal Inspector"><i class="fa fa-thermometer-half"></i></a>';
                panel = L.DomUtil.create("div", "dt-inspector-panel", container);
                panel.hidden = true;
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                // Over the panel the cursor is not over the map
                container.addEventListener("mousemove", function (e) { e.stopPropagation(); onOut(); });
                container.querySelector(".dt-inspector-button").addEventListener("click", function () { if (state.open) close(); else open(); });
                panel.addEventListener("click", onPanelClick);
                panel.addEventListener("change", onPanelChange);
                return container;
            }
        });
        var control = new Control();
        map.addControl(control);
        showButton();
        // Top left: WebODM's own buttons sit over the bottom corners
        var LegendControl = L.Control.extend({
            options: {position: "topleft"},
            onAdd: function () {
                legend = L.DomUtil.create("div", "leaflet-control dt-legend");
                legend.hidden = true;
                L.DomEvent.disableClickPropagation(legend);
                L.DomEvent.disableScrollPropagation(legend);
                return legend;
            }
        });
        map.addControl(new LegendControl());
        cursor = L.DomUtil.create("div", "dt-inspector-cursor", map.getContainer());
        cursor.style.display = "none";
        regionLayer = L.layerGroup().addTo(map);
        pinLayer = L.layerGroup().addTo(map);
        drawPins();
        drawRegions();
        map.on("mousemove", onMove);
        map.on("mouseout", onOut);
        map.on("layeradd", onLayerAdd);
        map.on("layerremove", onLayerRemove);
        thermalLayers(map, true).forEach(function (t) { watch(t); });
        drawIsotherms();
        if (plugins && plugins.Map && plugins.Map.onHandleClick) plugins.Map.onHandleClick(onClick);
        doc.addEventListener("onUnitSystemChanged", onUnits);

        // The user's palette, from the Analyzer's preferences
        var ready = fetchFn(API + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
            if (!r.ok) return;
            state.display = r.data;
            var preferred = r.data.palette;
            if (preferred && paletteNames(r.data).indexOf(preferred) !== -1) {
                state.palette = preferred;
                thermalLayers(map).forEach(applyPalette);
            } else {
                var shown = thermalLayers(map)[0];
                state.palette = shown ? paletteOf(shown.layer._url) : "";
            }
            renderLegend();
            render();
        }, function () {});

        // The project's workset mosaics, then the one a link asks for laid on the map, the panel open
        var mosaicsReady = !project ? Promise.resolve() : ready.then(function () {
            return fetchFn(API + "projects/" + project + "/inspector/mosaics", {credentials: "same-origin"}).then(readJson);
        }).then(function (r) {
            state.mosaics = r.ok && Array.isArray(r.data.mosaics) ? r.data.mosaics : [];
            showButton();
            var linked = linkedMosaic(search);
            var m = linked && state.mosaics.filter(function (x) { return x.dataset.id === linked.dataset && x.workset.id === linked.workset; })[0];
            if (m) {
                zoomTo(layMosaic(m, linked.tab));
                open();
            } else render();
        }, function () { state.mosaics = []; });

        // A region drawn before its statistics came (the page left) is read again
        state.regions.forEach(function (r) { if (!r.statistics && !r.reason) measure(r); });

        return {control: control, state: state, open: open, close: close, ready: ready, mosaicsReady: mosaicsReady, click: onClick, setMode: setMode,
                legend: function () { return legend; }, overlays: function () { return overlays; }};
    }

    // Whether a map shows a thermal orthophoto
    function hasThermal(tiles) {
        return (tiles || []).some(function (t) {
            var bands = (t.meta && t.meta.task && t.meta.task.orthophoto_bands) || [];
            return t.type === "orthophoto" && bands[0] && String(bands[0].description || "").toLowerCase() === "lwir";
        });
    }

    var api = {userUnit: userUnit, formatTemp: formatTemp, thermalLayer: thermalLayer, thermalLayers: thermalLayers,
               thermalLayerAt: thermalLayerAt, pointUrl: pointUrl, withColorMap: withColorMap, colorMapOf: colorMapOf,
               withPalette: withPalette, paletteOf: paletteOf, paletteOptions: paletteOptions, rangeOf: rangeOf,
               isothermKey: isothermKey, validIsotherm: validIsotherm, loadIsotherm: loadIsotherm, defaultIsotherm: defaultIsotherm,
               isothermUrl: isothermUrl, describeIsotherm: describeIsotherm, legendHtml: legendHtml,
               pinsKey: pinsKey, regionsKey: regionsKey, loadPins: loadPins, savePins: savePins, pinsCsv: pinsCsv,
               regionsCsv: regionsCsv, statisticsHtml: statisticsHtml, readoutHtml: readoutHtml,
               panelHtml: panelHtml, hasThermal: hasThermal, projectOf: projectOf, linkedMosaic: linkedMosaic, paletteKey: paletteKey,
               mosaicRange: mosaicRange, laidMosaic: laidMosaic, mosaicTileUrl: mosaicTileUrl, mosaicIsothermUrl: mosaicIsothermUrl,
               mosaicsHtml: mosaicsHtml, toCelsius: toCelsius, create: create};
    root.ThermalInspector = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
