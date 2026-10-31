// The Thermal Inspector: a control on WebODM's 2D map for thermal orthophotos (a single lwir band). The temperature
// under the cursor, points pinned with theirs and regions drawn with their statistics (both kept in the browser, for
// the same tasks; regions drawn by regions.js), and the thermal layer's palette, which is the user's everywhere (the
// Analyzer's preference). Temperatures come from the plugin's API
// (inspector_api.py) in °C and are shown in WebODM's units (°F when imperial). main.js adds it through
// PluginsAPI.Map.willAddControls, with WebODM's own Leaflet.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var HOVER_MS = 80;              // the readout asks for the point the cursor rests on, not every point it crosses
    var DRAWN_CLICK_MS = 500;       // the click Leaflet fires after a rectangle or circle is dragged is part of it
    var PINS_PREFIX = "dji-thermal-inspector:pins:";
    var REGIONS_PREFIX = "dji-thermal-inspector:regions:";
    var SHAPES = {rectangle: "far fa-square", circle: "far fa-circle", polygon: "fa fa-draw-polygon"};
    var SHAPE_NAMES = {rectangle: "Rectangle", circle: "Circle", polygon: "Polygon"};
    var SQ_FT_PER_SQ_M = 10.7639104;
    var Regions = root.ThermalRegions || (typeof require !== "undefined" ? require("./regions.js") : null);
    var META = root.Symbol ? root.Symbol["for"]("meta") : "meta";      // where WebODM's map keeps a layer's metadata
    var TILE_URL = /\/api\/projects\/(\d+)\/tasks\/([^/]+)\/orthophoto\/tiles\//;
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
    function formatArea(m2, unit) {
        var imperial = (unit || userUnit()) === "F";
        var v = imperial ? m2 * SQ_FT_PER_SQ_M : m2;
        return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + (imperial ? " ft²" : " m²");
    }

    // The task a layer of WebODM's map shows, when it is a thermal orthophoto: {project, task, layer}, else null
    function thermalLayer(layer) {
        var meta = layer && layer[META];
        var url = layer && layer._url;
        if (!meta || !meta.raster || typeof url !== "string") return null;
        var m = TILE_URL.exec(url);
        var bands = (meta.task && meta.task.orthophoto_bands) || [];
        if (!m || !bands[0] || String(bands[0].description || "").toLowerCase() !== "lwir") return null;
        return {project: m[1], task: m[2], layer: layer};
    }

    // The thermal orthophotos on the map, shown, topmost last (as WebODM finds the layer a click is on)
    function thermalLayers(map) {
        var found = [];
        Object.keys(map._layers || {}).forEach(function (k) {
            var t = thermalLayer(map._layers[k]);
            if (t && map.hasLayer(t.layer) && !(t.layer.isHidden && t.layer.isHidden())) found.push(t);
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

    function inspectorUrl(t, what) { return API + "projects/" + t.project + "/tasks/" + t.task + "/inspector/" + what; }
    function pointUrl(t, latlng) {
        return inspectorUrl(t, "point") + "?lon=" + Number(latlng.lng).toFixed(8) + "&lat=" + Number(latlng.lat).toFixed(8);
    }

    // A tile URL with its colour map changed, its other parameters kept
    function withColorMap(url, name) {
        var q = url.indexOf("?");
        var base = q === -1 ? url : url.slice(0, q);
        var params = (q === -1 ? "" : url.slice(q + 1)).split("&").filter(function (p) {
            return p && p.split("=")[0] !== "color_map";
        });
        params.push("color_map=" + encodeURIComponent(name));
        return base + "?" + params.join("&");
    }
    function colorMapOf(url) {
        var m = /[?&]color_map=([^&]*)/.exec(url || "");
        return m ? decodeURIComponent(m[1]) : "";
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
                '</td><td class="text-right"><a href="javascript:void(0)" data-act="show" title="Show its statistics"><i class="fa fa-chart-bar"></i></a> ' +
                '<a href="javascript:void(0)" data-act="remove" title="Remove"><i class="fa fa-times"></i></a></td></tr>';
        }).join("") + "</tbody></table>" +
            (shown ? '<div class="dt-inspector-shown"><strong>' + escapeHtml(shown.label) + "</strong> " +
                '<span class="text-muted">' + escapeHtml(SHAPE_NAMES[shown.shape] || "") + "</span>" + statisticsHtml(shown, unit) + "</div>" : "") +
            '<div class="dt-inspector-actions">' +
            '<button type="button" class="btn btn-default btn-xs" data-act="toggle-regions">' + (state.regionsVisible ? '<i class="fa fa-eye-slash"></i> Hide' : '<i class="fa fa-eye"></i> Show') + "</button> " +
            '<button type="button" class="btn btn-default btn-xs" data-act="csv-regions"><i class="fa fa-download"></i> CSV</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="clear-regions"><i class="fa fa-trash"></i> Remove all</button></div>';
    }

    function readoutHtml(r, unit) {
        if (!r) return '<span class="text-muted">Move the cursor over the thermal orthophoto.</span>';
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

    // The palettes to choose from ({palettes: DJI's, colormaps: WebODM's}, as the display API gives them): those WebODM
    // draws the layer in
    function paletteOptions(display) {
        return (display && display.colormaps) || [];
    }

    function panelHtml(state) {
        var unit = userUnit();
        var options = paletteOptions(state.display);
        var current = state.palette;
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
                options.map(function (p) {
                    return '<option value="' + escapeHtml(p) + '"' + (p === current ? " selected" : "") + ">" + escapeHtml(p) + "</option>";
                }).join("") + "</select></label>" : "") +
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
        var key = pinsKey(tasks), rkey = regionsKey(tasks);
        var regions = loadPins(storage, rkey).filter(function (r) { return r && r.geometry && SHAPES[r.shape]; });
        var state = {open: false, mode: "hover", readout: null, pins: loadPins(storage, key), pinsVisible: true,
                     regions: regions, regionsVisible: true, shown: regions.length ? regions[regions.length - 1].id : null,
                     notice: "", display: null, palette: ""};
        var container, panel, cursor, pinLayer, regionLayer, tool = null, timer = null, seq = 0, applying = false, drawnAt = 0;

        function render() {
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            panel.innerHTML = panelHtml(state);
            // Within the map, above its bottom controls
            var room = map.getContainer().clientHeight - container.offsetTop - 60;
            if (room > 0) panel.style.maxHeight = Math.max(160, room) + "px";
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

        function query(t, latlng) {
            return fetchFn(pointUrl(t, latlng), {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (!r.ok) return {error: (r.data && (r.data.error || r.data.detail)) || "Could not read the temperature"};
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

        // The thermal layers' palette: the user's preference when it is one WebODM draws, applied as each layer comes
        function applyPalette(t) {
            if (!state.palette || colorMapOf(t.layer._url) === state.palette) return;
            applying = true;
            t.layer.setUrl(withColorMap(t.layer._url, state.palette), true);
            if (t.layer._removeAllTiles) t.layer._removeAllTiles();
            if (t.layer.redraw) t.layer.redraw();
            applying = false;
        }

        // A palette chosen in WebODM's layer panel is the user's too: it follows the tile URL
        function watch(t) {
            if (t.layer.__dtWatched) return;
            t.layer.__dtWatched = true;
            var setUrl = t.layer.setUrl;
            t.layer.setUrl = function (url) {
                var result = setUrl.apply(this, arguments);
                var chosen = colorMapOf(url);
                if (!applying && chosen && chosen !== state.palette && paletteOptions(state.display).indexOf(chosen) !== -1) {
                    choosePalette(chosen, t.layer);
                }
                return result;
            };
        }

        function onLayerAdd(e) {
            var t = thermalLayer(e.layer);
            if (!t) return;
            watch(t);
            applyPalette(t);
        }

        function choosePalette(name, except) {
            state.palette = name;
            thermalLayers(map).forEach(function (t) { if (t.layer !== except) applyPalette(t); });
            render();
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
            if (!act) return;
            var what = act.getAttribute("data-act");
            var row = act.closest("[data-pin]");
            var pin = row && state.pins.filter(function (p) { return p.id === row.getAttribute("data-pin"); })[0];
            var rrow = act.closest("[data-region]");
            var region = rrow && state.regions.filter(function (r) { return r.id === rrow.getAttribute("data-region"); })[0];
            if (region) {
                if (what === "goto") map.fitBounds(regionBounds(region), {maxZoom: map.getZoom()});
                if (what === "remove") {
                    state.regions = state.regions.filter(function (r) { return r !== region; });
                    if (state.shown === region.id) state.shown = state.regions.length ? state.regions[state.regions.length - 1].id : null;
                } else state.shown = region.id;
                if (what === "show" && !region.statistics && !region.loading) measure(region);
                return regionsChanged();
            }
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
            if (e.target.getAttribute("data-act") === "palette") choosePalette(e.target.value);
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

        function onUnits() { drawPins(); drawRegions(); render(); }

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
        cursor = L.DomUtil.create("div", "dt-inspector-cursor", map.getContainer());
        cursor.style.display = "none";
        regionLayer = L.layerGroup().addTo(map);
        pinLayer = L.layerGroup().addTo(map);
        drawPins();
        drawRegions();
        map.on("mousemove", onMove);
        map.on("mouseout", onOut);
        map.on("layeradd", onLayerAdd);
        thermalLayers(map).forEach(function (t) { watch(t); });
        if (plugins && plugins.Map && plugins.Map.onHandleClick) plugins.Map.onHandleClick(onClick);
        doc.addEventListener("onUnitSystemChanged", onUnits);

        // The user's palette, from the Analyzer's preferences
        var ready = fetchFn(API + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
            if (!r.ok) return;
            state.display = r.data;
            var preferred = r.data.palette;
            if (preferred && paletteOptions(r.data).indexOf(preferred) !== -1) {
                state.palette = preferred;
                thermalLayers(map).forEach(applyPalette);
            } else {
                var shown = thermalLayers(map)[0];
                state.palette = shown ? colorMapOf(shown.layer._url) : "";
            }
            render();
        }, function () {});

        // A region drawn before its statistics came (the page left) is read again
        state.regions.forEach(function (r) { if (!r.statistics && !r.reason) measure(r); });

        return {control: control, state: state, open: open, close: close, ready: ready, click: onClick, setMode: setMode};
    }

    // Added to a map only when it shows a thermal orthophoto
    function hasThermal(tiles) {
        return (tiles || []).some(function (t) {
            var bands = (t.meta && t.meta.task && t.meta.task.orthophoto_bands) || [];
            return t.type === "orthophoto" && bands[0] && String(bands[0].description || "").toLowerCase() === "lwir";
        });
    }

    var api = {userUnit: userUnit, formatTemp: formatTemp, thermalLayer: thermalLayer, thermalLayers: thermalLayers,
               thermalLayerAt: thermalLayerAt, pointUrl: pointUrl, withColorMap: withColorMap, colorMapOf: colorMapOf,
               pinsKey: pinsKey, regionsKey: regionsKey, loadPins: loadPins, savePins: savePins, pinsCsv: pinsCsv,
               regionsCsv: regionsCsv, statisticsHtml: statisticsHtml, readoutHtml: readoutHtml,
               panelHtml: panelHtml, hasThermal: hasThermal, create: create};
    root.ThermalInspector = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
