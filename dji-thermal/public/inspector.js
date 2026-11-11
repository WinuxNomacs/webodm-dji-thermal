// The Thermal Inspector: a control on WebODM's 2D map for thermal orthophotos (a single lwir band). The temperature
// under the cursor, points pinned with theirs and regions drawn with their statistics, surroundings and ΔT (both kept
// in the browser, for the same tasks; regions drawn by regions.js; a line also has its profile), isotherms (the temperatures above, below or between limits painted
// over the thermal layers, also kept in the browser), the thermal layer's palette, which is the user's everywhere (the
// Analyzer's preference; without one, the task's, chosen in DJI Thermal Task), and a legend of its palette and range
// (scale.js). Temperatures come from the plugin's API
// (inspector_api.py) in °C and are shown in WebODM's units (°F when imperial). The project's workset mosaics can be
// laid on the map too (the Analyzer's tiles, above WebODM's layers, swiped against them with WebODM's own split
// control): a thermal layer like the orthophotos, read through the Analyzer's API. main.js adds it through
// PluginsAPI.Map.willAddControls, with WebODM's own Leaflet, to every map; its button shows only where the map has
// temperatures: a thermal orthophoto, or a workset mosaic laid on it (the Analyzer's "Open on WebODM's map"). A click shows the frames that saw a point (frames.js, the Analyzer's source
// frames window) beside the panel, on a mosaic and on an orthophoto processed from a workset's TIFFs. Pins, regions
// and lines can be saved, named, with what they measured, for everyone who can view the project (kept with the task or
// the workset: measurements.py); and the temperatures corrected for another emissivity and reflected temperature
// (correction.py's model, from what each layer was measured with): a correction changed keeps each layer's colour scale
// at the temperatures it shows, so the colours change with it.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var HOVER_MS = 80;              // the readout asks for the point the cursor rests on, not every point it crosses
    var DRAWN_CLICK_MS = 500;       // the click Leaflet fires after a rectangle or circle is dragged is part of it
    var PINS_PREFIX = "dji-thermal-inspector:pins:";
    var REGIONS_PREFIX = "dji-thermal-inspector:regions:";
    var ISOTHERM_PREFIX = "dji-thermal-inspector:isotherm:";
    var CORRECTION_PREFIX = "dji-thermal-inspector:correction:";   // where earlier versions kept a correction, removed
    var LEGEND_KEY = "dji-thermal-inspector:legend";      // where earlier versions kept the legend's tick, now a preference
    var KELVIN = 273.15;
    var EMISSIVITY = [0.1, 1], REFLECTED = [-100, 1000];     // correction.py's limits (°C)
    var SAVED_STYLE = {color: "#2e7d32", weight: 2, opacity: 0.9, dashArray: "6 4", fillOpacity: 0.08};
    var ISOTHERM_MODES = {off: "Off", above: "Above", below: "Below", between: "Between"};
    var ISOTHERM_COLORS = {red: "e53935", orange: "fb8c00", yellow: "fdd835", green: "43a047", blue: "1e88e5", magenta: "d81b60"};
    var SQ_FT_PER_SQ_M = 10.7639104;
    var FT_PER_M = 3.2808399;
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions.js") : null);
    // The shapes drawn (regions.js's tools but the pin): their icons and names
    var SHAPES = {}, SHAPE_NAMES = {};
    Object.keys(Regions.TOOLS).forEach(function (k) {
        if (k !== "pin") { SHAPES[k] = Regions.TOOLS[k].icon; SHAPE_NAMES[k] = Regions.TOOLS[k].name; }
    });
    var Scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale.js") : null);
    var Frames = root.ThermalFrames || (typeof require !== "undefined" ? require("./frames.js") : null);
    var movable = Frames.movable;
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);
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

    // The temperature unit (units.js: the user's, linked to WebODM's units; an anonymous viewer's default), else
    // WebODM's units (its unit_system, kept in the browser)
    function userUnit() {
        if (root.DjiThermalUnits && root.DjiThermalUnits.current) return root.DjiThermalUnits.current();
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
    function numberOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }
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

    // Whether a layer shows at a point: not where WebODM's divider (Swipe) clips it away. leaflet-side-by-side clips
    // the layer's container to rect(top, right, bottom, left) in the map's layer pixels
    function shownAt(map, layer, latlng) {
        var c = layer.getContainer && layer.getContainer();
        var m = /rect\(\s*(-?[\d.]+)px,?\s*(-?[\d.]+)px,?\s*(-?[\d.]+)px,?\s*(-?[\d.]+)px\s*\)/.exec((c && c.style && c.style.clip) || "");
        if (!m || !map.latLngToLayerPoint) return true;
        var p = map.latLngToLayerPoint(latlng);
        return p.x >= Number(m[4]) && p.x <= Number(m[2]) && p.y >= Number(m[1]) && p.y <= Number(m[3]);
    }

    function thermalLayerAt(map, latlng) {
        var at = thermalLayers(map).filter(function (t) {
            var bounds = t.layer.options && t.layer.options.bounds;
            return (!bounds || bounds.contains(latlng)) && shownAt(map, t.layer, latlng);
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
            Scale.adjustQuery(info.adjust, mosaicBands(info));
    }
    // A mosaic's value tile, which the browser colours (recolour.js), kept by the browser until it is built again
    function mosaicValuesUrl(info, coords) {
        return mosaicBase(info) + "/mosaics/" + info.tab + "/values/" + coords.z + "/" + coords.x + "/" + coords.y + ".png?v=" + encodeURIComponent(info.built_at);
    }

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
    // How an isotherm (°C) paints a thermal layer's values (in a mosaic's unit, °C on an orthophoto): recolour.js's
    // style, or null when it is off
    function isothermStyle(iso, unit) {
        if (!validIsotherm(iso)) return null;
        var exact = function (c) { return unit === "F" ? c * 1.8 + 32 : unit === "K" ? c + 273.15 : c; };
        var hex = ISOTHERM_COLORS[iso.color];
        return {paint: [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }),
                isotherm: [iso.mode === "below" ? -3e38 : exact(iso.low), iso.mode === "above" ? 3e38 : exact(iso.high)]};
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
    // A thermal layer's range (°C) in its values' unit: a mosaic's, or °C
    function valuesRange(t, range) { return t.mosaic ? range.map(function (c) { return fromCelsius(c, t.mosaic.unit); }) : range; }

    // How values over a range read once shown (f: a value as shown, a monotonic function), as the straight line through
    // the range's ends: {scale, offset} (Stepped's scale.bandsOf; exact without a correction, close with one)
    function linearOver(f, range) {
        var a = f(range[0]), b = f(range[1]), scale = (b - a) / ((range[1] - range[0]) || 1);
        return {scale: scale, offset: a - scale * range[0]};
    }

    // A mosaic's frames are drawn by the server: Stepped's bands in its unit, its temperatures in the user's
    function mosaicBands(info) {
        return Scale.bandsOf(info.adjust, info.range, linearOver(function (v) { return shownTemp(toCelsius(v, info.unit)); }, info.range));
    }

    // An overlay dropdown, last in the panel (Mosaic Overlays; each kind of overlay its own): a button saying how many
    // are shown, opening a checklist of them (kept open while ticking, as a multi-select is); the shown ones listed
    // below it, each with its tickbox and its controls. o: {kind (the rows' data-<kind> and data-act="<kind>-on"),
    // title, open, items: [{id, name (HTML), laid}], controls(item) -> HTML}
    function overlaysHtml(o) {
        if (!o.items || !o.items.length) return "";
        var shown = o.items.filter(function (i) { return i.laid; });
        var row = function (i, controls) {
            return '<div class="dt-inspector-overlay" data-' + o.kind + '="' + escapeHtml(i.id) + '">' +
                '<label class="dt-inspector-check dt-inspector-overlay-name"><input type="checkbox" data-act="' + o.kind + '-on"' +
                (i.laid ? " checked" : "") + "> " + i.name + "</label>" + (controls ? o.controls(i) : "") + "</div>";
        };
        return '<div class="dt-inspector-section dt-inspector-overlays">' +
            '<button type="button" class="btn btn-default btn-sm dt-inspector-dropdown" data-act="overlays-toggle" data-overlays="' + o.kind +
            '" aria-expanded="' + (o.open ? "true" : "false") + '" title="' + (o.open ? "Close the list" : "Choose which to show on the map") + '">' +
            "<strong>" + escapeHtml(o.title) + "</strong>: " + shown.length + " of " + o.items.length + " shown " +
            '<i class="fa fa-caret-' + (o.open ? "up" : "down") + '"></i></button>' +
            (o.open ? '<div class="dt-inspector-checklist">' + o.items.map(function (i) { return row(i, false); }).join("") + "</div>" : "") +
            shown.map(function (i) { return row(i, true); }).join("") + "</div>";
    }

    // The panel's Mosaic Overlays: each workset of the project's datasets, its tickbox laying it on the map; once
    // laid, its tab, opacity, Swipe (WebODM's split control) and Zoom to
    function mosaicsHtml(state) {
        return overlaysHtml({kind: "mosaic", title: "Mosaic Overlays", open: !!(state.overlaysOpen || {}).mosaic,
            items: (state.mosaics || []).map(function (m) {
                var id = mosaicId(m);
                return {id: id, laid: state.laid[id], mosaic: m,
                        name: escapeHtml(m.dataset.name) + ' <span class="text-muted">›</span> ' + escapeHtml(m.workset.name)};
            }),
            controls: function (i) {
                var info = i.laid.layer.__dtMosaic;
                return layerControlsHtml("mosaic", i.laid, '<select class="form-control input-sm" data-act="mosaic-tab" title="Which mosaic">' +
                    i.mosaic.tabs.map(function (t) {
                        return '<option value="' + t.tab + '"' + (t.tab === info.tab ? " selected" : "") + ">" + escapeHtml(MOSAIC_TABS[t.tab] || t.tab) + "</option>";
                    }).join("") + "</select>");
            }});
    }

    // A laid overlay's controls (data-act="<kind>-..."): what comes first (a mosaic's tab), its opacity, Swipe (WebODM's
    // split control) and Zoom to; while its orthophoto's details load, or when they can't be, a line saying so
    function layerControlsHtml(kind, laid, first) {
        if (laid.error) return '<div class="text-danger dt-inspector-hint">' + escapeHtml(laid.error) + "</div>";
        if (!laid.layer) return '<div class="text-muted dt-inspector-hint">Loading…</div>';
        return '<div class="dt-inspector-overlay-controls">' + (first || "") +
            '<input type="range" min="0" max="100" step="5" value="' + laid.opacity + '" data-act="' + kind + '-opacity" title="Opacity: ' + laid.opacity + '%">' +
            '<button type="button" class="btn btn-' + (laid.swipe ? "primary" : "default") + ' btn-xs" data-act="' + kind + '-swipe" title="' +
            (laid.swipe ? "Stop swiping" : "Show it on the right of a divider, WebODM's layers on the left") + '"><i class="fa fa-columns"></i> Swipe</button>' +
            '<a href="javascript:void(0)" data-act="' + kind + '-zoom" title="Zoom to it"><i class="fa fa-search-plus"></i></a></div>';
    }

    // The panel's Ortho Overlays: the orthophotos of the project's other tasks, RGB or thermal, each laid on the map by
    // its tickbox; once laid, its opacity, Swipe and Zoom to. A thermal one is read as its task's thermal layer is
    function orthosHtml(state) {
        return overlaysHtml({kind: "ortho", title: "Ortho Overlays", open: !!(state.overlaysOpen || {}).ortho,
            items: (state.orthos || []).map(function (o) {
                return {id: o.id, laid: (state.orthoLaid || {})[o.id],
                        name: '<i class="fa ' + (o.thermal ? "fa-thermometer-half" : "fa-image") + '" title="' + (o.thermal ? "Thermal" : "RGB") +
                              '"></i> ' + escapeHtml(o.name)};
            }),
            controls: function (i) { return layerControlsHtml("ortho", i.laid); }});
    }

    // The project's other tasks with an orthophoto, from WebODM's task list (completed, orthophoto.tif among their
    // assets, not on the map already): {id, name, thermal (its first band LWIR), task (as WebODM's map keeps it)}
    function orthosOf(list, onMap) {
        return (list || []).filter(function (task) {
            return task && task.status === 40 && (task.available_assets || []).indexOf("orthophoto.tif") !== -1 && onMap.indexOf(String(task.id)) === -1;
        }).map(function (task) {
            var bands = task.orthophoto_bands || [];
            var name = task.name || "Task " + String(task.id).slice(0, 8);
            return {id: String(task.id), name: name, thermal: !!bands[0] && String(bands[0].description || "").toLowerCase() === "lwir",
                    task: {id: String(task.id), name: name, orthophoto_bands: bands, crop: task.crop || null}};
        });
    }

    // An orthophoto's tile URL from its metadata, as WebODM's map builds it: a thermal one in Celsius over its 2nd to 98th
    // percentile (as WebODM's Thermal layer), at 512 pixels, cropped as its task is
    function orthoUrl(mres, o) {
        var url = mres.tiles[0];
        var s = mres.statistics && mres.statistics["1"];
        if (o.thermal && s && s.percentiles) url = withParam(url, "rescale", s.percentiles[0] + "," + s.percentiles[1]);
        url = withParam(url, "size", "512");
        return o.task.crop ? withParam(url, "crop", "1") : url;
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
    // tiles in one of DJI's (display.palettes), in a colour map WebODM's tiler lacks (display.own_colormaps: 4.0.0's
    // hot, rainbow and gray_r) or with adjustments, else by WebODM's; the range, size and crop kept
    function withPalette(url, name, display, adjust) {
        var a = adjust || {};
        var own = ((display && display.palettes) || []).concat((display && display.own_colormaps) || []);
        if (own.indexOf(name) !== -1 || Scale.adjusted(adjust)) {
            url = url.replace(WEBODM_TILES, API + "projects/$1/inspector/tiles/");
            url = withParam(withParam(url, "color_map", ""), "palette", name);
            url = withParam(withParam(url, "gamma", a.gamma && a.gamma !== 1 ? String(a.gamma) : ""), "equalize", "");
            // Stepped and its width (none: Auto), kept with the layer as its other adjustments are
            url = withParam(url, "tone", a.tone === "stepped" ? "stepped" : "");
            url = withParam(url, "step", a.tone === "stepped" && a.step > 0 ? String(a.step) : "");
            return withParam(url, "sharpen", a.sharpen ? String(a.sharpen) : "");
        }
        url = url.replace(PLUGIN_TILES, "/api/projects/$1/orthophoto/tiles/");
        ["palette", "gamma", "equalize", "tone", "step", "sharpen"].forEach(function (k) { url = withParam(url, k, ""); });
        return withColorMap(url, name);
    }
    // The adjustments a thermal layer's tile URL draws with
    function adjustOf(url) {
        if (!PLUGIN_TILES.test(url || "")) return Scale.defaultAdjust();
        return {gamma: parseFloat(paramOf(url, "gamma")) || 1, sharpen: parseFloat(paramOf(url, "sharpen")) || 0,
                tone: paramOf(url, "tone") === "stepped" ? "stepped" : "linear", step: Scale.typedStep(paramOf(url, "step"))};
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
    // The Inspector's tiles (what: isotherm or values) of the same place as a thermal layer's tile URL (either WebODM's
    // or the plugin's; a template or a tile's), its size and crop kept, with more parameters
    function taskTileUrl(url, what, more) {
        var m = TILE_URL.exec(url || "");
        if (!m) return "";
        var q = url.indexOf("?"), rest = url.slice(m.index + m[0].length, q === -1 ? url.length : q).replace(/\.(png|jpe?g|webp)$/, "");
        var params = [];
        if (paramOf(url, "size")) params.push("size=" + encodeURIComponent(paramOf(url, "size")));
        if (paramOf(url, "crop") === "1") params.push("crop=1");
        params = params.concat(more || []);
        return API + "projects/" + m[1] + "/tasks/" + m[2] + "/inspector/" + what + "/" + rest + (params.length ? "?" + params.join("&") : "");
    }
    // The tiles of a thermal layer's isotherm
    function isothermUrl(url, iso) {
        if (!validIsotherm(iso)) return "";
        var params = [];
        if (iso.mode !== "below") params.push("low=" + iso.low);
        if (iso.mode !== "above") params.push("high=" + iso.high);
        params.push("color=" + ISOTHERM_COLORS[iso.color]);
        return taskTileUrl(url, "isotherm", params);
    }
    // A thermal orthophoto's value tile, which the browser colours (recolour.js), from its tile's URL
    function valuesUrl(url) { return taskTileUrl(url, "values"); }
    function describeIsotherm(iso, unit) {
        if (!validIsotherm(iso)) return "";
        if (iso.mode === "above") return "Above " + formatTemp(iso.low, unit);
        if (iso.mode === "below") return "Below " + formatTemp(iso.high, unit);
        return "Between " + formatTemp(iso.low, unit) + " and " + formatTemp(iso.high, unit);
    }

    // The correction: {on, emissivity, reflected (°C)}, off on every visit. A layer's: {wanted: {emissivity, reflected},
    // baseline: what it was measured with, as its saved measurements' API gives it}, or null
    function validCorrection(c) {
        return !!c && typeof c.emissivity === "number" && c.emissivity >= EMISSIVITY[0] && c.emissivity <= EMISSIVITY[1] &&
            typeof c.reflected === "number" && c.reflected >= REFLECTED[0] && c.reflected <= REFLECTED[1];
    }
    // The corrections earlier versions kept in the browser
    function forgetCorrections(storage) {
        try {
            for (var i = storage.length - 1; i >= 0; i--) {
                var k = storage.key(i);
                if (k && k.indexOf(CORRECTION_PREFIX) === 0) storage.removeItem(k);
            }
        } catch (e) { /* nothing to remove */ }
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
    // A layer's range (its own values, °C) for another correction: the same temperatures shown, null when it can't be
    function keptRange(range, from, to) {
        if (!range) return null;
        var out = range.map(function (c) { return Math.round(uncorrected(corrected(c, from), to) * 1e4) / 1e4; });
        return isFinite(out[0]) && isFinite(out[1]) && out[1] > out[0] ? out : null;
    }
    // An isotherm's limits (temperatures as shown, corrected) as a layer's own values, for its tiles
    function rawIsotherm(iso, fix) {
        if (!fix || !validIsotherm(iso)) return iso;
        var out = assign({}, iso);
        if (typeof iso.low === "number") out.low = Math.round(uncorrected(iso.low, fix) * 1e6) / 1e6;
        if (typeof iso.high === "number") out.high = Math.round(uncorrected(iso.high, fix) * 1e6) / 1e6;
        return out;
    }

    // The correction's fields under the colour scale, always shown, and its tick box under them: unticked, the fields
    // are greyed and hold what the topmost layer was measured with (fallback: {emissivity, reflected}); ticked, they
    // take any value correction.py allows, and a layer on the map that can't be corrected says so
    function correctionHtml(c, unit, sources, notice, fallback) {
        var v = c.on ? c : fallback || {}, off = c.on ? "" : " disabled";
        var unrecorded = !c.on ? "" : (sources || []).map(function (src) {
            return src.loading || src.baseline ? "" : '<div class="text-muted dt-inspector-hint">' + escapeHtml(src.name) +
                ": doesn't record how it was measured, so isn't corrected</div>";
        }).join("");
        return '<div class="dt-inspector-correction"><label>Emissivity <input type="number" step="0.01" min="' + EMISSIVITY[0] + '" max="' + EMISSIVITY[1] +
            '" class="form-control input-sm" data-act="correction-emissivity" value="' + (typeof v.emissivity === "number" ? v.emissivity : "") + '"' + off + "></label>" +
            '<label>Reflected <input type="number" step="0.1" class="form-control input-sm" data-act="correction-reflected" value="' +
            (typeof v.reflected === "number" ? roundShown(v.reflected, unit) : "") + '"' + off + '> <span class="text-muted">°' + unit + "</span></label></div>" +
            '<label class="dt-inspector-label dt-inspector-check"><input type="checkbox" data-act="correction-on"' + (c.on ? " checked" : "") +
            "> Manual Corrections</label>" +
            (notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(notice) + "</div>" : "") + unrecorded;
    }

    // The legend: the palette's colours (encoded, as the palette API gives them) over the range (°C), its ends marked
    // with their values and round values between, in the user's unit, with the part an isotherm paints; with a
    // correction (fix), the marks are of corrected temperatures where the layer's own values are drawn, and the
    // isotherm's limits corrected ones too. extent, the image's lowest and highest temperatures (°C), is said under the
    // bar when it reaches beyond the range
    function legendHtml(colors, range, label, unit, iso, fix, extent, shares, steps) {
        if (!colors || !colors.length || !range) return "";
        unit = unit || userUnit();
        return '<div class="dt-legend-title">' + escapeHtml(label) + ' <span class="text-muted">°' + unit + "</span></div>" +
            barHtml(colors, range, unit, iso, fix, shares, steps) + extentHtml(range, unit, fix, extent);
    }

    // A colour scale: the palette's gradient over the range (°C; along shares: how the image is drawn), its marks, and
    // the part an isotherm paints (legendHtml)
    function barHtml(colors, range, unit, iso, fix, shares, steps) {
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
        return '<div class="dt-legend-bar" style="background: ' + Scale.gradientCss(colors, shares, steps) + ';">' + mark + "</div>" +
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
            '<div class="dt-inspector-scale-bar">' + (s.colors ? barHtml(s.colors, s.range, unit, state.isotherm, s.fix, s.shares, s.steps) : "") + "</div>" +
            '<div class="dt-inspector-range">' +
            '<input type="number" step="0.1" class="form-control input-sm" data-act="range-min" value="' + shown(s.range[0]) + '" title="Minimum">' +
            Scale.spanButtonsHtml(function (name) { return 'data-act="range-' + name + '"'; }, "btn-xs",
                                  {title: "The 2nd to 98th percentile of this layer", disabled: !s.auto}) +
            '<input type="number" step="0.1" class="form-control input-sm" data-act="range-max" value="' + shown(s.range[1]) + '" title="Maximum">' +
            '<span class="text-muted">°' + unit + "</span></div>" +
            (state.rangeError ? '<div class="text-danger dt-inspector-hint">' + escapeHtml(state.rangeError) + "</div>" : "") +
            (s.extent ? '<div class="text-muted dt-inspector-hint">This layer: ' + escapeHtml(shown(s.extent[0]).toFixed(1)) + " to " +
                escapeHtml(shown(s.extent[1]).toFixed(1)) + " °" + unit + "</div>" : "") + "</div>";
    }

    // The Image section of the topmost thermal layer (s: scaleHtml's): brightness and contrast move its range from its
    // Auto one, gamma, Stepped's bands and sharpening change how it is drawn (the mosaic viewer's)
    function imageHtml(s) {
        if (!s || !s.range) return "";
        var at = s.auto ? Scale.sliderPositions(s.auto, s.range) : {brightness: 0, contrast: 0};
        return '<div class="dt-inspector-section dt-inspector-image"><strong>Image</strong>' +
            Scale.imageControlsHtml(s.adjust, at, {field: function (name) { return 'data-act="image-' + name + '"'; }, stepped: true,
                                                   bands: s.bands, unit: "°" + userUnit()}) +
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
            .concat(["isotherm_share_pct", "coldest_latitude", "coldest_longitude", "hottest_latitude", "hottest_longitude", "first_spot_" + u, "second_spot_" + u])];
        regions.forEach(function (r) {
            var t = function (c) { return c === null || c === undefined ? "" : shownTemp(c, unit).toFixed(3); };
            var d = function (c) { return c === null || c === undefined ? "" : (unit === "F" ? c * 1.8 : c).toFixed(3); };
            if (r.shape === "delta") {
                if (typeof r.delta_t !== "number") return;
                rows.push([r.label, r.shape, "", "", typeof r.length === "number" ? r.length.toFixed(3) : "", "", "", "", "", "", "", "", "", d(r.delta_t),
                           "", "", "", "", "", t(r.first), t(r.second)]);
                return;
            }
            var s = r.statistics;
            if (!s) return;
            var p = s.percentiles || {};
            var share = typeof s.isotherm_share === "number" ? (s.isotherm_share * 100).toFixed(2) : "";
            rows.push([r.label, r.shape, s.count, regionArea(r) === null ? "" : regionArea(r).toFixed(3), typeof r.length === "number" ? r.length.toFixed(3) : "",
                       t(s.min), t(s.max), t(s.mean), d(s.std), t(s.median), t(p["2"]), t(p["98"]), t(s.surroundings), d(s.delta_t), share,
                       s.min_location[1].toFixed(8), s.min_location[0].toFixed(8), s.max_location[1].toFixed(8), s.max_location[0].toFixed(8), "", ""]);
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
    // measured with other limits isn't shown (true: shown whatever it was measured with, as a saved one's); pixels: a
    // frame's region (the frame page), its sizes in pixels
    function statisticsHtml(r, unit, iso, pixels) {
        if (r.loading) return '<div class="text-muted"><i class="fa fa-spinner fa-spin"></i> Reading the region…</div>';
        if (r.error) return '<div class="text-danger">' + escapeHtml(r.error) + "</div>";
        if (r.shape === "delta") return deltaHtml(r, unit, pixels);
        var s = r.statistics;
        if (!s) return '<div class="text-muted">' + escapeHtml(REASONS[r.reason] || "No temperatures in this region") + "</div>";
        var p = s.percentiles || {};
        var rows = [["Minimum", formatTemp(s.min, unit)], ["Maximum", formatTemp(s.max, unit)], ["Mean", formatTemp(s.mean, unit)],
                    ["Median", formatTemp(s.median, unit)], ["Std. deviation", formatDelta(s.std, unit)],
                    ["2nd percentile", formatTemp(p["2"], unit)], ["98th percentile", formatTemp(p["98"], unit)],
                    ["Surroundings", formatTemp(s.surroundings, unit)], ["ΔT", formatSigned(s.delta_t, unit)],
                    ["In the isotherm", typeof s.isotherm_share === "number" && (iso === true || r.isotherm === limitsKey(iso)) ? (s.isotherm_share * 100).toFixed(1) + " %" : ""],
                    ["Pixels", String(s.count)]];
        if (regionArea(r) !== null && !pixels) rows.push(["Area", formatArea(regionArea(r), unit)]);
        if (typeof r.length === "number") rows.push(["Length", pixels ? r.length.toFixed(1) + " px" : formatLength(r.length, unit)]);
        return '<table class="table table-condensed dt-inspector-stats"><tbody>' + rows.filter(function (row) { return row[1]; }).map(function (row) {
            return "<tr><td>" + escapeHtml(row[0]) + '</td><td class="text-right">' + escapeHtml(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>" + (r.profile ? profileHtml(r.profile, unit, r.length, pixels) : histogramHtml(s.histogram, unit)) +
            (r.resampled ? '<div class="text-muted dt-inspector-hint">A large region: read at a reduced resolution.</div>' : "");
    }

    // A ΔT's figures: each spot's temperature (its pixel's), ΔT (the second's less the first's) and the distance between
    // them (pixels: on a frame, in pixels)
    function deltaHtml(r, unit, pixels) {
        var spot = function (v, reason) {
            return typeof v === "number" ? formatTemp(v, unit) : pixels && reason === "outside_raster" ? "Outside the frame" : REASONS[reason] || "No data here";
        };
        var rows = [["First spot", spot(r.first, (r.reasons || [])[0])], ["Second spot", spot(r.second, (r.reasons || [])[1])],
                    ["ΔT", typeof r.delta_t === "number" ? formatSigned(r.delta_t, unit) : ""]];
        if (typeof r.length === "number") rows.push(["Distance", pixels ? r.length.toFixed(1) + " px" : formatLength(r.length, unit)]);
        return '<table class="table table-condensed dt-inspector-stats dt-inspector-delta-figures"><tbody>' + rows.filter(function (row) { return row[1]; }).map(function (row) {
            return "<tr><td>" + escapeHtml(row[0]) + '</td><td class="text-right">' + escapeHtml(row[1]) + "</td></tr>";
        }).join("") + "</tbody></table>";
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

    // A line's temperatures along it, broken where there are none; hovering it finds the point on the map (pixels: on
    // a frame, its distances in pixels)
    function profileHtml(p, unit, length, pixels) {
        var distance = function (d) { return pixels ? d.toFixed(d >= 100 ? 0 : 1) + " px" : formatLength(d, unit); };
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
            '<div class="dt-inspector-range"><span>' + escapeHtml(distance(0)) + "</span><span>" + escapeHtml(distance(length)) + "</span></div>" +
            '<div class="text-muted dt-inspector-hint dt-inspector-profile-read">Hover the profile to find its point on the ' + (pixels ? "frame" : "map") + ".</div></div>";
    }

    // The sample of a profile nearest a share (0..1) of its length
    function profileIndex(p, share) {
        var at = share * p.distance[p.distance.length - 1], best = 0;
        p.distance.forEach(function (d, i) { if (Math.abs(d - at) < Math.abs(p.distance[best] - at)) best = i; });
        return best;
    }

    function regionsHtml(state, unit) {
        var regions = state.regions;
        if (!regions.length) return '<div class="text-muted dt-inspector-hint">Choose a shape or the line, then draw on the map to read a region\'s temperatures, or ΔT to compare two spots.</div>';
        var shown = regions.filter(function (r) { return r.id === state.shown; })[0];
        return '<table class="table table-condensed dt-inspector-pins dt-inspector-regions"><tbody>' + regions.map(function (r) {
            var s = r.statistics;
            return '<tr data-region="' + escapeHtml(r.id) + '"' + (r === shown ? ' class="active"' : "") + '><td><i class="' + SHAPES[r.shape] + '"></i> ' +
                '<a href="javascript:void(0)" data-act="goto" title="Show on the map">' + escapeHtml(r.label) + "</a></td><td>" +
                (r.shape === "delta" && typeof r.delta_t === "number" ? escapeHtml(formatSigned(r.delta_t, unit)) + ' <span class="text-muted">ΔT</span>' :
                    s ? escapeHtml(formatTemp(s.mean, unit)) + ' <span class="text-muted">mean</span>' :
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
        if (m.shape === "delta") return typeof v.delta_t === "number" ? escapeHtml(formatSigned(v.delta_t, unit)) + ' <span class="text-muted">ΔT</span>' : '<span class="text-muted">' + escapeHtml(REASONS[v.reason] || "none") + "</span>";
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
            var icon = (Regions.TOOLS[i.m.shape] || {}).icon;
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
            '<span class="text-muted">' + escapeHtml((Regions.TOOLS[m.shape] || {}).name || "") + "</span>" +
            (m.comment ? '<div class="dt-inspector-comment">' + escapeHtml(m.comment) + "</div>" : "") +
            lines.map(function (l) { return '<div class="text-muted dt-inspector-hint">' + l + "</div>"; }).join("") + body + "</div>";
    }

    // The saved measurements as a table's rows: one per measurement, in the user's unit
    function savedRows(items, unit) {
        var u = unit.toLowerCase();
        var head = ["name", "comment", "shape", "layer", "tab", "created_at", "created_by", "latitude", "longitude", "temperature_" + u,
                    "pixels", "area_m2", "length_m"].concat(["min", "max", "mean", "std", "median", "p2", "p98", "surroundings", "delta_t"].map(function (k) { return k + "_" + u; }))
            .concat(["isotherm_low_" + u, "isotherm_high_" + u, "isotherm_share_pct", "emissivity", "reflected_" + u, "measured_emissivity", "measured_reflected_" + u,
                     "first_spot_" + u, "second_spot_" + u]);
        var t = function (c) { return c === null || c === undefined ? "" : Number(shownTemp(c, unit).toFixed(3)); };
        var d = function (c) { return c === null || c === undefined ? "" : Number((unit === "F" ? c * 1.8 : c).toFixed(3)); };
        var rows = items.map(function (i) {
            var m = i.m, v = m.values || {}, s = v.statistics || {}, p = s.percentiles || {}, iso = m.isotherm || {}, c = m.correction;
            var area = m.shape !== "pin" ? regionArea(savedRegion(m)) : null, pin = m.shape === "pin" ? m.geometry.coordinates : null;
            return [m.name, m.comment || "", m.shape, i.source.name, m.tab || "", m.created_at || "", m.created_by || "",
                    pin ? Number(pin[1].toFixed(8)) : "", pin ? Number(pin[0].toFixed(8)) : "", t(v.temperature), s.count === undefined ? "" : s.count,
                    area === null ? "" : Number(area.toFixed(3)), typeof v.length === "number" ? Number(v.length.toFixed(3)) : "",
                    t(s.min), t(s.max), t(s.mean), d(s.std), t(s.median), t(p["2"]), t(p["98"]), t(s.surroundings), d(m.shape === "delta" ? v.delta_t : s.delta_t),
                    t(iso.low), t(iso.high), typeof s.isotherm_share === "number" ? Number((s.isotherm_share * 100).toFixed(2)) : "",
                    c ? c.emissivity : "", c ? t(c.reflected) : "", c ? c.baseline.emissivity : "", c ? t(c.baseline.reflected) : "",
                    t(v.first), t(v.second)];
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
        // The top (the heading, modes, readout, palette and scale) stays in view while the rest scrolls under it, from the
        // correction's fields
        return '<div class="dt-inspector-top"><div class="dt-inspector-head"><strong><i class="fa fa-thermometer-half"></i> Thermal Inspector</strong>' +
            '<a href="javascript:void(0)" class="dt-inspector-close" data-act="close" title="Close"><i class="fa fa-times"></i></a></div>' +
            '<div class="btn-group btn-group-xs dt-inspector-modes">' +
            ["hover", "delta", "pin", "rectangle", "circle", "polygon", "line"].map(function (m) {
                // Icons only but ΔT's, so the buttons fit on one row; each says what it does when hovered
                var label = m === "hover" ? '<i class="fa fa-mouse-pointer"></i>' : m === "pin" ? '<i class="' + Regions.TOOLS.pin.icon + '"></i>' :
                    m === "delta" ? '<i class="' + SHAPES.delta + '"></i> ' + SHAPE_NAMES.delta : '<i class="' + SHAPES[m] + '"></i>';
                var title = m === "hover" ? "Hover: read the temperature under the cursor" :
                    m === "pin" ? "Pin: click the map to keep a point and its temperature" :
                    m === "line" ? "Draw a line: its temperatures along it" : m === "delta" ? "ΔT: click two spots, the second's temperature less the first's" :
                    "Draw a region: " + SHAPE_NAMES[m].toLowerCase();
                return '<button type="button" class="btn btn-' + (state.mode === m ? "primary" : "default") + '" data-mode="' + m + '" title="' + escapeHtml(title) + '"' +
                    ' aria-label="' + escapeHtml(m === "hover" ? "Hover" : m === "pin" ? "Pin" : SHAPE_NAMES[m]) + '">' + label + "</button>";
            }).join("") + "</div>" +
            (state.mode === "delta" ? '<div class="text-muted dt-inspector-hint">Click the first spot, then the second: ΔT is the second\'s temperature less the first\'s. Esc cancels.</div>' : "") +
            (state.mode === "polygon" ? '<div class="text-muted dt-inspector-hint">Click the corners; double-click or Enter finishes, Esc cancels.</div>' : "") +
            (state.mode === "line" ? '<div class="text-muted dt-inspector-hint">Click the line\'s points; double-click or Enter finishes, Esc cancels.</div>' : "") +
            (state.notice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.notice) + "</div>" : "") +
            '<div class="dt-inspector-pointer"><strong>Pointer Info</strong>' +
            '<label class="dt-inspector-check"><input type="checkbox" data-act="pointer-temperature"' + (state.pointerTemperature ? " checked" : "") +
            "> Temperature On Pointer</label></div>" +
            '<div class="dt-inspector-readout">' + readoutHtml(state.readout, unit, state.frames) + "</div>" +
            (options.length ? '<label class="dt-inspector-label">Palette <select class="form-control input-sm" data-act="palette">' +
                options.map(function (o) {
                    return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === current ? " selected" : "") + ">" + escapeHtml(o[1]) + "</option>";
                }).join("") + "</select></label>" : "") + scaleHtml(state.scale, state, unit) + "</div>" +
            correctionHtml(state.correction, unit, (state.onMap || []).map(function (k) { return state.sources[k]; }).filter(Boolean),
                           state.correctionNotice, state.correctionDefault) +
            imageHtml(state.scale) +
            '<div class="dt-inspector-section"><strong>Isotherm</strong>' + isothermHtml(state.isotherm, unit) +
            (state.isothermNotice ? '<div class="text-warning dt-inspector-hint">' + escapeHtml(state.isothermNotice) + "</div>" : "") + "</div>" +
            '<div class="dt-inspector-section"><strong>Pinned points</strong>' + pinsHtml(state, unit) + "</div>" +
            '<div class="dt-inspector-section"><strong>Regions and lines</strong>' + regionsHtml(state, unit) + "</div>" +
            ((state.onMap || []).length ? '<div class="dt-inspector-section"><strong>Saved measurements</strong>' + savedHtml(state, unit) + "</div>" : "") +
            mosaicsHtml(state) + orthosHtml(state);
    }

    function csrfToken(doc) {
        var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
        return m ? decodeURIComponent(m[1]) : "";
    }

    function readJson(res) {
        return res.json().then(function (data) { return {ok: res.ok, data: data}; },
                               function () { return {ok: res.ok, data: {}}; });
    }

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
        var key = pinsKey(tasks), rkey = regionsKey(tasks), ikey = isothermKey(tasks);
        forgetCorrections(storage);
        try { storage.removeItem(LEGEND_KEY); } catch (e) { /* nothing kept */ }
        var regions = loadPins(storage, rkey).filter(function (r) { return r && r.geometry && SHAPES[r.shape]; });
        var state = {open: false, mode: "hover", readout: null, pins: loadPins(storage, key), pinsVisible: true,
                     regions: regions, regionsVisible: true, shown: regions.length ? regions[regions.length - 1].id : null,
                     notice: "", display: null, palette: "", isotherm: loadIsotherm(storage, ikey), isothermNotice: "",
                     legendVisible: false, pointerTemperature: true, mosaics: null, laid: {}, orthos: null, orthoLaid: {}, overlaysOpen: {}, frames: false, pick: null,
                     correction: {on: false}, correctionNotice: "", sources: {}, onMap: [], savedVisible: true,
                     savedShown: null, form: null, savable: {}, scale: null, rangeError: ""};
        var project = projectOf(args.tiles, deps.path !== undefined ? deps.path : root.location && root.location.pathname);
        var search = deps.search !== undefined ? deps.search : root.location && root.location.search;
        var container, panel, frameBox, panelMove, legendMove, frameMove, framesMoved = false, cursor, pinLayer, regionLayer, savedLayer, pickLayer, legend, tool = null, timer = null, seq = 0, applying = false, drawnAt = 0;
        var profileMarker = null, profileAt = null;     // the point of the profile hovered, on the map
        var pickSeq = 0;                    // the frames asked for last
        var overlays = [], colors = {};     // the isotherm's layer over each thermal layer; each palette's colours
        var paletteChosen = false;          // a palette the user chose on this page, which the task's no longer replaces
        var sliding = false;                // while an Image slider moves (the frames window's picture waits)

        function render() {
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            state.frames = thermalLayers(map).some(function (t) { return !!framesSource(t, state.mosaics); });
            state.onMap = sourcesOnMap();
            state.pinTemp = pinTemp;
            state.savable = {};
            state.pins.forEach(function (p) { state.savable[p.id] = canSaveAt({lat: p.lat, lng: p.lng}); });
            state.regions.forEach(function (r) {
                var measured = r.shape === "delta" ? typeof r.delta_t === "number" : !!r.statistics;
                state.savable[r.id] = measured && canSaveAt(regionBounds(r).getCenter());
            });
            state.scale = scaleState();
            state.correctionDefault = correctionDefault();
            panel.innerHTML = panelHtml(state);
            // Within the map, above its bottom controls
            var room = map.getContainer().clientHeight - container.offsetTop - 60;
            if (room > 0) panel.style.maxHeight = Math.max(160, room) + "px";
            panelMove.keep();       // moved, and now taller: still inside the map
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
                state.sources[src.key] = assign(src, {loading: true, measurements: [], can_change: false, baseline: null, palette: ""});
                fetchFn(src.url, {credentials: "same-origin"}).then(readJson).then(function (r) {
                    if (r.ok) {
                        assign(src, {measurements: r.data.measurements || [], can_change: !!r.data.can_change, baseline: r.data.baseline || null,
                                     palette: r.data.palette || ""});
                    }
                }, function () {}).then(function () {
                    src.loading = false;
                    openInTaskPalette();
                    correctionChanged();
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

        // The correction or a layer's baseline changed: the temperatures shown again, the regions measured with another
        // correction measured again
        function correctionChanged() {
            state.regions.forEach(function (r) {
                if (r.loading || (!r.statistics && !r.reason && r.first === undefined)) return;
                var t = thermalLayerAt(map, regionBounds(r).getCenter()) || thermalLayers(map)[0];
                if (t && (r.correction || "null") !== fixKey(fixFor(t))) measure(r);
            });
            drawIsotherms();
            renderLegend();
            drawPins();
            render();
        }

        // What the topmost thermal layer was measured with, else the camera's usual emissivity and 20 °C
        function correctionDefault() {
            var layers = thermalLayers(map), t = layers[layers.length - 1];
            var src = t && state.sources[layerSource(t).key], b = src && src.baseline;
            return {emissivity: b ? b.emissivity : 0.95, reflected: b ? b.reflected : 20};
        }

        function correctionInput(what, value) {
            var c = assign({}, state.correction), unit = userUnit();
            state.correctionNotice = "";
            if (what === "on") {
                // Unticked, the values typed are forgotten; ticked, they start from what the topmost layer was measured with
                c = value ? assign({on: true}, correctionDefault()) : {on: false};
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
            var before = thermalLayers(map, true).map(function (t) { return {t: t, fix: fixFor(t)}; });
            state.correction = c;
            // Each layer corrected otherwise keeps the temperatures its scale shows, so its colours change
            before.forEach(function (b) {
                var fix = fixFor(b.t);
                if (fixKey(fix) === fixKey(b.fix)) return;
                var range = keptRange(layerRange(b.t) || layerExtent(b.t), b.fix, fix);
                if (range) setLook(b.t, range, layerAdjust(b.t));
            });
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
                var o = overlays.filter(function (x) { return x.layer === t.layer; })[0];
                if (!o) {
                    // The thermal layer's tiling as Leaflet set it up (detectRetina already applied), painted from the
                    // same values
                    var layer = t.layer, options = assign({}, layer.options, {opacity: 1, detectRetina: false, zIndex: ((layer.options || {}).zIndex || 0) + 1});
                    o = {layer: layer, overlay: Recolour.drawFromValues(L.gridLayer(options), {
                        url: function (coords) { return valuesUrlOf(layer, coords); },
                        style: function () { var at = thermalLayer(layer); return at ? isothermStyle(rawIsotherm(state.isotherm, fixFor(at)), at.mosaic && at.mosaic.unit) : null; },
                        fetchFn: fetchFn})};
                    overlays.push(o);
                    o.overlay.addTo(map);
                    mirrorClip(o);
                } else o.overlay.recolour();
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
            legend.innerHTML = legendHtml(c, look.range, label, userUnit(), state.isotherm, fixFor(t), layerExtent(t), sharesOf(t, look),
                                          stepsOf(t, look));
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
                    recolourAll();
                }, function () { colors[name] = false; });
            }
            return colors[name] || null;
        }

        // How a thermal layer is drawn, {range (°C), adjust}
        function lookOf(t) { return {range: layerRange(t), adjust: layerAdjust(t)}; }

        // The palette's share at values evenly across a layer's range as its tiles are drawn (gamma's)
        function sharesOf(t, look) {
            if (!look.range) return null;
            var r = valuesRange(t, look.range);
            return Recolour.drawnShares(r[0], r[1], look.adjust);
        }

        // Stepped's bands of a layer drawn so (look: {range (°C), adjust}), in its values' unit (scale.bandsOf's), their
        // edges at whole multiples of the width in the user's unit, of corrected temperatures with a correction; null
        // when not stepped
        function bandsOf(t, look) {
            if (!look.range) return null;
            var r = valuesRange(t, look.range), fix = fixFor(t);
            var shown = function (v) { return shownTemp(corrected(t.mosaic ? toCelsius(v, t.mosaic.unit) : v, fix)); };
            return Scale.bandsOf(look.adjust, r, linearOver(shown, r));
        }
        function stepsOf(t, look) { return look.range ? Scale.stepsOf(bandsOf(t, look), valuesRange(t, look.range)) : null; }

        // -- the thermal layers' tiles, coloured in the browser from their values ------------------------------------

        // A thermal layer's value tile at coords: a mosaic's, or the orthophoto's of its own tile there
        function valuesUrlOf(layer, coords) {
            return layer.__dtMosaic ? mosaicValuesUrl(layer.__dtMosaic, coords) : valuesUrl(layer.getTileUrl(coords));
        }

        // How a thermal layer's tiles are coloured now (recolour.js's style), null until its palette's colours come
        function drawStyle(layer) {
            var t = thermalLayer(layer), name = t && layerPalette(t), colors = name && paletteColors(t, name);
            var look = t && lookOf(t), range = look && (look.range || layerExtent(t));
            if (!colors || !range) return null;
            return {colors: colors, range: valuesRange(t, range), shares: sharesOf(t, {range: range, adjust: look.adjust}),
                    steps: stepsOf(t, {range: range, adjust: look.adjust}),
                    sharpen: look.adjust.sharpen || 0, isotherm: null, seams: !!t.mosaic && t.mosaic.tab === "source_frame"};
        }

        // A layer drawn from values made so, its tiles drawn again
        function drawnFromValues(layer) {
            return Recolour.drawFromValues(layer, {url: function (coords) { return valuesUrlOf(layer, coords); },
                                                   style: function () { return drawStyle(layer); }, fetchFn: fetchFn});
        }

        // Every thermal layer and isotherm coloured again (a palette's colours came)
        function recolourAll() {
            thermalLayers(map, true).forEach(function (t) { if (t.layer.recolour) t.layer.recolour(); });
            overlays.forEach(function (o) { o.overlay.recolour(); });
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
                    shares: look.range ? sharesOf(t, look) : null, steps: stepsOf(t, look), bands: bandsOf(t, look), fix: fixFor(t)};
        }

        // The panel's scale, range boxes and sliders as the layer is (or would be) drawn, without drawing the panel
        // again (the slider moved keeps its place)
        function showScale(moved) {
            var box = state.open && panel.querySelector(".dt-inspector-scale");
            if (!box) return;
            var s = state.scale = scaleState(), unit = userUnit();
            if (!s || !s.range) return render();
            var shown = function (c) { return roundShown(corrected(c, s.fix), unit); };
            box.querySelector(".dt-inspector-scale-bar").innerHTML = s.colors ? barHtml(s.colors, s.range, unit, state.isotherm, s.fix, s.shares, s.steps) : "";
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
            field("image-tone").value = s.adjust.tone === "stepped" ? "stepped" : "linear";
            // Auto's band width as the range changes
            if (field("image-step") && s.bands) field("image-step").placeholder = "Auto " + Number(s.bands.auto.toPrecision(6));
        }

        // The topmost layer drawn over a range (°C) with adjustments: a mosaic's tile URL, an orthophoto's (the
        // plugin's tiles once it is adjusted, WebODM's again when it is not, in one of WebODM's colour maps)
        function setLook(t, range, adjust, moved) {
            var said = state.rangeError;
            state.rangeError = "";
            if (t.mosaic) {
                restyleMosaic(t.layer, {range: range.map(function (c) { return fromCelsius(c, t.mosaic.unit); }), adjust: adjust});
            } else {
                var url = withPalette(withRange(t.layer._url, range), state.palette || paletteOf(t.layer._url), state.display, adjust);
                if (url !== t.layer._url) restyleOrthophoto(t.layer, url);
            }
            if (said) render();
            else showScale(moved);
        }

        // An orthophoto's look (its URL, which WebODM's layer panel shares) changed: its tiles coloured again from their
        // values, with no requests
        function restyleOrthophoto(layer, url) {
            applying = true;
            layer.setUrl(url, true);
            if (layer.recolour) layer.recolour();
            applying = false;
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
        // adjustments; the tiles coloured again at once, the frames window's picture when let go (commit)
        function slide(input, commit) {
            var t = topLayer();
            if (!t) return;
            var look = lookOf(t), name = input.getAttribute("data-act").slice("image-".length);
            var next = {range: look.range, adjust: assign({}, look.adjust)};
            var auto = autoRange(t, userUnit());
            if (name === "brightness" || name === "contrast") {
                if (!auto) return;
                var value = function (k) { return parseFloat(panel.querySelector('[data-act="image-' + k + '"]').value) || 0; };
                next.range = Scale.slidRange(auto, value("brightness"), value("contrast"));
            } else if (name === "gamma") next.adjust.gamma = Scale.sliderGamma(input.value);
            else next.adjust.sharpen = Math.round((parseFloat(input.value) || 0) * 100) / 100;
            sliding = !commit;
            setLook(t, next.range, next.adjust, input);
            sliding = false;
            if (commit) restylePick();
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
            // Linear or Stepped, and the bands' width (empty: Auto): the panel drawn again, for the width's field
            if (what === "image-tone" || what === "image-step") {
                var change = what === "image-tone" ? {tone: target.value === "stepped" ? "stepped" : "linear"} : {step: Scale.typedStep(target.value)};
                setLook(t, look.range, assign({}, look.adjust, change));
                restylePick();
                return render();
            }
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
                if (r.shape === "delta") {
                    return deltaLayers(latLngs(r), style.color, r.label + (typeof r.delta_t === "number" ? ": ΔT " + formatSigned(r.delta_t) : ""), "dt-inspector-tip")
                        .forEach(function (l) { regionLayer.addLayer(l); });
                }
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

        // A ΔT on the map: a thin line between its spots, a dot at each (the first hollow), the label at the second
        function deltaLayers(points, color, label, className) {
            var dot = function (p, fill) { return L.circleMarker(p, {radius: 4, color: color, weight: 2, fillColor: fill, fillOpacity: 1, interactive: false}); };
            var second = dot(points[1], color);
            second.bindTooltip(label, {permanent: true, direction: "right", className: className});
            return [L.polyline(points, {color: color, weight: 1.5, opacity: 0.95, dashArray: "4 3", interactive: false}), dot(points[0], "#fff"), second];
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
                } else if (m.shape === "delta") {
                    var v = m.values || {};
                    return deltaLayers(savedLatLngs(m), SAVED_STYLE.color, m.name + (typeof v.delta_t === "number" ? ": ΔT " + formatSigned(v.delta_t) : ""),
                                       "dt-inspector-tip dt-inspector-saved-tip").forEach(function (l) { savedLayer.addLayer(l); });
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
                body: JSON.stringify({geometry: r.geometry, shape: r.shape === "delta" ? "delta" : undefined, isotherm: isothermLimits(state.isotherm),
                                      correction: fix ? fix.wanted : null})}).then(readJson).then(function (res) {
                if (!res.ok) return {error: (res.data && (res.data.error || res.data.detail)) || "Could not read the region"};
                return res.data;
            }, function () { return {error: "Could not read the region"}; }).then(function (data) {
                r.loading = false;
                if (data.error) r.error = data.error;
                else if (r.shape === "delta") {
                    assign(r, {statistics: null, reason: data.reason || null, first: numberOrNull(data.first), second: numberOrNull(data.second),
                               delta_t: numberOrNull(data.delta_t), reasons: data.reasons || [], length: data.length, correction: fixKey(fix)});
                } else assign(r, {statistics: data.statistics || null, reason: data.reason || null, pixel_size: data.pixel_size,
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
            var prefix = shape === "line" ? "L" : shape === "delta" ? "D" : "R";
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
                    // The temperature the panel shows, corrected as it is
                    var text = state.pointerTemperature && r && r.valid ? formatTemp(state.readout.temperature) : "";
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
            var src = framesSource(thermalLayer(pick.t.layer), state.mosaics, state.palette, state.display);
            frameBox.innerHTML = Frames.pipHtml(pick, frameImageUrl(pick), src && src.base);
            if (framesMoved) frameMove.keep();
            else placeFrames(panelMove.offset());
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
            if (sliding) return;
            var img = state.pick && frameBox.querySelector("img");
            var url = img && frameImageUrl(state.pick);
            if (url && img.getAttribute("src") !== url) img.setAttribute("src", url);
        }

        // The source frames window moves with the panel, beside it: on its left, or on its right when only that has room;
        // once dragged on its own, it stays where it was dropped until it is closed
        function placeFrames(offset) {
            if (framesMoved) return;
            frameMove.to(offset);
            var a = map.getContainer().getBoundingClientRect(), p = panel.getBoundingClientRect();
            var room = (frameBox.offsetWidth || FRAMES_WIDTH) + FRAMES_GAP;
            frameBox.classList.toggle("dt-inspector-frames-right", !!(offset.x || offset.y) && p.left - a.left < room && a.right - p.right >= room);
        }

        function closeFrames() {
            pickSeq++;
            state.pick = null;
            if (!frameBox) return;
            framesMoved = false;
            frameMove.reset();
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
            if (url !== t.layer._url) restyleOrthophoto(t.layer, url);
        }

        // WebODM's layer panel sets the URL from its own colour map (its list shows what it was given) and range: a
        // colour map chosen there is the user's (saved when it is one of the palettes offered, else drawn on this page
        // only); a range alone keeps the user's palette, DJI's too, and the Image section's adjustments. A range set
        // there is the layer's; the panel's own range, sent again with another change, doesn't undo the Inspector's
        function watch(t) {
            if (t.mosaic || t.layer.__dtWatched) return;
            t.layer.__dtWatched = true;
            // Its tiles coloured in the browser from their values, whatever its palette
            drawnFromValues(t.layer);
            if (t.layer.redraw) t.layer.redraw();
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
                    // Coloured again from the values it has
                    args[1] = true;
                }
                var out = setUrl.apply(this, args);
                if (!applying && this.recolour) this.recolour();
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
            // Another tab's values asked for, else the tiles coloured again
            if (next.tab !== info.tab) layer.redraw();
            else if (layer.recolour) layer.recolour();
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
            var layer = drawnFromValues(L.gridLayer({maxZoom: 26, maxNativeZoom: (info.maxzoom || 20) + 1, minZoom: 0, tileSize: 256,
                zIndex: overlayZ(), bounds: b ? L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]) : undefined}));
            layer.__dtMosaic = info;
            state.laid[id] = {layer: layer, opacity: 100, swipe: false};
            layer.addTo(map);
            showButton();
            return state.laid[id];
        }

        // Above WebODM's layers, each overlay laid above the ones before
        function overlayZ() { return MOSAIC_Z + Object.keys(state.laid).length + Object.keys(state.orthoLaid).length; }

        // An orthophoto of another task laid on the map, once its metadata came (WebODM's, as its map asks): drawn from
        // WebODM's tiles as WebODM draws it; a thermal one marked as WebODM marks its layers, so the Inspector watches,
        // colours and reads it as that task's thermal layer (onLayerAdd), its measurements saved on that task
        function layOrtho(o) {
            if (state.orthoLaid[o.id]) return state.orthoLaid[o.id];
            var laid = state.orthoLaid[o.id] = {layer: null, opacity: 100, swipe: false, error: ""};
            var q = (o.thermal ? ["formula=Celsius", "bands=L", "color_map=magma"] : []).concat(o.task.crop ? ["crop=1"] : []);
            var failed = function () {
                if (state.orthoLaid[o.id] !== laid) return;
                laid.error = "Could not load this orthophoto";
                render();
            };
            fetchFn("/api/projects/" + project + "/tasks/" + o.id + "/orthophoto/metadata" + (q.length ? "?" + q.join("&") : ""),
                    {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (state.orthoLaid[o.id] !== laid) return;        // lifted meanwhile
                if (!r.ok || !r.data || !r.data.tiles || !r.data.tiles[0]) return failed();
                var mres = r.data, b = mres.bounds && mres.bounds.value, zoom = mres.maxzoom || 20;
                var layer = L.tileLayer(orthoUrl(mres, o), {bounds: b ? L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]) : undefined,
                    minZoom: 0, maxZoom: zoom + 99, maxNativeZoom: zoom - 1, tileSize: 512, tms: mres.scheme === "tms", detectRetina: true,
                    zIndex: overlayZ()});
                layer[META] = {task: assign({project: Number(project)}, o.task), raster: true, type: o.thermal ? "plant" : "orthophoto",
                               name: o.thermal ? "Thermal" : "Orthophoto"};
                layer[TILE_META] = mres;
                layer.__dtOrtho = o.id;
                laid.layer = layer;
                layer.setOpacity(laid.opacity / 100);
                layer.addTo(map);
                showButton();
                zoomTo(laid);
                render();
            }, failed);
            return laid;
        }

        function liftOrtho(id) {
            var laid = state.orthoLaid[id];
            if (!laid) return;
            if (laid.swipe) swipe(laid, false);
            delete state.orthoLaid[id];
            if (laid.layer) map.removeLayer(laid.layer);
            showButton();
        }

        function onOrthoInput(row, what, value) {
            var o = (state.orthos || []).filter(function (x) { return x.id === row.getAttribute("data-ortho"); })[0];
            if (!o) return;
            var laid = state.orthoLaid[o.id];
            if (what === "on") {
                if (value) layOrtho(o);
                else liftOrtho(o.id);
            } else if (!laid || !laid.layer) return;
            else if (what === "opacity") { laid.opacity = Number(value); laid.layer.setOpacity(laid.opacity / 100); }
            else if (what === "swipe") swipe(laid, !laid.swipe);
            else if (what === "zoom") return zoomTo(laid);
            render();
        }

        function liftMosaic(id) {
            var laid = state.laid[id];
            if (!laid) return;
            if (laid.swipe) swipe(laid, false);
            delete state.laid[id];
            map.removeLayer(laid.layer);
            showButton();
        }

        // On the right of WebODM's split control (PluginsAPI.Map.sideBySideChanged, as its own layer panel does)
        function swipe(laid, on) {
            if (!plugins || !plugins.Map || !plugins.Map.sideBySideChanged) return;
            laid.swipe = on;
            plugins.Map.sideBySideChanged(laid.layer, on);
        }

        function zoomTo(laid) {
            var b = laid.layer && laid.layer.options.bounds;
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

        // The button shows only where the map has temperatures: a thermal orthophoto, or a workset mosaic laid on it (the
        // Analyzer's "Open on WebODM's map"; kept while the panel is open, so a mosaic lifted there can be laid again).
        // An RGB map of a project with mosaics has none.
        function showButton() {
            container.style.display = hasThermal(args.tiles) || Object.keys(state.laid).length || state.open ||
                (state.orthos || []).some(function (o) { return o.thermal; }) ? "" : "none";
        }

        // Without a palette of the user's own, the map opens in the topmost orthophoto's task's (chosen in DJI Thermal
        // Task), until the user chooses one
        function openInTaskPalette() {
            if (!state.display || state.display.palette || paletteChosen) return;
            var t = thermalLayers(map).filter(function (x) { return !x.mosaic; }).pop(), src = t && state.sources[layerSource(t).key];
            if (src && src.palette && src.palette !== state.palette && paletteNames(state.display).indexOf(src.palette) !== -1) showPalette(src.palette);
        }

        function showPalette(name, except) {
            state.palette = name;
            thermalLayers(map).forEach(function (t) { if (t.layer !== except) applyPalette(t); });
            render();
        }

        function choosePalette(name, except) {
            paletteChosen = true;
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
            var orow = e.target.closest("[data-ortho]");
            if (orow && (what === "ortho-swipe" || what === "ortho-zoom")) return onOrthoInput(orow, what.slice("ortho-".length));
            if (what === "overlays-toggle") {
                var kind = act.getAttribute("data-overlays");
                state.overlaysOpen[kind] = !state.overlaysOpen[kind];
                return render();
            }
            if (what === "range-narrow" || what === "range-wider" || what === "range-raise" || what === "range-lower") {
                var shown = topLayer(), range = shown && lookOf(shown).range;
                if (!range) return;
                setLook(shown, what === "range-narrow" || what === "range-wider" ? Scale.spanRange(range, what === "range-wider" ? 1 : -1)
                    : Scale.shiftRange(range, what === "range-raise" ? 1 : -1, layerExtent(shown)), lookOf(shown).adjust);
                return;
            }
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

        // Temperature On Pointer: the user's preference, for the Analyzer's pages too (never saved from a public map)
        function choosePointerTemperature(on) {
            state.pointerTemperature = on;
            plainPointer();
            if (!on) cursor.style.display = "none";
            if (publicMap) return;
            fetchFn(API + "display", {method: "PUT", credentials: "same-origin",
                headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken(doc)},
                body: JSON.stringify({pointer_temperature: on})}).catch(function () {});
        }

        // With the panel open and Temperature On Pointer ticked, a plain arrow over the map instead of Leaflet's hand
        // (inspector.css); Pin's and the drawing tools' crosshair, set on the map itself, still wins
        function plainPointer() {
            map.getContainer().classList.toggle("dt-pointer-plain", !!(state.open && state.pointerTemperature));
        }

        function onPanelChange(e) {
            var what = e.target.getAttribute("data-act") || "";
            if (what === "palette") choosePalette(e.target.value);
            else if (what === "pointer-temperature") choosePointerTemperature(e.target.checked);
            else if (what.indexOf("isotherm-") === 0) isothermInput(what.slice("isotherm-".length), e.target.value);
            else if (what.indexOf("range-") === 0 || what.indexOf("image-") === 0) onScaleInput(what, e.target);
            else if (what.indexOf("correction-") === 0) {
                correctionInput(what.slice("correction-".length), what === "correction-on" ? e.target.checked : e.target.value);
            }
            else if (what.indexOf("mosaic-") === 0) {
                onMosaicInput(e.target.closest("[data-mosaic]"), what.slice("mosaic-".length), what === "mosaic-on" ? e.target.checked : e.target.value);
            }
            else if (what.indexOf("ortho-") === 0) {
                onOrthoInput(e.target.closest("[data-ortho]"), what.slice("ortho-".length), what === "ortho-on" ? e.target.checked : e.target.value);
            }
        }

        function open() {
            state.open = true;
            container.classList.add("open");
            plainPointer();
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
            plainPointer();
            onOut();
            showButton();
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
                // The panel is dragged by its heading, the frames window with it, or on its own by its heading
                panelMove = movable(panel, map.getContainer(), function (t) {
                    return !!t.closest(".dt-inspector-head") && !t.closest(FIELDS);
                }, placeFrames, doc);
                frameMove = movable(frameBox, map.getContainer(), function (t) {
                    return !!t.closest(".ta-pip-head") && !t.closest(FIELDS);
                }, function (offset, dragged) { if (dragged) framesMoved = true; }, doc);
                // Over the panel the cursor is not over the map
                container.addEventListener("mousemove", function (e) { e.stopPropagation(); onOut(); });
                container.querySelector(".dt-inspector-button").addEventListener("click", function () { if (state.open) close(); else open(); });
                panel.addEventListener("click", onPanelClick);
                panel.addEventListener("change", onPanelChange);
                // What is typed in the form is kept while the panel is drawn again
                panel.addEventListener("input", function (e) {
                    var field = e.target.getAttribute && e.target.getAttribute("data-form");
                    if (field && state.form) state.form[field] = e.target.value;
                    // While a slider moves, the tiles, the scale, the boxes and the legend follow
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
        map.on("resize", function () { panelMove.keep(); legendMove.keep(); if (framesMoved) frameMove.keep(); });
        map.on("mousemove", onMove);
        map.on("mouseout", onOut);
        map.on("layeradd", onLayerAdd);
        map.on("layerremove", onLayerRemove);
        thermalLayers(map, true).forEach(function (t) { watch(t); });
        drawIsotherms();
        if (plugins && plugins.Map && plugins.Map.onHandleClick) plugins.Map.onHandleClick(onClick);
        doc.addEventListener("onUnitSystemChanged", onUnits);
        doc.addEventListener("djiThermalUnitChanged", onUnits);

        // The user's palette and whether the legend is shown, from the Analyzer's preferences (shown when they can't
        // be read). Asked for only where there are temperatures: a thermal layer on the map, or the project's mosaics
        // (below); never on a public map, whose viewer may not be logged in (the legend shown, the task's palette).
        var publicMap = /^\/public\//.test((deps.path !== undefined ? deps.path : root.location && root.location.pathname) || "");
        function loadDisplay() {
            if (publicMap) {
                state.legendVisible = true;
                renderLegend();
                return Promise.resolve();
            }
            return fetchFn(API + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
                state.legendVisible = !r.ok || r.data.legend !== false;
                // On unless the user cleared it, here or on the Analyzer's pages
                state.pointerTemperature = !r.ok || r.data.pointer_temperature !== false;
                plainPointer();
                if (!r.ok) return renderLegend();
                state.display = r.data;
                var preferred = r.data.palette;
                if (preferred && paletteNames(r.data).indexOf(preferred) !== -1) {
                    state.palette = preferred;
                    thermalLayers(map).forEach(applyPalette);
                } else {
                    var shown = thermalLayers(map)[0];
                    state.palette = shown ? paletteOf(shown.layer._url) : "";
                    openInTaskPalette();
                }
                renderLegend();
                render();
            }, function () {
                state.legendVisible = true;
                renderLegend();
            });
        }
        var temperatures = !!(thermalLayers(map, true).length || hasThermal(args.tiles));
        var ready = temperatures ? loadDisplay() : Promise.resolve();

        // The project's workset mosaics, then the one a link asks for laid on the map, the panel open
        var mosaicsReady = !project ? Promise.resolve() : ready.then(function () {
            return fetchFn(API + "projects/" + project + "/inspector/mosaics", {credentials: "same-origin"}).then(readJson);
        }).then(function (r) {
            var found = r.ok && Array.isArray(r.data.mosaics) ? r.data.mosaics : [];
            // An RGB map whose project has mosaics: the preferences now, before one is laid
            return (found.length && !temperatures ? loadDisplay() : Promise.resolve()).then(function () { return found; });
        }).then(function (found) {
            state.mosaics = found;
            var linked = linkedMosaic(search);
            var m = linked && state.mosaics.filter(function (x) { return x.dataset.id === linked.dataset && x.workset.id === linked.workset; })[0];
            if (m) {
                zoomTo(layMosaic(m, linked.tab));
                open();
            } else render();
        }, function () { state.mosaics = []; });

        // The orthophotos of the project's other tasks (WebODM's task list) for Ortho Overlays. On a map without
        // temperatures whose project has a thermal one to lay, the preferences now and the button shown
        var orthosReady = !project ? Promise.resolve() : mosaicsReady.then(function () {
            return fetchFn("/api/projects/" + project + "/tasks/", {credentials: "same-origin"}).then(readJson);
        }).then(function (r) {
            state.orthos = orthosOf(r && r.ok && Array.isArray(r.data) ? r.data : [], tasks);
            var thermal = state.orthos.some(function (o) { return o.thermal; });
            return (thermal && !temperatures && !state.display ? loadDisplay() : Promise.resolve());
        }, function () { state.orthos = []; }).then(function () {
            showButton();
            render();
        });

        // A region drawn before its statistics came (the page left) is read again
        state.regions.forEach(function (r) { if (!r.statistics && !r.reason) measure(r); });

        return {control: control, state: state, open: open, close: close, ready: ready, mosaicsReady: mosaicsReady, orthosReady: orthosReady,
                click: onClick, setMode: setMode,
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
               mosaicRange: mosaicRange, laidMosaic: laidMosaic, mosaicValuesUrl: mosaicValuesUrl, isothermStyle: isothermStyle, valuesUrl: valuesUrl,
               framesSource: framesSource, fromCelsius: fromCelsius, corrected: corrected, uncorrected: uncorrected,
               rawIsotherm: rawIsotherm, keptRange: keptRange, correctionHtml: correctionHtml, forgetCorrections: forgetCorrections,
               savedHtml: savedHtml, savedCsv: savedCsv, savedGeoJson: savedGeoJson, formHtml: formHtml, pinsHtml: pinsHtml,
               mosaicsHtml: mosaicsHtml, orthosHtml: orthosHtml, orthosOf: orthosOf, orthoUrl: orthoUrl, shownAt: shownAt, toCelsius: toCelsius, movable: movable, adjustOf: adjustOf, autoRange: autoRange,
               scaleHtml: scaleHtml, imageHtml: imageHtml, create: create};
    root.ThermalInspector = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
