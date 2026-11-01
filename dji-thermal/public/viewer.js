// A conversion's mosaics on a map (viewer.html), over WebODM's base layers: a tab per mosaic (as converted, harmonized,
// and the as-converted mosaic's source frames, over its temperatures, and view angles), its palette and range changed live through the tile
// URL with its colour scale, the values under the cursor, the frames that saw a point clicked (in a window over the
// map, drawn as the tab draws the mosaic), and what dji-thermal-cli reports about the mosaic. Leaflet is
// WebODM's own, from the plugin's build (thermal/Leaflet.js).
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var scale = root.ThermalScale || (typeof require !== "undefined" ? require("./scale") : null);
    var gradientCss = scale.gradientCss, scaleTicks = scale.scaleTicks;
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var HOVER_MS = 120;         // the readout asks for the point the cursor rests on, not every point it crosses
    var READOUT_HINT = "Move the cursor over the mosaic; a click keeps the values there and opens the frames that saw it.";
    var TAB_LABELS = {as_converted: "Mosaic", harmonized: "Harmonized", source_frame: "Source frame",
                      view_angle: "View angle"};
    var TAB_HINTS = {
        as_converted: "Each pixel is one frame's own temperature, as the frames were converted.",
        harmonized: "Harmonized: the frames made to agree on temperature. The camera drifts a little between its " +
            "self-calibrations, so overlapping frames of the same ground can read a degree or two apart. Here every frame " +
            "uses the same ambient and reflected temperature, and each is shifted to match its neighbours where they " +
            "overlap. Compared with the Mosaic tab: no seams or patches from drift; the temperatures may sit slightly " +
            "higher or lower overall.",
        source_frame: "Where each frame was placed: the mosaic, with a line where one frame meets the next (each pixel " +
            "comes from the frame that saw it closest to straight down).",
        view_angle: "How far from straight down each pixel was seen, in degrees."
    };

    // How the image is drawn (the server draws it: colouring.py), as dji-thermal-ui's viewer: the adjustments' limits
    // and the legend's samples, as the server has them
    var GAMMA_LIMITS = [0.2, 5], SHARPEN_MAX = 5, CURVE_SAMPLES = 65;
    // A slider's ends and its step: half of one 5% finer than 0.05 or 0.1 (0.5 for sharpening), and a whole number of
    // them from end to end, so that both ends are reached
    function slider(min, max, step) { return {min: min, max: max, step: (max - min) / Math.round((max - min) / (step * 0.95)) / 2}; }
    var SLIDERS = {brightness: slider(-1, 1, 0.05), contrast: slider(-2, 2, 0.1), gamma: slider(-2.3, 2.3, 0.1),
                   sharpen: slider(0, SHARPEN_MAX, 0.5)};

    function tabLabel(tab) { return TAB_LABELS[tab] || tab; }

    function defaultAdjust() { return {gamma: 1, equalize: false, sharpen: 0}; }

    // The adjustments as a query (&gamma=&equalize=1&sharpen=), those not as by default
    function adjustQuery(adjust) {
        if (!adjust) return "";
        return (adjust.gamma && adjust.gamma !== 1 ? "&gamma=" + adjust.gamma : "") + (adjust.equalize ? "&equalize=1" : "") +
            (adjust.sharpen ? "&sharpen=" + adjust.sharpen : "");
    }

    // The palette's share at CURVE_SAMPLES values evenly across the range, with gamma alone (what the server's curve
    // gives with equalization)
    function toneShares(gamma) {
        var out = [];
        for (var i = 0; i < CURVE_SAMPLES; i++) out.push(Math.pow(i / (CURVE_SAMPLES - 1), 1 / (gamma || 1)));
        return out;
    }

    // The brightness (-1 to 1) and contrast (-2 to 2) sliders move the range from ref (the Auto one): brightness
    // lowers its centre by up to its width, each step of contrast halves its width
    function slidRange(ref, brightness, contrast) {
        var centre = (ref[0] + ref[1]) / 2 - brightness * (ref[1] - ref[0]), half = (ref[1] - ref[0]) / Math.pow(2, contrast) / 2;
        var round = function (x) { return Math.round(x * 100) / 100; };
        return [round(centre - half), round(centre + half)];
    }

    // Where the sliders sit for a range (within their ends)
    function sliderPositions(ref, range) {
        var clamp = function (x, limit) { return Math.max(-limit, Math.min(limit, Math.round(x * 100) / 100)); };
        var refWidth = ref[1] - ref[0], width = range[1] - range[0];
        if (!(refWidth > 0) || !(width > 0)) return {brightness: 0, contrast: 0};
        return {brightness: clamp(((ref[0] + ref[1]) - (range[0] + range[1])) / 2 / refWidth, 1),
                contrast: clamp(Math.log(refWidth / width) / Math.LN2, 2)};
    }

    // Gamma from its slider (its log2), and the slider from gamma
    function sliderGamma(value) {
        var g = Math.round(Math.pow(2, parseFloat(String(value)) || 0) * 100) / 100;
        return Math.max(GAMMA_LIMITS[0], Math.min(GAMMA_LIMITS[1], g));
    }
    function gammaSlider(gamma) { return Math.round(Math.log(gamma) / Math.LN2 * 100) / 100; }

    // The legend's shares as the image is drawn: the server's curve with equalization, else gamma's, else none (linear)
    function styleShares(style) {
        var a = style.adjust || defaultAdjust();
        if (a.equalize) return style.curve || null;
        return a.gamma !== 1 ? toneShares(a.gamma) : null;
    }

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

    // A colour scale: the palette's gradient (along shares: how the image is drawn) over the range shown ([lo, hi]),
    // marked with round values
    function legendHtml(encoded, shown, shares) {
        if (!encoded) return "";
        var ticks = scaleTicks(shown[0], shown[1], 5).map(function (t) {
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

    // A tab's tile URL template (base: the conversion's API URL) with its palette and range; the build time makes a
    // mosaic built again a new URL, so the browser keeps tiles no longer than the mosaic they show
    function tileUrl(base, tab, style, builtAt) {
        var query = ["v=" + encodeURIComponent(builtAt || ""), "color_map=" + encodeURIComponent(style.palette),
                     "rescale=" + style.range[0] + "," + style.range[1]];
        return base + "/mosaics/" + tab + "/tiles/{z}/{x}/{y}.png?" + query.join("&") + adjustQuery(style.adjust);
    }

    // One of the mosaic's frames as the tab draws it (its temperatures, or on View angle its pixels' angles), with the
    // tab's palette and range, cached as the tiles are
    function frameUrl(base, tab, index, style, builtAt) {
        var query = ["v=" + encodeURIComponent(builtAt || ""), "color_map=" + encodeURIComponent(style.palette),
                     "rescale=" + style.range[0] + "," + style.range[1]];
        return base + "/mosaics/" + tab + "/frames/" + index + ".png?" + query.join("&") + adjustQuery(style.adjust);
    }

    // The window of the frames that saw a point (pick: {frames, models, at: the one shown}), the frame drawn from url
    // with a crosshair on the point
    function pipHtml(pick, url) {
        var close = '<button type="button" class="btn btn-link btn-sm" data-pip="close" title="Close" aria-label="Close">' +
            '<i class="fa fa-times"></i></button>';
        var frames = pick.frames || [];
        if (!frames.length) {
            return '<div class="ta-pip-head"><span class="ta-pip-title">Source frame</span>' + close + "</div>" +
                '<div class="ta-message">' + (pick.models ? "No frame saw this point." :
                "These mosaics were built without their frames' positions: build them again to see the frames.") + "</div>";
        }
        var f = frames[pick.at], n = frames.length;
        var nav = function (action, icon, label, disabled) {
            return '<button type="button" class="btn btn-default btn-sm" data-pip="' + action + '" title="' + label + '" aria-label="' +
                label + '"' + (disabled ? " disabled" : "") + '><i class="fa fa-' + icon + '"></i></button>';
        };
        var left = ((f.x + 0.5) / f.width * 100).toFixed(2), top = ((f.y + 0.5) / f.height * 100).toFixed(2);
        return '<div class="ta-pip-head"><span class="ta-pip-title">Frame ' + (pick.at + 1) + " of " + n + " that saw this point</span>" +
            nav("prev", "chevron-left", "Previous frame", pick.at === 0) + nav("next", "chevron-right", "Next frame", pick.at === n - 1) +
            close + "</div>" +
            '<div class="ta-pip-image" style="aspect-ratio: ' + f.width + " / " + f.height + ';"><img src="' + esc(url) +
            '" alt="' + esc(f.file) + '"><span class="ta-pip-mark" style="left: ' + left + "%; top: " + top + '%;"></span></div>' +
            '<div class="ta-pip-foot">' + esc(f.file) + '<br><span class="ta-message">' +
            (f.source ? "The mosaic's pixel here comes from this frame; " : "") + "seen " +
            esc(core.formatNumber(f.view_angle, 1, "°")) + " from straight down</span></div>";
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
        out += '<div class="ta-scale" id="ta-viewer-scale">' + legendHtml(current && current.color_map, shownRange(tab.tab, style.range, unit),
                                                                           styleShares(style)) + "</div>";
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
        return out + imageHtml(tab, style, unit);
    }

    // How the image is drawn: brightness and contrast move the range, gamma and the tone curve share out the colours,
    // sharpening brings out edges
    function imageHtml(tab, style, unit) {
        var a = style.adjust || defaultAdjust(), temperature = isTemperature(tab.tab);
        var at = sliderPositions(defaultRange(tab, unit), style.range);
        var range = function (name, value, title, label, shown) {
            var sl = SLIDERS[name];
            return '<label class="ta-slider" title="' + title + '"><span>' + label + '</span><input type="range" id="ta-viewer-' + name +
                '" min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + value + '">' +
                '<span class="ta-slider-value" id="ta-viewer-' + name + '-value">' + (shown === undefined ? "" : shown) + "</span></label>";
        };
        return '<details class="ta-section" open data-section="image"><summary><h5>Image</h5></summary>' +
            range("brightness", at.brightness, "Moves the range down (brighter) or up", "Brightness") +
            range("contrast", at.contrast, "Narrows the range (more contrast) or widens it", "Contrast") +
            range("gamma", gammaSlider(a.gamma), "Above 1 brightens the cooler part of the range", "Gamma", a.gamma.toFixed(2)) +
            range("sharpen", a.sharpen, "Brings out edges (an unsharp mask)", "Sharpening", core.formatNumber(a.sharpen, 1)) +
            '<div class="ta-viewer-tone"><select class="form-control input-sm" id="ta-viewer-tone" aria-label="Tone" ' +
            'title="Equalized spreads the colours over the temperatures the whole mosaic has most of">' +
            '<option value="linear"' + (a.equalize ? "" : " selected") + ">Linear</option>" +
            (temperature ? '<option value="equalize"' + (a.equalize ? " selected" : "") + ">Equalized</option>" : "") + "</select>" +
            '<button type="button" class="btn btn-default btn-sm" id="ta-viewer-reset" title="The Auto range, no adjustments">Reset</button></div>' +
            '<p class="ta-message">How the image is drawn: the ' + (temperature ? "temperatures" : "values") + " stay as they are.</p></details>";
    }

    // The button that lets go of the point a click kept
    function followHtml() {
        return '<div><button type="button" class="btn btn-default btn-sm" id="ta-viewer-follow" ' +
            'title="Let go of the point kept (Esc)">Follow the cursor</button></div>';
    }

    // The values under the cursor, or at the point a click kept (pinned), with the button that lets go of it
    function readoutHtml(res, unit, pinned) {
        var follow = pinned ? followHtml() : "";
        if (!res || !res.valid) return '<span class="ta-message">' + (res && res.reason === "outside_raster" ?
            "Outside the mosaic." : "No data here.") + "</span>" + follow;
        var rows = [["Temperature", res.temperature === null || res.temperature === undefined ? "no data" : core.formatTemp(res.temperature, unit)]];
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
            if (!styles[g]) styles[g] = {palette: isTemperature(tab) ? v.default_palette : "inferno", range: defaultRange(current(), v.unit),
                                         adjust: defaultAdjust(), curve: null};
            return styles[g];
        }

        // The legend's curve with equalization: the server's (from the whole mosaic's histogram), for the range shown
        var askedCurve = 0;
        function loadCurve() {
            var s = style(), n = ++askedCurve, askedTab = tab;
            if (!s.adjust.equalize) return Promise.resolve();
            return fetchFn(base + "/mosaics/" + tab + "/curve?rescale=" + s.range[0] + "," + s.range[1] + adjustQuery(s.adjust),
                           {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (n !== askedCurve || askedTab !== tab) return;
                s.curve = r.ok ? r.data.shares : null;
                showScale();
            });
        }

        function showScale() {
            var p = (v.palettes || []).filter(function (x) { return x.key === style().palette; })[0];
            $("ta-viewer-scale").innerHTML = legendHtml(p && p.color_map, shownRange(tab, style().range, v.unit), styleShares(style()));
        }

        // The range boxes and the brightness and contrast sliders, as the range is
        function showRange() {
            var r = style().range, temperature = isTemperature(tab), at = sliderPositions(defaultRange(current(), v.unit), r);
            $("ta-viewer-min").value = temperature ? shownTemp(r[0], v.unit) : r[0];
            $("ta-viewer-max").value = temperature ? shownTemp(r[1], v.unit) : r[1];
            $("ta-viewer-brightness").value = at.brightness;
            $("ta-viewer-contrast").value = at.contrast;
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
                .then(core.readJson).then(function (r) {
                    if (askedTab !== tab || n !== asked || kept !== pinned) return;
                    $("ta-viewer-readout").innerHTML = r.ok ? readoutHtml(r.data, v.unit, !!pinned) : '<span class="text-danger">' +
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
            return fetchFn(base + "/mosaics/" + tab + "/frames?lon=" + latlng.lng + "&lat=" + latlng.lat, {credentials: "same-origin"})
                .then(core.readJson).then(function (r) {
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
            box.innerHTML = pipHtml(pick, f ? frameUrl(base, tab, f.index, style(), v.built_at) : "");
            pickLayer.clearLayers();
            if (f && f.footprint) {
                L.polygon(f.footprint.map(function (c) { return [c[1], c[0]]; }),
                          {color: "#fff", weight: 2, dashArray: "6 4", fill: false, interactive: false}).addTo(pickLayer);
            }
        }

        function closePick() {
            pick = null;
            $("ta-viewer-pip").hidden = true;
            $("ta-viewer-pip").innerHTML = "";
            if (pickLayer) pickLayer.clearLayers();
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
            loadCurve();
            $("ta-viewer-report").innerHTML = reportHtml(v.kinds[t.kind], t.kind, base);
            $("ta-viewer-readout").innerHTML = '<span class="ta-message">' + esc(READOUT_HINT) + "</span>";
            return ensureMap().then(function () {
                showLayer();
                if (pinned) readout(pinned);
            });
        }

        // Only the scale and the tiles, as the palette, range or adjustments change
        function restyle() {
            showScale();
            if (layer) layer.setUrl(tileUrl(base, tab, style(), v.built_at));
            if (pick) showPick();
            loadCurve();
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
            if (builtBefore !== v.built_at) {
                styles = {};
                closePick();
                follow();
            }
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
            var f = pick && pick.frames[pick.at];
            if (pick) select(pick.latlng, f && f.index);
        });

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

        $("ta-viewer-controls").addEventListener("change", function (e) {
            if (e.target.id === "ta-viewer-palette") {
                style().palette = e.target.value;
                // A temperature palette is the user's, everywhere (DJI's keys carry the viewer's prefix)
                if (isTemperature(tab)) core.savePalette(fetchFn, page.getAttribute("data-api"), csrf, e.target.value.replace(/^dji_/, "")).catch(function () {});
                return restyle();
            }
            if (e.target.id === "ta-viewer-min" || e.target.id === "ta-viewer-max") {
                var r = parseRange($("ta-viewer-min").value, $("ta-viewer-max").value, tab, v.unit);
                $("ta-viewer-range-error").textContent = r.error || "";
                if (r.error) return;
                style().range = r.range;
                showRange();
                return restyle();
            }
            if (e.target.id === "ta-viewer-tone") {
                style().adjust.equalize = e.target.value === "equalize";
                return restyle();
            }
            // A slider let go of draws the image again (while it moves, only the legend and the boxes follow)
            if (/^ta-viewer-(brightness|contrast|gamma|sharpen)$/.test(e.target.id)) {
                slide(e.target);
                restyle();
            }
        });

        // A slider moved: brightness and contrast move the range from the Auto one, gamma and sharpening the adjustments
        function slide(input) {
            var s = style(), name = input.id.replace("ta-viewer-", "");
            if (name === "brightness" || name === "contrast") {
                s.range = slidRange(defaultRange(current(), v.unit), parseFloat($("ta-viewer-brightness").value) || 0,
                                    parseFloat($("ta-viewer-contrast").value) || 0);
                $("ta-viewer-range-error").textContent = "";
                var temperature = isTemperature(tab);
                $("ta-viewer-min").value = temperature ? shownTemp(s.range[0], v.unit) : s.range[0];
                $("ta-viewer-max").value = temperature ? shownTemp(s.range[1], v.unit) : s.range[1];
            } else if (name === "gamma") {
                s.adjust.gamma = sliderGamma(input.value);
                $("ta-viewer-gamma-value").textContent = s.adjust.gamma.toFixed(2);
            } else {
                s.adjust.sharpen = Math.round((parseFloat(input.value) || 0) * 100) / 100;
                $("ta-viewer-sharpen-value").textContent = core.formatNumber(s.adjust.sharpen, 1);
            }
            showScale();
        }

        $("ta-viewer-controls").addEventListener("input", function (e) {
            if (/^ta-viewer-(brightness|contrast|gamma|sharpen)$/.test(e.target.id)) slide(e.target);
        });

        // Auto: the range from the mosaic's percentiles; Reset: that range, and no adjustments
        $("ta-viewer-controls").addEventListener("click", function (e) {
            if (e.target.id !== "ta-viewer-auto" && e.target.id !== "ta-viewer-reset") return;
            style().range = defaultRange(current(), v.unit);
            if (e.target.id === "ta-viewer-reset") {
                style().adjust = defaultAdjust();
                style().curve = null;
            }
            $("ta-viewer-controls").innerHTML = controlsHtml(current(), style(), v.palettes || [], v.unit);
            restyle();
        });

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
               gradientCss: gradientCss, scaleTicks: scaleTicks, legendHtml: legendHtml, takenText: takenText, tileUrl: tileUrl,
               frameUrl: frameUrl, pipHtml: pipHtml, READOUT_HINT: READOUT_HINT, tabsHtml: tabsHtml, controlsHtml: controlsHtml, readoutHtml: readoutHtml, reportHtml: reportHtml, statusHtml: statusHtml,
               baseLayers: baseLayers, loadLeaflet: loadLeaflet, init: init, adjustQuery: adjustQuery, toneShares: toneShares,
               slidRange: slidRange, sliderPositions: sliderPositions, sliderGamma: sliderGamma, gammaSlider: gammaSlider,
               SLIDERS: SLIDERS, imageHtml: imageHtml};
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
