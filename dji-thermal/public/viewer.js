// A conversion's mosaics on a map (viewer.html), over WebODM's base layers: a tab per mosaic (as converted, harmonized,
// Intensify: the harmonized one's differences from their surroundings, and the as-converted mosaic's source frames,
// over its temperatures, and view angles), its palette and range changed live through the tile
// URL with its colour scale, the values under the cursor, the frames that saw a point clicked (in a window over the
// map, drawn as the tab draws the mosaic), and what dji-thermal-cli reports about the mosaic. Leaflet is
// WebODM's own, from the plugin's build (thermal/Leaflet.js).
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale") : null);
    var Frames = root.ThermalFrames || (typeof require !== "undefined" ? require("./frames") : null);
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour") : null);
    var pipHtml = Frames.pipHtml;
    var gradientCss = scale.gradientCss, scaleTicks = scale.scaleTicks, rangeTicks = scale.rangeTicks;
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var HOVER_MS = 120;         // the readout asks for the point the cursor rests on, not every point it crosses
    var READOUT_HINT = "Move the cursor over the mosaic; a click keeps the values there and opens the frames that saw it.";
    var DELTA_LABEL = "ΔT from surroundings";   // a point's temperature less the median around it (about 2 m)
    var TAB_LABELS = {as_converted: "Mosaic", harmonized: "Harmonized", intensify: "Intensify", source_frame: "Source frame",
                      view_angle: "View angle"};
    var TAB_HINTS = {
        as_converted: "Each pixel is one frame's own temperature, as the frames were converted.",
        harmonized: "Harmonized: the frames made to agree on temperature. The camera drifts a little between its " +
            "self-calibrations, so overlapping frames of the same ground can read a degree or two apart. Here every frame " +
            "uses the same ambient and reflected temperature, and each is shifted to match its neighbours where they " +
            "overlap. Compared with the Mosaic tab: no seams or patches from drift; the temperatures may sit slightly " +
            "higher or lower overall.",
        intensify: "Intensify: each pixel of the harmonized mosaic less the typical temperature around it (the median " +
            "over about 2 m). Slopes, the sun's side and gradients across the roof drop to about 0, so a narrow cooler " +
            "or warmer feature, such as a seam or a leak, stands out wherever it is: blue below its surroundings, red " +
            "above. The numbers are differences, not temperatures; anything 2 m wide or more fades out.",
        source_frame: "Where each frame was placed: the mosaic, with a line where one frame meets the next (each pixel " +
            "comes from the frame that saw it closest to straight down).",
        view_angle: "How far from straight down each pixel was seen, in degrees.",
        frame: "The frame's temperatures, as the workset measured it."
    };

    // How the image is drawn: shared with the Thermal Inspector (scale.js)
    var SLIDERS = scale.SLIDERS, defaultAdjust = scale.defaultAdjust, adjustQuery = scale.adjustQuery, toneShares = scale.toneShares;
    var slidRange = scale.slidRange, sliderPositions = scale.sliderPositions, sliderGamma = scale.sliderGamma, gammaSlider = scale.gammaSlider;

    function tabLabel(tab) { return TAB_LABELS[tab] || tab; }

    var ISOTHERM_MODES = [["", "None"], ["above", "Above"], ["below", "Below"], ["between", "Between"]];

    // An isotherm typed (mode, and its temperatures in the user's unit) as the server takes it, in the mosaic's unit
    // ("above,T", "below,T", "between,A,B"; "" for none): {value} or {error} (from dji-thermal-ui's isothermParam);
    // tab: on a tab of differences, the values typed are differences
    function isothermParam(mode, a, b, unit, tab) {
        if (!mode) return {value: ""};
        var x = parseFloat(a), y = parseFloat(b);
        var typed = function (t) { return typedValue(tab || "frame", t, unit); };
        if (isNaN(x)) return {error: "The isotherm needs a temperature"};
        if (mode !== "between") return {value: mode + "," + typed(x)};
        if (isNaN(y)) return {error: "The isotherm needs two temperatures"};
        if (!(y > x)) return {error: "The second temperature must be above the first"};
        return {value: "between," + typed(x) + "," + typed(y)};
    }

    // The isotherm of a style as a query, on the tabs of temperatures and their differences
    function isothermQuery(tab, style) {
        return inUnit(tab) && style.isotherm && style.isotherm.value ? "&isotherm=" + encodeURIComponent(style.isotherm.value) : "";
    }

    // The legend's shares as the image is drawn: the server's curve with equalization, else gamma's, else none (linear)
    function styleShares(style) { return scale.adjustShares(style.adjust, style.curve); }

    // The source frames are shown over the as-converted temperatures; the frame page shows one frame's
    function isTemperature(tab) { return tab === "as_converted" || tab === "harmonized" || tab === "source_frame" || tab === "frame"; }
    // Intensify shows differences of temperatures (each pixel less its surroundings), in the mosaic's unit
    function isDifference(tab) { return tab === "intensify"; }
    // Temperatures or their differences: shown in the user's unit, equalized, drawn as isotherms
    function inUnit(tab) { return isTemperature(tab) || isDifference(tab); }

    // What a tab shows, in the controls' words
    function wholeName(tab) { return tab === "frame" ? "frame" : "mosaic"; }

    // The tabs that share a palette and range: the temperature mosaics show the same scale, to compare them
    function styleGroup(tab) { return isTemperature(tab) ? "temperature" : tab; }

    // A temperature in the mosaic's unit as the user types it, and back
    function shownTemp(x, unit) { return Math.round(core.convertTemp(x, unit) * 100) / 100; }
    function typedTemp(x, unit) { return Math.round(core.convertTemp(x, core.userUnit(), unit) * 10000) / 10000; }

    // A tab's value in the mosaic's unit as the user sees it (exact: a temperature's, a difference's in the user's unit,
    // scaled and not shifted), and one typed back in the mosaic's unit (rounded)
    function exactValue(tab, x, unit) {
        return isTemperature(tab) ? core.convertTemp(x, unit) : isDifference(tab) ? core.convertDelta(x, unit) : Number(x);
    }
    function shownValue(tab, x, unit) { return inUnit(tab) ? Math.round(exactValue(tab, x, unit) * 100) / 100 : x; }
    function typedValue(tab, x, unit) {
        if (isTemperature(tab)) return typedTemp(x, unit);
        return isDifference(tab) ? Math.round(core.convertDelta(x, core.userUnit(), unit) * 10000) / 10000 : x;
    }

    // A tab's starting range: its 2nd to 98th percentile, rounded outwards to a tenth (a difference's symmetric about 0,
    // so that the palette's middle is no difference); for a temperature, rounded in the user's unit and kept in the
    // mosaic's
    function defaultRange(tab, unit) {
        var p = tab && tab.stats && tab.stats.percentiles;
        if (!p || p.length < 2) return [0, 1];
        var shown = function (x) { return exactValue(tab.tab, x, unit); };
        var kept = function (x) { return typedValue(tab.tab, x, unit); };
        if (isDifference(tab.tab)) {
            var m = Math.max(0.1, Math.ceil(Math.max(Math.abs(shown(p[0])), Math.abs(shown(p[1]))) * 10) / 10);
            return [kept(-m), kept(m)];
        }
        var lo = Math.floor(shown(p[0]) * 10) / 10, hi = Math.ceil(shown(p[1]) * 10) / 10;
        return hi > lo ? [kept(lo), kept(hi)] : [kept(lo), kept(lo + 1)];
    }

    // The range typed (a temperature's in the user's unit), in the mosaic's: {range} or {error}
    function parseRange(minText, maxText, tab, unit) {
        var lo = parseFloat(minText), hi = parseFloat(maxText);
        if (isNaN(lo) || isNaN(hi)) return {error: "The range needs a minimum and a maximum"};
        if (!(hi > lo)) return {error: "The maximum must be above the minimum"};
        return {range: [typedValue(tab, lo, unit), typedValue(tab, hi, unit)]};
    }

    // A tab's range as shown: a temperature's (or a difference's) in the user's unit
    function shownRange(tab, range, unit) {
        return range.map(function (x) { return exactValue(tab, x, unit); });
    }

    // A colour scale: the palette's gradient (along shares: how the image is drawn) over the range shown ([lo, hi]),
    // marked with its ends' values and round values between them
    function legendHtml(encoded, shown, shares) {
        if (!encoded) return "";
        var ticks = rangeTicks(shown[0], shown[1], 5).map(function (t) {
            var end = t.at < 0.1 ? " ta-tick-start" : t.at > 0.9 ? " ta-tick-end" : "";
            return '<span class="ta-tick' + end + '" style="left: ' + (t.at * 100).toFixed(1) + '%;">' + esc(t.label) + "</span>";
        }).join("");
        return '<div class="ta-viewer-legend" style="background: ' + gradientCss(encoded, shares) + ';"></div>' +
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

    // The URL of a tab's value tile (base: the conversion's API URL), which the browser colours (recolour.js); the
    // build time makes a mosaic built again a new URL, so the browser keeps tiles no longer than the mosaic they show
    function valuesUrl(base, tab, coords, builtAt) {
        return base + "/mosaics/" + tab + "/values/" + coords.z + "/" + coords.x + "/" + coords.y + ".png?v=" + encodeURIComponent(builtAt || "");
    }

    // One of the mosaic's frames as the tab draws it (its temperatures, or on View angle its pixels' angles), with the
    // tab's palette and range, cached as the tiles are
    function frameUrl(base, tab, index, style, builtAt) {
        var query = ["v=" + encodeURIComponent(builtAt || ""), "color_map=" + encodeURIComponent(style.palette),
                     "rescale=" + style.range[0] + "," + style.range[1]];
        return Frames.frameUrl(base, tab, index, query.join("&") + adjustQuery(style.adjust) + isothermQuery(tab, style));
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
        var temperature = inUnit(tab.tab);
        var symbol = temperature ? core.unitSymbol(core.userUnit()) : "°";
        var shown = function (x) { return shownValue(tab.tab, x, unit); };
        var current = palettes.filter(function (p) { return p.key === style.palette; })[0];
        out += '<div class="form-group"><label for="ta-viewer-palette">Palette</label><select class="form-control input-sm" id="ta-viewer-palette">' +
            palettes.map(function (p) {
                return '<option value="' + esc(p.key) + '"' + (p.key === style.palette ? " selected" : "") + ">" + esc(p.label) + "</option>";
            }).join("") + "</select></div>";
        out += '<div class="ta-scale" id="ta-viewer-scale">' + legendHtml(current && current.color_map, shownRange(tab.tab, style.range, unit),
                                                                           styleShares(style)) + "</div>";
        out += '<div class="ta-viewer-range">' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-min" value="' + shown(style.range[0]) + '" title="Minimum">' +
            scale.spanButtonsHtml(function (name) { return 'id="ta-viewer-' + name + '"'; }, "btn-sm") +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-max" value="' + shown(style.range[1]) + '" title="Maximum">' +
            "<span>" + esc(symbol) + "</span>" +
            '<button type="button" class="btn btn-default btn-sm" id="ta-viewer-auto" title="The 2nd to 98th percentile of this ' + wholeName(tab.tab) + '">Auto</button></div>';
        out += '<div class="ta-viewer-range-error text-danger" id="ta-viewer-range-error"></div>';
        var s = tab.stats;
        if (s) out += '<div class="ta-message">This ' + wholeName(tab.tab) + ": " +
            core.formatNumber(exactValue(tab.tab, s.min, unit), 1) + " to " +
            core.formatNumber(exactValue(tab.tab, s.max, unit), 1, " " + symbol) + "</div>";
        return out + imageHtml(tab, style, unit) + (temperature ? isothermHtml(style, isDifference(tab.tab)) : "");
    }

    // The isotherm: its temperatures keep the palette, the rest is grey (as dji-thermal-ui's)
    function isothermHtml(style, difference) {
        var iso = style.isotherm || {mode: "", a: "", b: ""}, mode = iso.mode;
        return '<details class="ta-section" open data-section="isotherm"><summary><h5>Isotherm</h5></summary>' +
            '<div class="ta-viewer-isotherm"><select class="form-control input-sm" id="ta-viewer-iso-mode" aria-label="Isotherm">' +
            ISOTHERM_MODES.map(function (m) {
                return '<option value="' + m[0] + '"' + (m[0] === mode ? " selected" : "") + ">" + m[1] + "</option>";
            }).join("") + "</select>" +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-iso-a" title="Temperature" aria-label="Temperature"' +
            (mode ? "" : " hidden") + ' value="' + esc(iso.a) + '">' +
            '<input type="number" step="0.1" class="form-control input-sm" id="ta-viewer-iso-b" title="Up to" aria-label="Up to"' +
            (mode === "between" ? "" : " hidden") + ' value="' + esc(iso.b) + '">' +
            '<span id="ta-viewer-iso-unit"' + (mode ? "" : " hidden") + ">" + esc(core.unitSymbol(core.userUnit())) + "</span></div>" +
            '<div class="text-danger" id="ta-viewer-iso-error"></div>' +
            '<p class="ta-message" id="ta-viewer-iso-hint"' + (mode ? "" : " hidden") + ">Its pixels keep the palette, the rest is grey." +
            (difference ? " Its values are differences from the surroundings (e.g. below -1.5)." : "") + "</p></details>";
    }

    // How the image is drawn: brightness and contrast move the range, gamma and the tone curve share out the colours,
    // sharpening brings out edges
    function imageHtml(tab, style, unit) {
        var temperature = inUnit(tab.tab);
        return '<details class="ta-section" open data-section="image"><summary><h5>Image</h5></summary>' +
            scale.imageControlsHtml(style.adjust, sliderPositions(defaultRange(tab, unit), style.range),
                                    {field: function (name) { return 'id="ta-viewer-' + name + '"'; }, equalize: temperature, whole: wholeName(tab.tab)}) +
            '<p class="ta-message">How the image is drawn: the ' + (isDifference(tab.tab) ? "differences" : temperature ? "temperatures" : "values") +
            " stay as they are.</p></details>";
    }

    // The button that lets go of the point a click kept
    function followHtml() {
        return '<div><button type="button" class="btn btn-default btn-sm" id="ta-viewer-follow" ' +
            'title="Let go of the point kept (Esc)">Follow the cursor</button></div>';
    }

    // The values under the cursor, or at the point a click kept (pinned), with the button that lets go of it
    function readoutHtml(res, unit, pinned, tab) {
        var follow = pinned ? followHtml() : "";
        if (!res || !res.valid) return '<span class="ta-message">' + (res && res.reason === "outside_raster" ?
            "Outside the mosaic." : "No data here.") + "</span>" + follow;
        var rows = [["Temperature", res.temperature === null || res.temperature === undefined ? "no data" : core.formatTemp(res.temperature, unit)]];
        // The temperature less its surroundings' (about 2 m around): on Intensify first, what it draws, then the
        // harmonized mosaic's temperature; on the temperature tabs after the temperature
        if (res.difference !== undefined) {
            var delta = [DELTA_LABEL, res.difference === null ? "no data" : core.formatDelta(res.difference, unit, 2, true)];
            if (isDifference(tab)) rows.unshift(delta); else rows.push(delta);
        }
        if (res.frame !== null && res.frame !== undefined) rows.push(["Frame", res.frame]);
        if (res.frame_pixel) rows.push(["Frame pixel", "x " + res.frame_pixel[0] + ", y " + res.frame_pixel[1]]);
        if (res.view_angle !== null && res.view_angle !== undefined) rows.push(["View angle", core.formatNumber(res.view_angle, 1, "°")]);
        // A file name may break after its underscores
        return '<table class="table table-condensed ta-viewer-values"><tbody>' + rows.map(function (r) {
            return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]).replace(/_/g, "_<wbr>") + "</td></tr>";
        }).join("") + "</tbody></table>" + follow;
    }

    // What dji-thermal-cli reports about a mosaic, then its files to download (base: the conversion's API URL)
    function reportHtml(kind, kindName, base) {
        if (!kind) return "";
        var rows = core.mosaicReportRows(kind);
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

    // What the palette, range, Image and Isotherm controls (controlsHtml, drawn in el) do, on the mosaic viewer and the
    // frame page. o: {doc, el, current() (the tab: {tab, stats}), style() (its style), unit(), palettes(), recolour()
    // (a slider moving), restyle() (anything else changed, or a slider let go of), onPalette(key)}
    function bindControls(o) {
        var $ = function (i) { return o.doc.getElementById(i); };

        // The range boxes and the brightness and contrast sliders, as the range is
        function showRange() {
            var r = o.style().range, tab = o.current().tab;
            var at = sliderPositions(defaultRange(o.current(), o.unit()), r);
            $("ta-viewer-min").value = shownValue(tab, r[0], o.unit());
            $("ta-viewer-max").value = shownValue(tab, r[1], o.unit());
            $("ta-viewer-brightness").value = at.brightness;
            $("ta-viewer-contrast").value = at.contrast;
        }

        // The isotherm typed: its fields shown for its mode, drawn once it is complete
        function isotherm() {
            var iso = o.style().isotherm, mode = $("ta-viewer-iso-mode").value;
            iso.mode = mode;
            iso.a = $("ta-viewer-iso-a").value;
            iso.b = $("ta-viewer-iso-b").value;
            $("ta-viewer-iso-a").hidden = $("ta-viewer-iso-unit").hidden = $("ta-viewer-iso-hint").hidden = !mode;
            $("ta-viewer-iso-b").hidden = mode !== "between";
            var r = isothermParam(mode, iso.a, iso.b, o.unit(), o.current().tab);
            // Not an error yet while a temperature is still to be typed
            $("ta-viewer-iso-error").textContent = r.error && (iso.a !== "" || mode === "between" && iso.b !== "") ? r.error : "";
            if (r.error || r.value === iso.value) return;
            iso.value = r.value;
            o.restyle();
        }

        // A slider moved: brightness and contrast move the range from the Auto one, gamma and sharpening the adjustments
        function slide(input) {
            var s = o.style(), name = input.id.replace("ta-viewer-", "");
            if (name === "brightness" || name === "contrast") {
                s.range = slidRange(defaultRange(o.current(), o.unit()), parseFloat($("ta-viewer-brightness").value) || 0,
                                    parseFloat($("ta-viewer-contrast").value) || 0);
                $("ta-viewer-range-error").textContent = "";
                var tab = o.current().tab;
                $("ta-viewer-min").value = shownValue(tab, s.range[0], o.unit());
                $("ta-viewer-max").value = shownValue(tab, s.range[1], o.unit());
            } else if (name === "gamma") {
                s.adjust.gamma = sliderGamma(input.value);
                $("ta-viewer-gamma-value").textContent = s.adjust.gamma.toFixed(2);
            } else {
                s.adjust.sharpen = Math.round((parseFloat(input.value) || 0) * 100) / 100;
                $("ta-viewer-sharpen-value").textContent = core.formatNumber(s.adjust.sharpen, 1);
            }
        }

        o.el.addEventListener("change", function (e) {
            if (e.target.id === "ta-viewer-palette") {
                o.style().palette = e.target.value;
                o.onPalette(e.target.value);
                return o.restyle();
            }
            if (e.target.id === "ta-viewer-min" || e.target.id === "ta-viewer-max") {
                var r = parseRange($("ta-viewer-min").value, $("ta-viewer-max").value, o.current().tab, o.unit());
                $("ta-viewer-range-error").textContent = r.error || "";
                if (r.error) return;
                o.style().range = r.range;
                showRange();
                return o.restyle();
            }
            if (/^ta-viewer-iso-(mode|a|b)$/.test(e.target.id)) return isotherm();
            if (e.target.id === "ta-viewer-tone") {
                o.style().adjust.equalize = e.target.value === "equalize";
                return o.restyle();
            }
            // A slider let go of draws what the server draws again too (while it moves, the image follows)
            if (/^ta-viewer-(brightness|contrast|gamma|sharpen)$/.test(e.target.id)) {
                slide(e.target);
                o.restyle();
            }
        });

        o.el.addEventListener("input", function (e) {
            if (!/^ta-viewer-(brightness|contrast|gamma|sharpen)$/.test(e.target.id)) return;
            slide(e.target);
            o.recolour();
        });

        // The arrows: the range narrowed or widened, as a range typed is
        o.el.addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button") : null;
            if (!b || (b.id !== "ta-viewer-narrow" && b.id !== "ta-viewer-wider")) return;
            o.style().range = scale.spanRange(o.style().range, b.id === "ta-viewer-wider" ? 1 : -1);
            $("ta-viewer-range-error").textContent = "";
            showRange();
            o.restyle();
        });

        // Auto: the range from the tab's percentiles; Reset: that range, and no adjustments
        o.el.addEventListener("click", function (e) {
            if (e.target.id !== "ta-viewer-auto" && e.target.id !== "ta-viewer-reset") return;
            o.style().range = defaultRange(o.current(), o.unit());
            if (e.target.id === "ta-viewer-reset") {
                o.style().adjust = defaultAdjust();
                o.style().curve = null;
            }
            o.el.innerHTML = controlsHtml(o.current(), o.style(), o.palettes(), o.unit());
            o.restyle();
        });
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
        var mapReady = null, pick = null, pickLayer = null;
        // The point a click kept the readout on (until "Follow the cursor" or Esc), and its marker
        var pinned = null, pinLayer = null;

        function status(s) {
            $("ta-viewer-status").className = "ta-status" + (s.cls ? " " + s.cls : "");
            $("ta-viewer-status").innerHTML = s.text;
        }

        function current() { return (v.tabs || []).filter(function (t) { return t.tab === tab; })[0]; }

        // The tab's palette and range, those of its group (the temperature tabs share theirs)
        function style() {
            var g = styleGroup(tab);
            var first = isTemperature(tab) ? v.default_palette : isDifference(tab) && v.difference_palette || "inferno";
            if (!styles[g]) styles[g] = {palette: first, range: defaultRange(current(), v.unit),
                                         adjust: defaultAdjust(), curve: null, isotherm: {mode: "", a: "", b: "", value: ""}};
            return styles[g];
        }

        // The curve with equalization, for the range shown: from the tab's histogram (the whole mosaic's), asked for
        // once, as the server draws it
        var histograms = {};
        function loadCurve() {
            var s = style(), askedTab = tab, h = histograms[tab];
            if (!s.adjust.equalize || !inUnit(tab)) return;
            if (h && !h.then) {
                s.curve = Recolour.curveShares(s.range[0], s.range[1], s.adjust, Recolour.equalization(h, s.range[0], s.range[1]));
                return;
            }
            if (h) return;
            histograms[tab] = fetchFn(base + "/mosaics/" + tab + "/histogram", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                histograms[askedTab] = r.ok ? r.data : {counts: null, edges: null};
                if (askedTab === tab) recolour();
            }, function () {
                // Never reached the server: asked again on the next change
                delete histograms[askedTab];
            });
        }

        // How the tab's tiles are coloured now (recolour.js's style)
        function drawStyle() {
            var s = style(), p = (v.palettes || []).filter(function (x) { return x.key === s.palette; })[0];
            if (!p) return null;
            return {palette: s.palette, colors: p.color_map, range: s.range, shares: styleShares(s), sharpen: s.adjust.sharpen,
                    isotherm: inUnit(tab) ? Recolour.isothermRange(s.isotherm && s.isotherm.value) : null, seams: tab === "source_frame"};
        }

        function showScale() {
            var p = (v.palettes || []).filter(function (x) { return x.key === style().palette; })[0];
            $("ta-viewer-scale").innerHTML = legendHtml(p && p.color_map, shownRange(tab, style().range, v.unit), styleShares(style()));
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
                    if (pinned) return;
                    hover = root.setTimeout(function () { readout(e.latlng); }, HOVER_MS);
                });
                map.on("mouseout", function () { if (hover) root.clearTimeout(hover); });
                map.on("click", function (e) { pin(e.latlng); });
                pickLayer = L.layerGroup().addTo(map);
                pinLayer = L.layerGroup().addTo(map);
                return map;
            });
            return mapReady;
        }

        // The values at a point; a reply for a point the cursor has moved on from, or the readout let go of, is dropped
        var asked = 0;
        function readout(latlng) {
            var askedTab = tab, n = ++asked, kept = pinned;
            return fetchFn(base + "/mosaics/" + tab + "/point?lon=" + latlng.lng + "&lat=" + latlng.lat, {credentials: "same-origin"})
                .then(core.readJson, core.unreachable).then(function (r) {
                    if (askedTab !== tab || n !== asked || kept !== pinned) return;
                    $("ta-viewer-readout").innerHTML = r.ok ? readoutHtml(r.data, v.unit, !!pinned, askedTab) : '<span class="text-danger">' +
                        esc(core.errorText(r.data, "Could not read the mosaic here.")) + "</span>" + (pinned ? followHtml() : "");
                });
        }

        // A click keeps the readout on its point, marked on the map, and opens the frames that saw it
        function pin(latlng) {
            if (hover) root.clearTimeout(hover);
            pinned = latlng;
            pinLayer.clearLayers();
            L.circleMarker(latlng, {radius: 6, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 1}).addTo(pinLayer);
            readout(latlng);
            select(latlng);
        }

        // The readout follows the cursor again
        function follow() {
            pinned = null;
            asked++;
            if (pinLayer) pinLayer.clearLayers();
            $("ta-viewer-readout").innerHTML = '<span class="ta-message">' + esc(READOUT_HINT) + "</span>";
        }

        // The frames that saw a point, for the tab shown; keep: the frame to show again if it saw it too
        function select(latlng, keep) {
            var askedTab = tab;
            return fetchFn(Frames.framesUrl(base, tab, latlng), {credentials: "same-origin"})
                .then(core.readJson, core.unreachable).then(function (r) {
                    if (askedTab !== tab) return;
                    if (!r.ok) {
                        pick = {latlng: latlng, frames: [], models: true, at: 0};
                        showPick();
                        $("ta-viewer-pip").querySelector(".ta-message").textContent = core.errorText(r.data, "Could not find the frames here.");
                        return;
                    }
                    var frames = r.data.frames || [];
                    var at = frames.map(function (f) { return f.index; }).indexOf(keep);
                    pick = {latlng: latlng, frames: frames, models: r.data.models, at: at < 0 ? 0 : at};
                    showPick();
                });
        }

        function showPick() {
            var box = $("ta-viewer-pip"), f = pick.frames[pick.at];
            box.hidden = false;
            box.innerHTML = pipHtml(pick, f ? frameUrl(base, tab, f.index, style(), v.built_at) : "", base);
            if (pipMove) pipMove.keep();
            pickLayer.clearLayers();
            if (f && f.footprint) {
                L.polygon(f.footprint.map(function (c) { return [c[1], c[0]]; }),
                          {color: "#fff", weight: 2, dashArray: "6 4", fill: false, interactive: false}).addTo(pickLayer);
            }
        }

        function closePick() {
            pick = null;
            if (pipMove) pipMove.reset();
            $("ta-viewer-pip").hidden = true;
            $("ta-viewer-pip").innerHTML = "";
            if (pickLayer) pickLayer.clearLayers();
        }

        // The tab's tiles, coloured in the browser from their values
        function showLayer() {
            var t = current(), shownTab = tab, builtAt = v.built_at;
            if (layer) map.removeLayer(layer);
            layer = Recolour.drawFromValues(L.gridLayer({maxZoom: 26, maxNativeZoom: (t.maxzoom || 20) + 1, minZoom: 0,
                bounds: t.bounds ? [[t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]]] : undefined}),
                {url: function (coords) { return valuesUrl(base, shownTab, coords, builtAt); }, style: drawStyle, fetchFn: fetchFn});
            layer.addTo(map);
            if (!fitted && t.bounds) {
                map.fitBounds([[t.bounds[1], t.bounds[0]], [t.bounds[3], t.bounds[2]]]);
                fitted = true;
            }
        }

        function renderTab() {
            var t = current();
            // WebODM's map with this mosaic (the tab shown, a temperature's) laid on it by the Thermal Inspector
            if (v.project) $("ta-viewer-webodm-map").href = "/map/project/" + encodeURIComponent(v.project) + "/?dt-mosaic=" +
                encodeURIComponent(v.dataset + "/" + v.id) + (isTemperature(tab) ? "/" + tab : "");
            $("ta-viewer-tabs").innerHTML = tabsHtml(v.tabs, tab);
            loadCurve();
            $("ta-viewer-controls").innerHTML = controlsHtml(t, style(), v.palettes || [], v.unit);
            // Intensify's report is the harmonized mosaic's, which it is made from
            var kind = (v.kinds[t.kind] || {}).of || t.kind;
            $("ta-viewer-report").innerHTML = reportHtml(v.kinds[kind], kind, base);
            $("ta-viewer-readout").innerHTML = '<span class="ta-message">' + esc(READOUT_HINT) + "</span>";
            return ensureMap().then(function () {
                showLayer();
                if (pinned) readout(pinned);
            });
        }

        // The scale and the tiles coloured again, as the palette, range or adjustments change (no requests)
        function recolour() {
            loadCurve();
            showScale();
            if (layer) layer.recolour();
        }
        // And the frames window's picture, which the server draws
        function restyle() {
            recolour();
            if (pick) showPick();
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
            $("ta-viewer-webodm-map").hidden = !ready || busy || !v.project_map;
            if (timer) root.clearTimeout(timer);
            timer = busy ? root.setTimeout(load, POLL_MS) : null;
            if (!ready) return Promise.resolve();
            if (builtBefore !== v.built_at) {
                styles = {};
                closePick();
                follow();
            }
            if (!tab || !current()) tab = v.tabs[0].tab;
            return renderTab();
        }

        // A reload that failed while the mosaics are built is tried again, less often: one dropped request must not
        // leave the page showing the build as it was
        function retry() {
            if (timer) timer = root.setTimeout(load, POLL_MS * 5);
        }

        function load() {
            return fetchFn(base + "/mosaics", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) {
                    retry();
                    return status({text: esc(core.errorText(r.data, "Could not load the mosaics.")), cls: "text-danger"});
                }
                return render(r.data);
            }, function () {
                retry();
                status({text: "Could not load the mosaics.", cls: "text-danger"});
            });
        }

        function post(url, failure) {
            return fetchFn(url, {method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": csrf}})
                .then(core.readJson, core.unreachable).then(function (r) {
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
            var f = pick && pick.frames[pick.at];
            if (pick) select(pick.latlng, f && f.index);
        });

        // The frames window is dragged by its heading over the map, and goes back to its corner when closed
        var pipMove = Frames.movable($("ta-viewer-pip"), $("ta-viewer-pip").parentNode, function (t) {
            return !!t.closest(".ta-pip-head") && !t.closest("a, button");
        }, null, doc);
        if (doc.defaultView) doc.defaultView.addEventListener("resize", function () { pipMove.keep(); });

        $("ta-viewer-pip").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button[data-pip]") : null;
            if (!b || b.disabled) return;
            var action = b.getAttribute("data-pip");
            if (action === "close") return closePick();
            pick.at = Math.max(0, Math.min(pick.frames.length - 1, pick.at + (action === "next" ? 1 : -1)));
            showPick();
        });

        // A frame that cannot be drawn says so in its place
        $("ta-viewer-pip").addEventListener("error", function (e) {
            if (e.target.tagName !== "IMG") return;
            e.target.parentNode.outerHTML = '<div class="text-danger">Could not draw this frame.</div>';
        }, true);

        bindControls({doc: doc, el: $("ta-viewer-controls"), current: current, style: style, unit: function () { return v.unit; },
                      palettes: function () { return v.palettes || []; }, recolour: recolour, restyle: restyle,
                      // A temperature palette is the user's, everywhere (DJI's keys carry the viewer's prefix); the
                      // palette for differences is the viewers' own, not one to keep
                      onPalette: function (key) {
                          var p = (v.palettes || []).filter(function (x) { return x.key === key; })[0];
                          if (isTemperature(tab) && (!p || p.saved !== false)) core.savePalette(fetchFn, page.getAttribute("data-api"), csrf, key.replace(/^dji_/, "")).catch(function () {});
                      }});

        $("ta-viewer-readout").addEventListener("click", function (e) {
            if (e.target.closest && e.target.closest("#ta-viewer-follow")) follow();
        });

        // Esc lets go of the point kept, but not while typing in a field
        doc.addEventListener("keydown", function (e) {
            if (e.key !== "Escape" || !pinned || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || "")) return;
            follow();
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
               gradientCss: gradientCss, scaleTicks: scaleTicks, legendHtml: legendHtml, takenText: takenText, valuesUrl: valuesUrl,
               frameUrl: frameUrl, pipHtml: pipHtml, READOUT_HINT: READOUT_HINT, tabsHtml: tabsHtml, controlsHtml: controlsHtml, readoutHtml: readoutHtml, reportHtml: reportHtml, statusHtml: statusHtml,
               baseLayers: baseLayers, loadLeaflet: loadLeaflet, init: init, adjustQuery: adjustQuery, toneShares: toneShares,
               slidRange: slidRange, sliderPositions: sliderPositions, sliderGamma: sliderGamma, gammaSlider: gammaSlider,
               SLIDERS: SLIDERS, imageHtml: imageHtml, isothermParam: isothermParam, isothermHtml: isothermHtml,
               bindControls: bindControls, DELTA_LABEL: DELTA_LABEL, isTemperature: isTemperature, isDifference: isDifference, inUnit: inUnit, shownTemp: shownTemp};
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
