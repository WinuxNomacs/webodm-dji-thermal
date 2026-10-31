// The Thermal Inspector: a control on WebODM's 2D map for thermal orthophotos (a single lwir band). The temperature
// under the cursor, points pinned with theirs (kept in the browser, for the same tasks), and the thermal layer's
// palette, which is the user's everywhere (the Analyzer's preference). Temperatures come from the plugin's API
// (inspector_api.py) in °C and are shown in WebODM's units (°F when imperial). main.js adds it through
// PluginsAPI.Map.willAddControls, with WebODM's own Leaflet.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var HOVER_MS = 80;              // the readout asks for the point the cursor rests on, not every point it crosses
    var PINS_PREFIX = "dji-thermal-inspector:pins:";
    var META = root.Symbol ? root.Symbol["for"]("meta") : "meta";      // where WebODM's map keeps a layer's metadata
    var TILE_URL = /\/api\/projects\/(\d+)\/tasks\/([^/]+)\/orthophoto\/tiles\//;
    var REASONS = {excluded: "Outside the task's crop", outside_raster: "Outside the orthophoto", nodata: "No data here"};

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

    // Pins: {id, label, lat, lng, temperature (°C) or null, reason}, remembered in the browser for the same tasks
    function pinsKey(tasks) { return PINS_PREFIX + tasks.slice().sort().join(","); }
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
            ["hover", "pin"].map(function (m) {
                return '<button type="button" class="btn btn-' + (state.mode === m ? "primary" : "default") + '" data-mode="' + m + '">' +
                    (m === "hover" ? '<i class="fa fa-mouse-pointer"></i> Hover' : '<i class="fa fa-map-pin"></i> Pin') + "</button>";
            }).join("") + "</div>" +
            '<div class="dt-inspector-readout">' + readoutHtml(state.readout, unit) + "</div>" +
            (options.length ? '<label class="dt-inspector-label">Palette <select class="form-control input-sm" data-act="palette">' +
                options.map(function (p) {
                    return '<option value="' + escapeHtml(p) + '"' + (p === current ? " selected" : "") + ">" + escapeHtml(p) + "</option>";
                }).join("") + "</select></label>" : "") +
            '<div class="dt-inspector-section"><strong>Pinned points</strong>' + pinsHtml(state.pins, unit, state.pinsVisible) + "</div>";
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
        var key = pinsKey(tasks);
        var state = {open: false, mode: "hover", readout: null, pins: loadPins(storage, key), pinsVisible: true,
                     display: null, palette: ""};
        var container, panel, cursor, pinLayer, timer = null, seq = 0, applying = false;

        function render() {
            if (!state.open) { panel.hidden = true; return; }
            panel.hidden = false;
            panel.innerHTML = panelHtml(state);
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

        // A click while pinning pins the point and is not WebODM's (no popup)
        function onClick(e) {
            if (!state.open || state.mode !== "pin") return false;
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
            if (mode) {
                state.mode = mode.getAttribute("data-mode");
                map.getContainer().style.cursor = state.mode === "pin" ? "crosshair" : "";
                return render();
            }
            var act = e.target.closest("[data-act]");
            if (!act) return;
            var what = act.getAttribute("data-act");
            var row = act.closest("[data-pin]");
            var pin = row && state.pins.filter(function (p) { return p.id === row.getAttribute("data-pin"); })[0];
            if (what === "close") close();
            else if (what === "goto" && pin) map.panTo([pin.lat, pin.lng]);
            else if (what === "remove" && pin) { state.pins = state.pins.filter(function (p) { return p !== pin; }); pinsChanged(); }
            else if (what === "toggle") { state.pinsVisible = !state.pinsVisible; drawPins(); render(); }
            else if (what === "clear") { state.pins = []; pinsChanged(); }
            else if (what === "csv") download("thermal-points.csv", pinsCsv(state.pins, userUnit()));
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
            state.open = false;
            state.mode = "hover";
            state.readout = null;
            map.getContainer().style.cursor = "";
            container.classList.remove("open");
            onOut();
            render();
        }

        function onUnits() { drawPins(); render(); }

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
        pinLayer = L.layerGroup().addTo(map);
        drawPins();
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

        return {control: control, state: state, open: open, close: close, ready: ready, click: onClick};
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
               pinsKey: pinsKey, loadPins: loadPins, savePins: savePins, pinsCsv: pinsCsv, readoutHtml: readoutHtml,
               panelHtml: panelHtml, hasThermal: hasThermal, create: create};
    root.ThermalInspector = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
