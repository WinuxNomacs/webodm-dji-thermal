// The Thermal Inspector: a control on WebODM's 2D map for thermal orthophotos (a single lwir band). The temperature
// under the cursor, points pinned with theirs and regions drawn with their statistics, surroundings and ΔT (both kept
// in the browser, for the same tasks; regions drawn by regions.js; a line also has its profile), isotherms (the temperatures above, below or between limits painted
// over the thermal layers, also kept in the browser), the thermal layer's palette, which is the user's everywhere (the
// Analyzer's preference), and a legend of its palette and range (scale.js). Temperatures come from the plugin's API
// (inspector_api.py) in °C and are shown in WebODM's units (°F when imperial). The project's workset mosaics can be
// laid on the map too (the Analyzer's tiles, above WebODM's layers, swiped against them with WebODM's own split
// control): a thermal layer like the orthophotos, read through the Analyzer's API. main.js adds it through
// PluginsAPI.Map.willAddControls, with WebODM's own Leaflet, to every map; its button shows when the map has a thermal
// orthophoto or the project has mosaics. A click shows the frames that saw a point (frames.js, the Analyzer's source
// frames window) beside the panel, on a mosaic and on an orthophoto processed from a workset's TIFFs. Pins, regions
// and lines can be saved, named, with what they measured, for everyone who can view the project (kept with the task or
// the workset: measurements.py); and the temperatures corrected for another emissivity and reflected temperature
// (correction.py's model, from what each layer was measured with), the numbers only: the map's colours stay.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var HOVER_MS = 80;              // the readout asks for the point the cursor rests on, not every point it crosses
    var DRAWN_CLICK_MS = 500;       // the click Leaflet fires after a rectangle or circle is dragged is part of it
    var PINS_PREFIX = "dji-thermal-inspector:pins:";
    var REGIONS_PREFIX = "dji-thermal-inspector:regions:";
    var ISOTHERM_PREFIX = "dji-thermal-inspector:isotherm:";
    var CORRECTION_PREFIX = "dji-thermal-inspector:correction:";
    var LEGEND_KEY = "dji-thermal-inspector:legend";
    var KELVIN = 273.15;
    var EMISSIVITY = [0.1, 1], REFLECTED = [-100, 1000];     // correction.py's limits (°C)
    var SAVED_STYLE = {color: "#2e7d32", weight: 2, opacity: 0.9, dashArray: "6 4", fillOpacity: 0.08};
    var ISOTHERM_MODES = {off: "Off", above: "Above", below: "Below", between: "Between"};
    var ISOTHERM_COLORS = {red: "e53935", orange: "fb8c00", yellow: "fdd835", green: "43a047", blue: "1e88e5", magenta: "d81b60"};
    var SHAPES = {rectangle: "far fa-square", circle: "far fa-circle", polygon: "fa fa-draw-polygon", line: "fa fa-route"};
    var SHAPE_NAMES = {rectangle: "Rectangle", circle: "Circle", polygon: "Polygon", line: "Line"};
    var SQ_FT_PER_SQ_M = 10.7639104;
    var FT_PER_M = 3.2808399;
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions.js") : null);
    var Scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale.js") : null);
    var Frames = root.ThermalFrames || (typeof require !== "undefined" ? require("./frames.js") : null);
    var META = root.Symbol ? root.Symbol["for"]("meta") : "meta";      // where WebODM's map keeps a layer's metadata
    var TILE_META = root.Symbol ? root.Symbol["for"]("tile-meta") : "tile-meta";   // and its tiles' (their statistics)
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
                   no_area: "The polygon has no area", line_too_short: "A line needs two points"};

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
    // A difference of temperatures with its sign (ΔT)
    function formatSigned(celsius, unit) {
        if (celsius === null || celsius === undefined || isNaN(celsius)) return "";
        return (celsius > 0 ? "+" : "") + formatDelta(celsius, unit);
    }
    function formatLength(m, unit) {
        var imperial = (unit || userUnit()) === "F";
        return (imperial ? m * FT_PER_M : m).toFixed(m >= 100 ? 0 : 1) + (imperial ? " ft" : " m");
    }
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
        return {project: m[1], task: m[2], layer: layer, name: (meta.task && meta.task.name) || ""};
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

    // A temperature in a mosaic's unit (C, F or K) in °C, and back
    function toCelsius(v, unit) { return unit === "F" ? (v - 32) / 1.8 : unit === "K" ? v - 273.15 : v; }
    function fromCelsius(c, unit) { return Math.round((unit === "F" ? c * 1.8 + 32 : unit === "K" ? c + 273.15 : c) * 1e4) / 1e4; }

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

    // What a mosaic laid on the map draws: {project, dataset, workset, tab, unit, built_at, key, range and auto (its
    // Auto range; its unit), adjust (the Image section's), extent (its lowest and highest temperatures, its unit; or
    // null), name}
    function laidMosaic(project, m, tab, palette, display) {
        var t = (m.tabs || []).filter(function (x) { return x.tab === tab; })[0] || m.tabs[0];
        var s = t.stats || {};
        return {project: String(project), dataset: m.dataset.id, workset: m.workset.id, tab: t.tab, unit: m.unit || "C",
                built_at: m.built_at || "", key: paletteKey(m, palette, display), range: mosaicRange(t), auto: mosaicRange(t),
                adjust: Scale.defaultAdjust(),
                extent: typeof s.min === "number" && typeof s.max === "number" ? [s.min, s.max] : null,
                name: m.dataset.name + " › " + m.workset.name, bounds: t.bounds, maxzoom: t.maxzoom};
    }

    // A mosaic's tiles and its frames are drawn alike: build time, palette, range (its unit) and adjustments
    function mosaicQuery(info) {
        return "v=" + encodeURIComponent(info.built_at) + "&color_map=" + encodeURIComponent(info.key) + "&rescale=" + info.range[0] + "," + info.range[1] +
            Scale.adjustQuery(info.adjust);
    }
    function mosaicTileUrl(info) { return mosaicBase(info) + "/mosaics/" + info.tab + "/tiles/{z}/{x}/{y}.png?" + mosaicQuery(info); }

    // Where a thermal layer's source frames come from: a mosaic's own; for a WebODM orthophoto, the workset (of
    // mosaics, the Inspector's list) whose TIFFs its task processed, drawn as its as-converted mosaic in the layer's
    // palette, range and adjustments ({base, tab, query, orthophoto}); null for an orthophoto from elsewhere
    function framesSource(t, mosaics, palette, display) {
        if (!t) return null;
        if (t.mosaic) return {base: mosaicBase(t.mosaic), tab: t.mosaic.tab, query: mosaicQuery(t.mosaic), orthophoto: false};
        var m = (mosaics || []).filter(function (x) { return (x.tasks || []).indexOf(t.task) !== -1; })[0];
        if (!m) return null;
        var info = laidMosaic(t.project, m, "as_converted", palette || paletteOf(t.layer._url), display);
        var range = rangeOf(t.layer._url);
        if (range) info.range = range.map(function (c) { return fromCelsius(c, info.unit); });
        info.adjust = adjustOf(t.layer._url);
        return {base: mosaicBase(info), tab: info.tab, query: mosaicQuery(info), orthophoto: true};
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
    // A thermal layer's lowest and highest temperatures (°C): a mosaic's, or what WebODM's tiles say of the orthophoto;
    // null when unknown
    function layerExtent(t) {
        if (!t) return null;
        if (t.mosaic) return t.mosaic.extent ? t.mosaic.extent.map(function (v) { return toCelsius(v, t.mosaic.unit); }) : null;
        var s = t.layer[TILE_META] && t.layer[TILE_META].statistics && t.layer[TILE_META].statistics["1"];
        return s && typeof s.min === "number" && typeof s.max === "number" ? [s.min, s.max] : null;
    }
    function layerPalette(t) { return !t ? "" : t.mosaic ? keyPalette(t.mosaic.key) : paletteOf(t.layer._url); }
    // A thermal layer's adjustments (the Image section's)
    function layerAdjust(t) { return !t ? Scale.defaultAdjust() : t.mosaic ? t.mosaic.adjust || Scale.defaultAdjust() : adjustOf(t.layer._url); }
    // A thermal layer's Auto range (°C): a mosaic's 2nd to 98th percentile (as it starts); what WebODM's tiles say of the
    // orthophoto's, rounded outwards to a tenth in the user's unit; null when unknown
    function autoRange(t, unit) {
        if (!t) return null;
        if (t.mosaic) return (t.mosaic.auto || t.mosaic.range).map(function (v) { return toCelsius(v, t.mosaic.unit); });
        var s = t.layer[TILE_META] && t.layer[TILE_META].statistics && t.layer[TILE_META].statistics["1"];
        var p = s && s.percentiles;
        if (!p || p.length < 2 || !isFinite(p[0]) || !isFinite(p[1])) return null;
        var lo = Math.floor(shownTemp(p[0], unit) * 10) / 10, hi = Math.ceil(shownTemp(p[1], unit) * 10) / 10;
        return [typedTemp(lo, unit), typedTemp(hi > lo ? hi : lo + 1, unit)];
    }
    // The legend's curve with equalization: the server's (from the whole image's histogram) for a range (°C)
    function curveUrl(t, range, adjust) {
        var r = t.mosaic ? range.map(function (c) { return fromCelsius(c, t.mosaic.unit); }) : range;
        return inspectorUrl(t, "curve") + "?rescale=" + r[0] + "," + r[1] + Scale.adjustQuery(adjust);
    }

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

    // A thermal layer's tile URL in a palette, drawn with adjustments (the Image section's): drawn by the plugin's
    // tiles in one of DJI's (display.palettes) or with adjustments, else by WebODM's; the range, size and crop kept
    function withPalette(url, name, display, adjust) {
        var a = adjust || {};
        if (((display && display.palettes) || []).indexOf(name) !== -1 || Scale.adjusted(adjust)) {
            url = url.replace(WEBODM_TILES, API + "projects/$1/inspector/tiles/");
            url = withParam(withParam(url, "color_map", ""), "palette", name);
            url = withParam(url, "gamma", a.gamma && a.gamma !== 1 ? String(a.gamma) : "");
            url = withParam(url, "equalize", a.equalize ? "1" : "");
            return withParam(url, "sharpen", a.sharpen ? String(a.sharpen) : "");
        }
        url = url.replace(PLUGIN_TILES, "/api/projects/$1/orthophoto/tiles/");
        ["palette", "gamma", "equalize", "sharpen"].forEach(function (k) { url = withParam(url, k, ""); });
        return withColorMap(url, name);
    }
    // The adjustments a thermal layer's tile URL draws with
    function adjustOf(url) {
        if (!PLUGIN_TILES.test(url || "")) return Scale.defaultAdjust();
        return {gamma: parseFloat(paramOf(url, "gamma")) || 1, equalize: paramOf(url, "equalize") === "1", sharpen: parseFloat(paramOf(url, "sharpen")) || 0};
    }
    function paletteOf(url) { return PLUGIN_TILES.test(url || "") ? paramOf(url, "palette") : colorMapOf(url); }
    // A tile URL drawn over another range (°C)
    function withRange(url, range) {
        var rest = withParam(url, "rescale", "");
        return rest + (rest.indexOf("?") === -1 ? "?" : "&") + "rescale=" + range[0] + "," + range[1];
    }
    // The range (°C) a thermal layer is drawn over, [lo, hi], or null
    function rangeOf(url) {
        var p = paramOf(url, "rescale").split(",").map(parseFloat);
        return p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && p[0] < p[1] ? p : null;
    }

    // Isotherms: {mode: off, above, below or between, low and high (°C, as the mode uses them), color (a name of
    // ISOTHERM_COLORS)}, remembered in the browser for the same tasks
    // The isotherm's limits a region's share in it is measured with (°C): {low, high}, either null; null when it is off
    function isothermLimits(iso) {
        if (!validIsotherm(iso)) return null;
        return {low: iso.mode === "below" ? null : iso.low, high: iso.mode === "above" ? null : iso.high};
    }
    function limitsKey(iso) { return JSON.stringify(isothermLimits(iso)); }
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

    // The correction: {on, emissivity, reflected (°C)}, remembered in the browser for the same tasks. A layer's: {wanted:
    // {emissivity, reflected}, baseline: what it was measured with, as its saved measurements' API gives it}, or null
    function correctionKey(tasks) { return CORRECTION_PREFIX + tasks.slice().sort().join(","); }
    function validCorrection(c) {
        return !!c && typeof c.emissivity === "number" && c.emissivity >= EMISSIVITY[0] && c.emissivity <= EMISSIVITY[1] &&
            typeof c.reflected === "number" && c.reflected >= REFLECTED[0] && c.reflected <= REFLECTED[1];
    }
    function loadCorrection(storage, key) {
        var c;
        try { c = JSON.parse(storage.getItem(key) || "null"); } catch (e) { c = null; }
        return validCorrection(c) ? {on: !!c.on, emissivity: c.emissivity, reflected: c.reflected} : {on: false};
    }
    function saveCorrection(storage, key, c) {
        try {
            if (validCorrection(c)) storage.setItem(key, JSON.stringify(c));
            else storage.removeItem(key);
        } catch (e) { /* kept for this page only */ }
    }
    // The object's radiance with the parameters wanted is gain * its radiance with the baseline's + offset
    function gainOffset(fix) {
        var e = fix.wanted.emissivity, r = fix.wanted.reflected + KELVIN, e0 = fix.baseline.emissivity, r0 = fix.baseline.reflected + KELVIN;
        return {gain: e0 / e, offset: ((1 - e0) * Math.pow(r0, 4) - (1 - e) * Math.pow(r, 4)) / e};
    }
    // A temperature (°C) measured with the baseline as with the parameters wanted, and back
    function corrected(celsius, fix) {
        if (!fix || celsius === null || celsius === undefined) return celsius;
        var g = gainOffset(fix), w = g.gain * Math.pow(celsius + KELVIN, 4) + g.offset;
        return Math.pow(Math.max(w, 0), 0.25) - KELVIN;
    }
    function uncorrected(celsius, fix) {
        if (!fix || celsius === null || celsius === undefined) return celsius;
        var g = gainOffset(fix), w = (Math.pow(celsius + KELVIN, 4) - g.offset) / g.gain;
        return Math.pow(Math.max(w, 0), 0.25) - KELVIN;
    }
    // An isotherm's limits (temperatures as shown, corrected) as a layer's own values, for its tiles
    function rawIsotherm(iso, fix) {
        if (!fix || !validIsotherm(iso)) return iso;
        var out = assign({}, iso);
        if (typeof iso.low === "number") out.low = Math.round(uncorrected(iso.low, fix) * 1e6) / 1e6;
        if (typeof iso.high === "number") out.high = Math.round(uncorrected(iso.high, fix) * 1e6) / 1e6;
        return out;
    }

    // The Correction section: the parameters wanted, and what each layer on the map was measured with
    function correctionHtml(c, unit, sources, notice) {
        var head = '<label class="dt-inspector-check"><input type="checkbox" data-act="correction-on"' + (c.on ? " checked" : "") +
            "> Correct for another emissivity and reflected temperature</label>";
        if (!c.on) return head;
        var measured = (sources || []).map(function (src) {
            if (src.loading) return "";
            var b = src.baseline;
            return '<div class="text-muted dt-inspector-hint">' + escapeHtml(src.name) + ": " + (b ?
                escapeHtml("measured with emissivity " + b.emissivity.toFixed(2) + ", reflected " + formatTemp(b.reflected, unit)) :
                "doesn't record how it was measured, so isn't corrected") + "</div>";
        }).join("");
        return head + '<div class="dt-inspector-correction"><label>Emissivity <input type="number" step="0.01" min="' + EMISSIVITY[0] + '" max="' + EMISSIVITY[1] +
            '" class="form-control input-sm" data-act="correction-emissivity" value="' + (typeof c.emissivity === "number" ? c.emissivity : "") + '"></label>' +
            '<label>Reflected <input type="number" step="0.1" class="form-control input-sm" data-act="correction-reflected" value="' +
            (typeof c.reflected === "number" ? roundShown(c.reflected, unit) : "") + '"> <span class="text-muted">°' + unit + "</span></label></div>" +
            (notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(notice) + "</div>" : "") + measured +
            '<div class="text-muted dt-inspector-hint">Approximate (a broadband model): for comparing surfaces, not calibrated values. ' +
            "The temperatures shown change; the map's colours don't.</div>";
    }

    // The legend: the palette's colours (encoded, as the palette API gives them) over the range (°C), its ends marked
    // with their values and round values between, in the user's unit, with the part an isotherm paints; with a
    // correction (fix), the marks are of corrected temperatures where the layer's own values are drawn, and the
    // isotherm's limits corrected ones too. extent, the image's lowest and highest temperatures (°C), is said under the
    // bar when it reaches beyond the range
    function legendHtml(colors, range, label, unit, iso, fix, extent, shares) {
        if (!colors || !colors.length || !range) return "";
        unit = unit || userUnit();
        return '<div class="dt-legend-title">' + escapeHtml(label) + ' <span class="text-muted">°' + unit + "</span></div>" +
            barHtml(colors, range, unit, iso, fix, shares) + extentHtml(range, unit, fix, extent);
    }

    // A colour scale: the palette's gradient over the range (°C; along shares: how the image is drawn), its marks, and
    // the part an isotherm paints (legendHtml)
    function barHtml(colors, range, unit, iso, fix, shares) {
        var lo = shownTemp(corrected(range[0], fix), unit), hi = shownTemp(corrected(range[1], fix), unit);
        var at = function (celsius) { return (uncorrected(celsius, fix) - range[0]) / (range[1] - range[0]); };
        var ticks = Scale.rangeTicks(lo, hi, 4).map(function (t) {
            var where = fix && !t.end ? at(typedTemp(t.value, unit)) : t.at;
            var end = where < 0.1 ? " dt-tick-start" : where > 0.9 ? " dt-tick-end" : "";
            return '<span class="dt-tick' + end + '" style="left: ' + (where * 100).toFixed(1) + '%;">' + escapeHtml(t.label) + "</span>";
        }).join("");
        var mark = "";
        if (validIsotherm(iso)) {
            var raw = rawIsotherm(iso, fix);
            var from = iso.mode === "below" ? range[0] : Math.max(raw.low, range[0]);
            var to = iso.mode === "above" ? range[1] : Math.min(raw.high, range[1]);
            if (to > from || (to === from && iso.mode === "between")) {
                mark = '<div class="dt-legend-isotherm" title="' + escapeHtml(describeIsotherm(iso, unit)) + '" style="left: ' +
                    ((from - range[0]) / (range[1] - range[0]) * 100).toFixed(1) + "%; width: " +
                    ((to - from) / (range[1] - range[0]) * 100).toFixed(1) + "%; border-color: #" + ISOTHERM_COLORS[iso.color] + ';"></div>';
            }
        }
        return '<div class="dt-legend-bar" style="background: ' + Scale.gradientCss(colors, shares) + ';">' + mark + "</div>" +
            '<div class="dt-legend-ticks">' + ticks + "</div>";
    }

    // The panel's colour scale of the topmost thermal layer (s: {name (when several are shown), colors, range, auto,
    // extent (°C), adjust, shares, fix}): the scale, its range typed in the user's unit (corrected temperatures with a
    // correction), Auto, and the layer's lowest and highest temperatures
    function scaleHtml(s, state, unit) {
        if (!s || !s.range) return "";
        var shown = function (c) { return roundShown(corrected(c, s.fix), unit); };
        return '<div class="dt-inspector-scale">' +
            (s.name ? '<div class="text-muted dt-inspector-hint">Of ' + escapeHtml(s.name) + "</div>" : "") +
            '<div class="dt-inspector-scale-bar">' + (s.colors ? barHtml(s.colors, s.range, unit, state.isotherm, s.fix, s.shares) : "") + "</div>" +
            '<div class="dt-inspector-range">' +
            '<input type="number" step="0.1" class="form-control input-sm" data-act="range-min" value="' + shown(s.range[0]) + '" title="Minimum">' +
            '<span class="text-muted">to</span>' +
            '<input type="number" step="0.1" class="form-control input-sm" data-act="range-max" value="' + shown(s.range[1]) + '" title="Maximum">' +
            '<span class="text-muted">°' + unit + "</span>" +
            '<button type="button" class="btn btn-default btn-xs" data-act="range-auto"' + (s.auto ? "" : " disabled") +
            ' title="The 2nd to 98th percentile of this layer">Auto</button></div>' +
            (state.rangeError ? '<div class="text-danger dt-inspector-hint">' + escapeHtml(state.rangeError) + "</div>" : "") +
            (s.extent ? '<div class="text-muted dt-inspector-hint">This layer: ' + escapeHtml(shown(s.extent[0]).toFixed(1)) + " to " +
                escapeHtml(shown(s.extent[1]).toFixed(1)) + " °" + unit + "</div>" : "") + "</div>";
    }

    // The Image section of the topmost thermal layer (s: scaleHtml's): brightness and contrast move its range from its
    // Auto one, gamma, the tone curve and sharpening change how it is drawn (the mosaic viewer's)
    function imageHtml(s) {
        if (!s || !s.range) return "";
        var at = s.auto ? Scale.sliderPositions(s.auto, s.range) : {brightness: 0, contrast: 0};
        return '<div class="dt-inspector-section dt-inspector-image"><strong>Image</strong>' +
            Scale.imageControlsHtml(s.adjust, at, {field: function (name) { return 'data-act="image-' + name + '"'; }, equalize: true, whole: "layer"}) +
            '<div class="text-muted dt-inspector-hint">How the image is drawn: the temperatures stay as they are.</div></div>';
    }

    // The image's lowest and highest temperatures, when either lies outside the legend's range (as shown, to a tenth)
    function extentHtml(range, unit, fix, extent) {
        if (!extent) return "";
        var tenth = function (c) { return Math.round(shownTemp(corrected(c, fix), unit) * 10) / 10; };
        var low = tenth(extent[0]), high = tenth(extent[1]);
        if (low >= tenth(range[0]) && high <= tenth(range[1])) return "";
        return '<div class="dt-legend-extent text-muted" title="The colours stop at the ends of the scale: colder and hotter parts take its end colours">Image: ' +
            escapeHtml(String(low)) + "–" + escapeHtml(String(high)) + " °" + unit + "</div>";
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
    // temp: a pin's temperature shown (°C, corrected), its own without
    function pinsCsv(pins, unit, temp) {
        temp = temp || function (p) { return p.temperature; };
        var rows = [["label", "latitude", "longitude", "temperature_" + unit.toLowerCase()]];
        pins.forEach(function (p) {
            var c = temp(p);
            rows.push([p.label, p.lat.toFixed(8), p.lng.toFixed(8), c === null || c === undefined ? "" : shownTemp(c, unit).toFixed(3)]);
        });
        return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
    }

    function regionArea(r) {
        return r.statistics && r.pixel_size && r.shape !== "line" ? r.statistics.count * r.pixel_size * r.pixel_size : null;
    }

    // One row per region with statistics
    function regionsCsv(regions, unit) {
        var u = unit.toLowerCase();
        var rows = [["label", "shape", "pixels", "area_m2", "length_m"].concat(["min", "max", "mean", "std", "median", "p2", "p98", "surroundings", "delta_t"].map(function (s) { return s + "_" + u; }))
            .concat(["isotherm_share_pct", "coldest_latitude", "coldest_longitude", "hottest_latitude", "hottest_longitude"])];
        regions.forEach(function (r) {
            var s = r.statistics;
            if (!s) return;
            var t = function (c) { return c === null || c === undefined ? "" : shownTemp(c, unit).toFixed(3); };
            var p = s.percentiles || {};
            var d = function (c) { return c === null || c === undefined ? "" : (unit === "F" ? c * 1.8 : c).toFixed(3); };
            var share = typeof s.isotherm_share === "number" ? (s.isotherm_share * 100).toFixed(2) : "";
            rows.push([r.label, r.shape, s.count, regionArea(r) === null ? "" : regionArea(r).toFixed(3), typeof r.length === "number" ? r.length.toFixed(3) : "",
                       t(s.min), t(s.max), t(s.mean), d(s.std), t(s.median), t(p["2"]), t(p["98"]), t(s.surroundings), d(s.delta_t), share,
                       s.min_location[1].toFixed(8), s.min_location[0].toFixed(8), s.max_location[1].toFixed(8), s.max_location[0].toFixed(8)]);
        });
        return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
    }

    // A line's profile: a row per sample (distance in metres, where, the temperature; on a mosaic, the frame)
    function profileCsv(r, unit) {
        var p = r.profile, framed = !!p.frames;
        var rows = [["distance_m", "latitude", "longitude", "temperature_" + unit.toLowerCase()].concat(framed ? ["frame"] : [])];
        p.distance.forEach(function (d, i) {
            var v = p.values[i];
            rows.push([d.toFixed(3), p.points[i][1].toFixed(8), p.points[i][0].toFixed(8),
                       v === null || v === undefined ? "" : shownTemp(v, unit).toFixed(3)].concat(framed ? [p.frames[i] || ""] : []));
        });
        return rows.map(function (row) { return row.map(csvCell).join(","); }).join("\n") + "\n";
    }

    // The statistics of a region: a table and its histogram (a line's profile); iso, the isotherm shown: a share in it
    // measured with other limits isn't shown (true: shown whatever it was measured with, as a saved one's)
    function statisticsHtml(r, unit, iso) {
        if (r.loading) return '<div class="text-muted"><i class="fa fa-spinner fa-spin"></i> Reading the region…</div>';
        if (r.error) return '<div class="text-danger">' + escapeHtml(r.error) + "</div>";
        var s = r.statistics;
        if (!s) return '<div class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperatures in this region") + "</div>";
        var p = s.percentiles || {};
        var rows = [["Minimum", formatTemp(s.min, unit)], ["Maximum", formatTemp(s.max, unit)], ["Mean", formatTemp(s.mean, unit)],
                    ["Median", formatTemp(s.median, unit)], ["Std. deviation", formatDelta(s.std, unit)],
                    ["2nd percentile", formatTemp(p["2"], unit)], ["98th percentile", formatTemp(p["98"], unit)],
                    ["Surroundings", formatTemp(s.surroundings, unit)], ["ΔT", formatSigned(s.delta_t, unit)],
                    ["In the isotherm", typeof s.isotherm_share === "number" && (iso === true || r.isotherm === limitsKey(iso)) ? (s.isotherm_share * 100).toFixed(1) + " %" : ""],
                    ["Pixels", String(s.count)]];
        if (regionArea(r) !== null) rows.push(["Area", formatArea(regionArea(r), unit)]);
        if (typeof r.length === "number") rows.push(["Length", formatLength(r.length, unit)]);
        return '<table class="table table-condensed dt-inspector-stats"><tbody>' + rows.filter(function (row) { return row[1]; }).map(function (row) {
            return "<tr><td>" + escapeHtml(row[0]) + '</td><td class="text-right">' + escapeHtml(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + (r.profile ? profileHtml(r.profile, unit, r.length) : histogramHtml(s.histogram, unit)) +
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

    var PROFILE_W = 240, PROFILE_H = 64;
    function profileX(d, length) { return length > 0 ? d / length * PROFILE_W : 0; }

    // A line's temperatures along it, broken where there are none; hovering it finds the point on the map
    function profileHtml(p, unit, length) {
        var found = p.values.filter(function (v) { return v !== null && v !== undefined; });
        if (!found.length) return "";
        length = length || p.distance[p.distance.length - 1];
        var lo = Math.min.apply(null, found), hi = Math.max.apply(null, found), span = hi - lo || 1;
        var lines = [], current = [];
        p.values.forEach(function (v, i) {
            if (v === null || v === undefined) { if (current.length) lines.push(current); current = []; return; }
            current.push(profileX(p.distance[i], length).toFixed(2) + "," + (PROFILE_H - 2 - (v - lo) / span * (PROFILE_H - 4)).toFixed(2));
        });
        if (current.length) lines.push(current);
        return '<div class="dt-inspector-profile"><div class="dt-inspector-range"><span>' + escapeHtml(formatTemp(hi, unit)) + "</span></div>" +
            '<svg viewBox="0 0 ' + PROFILE_W + " " + PROFILE_H + '" preserveAspectRatio="none" width="100%" height="' + PROFILE_H + '" data-act="profile">' +
            lines.map(function (l) {
                return l.length === 1 ? '<circle cx="' + l[0].split(",")[0] + '" cy="' + l[0].split(",")[1] + '" r="1.5"></circle>' :
                    '<polyline points="' + l.join(" ") + '" vector-effect="non-scaling-stroke"></polyline>';
            }).join("") + '<line class="dt-inspector-profile-at" x1="0" x2="0" y1="0" y2="' + PROFILE_H + '" vector-effect="non-scaling-stroke" visibility="hidden"></line></svg>' +
            '<div class="dt-inspector-range"><span>' + escapeHtml(formatTemp(lo, unit)) + "</span></div>" +
            '<div class="dt-inspector-range"><span>' + escapeHtml(formatLength(0, unit)) + "</span><span>" + escapeHtml(formatLength(length, unit)) + "</span></div>" +
            '<div class="text-muted dt-inspector-hint dt-inspector-profile-read">Hover the profile to find its point on the map.</div></div>';
    }

    // The sample of a profile nearest a share (0..1) of its length
    function profileIndex(p, share) {
        var at = share * p.distance[p.distance.length - 1], best = 0;
        p.distance.forEach(function (d, i) { if (Math.abs(d - at) < Math.abs(p.distance[best] - at)) best = i; });
        return best;
    }

    function regionsHtml(state, unit) {
        var regions = state.regions;
        if (!regions.length) return '<div class="text-muted dt-inspector-hint">Choose a shape or the line, then draw on the map to read a region\'s temperatures.</div>';
        var shown = regions.filter(function (r) { return r.id === state.shown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + regions.map(function (r) {
            var s = r.statistics;
            return '<tr data-region="' + escapeHtml(r.id) + '"' + (r === shown ? ' class="active"' : "") + '><td><i class="' + SHAPES[r.shape] + '"></i> ' +
                '<a href="javascript:void(0)" data-act="goto" title="Show on the map">' + escapeHtml(r.label) + "</a></td><td>" +
                (s ? escapeHtml(formatTemp(s.mean, unit)) + ' <span class="text-muted">mean</span>' :
                    '<span class="text-muted">' + escapeHtml(r.loading ? "…" : REASONS[r.reason] || "none") + "</span>") +
                '</td><td class="text-right">' + saveLink(state, r) + '<a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" + formHtml(state.form, "region") +
            (shown ? '<div class="dt-inspector-shown" data-profile-of="region"><strong>' + escapeHtml(shown.label) + "</strong> " +
                '<span class="text-muted">' + escapeHtml(SHAPE_NAMES[shown.shape] || "") + "</span>" + statisticsHtml(shown, unit, state.isotherm) +
                (shown.profile && shown.statistics ? '<button type="button" class="btn btn-default btn-xs" data-act="csv-profile"><i class="fa fa-download"></i> Profile CSV</button>' : "") +
                "</div>" : "") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle-regions">' + (state.regionsVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv-regions"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear-regions"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    // frames: a click shows the frames that saw a point of a layer shown
    function readoutHtml(r, unit, frames) {
        if (!r) return '<span class="text-muted">Move the cursor over a thermal layer.' + (frames ? " Click it to see the frames that saw the point." : "") + "</span>";
        if (r.error) return '<span class="text-danger">' + escapeHtml(r.error) + "</span>";
        if (!r.valid) return '<span class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperature here") + "</span>";
        return '<span class="dt-inspector-temp">' + escapeHtml(formatTemp(r.temperature, unit)) + "</span>";
    }

    // state: the panel's (its pins, form, what can be saved and the corrected temperatures)
    function pinsHtml(state, unit) {
        var pins = state.pins, temp = state.pinTemp || function (p) { return p.temperature; };
        if (!pins.length) return '<div class="text-muted dt-inspector-hint">Choose Pin, then click the map to keep a point\'s temperature.</div>';
        return '<table class="table table-condensed dt-inspector-pins"><tbody>' + pins.map(function (p) {
            var c = temp(p);
            return '<tr data-pin="' + escapeHtml(p.id) + '"><td><a href="javascript:void(0)" data-act="goto" title="Show on the map">' +
                escapeHtml(p.label) + "</a></td><td>" +
                (c === null || c === undefined ? '<span class="text-muted">' + escapeHtml(REASONS[p.reason] || "none") + "</span>" :
                    escapeHtml(formatTemp(c, unit))) +
                '</td><td class="text-right">' + saveLink(state, p) + '<a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" + formHtml(state.form, "pin") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle">' + (state.pinsVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    // -- saved measurements ------------------------------------------------------------------------------------------

    // A pin's or region's Save, for who can save on the layer under it (state.savable, by id)
    function saveLink(state, item) {
        return (state.savable || {})[item.id] ? '<a href="javascript:void(0)" data-act="save" title="Save it, named, for everyone who can view the project"><i class="fa fa-save"></i></a>' : "";
    }

    // The form naming a measurement saved (kind: pin, region or saved), under its list
    function formHtml(form, kind) {
        if (!form || form.kind !== kind) return "";
        return '<div class="dt-inspector-form"><strong>' + (kind === "saved" ? "Edit the saved measurement" : "Save " + escapeHtml(form.label)) + "</strong>" +
            '<input type="text" class="form-control input-sm" data-form="name" maxlength="255" placeholder="Name" value="' + escapeHtml(form.name) + '">' +
            '<textarea class="form-control input-sm" data-form="comment" rows="2" maxlength="2000" placeholder="Comment (optional)">' + escapeHtml(form.comment) + "</textarea>" +
            (form.error ? '<div class="text-danger dt-inspector-hint">' + escapeHtml(form.error) + "</div>" : "") +
            '<div class="dt-inspector-actions"><button type="button" class="btn btn-primary btn-xs" data-act="form-save"' + (form.busy ? " disabled" : "") + ">" +
            (form.busy ? '<i class="fa fa-spinner fa-spin"></i> ' : "") + (kind === "saved" ? "Save changes" : "Save") + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="form-cancel">Cancel</button></div></div>';
    }

    // The saved measurements of the layers on the map: [{key (source|id), source, m}]
    function savedItems(state) {
        var found = [];
        (state.onMap || []).forEach(function (key) {
            var src = state.sources[key];
            ((src && src.measurements) || []).forEach(function (m) { found.push({key: key + "|" + m.id, source: src, m: m}); });
        });
        return found;
    }

    // A saved region as the region list's (statisticsHtml, regionArea)
    function savedRegion(m) {
        return assign({}, m.values, {label: m.name, shape: m.shape});
    }

    function describeLimits(limits, unit) {
        if (!limits) return "";
        if (limits.low !== null && limits.high !== null) return "between " + formatTemp(limits.low, unit) + " and " + formatTemp(limits.high, unit);
        return limits.low !== null ? "above " + formatTemp(limits.low, unit) : "below " + formatTemp(limits.high, unit);
    }

    function savedValue(m, unit) {
        var v = m.values || {};
        if (m.shape === "pin") return v.temperature === null || v.temperature === undefined ? '<span class="text-muted">' + escapeHtml(REASONS[v.reason] || "none") + "</span>" : escapeHtml(formatTemp(v.temperature, unit));
        return v.statistics ? escapeHtml(formatTemp(v.statistics.mean, unit)) + ' <span class="text-muted">mean</span>' : '<span class="text-muted">' + escapeHtml(REASONS[v.reason] || "none") + "</span>";
    }

    function savedHtml(state, unit) {
        var items = savedItems(state);
        if (!items.length) {
            var any = (state.onMap || []).some(function (k) { return state.sources[k] && state.sources[k].can_change; });
            return '<div class="text-muted dt-inspector-hint">' + (any ? "None yet: a pin's, region's or line's Save keeps it here for everyone who can view the project." : "None.") + "</div>";
        }
        var shown = items.filter(function (i) { return i.key === state.savedShown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + items.map(function (i) {
            var icon = i.m.shape === "pin" ? "fa fa-map-pin" : SHAPES[i.m.shape];
            return '<tr data-saved="' + escapeHtml(i.key) + '"' + (i === shown ? ' class="active"' : "") + '><td><i class="' + icon + '"></i> ' +
                '<a href="javascript:void(0)" data-act="goto" title="Show on the map">' + escapeHtml(i.m.name) + "</a></td><td>" + savedValue(i.m, unit) +
                '</td><td class="text-right">' + (i.source.can_change ? '<a href="javascript:void(0)" data-act="edit" title="Rename it or change its comment"><i class="fa fa-pencil-alt"></i></a>' +
                    '<a href="javascript:void(0)" data-act="delete" title="Delete it for everyone"><i class="fa fa-times"></i></a>' : "") + "</td></tr>";
        }).join("") + "</tbody></table>" + formHtml(state.form, "saved") +
            (shown ? savedShownHtml(shown, unit) : "") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle-saved">' + (state.savedVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv-saved"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="geojson-saved"><i class="fa fa-download"></i> GeoJSON</button></div>';
    }

    // A saved measurement's details: where, who, its comment, how it was measured, and its values as they were saved
    function savedShownHtml(item, unit) {
        var m = item.m, c = m.correction, lines = [];
        lines.push(escapeHtml(item.source.name + (m.tab ? " › " + (MOSAIC_TABS[m.tab] || m.tab) : "")));
        lines.push("Saved by " + escapeHtml(m.created_by || "?") + (m.created_at ? ", " + escapeHtml(String(m.created_at).slice(0, 10)) : ""));
        if (c) {
            lines.push(escapeHtml("Corrected to emissivity " + c.emissivity.toFixed(2) + ", reflected " + formatTemp(c.reflected, unit) +
                " (measured with " + c.baseline.emissivity.toFixed(2) + ", " + formatTemp(c.baseline.reflected, unit) + ")"));
        }
        if (m.isotherm) lines.push(escapeHtml("Isotherm " + describeLimits(m.isotherm, unit)));
        var body = m.shape === "pin" ? '<div class="dt-inspector-readout"><span class="dt-inspector-temp">' + savedValue(m, unit) + "</span></div>" :
            statisticsHtml(savedRegion(m), unit, true) +
            (m.values && m.values.profile && m.values.statistics ? '<button type="button" class="btn btn-default btn-xs" data-act="csv-saved-profile"><i class="fa fa-download"></i> Profile CSV</button>' : "");
        return '<div class="dt-inspector-shown" data-profile-of="saved"><strong>' + escapeHtml(m.name) + "</strong> " +
            '<span class="text-muted">' + escapeHtml(m.shape === "pin" ? "Pin" : SHAPE_NAMES[m.shape] || "") + "</span>" +
            (m.comment ? '<div class="dt-inspector-comment">' + escapeHtml(m.comment) + "</div>" : "") +
            lines.map(function (l) { return '<div class="text-muted dt-inspector-hint">' + l + "</div>"; }).join("") + body + "</div>";
    }

    // The saved measurements as a table's rows: one per measurement, in the user's unit
    function savedRows(items, unit) {
        var u = unit.toLowerCase();
        var head = ["name", "comment", "shape", "layer", "tab", "created_at", "created_by", "latitude", "longitude", "temperature_" + u,
                    "pixels", "area_m2", "length_m"].concat(["min", "max", "mean", "std", "median", "p2", "p98", "surroundings", "delta_t"].map(function (k) { return k + "_" + u; }))
            .concat(["isotherm_low_" + u, "isotherm_high_" + u, "isotherm_share_pct", "emissivity", "reflected_" + u, "measured_emissivity", "measured_reflected_" + u]);
        var t = function (c) { return c === null || c === undefined ? "" : Number(shownTemp(c, unit).toFixed(3)); };
        var d = function (c) { return c === null || c === undefined ? "" : Number((unit === "F" ? c * 1.8 : c).toFixed(3)); };
        var rows = items.map(function (i) {
            var m = i.m, v = m.values || {}, s = v.statistics || {}, p = s.percentiles || {}, iso = m.isotherm || {}, c = m.correction;
            var area = m.shape !== "pin" ? regionArea(savedRegion(m)) : null, pin = m.shape === "pin" ? m.geometry.coordinates : null;
            return [m.name, m.comment || "", m.shape, i.source.name, m.tab || "", m.created_at || "", m.created_by || "",
                    pin ? Number(pin[1].toFixed(8)) : "", pin ? Number(pin[0].toFixed(8)) : "", t(v.temperature), s.count === undefined ? "" : s.count,
                    area === null ? "" : Number(area.toFixed(3)), typeof v.length === "number" ? Number(v.length.toFixed(3)) : "",
                    t(s.min), t(s.max), t(s.mean), d(s.std), t(s.median), t(p["2"]), t(p["98"]), t(s.surroundings), d(s.delta_t),
                    t(iso.low), t(iso.high), typeof s.isotherm_share === "number" ? Number((s.isotherm_share * 100).toFixed(2)) : "",
                    c ? c.emissivity : "", c ? t(c.reflected) : "", c ? c.baseline.emissivity : "", c ? t(c.baseline.reflected) : ""];
        });
        return {head: head, rows: rows};
    }
    function savedCsv(items, unit) {
        var table = savedRows(items, unit);
        return [table.head].concat(table.rows).map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
    }
    // As GeoJSON: each one's geometry (a circle's as the polygon it was measured with), its row as properties
    function savedGeoJson(items, unit) {
        var table = savedRows(items, unit);
        return JSON.stringify({type: "FeatureCollection", features: items.map(function (i, n) {
            var props = {};
            table.head.forEach(function (k, j) { if (k !== "latitude" && k !== "longitude") props[k] = table.rows[n][j] === "" ? null : table.rows[n][j]; });
            return {type: "Feature", geometry: i.m.geometry, properties: props};
        })}, null, 1) + "\n";
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
            ["hover", "pin", "rectangle", "circle", "polygon", "line"].map(function (m) {
                var label = m === "hover" ? '<i class="fa fa-mouse-pointer"></i> Hover' : m === "pin" ? '<i class="fa fa-map-pin"></i> Pin' :
                    '<i class="' + SHAPES[m] + '"></i>';
                return '<button type="button" class="btn btn-' + (state.mode === m ? "primary" : "default") + '" data-mode="' + m + '"' +
                    (SHAPES[m] ? ' title="' + (m === "line" ? "Draw a line: its temperatures along it" : "Draw a region: " + SHAPE_NAMES[m].toLowerCase()) + '"' : "") + ">" + label + "</button>";
            }).join("") + "</div>" +
            (state.mode === "polygon" ? '<div class="text-muted dt-inspector-hint">Click the corners; double-click or Enter finishes, Esc cancels.</div>' : "") +
            (state.mode === "line" ? '<div class="text-muted dt-inspector-hint">Click the line\'s points; double-click or Enter finishes, Esc cancels.</div>' : "") +
            (state.notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.notice) + "</div>" : "") +
            '<div class="dt-inspector-readout">' + readoutHtml(state.readout, unit, state.frames) + "</div>" +
            (options.length ? '<label class="dt-inspector-label">Palette <select class="form-control input-sm" data-act="palette">' +
                options.map(function (o) {
                    return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === current ? " selected" : "") + ">" + escapeHtml(o[1]) + "</option>";
                }).join("") + "</select></label>" : "") + scaleHtml(state.scale, state, unit) +
            '<label class="dt-inspector-label dt-inspector-check"><input type="checkbox" data-act="legend"' + (state.legendVisible ? " checked" : "") +
            "> Legend on the map</label>" + imageHtml(state.scale) +
            mosaicsHtml(state) +
            '<div class="dt-inspector-section"><strong>Isotherm</strong>' + isothermHtml(state.isotherm, unit) +
            (state.isothermNotice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.isothermNotice) + "</div>" : "") + "</div>" +
            '<div class="dt-inspector-section"><strong>Correction</strong>' + correctionHtml(state.correction, unit, (state.onMap || []).map(function (k) { return state.sources[k]; }).filter(Boolean), state.correctionNotice) + "</div>" +
            '<div class="dt-inspector-section"><strong>Pinned points</strong>' + pinsHtml(state, unit) + "</div>" +
            '<div class="dt-inspector-section"><strong>Regions and lines</strong>' + regionsHtml(state, unit) + "</div>" +
            ((state.onMap || []).length ? '<div class="dt-inspector-section"><strong>Saved measurements</strong>' + savedHtml(state, unit) + "</div>" : "");
    }

    function csrfToken(doc) {
        var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
        return m ? decodeURIComponent(m[1]) : "";
    }

    function readJson(res) {
        return res.json().then(function (data) { return {ok: res.ok, data: data}; },
                               function () { return {ok: res.ok, data: {}}; });
    }

    // A box (the panel, the legend) dragged over the map: moved by an offset (a CSS translate) that keeps it inside
    // area (the map's element); grabs(target) says whether a press there starts a drag (not on a link or a field);
    // moved(offset) follows each move. The box grabbed last is drawn over the map's other controls (its Leaflet corner
    // raised) until it is back in its place. reset puts it back
    function movable(box, area, grabs, moved, doc) {
        var offset = {x: 0, y: 0}, drag = null;
        doc = doc || box.ownerDocument;
        function corner() { return box.closest(".leaflet-top, .leaflet-bottom") || box; }
        function set(x, y) {
            offset = {x: x, y: y};
            box.style.transform = x || y ? "translate(" + x + "px, " + y + "px)" : "";
            if (!x && !y) corner().style.zIndex = "";
            if (moved) moved(offset);
        }
        function place(x, y) {
            var r = box.getBoundingClientRect(), a = area.getBoundingClientRect();
            var left = r.left - offset.x, top = r.top - offset.y;       // where it is unmoved
            // Inside the area; a box wider or taller than the area keeps its left or top edge in it
            x = Math.max(a.left - left, Math.min(x, a.right - (left + r.width)));
            y = Math.max(a.top - top, Math.min(y, a.bottom - (top + r.height)));
            set(Math.round(x) || 0, Math.round(y) || 0);
        }
        function onMove(e) {
            if (!drag) return;
            e.preventDefault();
            place(drag.x + e.clientX - drag.startX, drag.y + e.clientY - drag.startY);
        }
        function onUp() {
            drag = null;
            box.classList.remove("dt-moving");
            doc.removeEventListener("pointermove", onMove);
            doc.removeEventListener("pointerup", onUp);
            doc.removeEventListener("pointercancel", onUp);
        }
        box.addEventListener("pointerdown", function (e) {
            if ((e.button && e.button !== 0) || !grabs(e.target)) return;
            e.preventDefault();
            e.stopPropagation();        // not the map's own dragging
            drag = {x: offset.x, y: offset.y, startX: e.clientX, startY: e.clientY};
            corner().style.zIndex = String(++movedOnTop);
            box.classList.add("dt-moving");
            doc.addEventListener("pointermove", onMove);
            doc.addEventListener("pointerup", onUp);
            doc.addEventListener("pointercancel", onUp);
        });
        return {
            reset: function () { onUp(); set(0, 0); },
            keep: function () { if (offset.x || offset.y) place(offset.x, offset.y); },     // after the area or the box changed size
            offset: function () { return offset; }
        };
    }
    var movedOnTop = 1000;      // Leaflet's corners are at 1000: the box grabbed last goes over them
    var FIELDS = "a, button, input, select, textarea, label";      // a press on these is theirs, not a drag
    var FRAMES_WIDTH = 300, FRAMES_GAP = 8;                         // the source frames window beside the panel (px)

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
        var key = pinsKey(tasks), rkey = regionsKey(tasks), ikey = isothermKey(tasks), ckey = correctionKey(tasks);
        var regions = loadPins(storage, rkey).filter(function (r) { return r && r.geometry && SHAPES[r.shape]; });
        var state = {open: false, mode: "hover", readout: null, pins: loadPins(storage, key), pinsVisible: true,
                     regions: regions, regionsVisible: true, shown: regions.length ? regions[regions.length - 1].id : null,
                     notice: "", display: null, palette: "", isotherm: loadIsotherm(storage, ikey), isothermNotice: "",
                     legendVisible: legendShown(), mosaics: null, laid: {}, frames: false, pick: null,
                     correction: loadCorrection(storage, ckey), correctionNotice: "", sources: {}, onMap: [], savedVisible: true,
                     savedShown: null, form: null, savable: {}, scale: null, rangeError: "", preview: null};
        var project = projectOf(args.tiles, deps.path !== undefined ? deps.path : root.location && root.location.pathname);
        var search = deps.search !== undefined ? deps.search : root.location && root.location.search;
        var container, panel, frameBox, panelMove, legendMove, cursor, pinLayer, regionLayer, savedLayer, pickLayer, legend, tool = null, timer = null, seq = 0, applying = false, drawnAt = 0;
        var profileMarker = null, profileAt = null;     // the point of the profile hovered, on the map
        var pickSeq = 0;                    // the frames asked for last
        var overlays = [], colors = {};     // the isotherm's layer over each thermal layer; each palette's colours
        var curves = {};                    // the legends' curves with equalization, by their URL

        function render() {
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            state.frames = thermalLayers(map).some(function (t) { return !!framesSource(t, state.mosaics); });
            state.onMap = sourcesOnMap();
            state.pinTemp = pinTemp;
            state.savable = {};
            state.pins.forEach(function (p) { state.savable[p.id] = canSaveAt({lat: p.lat, lng: p.lng}); });
            state.regions.forEach(function (r) { state.savable[r.id] = !!r.statistics && canSaveAt(regionBounds(r).getCenter()); });
            state.scale = scaleState();
            panel.innerHTML = panelHtml(state);
            // Within the map, above its bottom controls
            var room = map.getContainer().clientHeight - container.offsetTop - 60;
            if (room > 0) panel.style.maxHeight = Math.max(160, room) + "px";
            panelMove.keep();       // moved, and now taller: still inside the map
        }

        function legendShown() {
            try { return storage.getItem(LEGEND_KEY) !== "0"; } catch (e) { return true; }
        }

        // -- what each thermal layer was measured with, and its saved measurements -----------------------------------

        // A thermal layer's saved measurements: its task's, or its mosaic's workset's
        function layerSource(t) {
            if (t.mosaic) return {key: "m:" + t.mosaic.dataset + "/" + t.mosaic.workset, url: mosaicBase(t.mosaic) + "/measurements", name: t.mosaic.name};
            return {key: "t:" + t.task, url: inspectorUrl(t, "measurements"), name: t.name || "This task"};
        }
        function sourcesOnMap() {
            var keys = [];
            thermalLayers(map, true).forEach(function (t) {
                var k = layerSource(t).key;
                if (keys.indexOf(k) === -1 && state.sources[k]) keys.push(k);
            });
            return keys;
        }
        // The saved measurements and baseline of the thermal layers on the map, asked for once each
        function loadSources() {
            thermalLayers(map, true).forEach(function (t) {
                var src = layerSource(t);
                if (state.sources[src.key]) return;
                state.sources[src.key] = assign(src, {loading: true, measurements: [], can_change: false, baseline: null});
                fetchFn(src.url, {credentials: "same-origin"}).then(readJson).then(function (r) {
                    if (r.ok) assign(src, {measurements: r.data.measurements || [], can_change: !!r.data.can_change, baseline: r.data.baseline || null});
                }, function () {}).then(function () {
                    src.loading = false;
                    correctionChanged(true);
                    drawSaved();
                });
            });
        }
        function canSaveAt(latlng) {
            var t = thermalLayerAt(map, latlng), src = t && state.sources[layerSource(t).key];
            return !!(src && src.can_change);
        }

        // The correction of a layer (or of the layer a source key names), when it is on and the layer's baseline known
        function fixForKey(k) {
            var c = state.correction, src = state.sources[k];
            if (!c.on || !validCorrection(c) || !src || !src.baseline) return null;
            return {wanted: {emissivity: c.emissivity, reflected: c.reflected}, baseline: src.baseline};
        }
        function fixFor(t) { return t ? fixForKey(layerSource(t).key) : null; }
        function fixKey(fix) { return JSON.stringify(fix ? fix.wanted : null); }
        // A pin's temperature shown: corrected for the layer it was read on
        function pinTemp(p) { return p.source ? corrected(p.temperature, fixForKey(p.source)) : p.temperature; }

        // The correction or a layer's baseline changed (known): the temperatures shown again, the regions measured with
        // another correction measured again
        function correctionChanged(known) {
            if (!known) saveCorrection(storage, ckey, state.correction);
            state.regions.forEach(function (r) {
                if (r.loading || (!r.statistics && !r.reason)) return;
                var t = thermalLayerAt(map, regionBounds(r).getCenter()) || thermalLayers(map)[0];
                if (t && (r.correction || "null") !== fixKey(fixFor(t))) measure(r);
            });
            drawIsotherms();
            renderLegend();
            drawPins();
            render();
        }

        function correctionInput(what, value) {
            var c = assign({}, state.correction), unit = userUnit();
            state.correctionNotice = "";
            if (what === "on") {
                c.on = value;
                // Starting from what the topmost layer was measured with
                if (value && !validCorrection(c)) {
                    var layers = thermalLayers(map), t = layers[layers.length - 1];
                    var src = t && state.sources[layerSource(t).key], b = src && src.baseline;
                    c.emissivity = b ? b.emissivity : 0.95;
                    c.reflected = b ? b.reflected : 20;
                }
            } else {
                var typed = parseFloat(value);
                if (!isFinite(typed)) { state.correctionNotice = "Enter a number"; return render(); }
                c[what] = what === "reflected" ? typedTemp(typed, unit) : typed;
                if (!validCorrection(c)) {
                    state.correctionNotice = what === "emissivity" ? "The emissivity is between " + EMISSIVITY[0] + " and " + EMISSIVITY[1] :
                        "The reflected temperature is between " + formatTemp(REFLECTED[0], unit) + " and " + formatTemp(REFLECTED[1], unit);
                    return render();
                }
            }
            state.correction = c;
            correctionChanged();
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
                var iso = rawIsotherm(state.isotherm, fixFor(t));
                var url = t.mosaic ? mosaicIsothermUrl(t.mosaic, iso) : isothermUrl(t.layer._url, iso);
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
            restylePick();
            if (!legend) return;
            var t = topLayer(), name = layerPalette(t), look = t && lookOf(t);
            if (!state.legendVisible || !look || !look.range || !name) { legend.hidden = true; return; }
            var c = paletteColors(t, name);
            if (!c) { legend.hidden = true; return; }
            var label = ((state.display && state.display.palettes) || []).indexOf(name) !== -1 ? "DJI " + name : name;
            legend.innerHTML = legendHtml(c, look.range, label, userUnit(), state.isotherm, fixFor(t), layerExtent(t), sharesOf(t, look));
            legend.hidden = false;
            legendMove.keep();
        }

        // -- the colour scale and the Image section: the topmost thermal layer's ------------------------------------

        function topLayer() { var layers = thermalLayers(map); return layers[layers.length - 1] || null; }

        // A palette's colours, asked for once; the legend and the panel's scale drawn again when they come
        function paletteColors(t, name) {
            if (colors[name] === undefined) {
                colors[name] = null;
                fetchFn(paletteUrl(t, name), {credentials: "same-origin"}).then(readJson).then(function (r) {
                    colors[name] = r.ok && r.data.color_map ? r.data.color_map : false;
                    renderLegend();
                    showScale();
                }, function () { colors[name] = false; });
            }
            return colors[name] || null;
        }

        // How a thermal layer is drawn, {range (°C), adjust}: while a slider moves, as it would be drawn
        function lookOf(t) {
            if (state.preview && state.preview.layer === t.layer) return state.preview;
            return {range: layerRange(t), adjust: layerAdjust(t)};
        }

        // The scale's shares as a layer is drawn: with equalization, its server's curve (asked for once per range)
        function sharesOf(t, look) {
            if (!look.adjust.equalize || !look.range) return Scale.adjustShares(look.adjust);
            var url = curveUrl(t, look.range, look.adjust);
            if (curves[url] === undefined) {
                curves[url] = null;
                fetchFn(url, {credentials: "same-origin"}).then(readJson).then(function (r) {
                    curves[url] = r.ok && r.data.shares ? r.data.shares : false;
                    renderLegend();
                    showScale();
                }, function () { curves[url] = false; });
            }
            return curves[url] || null;
        }

        function layerName(t) {
            return t.mosaic ? t.mosaic.name + " › " + (MOSAIC_TABS[t.mosaic.tab] || t.mosaic.tab) : t.name || "This task";
        }

        // What the panel's scale and Image section show (scaleHtml's), or null without a thermal layer shown
        function scaleState() {
            var t = topLayer();
            if (!t) return null;
            var look = lookOf(t), name = layerPalette(t);
            return {name: thermalLayers(map).length > 1 ? layerName(t) : "", colors: name ? paletteColors(t, name) : null,
                    range: look.range, auto: autoRange(t, userUnit()), extent: layerExtent(t), adjust: look.adjust,
                    shares: look.range ? sharesOf(t, look) : null, fix: fixFor(t)};
        }

        // The panel's scale, range boxes and sliders as the layer is (or would be) drawn, without drawing the panel
        // again (the slider moved keeps its place)
        function showScale(moved) {
            var box = state.open && panel.querySelector(".dt-inspector-scale");
            if (!box) return;
            var s = state.scale = scaleState(), unit = userUnit();
            if (!s || !s.range) return render();
            var shown = function (c) { return roundShown(corrected(c, s.fix), unit); };
            box.querySelector(".dt-inspector-scale-bar").innerHTML = s.colors ? barHtml(s.colors, s.range, unit, state.isotherm, s.fix, s.shares) : "";
            var field = function (act) { return panel.querySelector('[data-act="' + act + '"]'); };
            field("range-min").value = shown(s.range[0]);
            field("range-max").value = shown(s.range[1]);
            var at = s.auto ? Scale.sliderPositions(s.auto, s.range) : {brightness: 0, contrast: 0};
            var sliders = {brightness: at.brightness, contrast: at.contrast, gamma: Scale.gammaSlider(s.adjust.gamma), sharpen: s.adjust.sharpen};
            Object.keys(sliders).forEach(function (k) {
                var input = field("image-" + k);
                if (input && input !== moved) input.value = sliders[k];
            });
            field("image-gamma-value").textContent = s.adjust.gamma.toFixed(2);
            field("image-sharpen-value").textContent = Number(s.adjust.sharpen).toFixed(1);
            field("image-tone").value = s.adjust.equalize ? "equalize" : "linear";
        }

        // The topmost layer drawn over a range (°C) with adjustments: a mosaic's tile URL, an orthophoto's (the
        // plugin's tiles once it is adjusted, WebODM's again when it is not, in one of WebODM's colour maps)
        function setLook(t, range, adjust) {
            var said = state.rangeError;
            state.preview = null;
            state.rangeError = "";
            if (t.mosaic) {
                restyleMosaic(t.layer, {range: range.map(function (c) { return fromCelsius(c, t.mosaic.unit); }), adjust: adjust});
            } else {
                var url = withPalette(withRange(t.layer._url, range), state.palette || paletteOf(t.layer._url), state.display, adjust);
                if (url !== t.layer._url) {
                    applying = true;
                    t.layer.setUrl(url, true);
                    if (t.layer._removeAllTiles) t.layer._removeAllTiles();
                    if (t.layer.redraw) t.layer.redraw();
                    applying = false;
                }
            }
            if (said) render();
            else showScale();
        }

        // The range typed, in the user's unit (corrected temperatures with a correction)
        function typedRange() {
            var t = topLayer(), fix = fixFor(t), unit = userUnit();
            var lo = parseFloat(panel.querySelector('[data-act="range-min"]').value), hi = parseFloat(panel.querySelector('[data-act="range-max"]').value);
            if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
            if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
            var raw = function (v) { return Math.round(uncorrected(typedTemp(v, unit), fix) * 1e4) / 1e4; };
            return {range: [raw(lo), raw(hi)]};
        }

        // A slider moved: brightness and contrast move the range from the Auto one, gamma and sharpening the
        // adjustments; shown at once, drawn when let go (commit)
        function slide(input, commit) {
            var t = topLayer();
            if (!t) return;
            var look = lookOf(t), name = input.getAttribute("data-act").slice("image-".length);
            var next = {layer: t.layer, range: look.range, adjust: assign({}, look.adjust)};
            var auto = autoRange(t, userUnit());
            if (name === "brightness" || name === "contrast") {
                if (!auto) return;
                var value = function (k) { return parseFloat(panel.querySelector('[data-act="image-' + k + '"]').value) || 0; };
                next.range = Scale.slidRange(auto, value("brightness"), value("contrast"));
            } else if (name === "gamma") next.adjust.gamma = Scale.sliderGamma(input.value);
            else next.adjust.sharpen = Math.round((parseFloat(input.value) || 0) * 100) / 100;
            if (commit) return setLook(t, next.range, next.adjust);
            state.preview = next;
            showScale(input);
            renderLegend();
        }

        function onScaleInput(what, target) {
            var t = topLayer();
            if (!t) return;
            var look = lookOf(t);
            if (what === "range-min" || what === "range-max") {
                var r = typedRange();
                if (r.error) { state.rangeError = r.error; return render(); }
                return setLook(t, r.range, look.adjust);
            }
            if (what === "image-tone") return setLook(t, look.range, assign({}, look.adjust, {equalize: target.value === "equalize"}));
            if (/^image-(brightness|contrast|gamma|sharpen)$/.test(what)) return slide(target, true);
        }

        function isothermChanged(iso) {
            state.isotherm = iso;
            state.isothermNotice = "";
            saveIsotherm(storage, ikey, iso);
            // The region shown is measured again for its share in the new isotherm, the others when shown
            var shown = state.regions.filter(function (r) { return r.id === state.shown; })[0];
            if (shown && shown.statistics && !shown.loading && shown.isotherm !== limitsKey(iso)) measure(shown);
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
                var range = layerRange(t), fix = fixFor(t);
                if (range && fix) range = range.map(function (c) { return corrected(c, fix); });
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
            if (el) el.innerHTML = readoutHtml(state.readout, userUnit(), state.frames);
        }

        function drawPins() {
            pinLayer.clearLayers();
            if (!state.pinsVisible) return;
            state.pins.forEach(function (p) {
                var marker = L.circleMarker([p.lat, p.lng], {radius: 5, color: "#fff", weight: 2, fillColor: "#d9534f", fillOpacity: 1});
                var c = pinTemp(p);
                marker.bindTooltip(p.label + (c === null || c === undefined ? "" : ": " + formatTemp(c)),
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

        function latLngs(r) {
            return (r.geometry.type === "LineString" ? r.geometry.coordinates : r.geometry.coordinates[0]).map(function (c) { return [c[1], c[0]]; });
        }
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
                    r.shape === "line" ? L.polyline(latLngs(r), assign({interactive: false}, style, {weight: style.weight + 1})) :
                    L.polygon(latLngs(r), assign({interactive: false}, style));
                regionLayer.addLayer(shape);
                // A line's label at its start, off the points its profile finds along it
                var labelled = r.shape !== "line" ? shape : L.circleMarker(latLngs(r)[0], {radius: 3, color: style.color, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false});
                labelled.bindTooltip(r.label, {permanent: true, direction: r.shape === "line" ? "left" : "center", className: "dt-inspector-tip"});
                if (labelled !== shape) regionLayer.addLayer(labelled);
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

        // -- saved measurements -------------------------------------------------------------------------------------

        function savedItem(k) { return savedItems(assign({}, state, {onMap: sourcesOnMap()})).filter(function (i) { return i.key === k; })[0]; }

        function savedLatLngs(m) {
            return (m.geometry.type === "LineString" ? m.geometry.coordinates : m.geometry.coordinates[0]).map(function (c) { return [c[1], c[0]]; });
        }

        function drawSaved() {
            savedLayer.clearLayers();
            if (!state.savedVisible) return;
            savedItems(assign({}, state, {onMap: sourcesOnMap()})).forEach(function (i) {
                var m = i.m, style = i.key === state.savedShown ? assign({}, SAVED_STYLE, {weight: 3}) : SAVED_STYLE, shape;
                if (m.shape === "pin") {
                    var c = m.geometry.coordinates;
                    shape = L.circleMarker([c[1], c[0]], {radius: 5, color: "#fff", weight: 2, fillColor: SAVED_STYLE.color, fillOpacity: 1, interactive: false});
                } else if (m.circle) shape = L.circle([m.circle.lat, m.circle.lng], assign({radius: m.circle.radius, interactive: false}, style));
                else if (m.shape === "line") shape = L.polyline(savedLatLngs(m), assign({interactive: false}, style, {weight: style.weight + 1}));
                else shape = L.polygon(savedLatLngs(m), assign({interactive: false}, style));
                shape.bindTooltip(m.name, {permanent: true, direction: m.shape === "pin" ? "right" : "center", className: "dt-inspector-tip dt-inspector-saved-tip"});
                savedLayer.addLayer(shape);
            });
        }

        function savedBounds(m) {
            if (m.shape === "pin") return L.latLngBounds([[m.geometry.coordinates[1], m.geometry.coordinates[0]]]);
            return L.latLngBounds(savedLatLngs(m));
        }

        // The form for a pin, region or saved measurement (kind) of an id
        function openForm(kind, id) {
            var item = kind === "pin" ? state.pins.filter(function (p) { return p.id === id; })[0] :
                kind === "region" ? state.regions.filter(function (r) { return r.id === id; })[0] : savedItem(id);
            if (!item) return;
            state.form = kind === "saved" ? {kind: kind, id: id, label: item.m.name, name: item.m.name, comment: item.m.comment || ""} :
                {kind: kind, id: id, label: item.label, name: item.label, comment: ""};
            render();
            var input = panel.querySelector('[data-form="name"]');
            if (input && input.focus) input.focus();
        }

        function request(url, method, body) {
            return fetchFn(url, {method: method, credentials: "same-origin",
                headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken(doc)},
                body: body === undefined ? undefined : JSON.stringify(body)}).then(readJson);
        }

        // The form's Save: a pin or region measured and saved on the layer under it, or a saved one renamed
        function submitForm() {
            var form = state.form;
            if (!form || form.busy) return;
            if (!form.name.trim()) { form.error = "Give it a name"; return render(); }
            var done, item;
            if (form.kind === "saved") {
                item = savedItem(form.id);
                if (!item) return;
                done = request(item.source.url + "/" + item.m.id, "PATCH", {name: form.name, comment: form.comment}).then(function (r) {
                    if (r.ok) assign(item.m, r.data);
                    return r;
                });
            } else {
                var pin = form.kind === "pin" && state.pins.filter(function (p) { return p.id === form.id; })[0];
                var region = form.kind === "region" && state.regions.filter(function (r) { return r.id === form.id; })[0];
                if (!pin && !region) return;
                var at = pin ? L.latLng(pin.lat, pin.lng) : regionBounds(region).getCenter(), t = thermalLayerAt(map, at);
                var src = t && state.sources[layerSource(t).key];
                if (!src) { form.error = "No thermal layer here"; return render(); }
                var fix = fixFor(t);
                var body = {name: form.name, comment: form.comment, shape: pin ? "pin" : region.shape, correction: fix ? fix.wanted : null,
                            geometry: pin ? {type: "Point", coordinates: [pin.lng, pin.lat]} : region.geometry};
                if (region) body.isotherm = isothermLimits(state.isotherm);
                if (region && region.circle) body.circle = region.circle;
                if (t.mosaic) body.tab = t.mosaic.tab;
                // Once saved, it is no longer the browser's own
                done = request(src.url, "POST", body).then(function (r) {
                    if (r.ok) {
                        src.measurements.push(r.data);
                        state.savedShown = src.key + "|" + r.data.id;
                        if (pin) { state.pins = state.pins.filter(function (p) { return p !== pin; }); pinsChanged(); }
                        if (region) {
                            state.regions = state.regions.filter(function (x) { return x !== region; });
                            if (state.shown === region.id) state.shown = null;
                            regionsChanged();
                        }
                    }
                    return r;
                });
            }
            form.busy = true;
            form.error = "";
            render();
            return done.then(function (r) {
                form.busy = false;
                if (r.ok) state.form = null;
                else form.error = (r.data && (r.data.error || r.data.detail)) || "Could not save it";
            }, function () { form.busy = false; form.error = "Could not save it"; }).then(function () { drawSaved(); render(); });
        }

        function deleteSaved(item) {
            var ask = deps.confirm || function (text) { return !root.confirm || root.confirm(text); };
            if (!ask("Delete the saved measurement \u201c" + item.m.name + "\u201d for everyone?")) return;
            return request(item.source.url + "/" + item.m.id, "DELETE").then(function (r) {
                if (r.ok) {
                    item.source.measurements = item.source.measurements.filter(function (m) { return m !== item.m; });
                    if (state.savedShown === item.key) state.savedShown = null;
                    if (state.form && state.form.kind === "saved" && state.form.id === item.key) state.form = null;
                }
                drawSaved();
                render();
            }, function () {});
        }

        // The statistics of a region, from the thermal orthophoto at its centre; with the isotherm shown, its share in it
        function measure(r) {
            var t = thermalLayerAt(map, regionBounds(r).getCenter()) || thermalLayers(map)[0];
            if (!t) {
                assign(r, {loading: false, statistics: null, reason: "outside_raster"});
                return Promise.resolve(regionsChanged());
            }
            r.loading = true;
            r.error = null;
            var iso = limitsKey(state.isotherm), fix = fixFor(t);
            return fetchFn(inspectorUrl(t, "region"), {method: "POST", credentials: "same-origin",
                headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken(doc)},
                body: JSON.stringify({geometry: r.geometry, isotherm: isothermLimits(state.isotherm), correction: fix ? fix.wanted : null})}).then(readJson).then(function (res) {
                if (!res.ok) return {error: (res.data && (res.data.error || res.data.detail)) || "Could not read the region"};
                return res.data;
            }, function () { return {error: "Could not read the region"}; }).then(function (data) {
                r.loading = false;
                if (data.error) r.error = data.error;
                else assign(r, {statistics: data.statistics || null, reason: data.reason || null, pixel_size: data.pixel_size,
                                resampled: !!data.resampled, length: data.length, profile: data.profile || null, isotherm: iso, correction: fixKey(fix)});
                if (state.regions.indexOf(r) === -1) return;
                // The correction changed while it was measured
                if (!data.error && r.correction !== fixKey(fixFor(t))) return measure(r);
                regionsChanged();
            });
        }

        function regionDrawn(shape, drawn) {
            drawnAt = Date.now();
            map.removeLayer(drawn.layer);       // drawn again with the others
            var prefix = shape === "line" ? "L" : "R";
            var n = state.regions.reduce(function (m, r) {
                return String(r.label).charAt(0) === prefix ? Math.max(m, Number(String(r.label).replace(/\D/g, "")) || 0) : m;
            }, 0) + 1;
            var r = {id: String(Date.now()) + "r" + n, label: prefix + n, shape: shape, geometry: drawn.geometry, statistics: null, reason: null};
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
                    var fix = fixFor(t);
                    state.readout = fix && r && r.valid ? assign({}, r, {temperature: corrected(r.temperature, fix)}) : r;
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
        // In Hover, one on a layer with source frames shows them (else it is WebODM's); a pin shows them too
        function onClick(e) {
            if (Date.now() - drawnAt < DRAWN_CLICK_MS) return true;
            if (!state.open) return false;
            var t = state.mode === "hover" || state.mode === "pin" ? thermalLayerAt(map, e.latlng) : null;
            if (state.mode === "hover") return showFrames(t, e.latlng);
            if (state.mode !== "pin") return true;
            if (!t) return true;
            showFrames(t, e.latlng);
            var n = state.pins.reduce(function (m, p) { return Math.max(m, Number(String(p.label).replace(/\D/g, "")) || 0); }, 0) + 1;
            var pin = {id: String(Date.now()) + n, label: "P" + n, lat: e.latlng.lat, lng: e.latlng.lng, temperature: null, reason: null, source: layerSource(t).key};
            query(t, e.latlng).then(function (r) {
                pin.temperature = r && r.valid ? r.temperature : null;
                pin.reason = r && !r.valid ? (r.reason || "error") : null;
                state.pins.push(pin);
                pinsChanged();
            });
            return true;
        }

        // -- the source frames window ------------------------------------------------------------------------------

        // The frames that saw a point of a thermal layer, beside the panel; keep: the frame to show again if it saw the
        // point too. False (nothing shown) for a layer without source frames.
        function showFrames(t, latlng, keep) {
            var src = framesSource(t, state.mosaics, state.palette, state.display);
            if (!src) return false;
            var n = ++pickSeq;
            fetchFn(Frames.framesUrl(src.base, src.tab, latlng), {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (n !== pickSeq || !state.open) return;
                var frames = r.ok ? r.data.frames || [] : [];
                if (src.orthophoto) frames = Frames.orthophotoFrames(frames);
                var at = frames.map(function (f) { return f.index; }).indexOf(keep);
                state.pick = {t: t, latlng: latlng, frames: frames, models: !r.ok || r.data.models, at: at < 0 ? 0 : at,
                              orthophoto: src.orthophoto, error: r.ok ? "" : (r.data && (r.data.error || r.data.detail)) || "Could not find the frames here."};
                drawPick();
            }, function () {});
            return true;
        }

        function frameImageUrl(pick) {
            var src = framesSource(thermalLayer(pick.t.layer), state.mosaics, state.palette, state.display), f = pick.frames[pick.at];
            return src && f ? Frames.frameUrl(src.base, src.tab, f.index, src.query) : "";
        }

        function drawPick() {
            var pick = state.pick, f = pick.frames[pick.at];
            frameBox.hidden = false;
            frameBox.innerHTML = Frames.pipHtml(pick, frameImageUrl(pick));
            placeFrames(panelMove.offset());
            if (pick.error) frameBox.querySelector(".ta-message").textContent = pick.error;
            pickLayer.clearLayers();
            L.circleMarker(pick.latlng, {radius: 6, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 1, interactive: false}).addTo(pickLayer);
            if (f && f.footprint) {
                L.polygon(f.footprint.map(function (c) { return [c[1], c[0]]; }),
                          {color: "#fff", weight: 2, dashArray: "6 4", fill: false, interactive: false}).addTo(pickLayer);
            }
        }

        // The frame shown drawn again as its layer is (palette, range)
        function restylePick() {
            var img = state.pick && frameBox.querySelector("img");
            var url = img && frameImageUrl(state.pick);
            if (url && img.getAttribute("src") !== url) img.setAttribute("src", url);
        }

        // The source frames window moves with the panel, beside it: on its left, or on its right when only that has room
        function placeFrames(offset) {
            frameBox.style.transform = panel.style.transform;
            var a = map.getContainer().getBoundingClientRect(), p = panel.getBoundingClientRect();
            var room = (frameBox.offsetWidth || FRAMES_WIDTH) + FRAMES_GAP;
            frameBox.classList.toggle("dt-inspector-frames-right", !!(offset.x || offset.y) && p.left - a.left < room && a.right - p.right >= room);
        }

        function closeFrames() {
            pickSeq++;
            state.pick = null;
            if (!frameBox) return;
            frameBox.hidden = true;
            frameBox.innerHTML = "";
            pickLayer.clearLayers();
        }

        function onFramesClick(e) {
            var b = e.target.closest("button[data-pip]");
            if (!b || b.disabled || !state.pick) return;
            var action = b.getAttribute("data-pip");
            if (action === "close") return closeFrames();
            state.pick.at = Math.max(0, Math.min(state.pick.frames.length - 1, state.pick.at + (action === "next" ? 1 : -1)));
            drawPick();
        }

        // The thermal layers' palette: the user's preference, applied as each layer comes
        function applyPalette(t) {
            if (!state.palette) return;
            if (t.mosaic) return restyleMosaic(t.layer, {key: paletteKey(mosaicOf(t.mosaic), state.palette, state.display)});
            var url = withPalette(t.layer._url, state.palette, state.display, adjustOf(t.layer._url));
            if (url === t.layer._url) return;
            applying = true;
            t.layer.setUrl(url, true);
            if (t.layer._removeAllTiles) t.layer._removeAllTiles();
            if (t.layer.redraw) t.layer.redraw();
            applying = false;
        }

        // WebODM's layer panel sets the URL from its own colour map (its list shows what it was given) and range: a
        // colour map chosen there is the user's (saved when it is one of the palettes offered, else drawn on this page
        // only); a range alone keeps the user's palette, DJI's too, and the Image section's adjustments. A range set
        // there is the layer's; the panel's own range, sent again with another change, doesn't undo the Inspector's
        function watch(t) {
            if (t.mosaic || t.layer.__dtWatched) return;
            t.layer.__dtWatched = true;
            t.layer.__dtPanelMap = colorMapOf(t.layer._url);
            t.layer.__dtPanelRange = paramOf(t.layer._url, "rescale");
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
                    var range = paramOf(url, "rescale");
                    if (range && range === t.layer.__dtPanelRange && rangeOf(t.layer._url)) args[0] = withRange(args[0], rangeOf(t.layer._url));
                    else t.layer.__dtPanelRange = range;
                    var name = state.palette || chosen || paletteOf(t.layer._url);
                    if (name) args[0] = withPalette(args[0], name, state.display, adjustOf(t.layer._url));
                }
                var out = setUrl.apply(this, args);
                drawIsotherms();
                renderLegend();
                if (!applying) render();
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
            loadSources();
            drawSaved();
            render();
        }

        function onLayerRemove(e) {
            if (!thermalLayer(e.layer)) return;
            if (state.pick && state.pick.t.layer === e.layer) closeFrames();
            drawIsotherms();
            renderLegend();
            drawSaved();
            render();
        }

        // -- workset mosaics on the map -----------------------------------------------------------------------------

        function mosaicOf(info) {
            return (state.mosaics || []).filter(function (m) { return m.dataset.id === info.dataset && m.workset.id === info.workset; })[0] || {};
        }

        // A mosaic laid on the map drawn with changes ({tab, key, range, adjust}): its tile URL, and a tab's own range
        function restyleMosaic(layer, change) {
            var info = layer.__dtMosaic, m = mosaicOf(info);
            var next = change.tab && change.tab !== info.tab ? assign(laidMosaic(project, m, change.tab, state.palette, state.display), {adjust: info.adjust}) :
                assign({}, info, change);
            layer.__dtMosaic = next;
            var url = mosaicTileUrl(next);
            if (url !== layer._url) layer.setUrl(url);
            drawIsotherms();
            renderLegend();
            // The frames of the tab now shown, the same one shown if it saw the point too
            var pick = state.pick, f = pick && pick.frames[pick.at];
            if (pick && pick.t.layer === layer && next.tab !== info.tab) showFrames(thermalLayer(layer), pick.latlng, f && f.index);
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
            if (what === "range-auto" || what === "image-reset") {
                var top = topLayer(), auto = top && autoRange(top, userUnit());
                if (!top) return;
                return setLook(top, auto || lookOf(top).range, what === "image-reset" ? Scale.defaultAdjust() : lookOf(top).adjust);
            }
            if (what === "form-save") return submitForm();
            if (what === "form-cancel") { state.form = null; return render(); }
            // A saved measurement's row: shown (its name also zooms to it), edited or deleted
            var srow = e.target.closest("[data-saved]");
            var item = srow && savedItem(srow.getAttribute("data-saved"));
            if (item) {
                if (what === "edit") return openForm("saved", item.key);
                if (what === "delete") return deleteSaved(item);
                if (what === "goto") map.fitBounds(savedBounds(item.m), {maxZoom: map.getZoom()});
                state.savedShown = item.key;
                state.shown = null;
                drawSaved();
                drawRegions();
                return render();
            }
            // A click anywhere on a region's row shows its statistics (measured again if they never came)
            var rrow = e.target.closest("[data-region]");
            var region = rrow && state.regions.filter(function (r) { return r.id === rrow.getAttribute("data-region"); })[0];
            if (region) {
                if (what === "save") return openForm("region", region.id);
                if (what === "goto") map.fitBounds(regionBounds(region), {maxZoom: map.getZoom()});
                if (what === "remove") {
                    state.regions = state.regions.filter(function (r) { return r !== region; });
                    if (state.shown === region.id) state.shown = state.regions.length ? state.regions[state.regions.length - 1].id : null;
                } else {
                    state.shown = region.id;
                    if (!region.loading && (!region.statistics || (validIsotherm(state.isotherm) && region.isotherm !== limitsKey(state.isotherm)))) measure(region);
                    if (state.savedShown) { state.savedShown = null; drawSaved(); }
                }
                return regionsChanged();
            }
            if (!act) return;
            var row = act.closest("[data-pin]");
            var pin = row && state.pins.filter(function (p) { return p.id === row.getAttribute("data-pin"); })[0];
            if (what === "close") close();
            else if (what === "save" && pin) openForm("pin", pin.id);
            else if (what === "goto" && pin) {
                map.panTo([pin.lat, pin.lng]);
                showFrames(thermalLayerAt(map, L.latLng(pin.lat, pin.lng)), L.latLng(pin.lat, pin.lng));
            }
            else if (what === "remove" && pin) { state.pins = state.pins.filter(function (p) { return p !== pin; }); pinsChanged(); }
            else if (what === "toggle") { state.pinsVisible = !state.pinsVisible; drawPins(); render(); }
            else if (what === "clear") { state.pins = []; pinsChanged(); }
            else if (what === "csv") download("thermal-points.csv", pinsCsv(state.pins, userUnit(), pinTemp));
            else if (what === "toggle-saved") { state.savedVisible = !state.savedVisible; drawSaved(); render(); }
            else if (what === "csv-saved") download("thermal-saved-measurements.csv", savedCsv(savedItems(state), userUnit()));
            else if (what === "geojson-saved") download("thermal-saved-measurements.geojson", savedGeoJson(savedItems(state), userUnit()), "application/geo+json");
            else if (what === "csv-saved-profile") {
                var saved = savedItem(state.savedShown);
                if (saved && saved.m.values && saved.m.values.profile) download("thermal-profile-" + saved.m.name.replace(/[^\w.-]+/g, "_") + ".csv", profileCsv(saved.m.values, userUnit()));
            }
            else if (what === "toggle-regions") { state.regionsVisible = !state.regionsVisible; drawRegions(); render(); }
            else if (what === "clear-regions") { state.regions = []; state.shown = null; regionsChanged(); }
            else if (what === "csv-regions") download("thermal-regions.csv", regionsCsv(state.regions, userUnit()));
            else if (what === "csv-profile") {
                var line = state.regions.filter(function (r) { return r.id === state.shown; })[0];
                if (line && line.profile) download("thermal-profile-" + line.label + ".csv", profileCsv(line, userUnit()));
            } else if (what === "profile" && profileAt) showFrames(thermalLayerAt(map, profileAt), profileAt);
        }

        // Hovering the profile of the line shown: the point on the map, its distance, temperature and frame
        function onProfileMove(e) {
            var svg = e.target.closest && e.target.closest(".dt-inspector-profile svg");
            var of = svg && svg.closest("[data-profile-of]"), saved = of && of.getAttribute("data-profile-of") === "saved" && savedItem(state.savedShown);
            var line = saved ? saved.m.values : state.regions.filter(function (r) { return r.id === state.shown; })[0];
            if (!svg || !line || !line.profile) return onProfileOut();
            var box = svg.getBoundingClientRect(), p = line.profile;
            var i = profileIndex(p, box.width > 0 ? Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) : 0);
            profileAt = L.latLng(p.points[i][1], p.points[i][0]);
            if (!profileMarker) profileMarker = L.circleMarker(profileAt, {radius: 5, color: "#fff", weight: 2, fillColor: Regions.STYLE.color, fillOpacity: 1, interactive: false}).addTo(map);
            else profileMarker.setLatLng(profileAt);
            var x = profileX(p.distance[i], p.distance[p.distance.length - 1]).toFixed(2), at = svg.querySelector(".dt-inspector-profile-at");
            if (at) { at.setAttribute("x1", x); at.setAttribute("x2", x); at.setAttribute("visibility", "visible"); }
            var v = p.values[i], read = panel.querySelector(".dt-inspector-profile-read");
            if (read) {
                read.textContent = formatLength(p.distance[i]) + ": " + (v === null || v === undefined ? "no temperature" : formatTemp(v)) +
                    (p.frames && p.frames[i] ? " · " + p.frames[i] : "") + (state.frames ? " (click: the frames that saw it)" : "");
            }
        }

        function onProfileOut() {
            if (profileMarker) { map.removeLayer(profileMarker); profileMarker = null; }
            profileAt = null;
            var at = panel.querySelector(".dt-inspector-profile-at");
            if (at) at.setAttribute("visibility", "hidden");
        }

        function download(name, text, type) {
            var a = doc.createElement("a");
            a.href = "data:" + (type || "text/csv") + ";charset=utf-8," + encodeURIComponent(text);
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
                if (!state.legendVisible) legendMove.reset();
                try { storage.setItem(LEGEND_KEY, state.legendVisible ? "1" : "0"); } catch (err) { /* this page only */ }
                renderLegend();
            } else if (what.indexOf("isotherm-") === 0) isothermInput(what.slice("isotherm-".length), e.target.value);
            else if (what.indexOf("range-") === 0 || what.indexOf("image-") === 0) onScaleInput(what, e.target);
            else if (what.indexOf("correction-") === 0) {
                correctionInput(what.slice("correction-".length), what === "correction-on" ? e.target.checked : e.target.value);
            }
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
            closeFrames();
            panelMove.reset();
            onProfileOut();
            setMode("hover");
            state.open = false;
            state.readout = null;
            container.classList.remove("open");
            onOut();
            render();
        }

        function onUnits() { drawPins(); drawRegions(); drawSaved(); renderLegend(); render(); }

        var Control = L.Control.extend({
            options: {position: "topright"},
            onAdd: function () {
                container = L.DomUtil.create("div", "leaflet-bar leaflet-control dt-inspector");
                container.innerHTML = '<a href="javascript:void(0)" class="dt-inspector-button" title="Thermal Inspector"><i class="fa fa-thermometer-half"></i></a>';
                panel = L.DomUtil.create("div", "dt-inspector-panel", container);
                panel.hidden = true;
                frameBox = L.DomUtil.create("div", "dt-inspector-frames", container);
                frameBox.hidden = true;
                frameBox.addEventListener("click", onFramesClick);
                // A frame that cannot be drawn says so in its place
                frameBox.addEventListener("error", function (e) {
                    if (e.target.tagName === "IMG") e.target.parentNode.outerHTML = '<div class="text-danger">Could not draw this frame.</div>';
                }, true);
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                // The panel is dragged by its heading, the frames window with it
                panelMove = movable(panel, map.getContainer(), function (t) {
                    return !!t.closest(".dt-inspector-head") && !t.closest(FIELDS);
                }, placeFrames, doc);
                // Over the panel the cursor is not over the map
                container.addEventListener("mousemove", function (e) { e.stopPropagation(); onOut(); });
                container.querySelector(".dt-inspector-button").addEventListener("click", function () { if (state.open) close(); else open(); });
                panel.addEventListener("click", onPanelClick);
                panel.addEventListener("change", onPanelChange);
                // What is typed in the form is kept while the panel is drawn again
                panel.addEventListener("input", function (e) {
                    var field = e.target.getAttribute && e.target.getAttribute("data-form");
                    if (field && state.form) state.form[field] = e.target.value;
                    // While a slider moves, only the scale, the boxes and the legend follow
                    if (/^image-(brightness|contrast|gamma|sharpen)$/.test((e.target.getAttribute && e.target.getAttribute("data-act")) || "")) slide(e.target);
                });
                panel.addEventListener("keydown", function (e) {
                    if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-form") === "name") submitForm();
                });
                panel.addEventListener("mousemove", onProfileMove);
                panel.addEventListener("mouseleave", onProfileOut);
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
                legendMove = movable(legend, map.getContainer(), function (t) { return !t.closest(FIELDS); }, null, doc);
                return legend;
            }
        });
        map.addControl(new LegendControl());
        cursor = L.DomUtil.create("div", "dt-inspector-cursor", map.getContainer());
        cursor.style.display = "none";
        savedLayer = L.layerGroup().addTo(map);
        regionLayer = L.layerGroup().addTo(map);
        pinLayer = L.layerGroup().addTo(map);
        pickLayer = L.layerGroup().addTo(map);
        drawPins();
        drawRegions();
        loadSources();
        map.on("resize", function () { panelMove.keep(); legendMove.keep(); });
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
               regionsCsv: regionsCsv, profileCsv: profileCsv, statisticsHtml: statisticsHtml, profileHtml: profileHtml, profileIndex: profileIndex,
               isothermLimits: isothermLimits, readoutHtml: readoutHtml,
               panelHtml: panelHtml, hasThermal: hasThermal, projectOf: projectOf, linkedMosaic: linkedMosaic, paletteKey: paletteKey,
               mosaicRange: mosaicRange, laidMosaic: laidMosaic, mosaicTileUrl: mosaicTileUrl, mosaicIsothermUrl: mosaicIsothermUrl,
               framesSource: framesSource, fromCelsius: fromCelsius, corrected: corrected, uncorrected: uncorrected,
               rawIsotherm: rawIsotherm, correctionHtml: correctionHtml, loadCorrection: loadCorrection, correctionKey: correctionKey,
               savedHtml: savedHtml, savedCsv: savedCsv, savedGeoJson: savedGeoJson, formHtml: formHtml, pinsHtml: pinsHtml,
               mosaicsHtml: mosaicsHtml, toCelsius: toCelsius, movable: movable, adjustOf: adjustOf, autoRange: autoRange,
               scaleHtml: scaleHtml, imageHtml: imageHtml, create: create};
    root.ThermalInspector = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
