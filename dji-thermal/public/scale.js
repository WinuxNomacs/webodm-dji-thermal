// Colour scales, shared by the mosaic viewer (viewer.js) and the Thermal Inspector (inspector.js): a palette (encoded as
// WebODM's tiler gives colour maps: 0xRRGGBBAA integers) as a CSS gradient, the values to mark on it, and the Image
// section's controls (how the server draws the image: colouring.py), as dji-thermal-ui's viewer has them.
(function (root) {
    var END_ROOM = 0.18;        // a round value this close to an end of the scale (a share of it) is left to the end's label
    // The adjustments' limits and the legend's samples, as the server has them
    var GAMMA_LIMITS = [0.2, 5], SHARPEN_MAX = 5, CURVE_SAMPLES = 65;
    // A slider's ends and its step: half of one 5% finer than 0.05 or 0.1 (0.5 for sharpening), and a whole number of
    // them from end to end, so that both ends are reached
    function slider(min, max, step) { return {min: min, max: max, step: (max - min) / Math.round((max - min) / (step * 0.95)) / 2}; }
    var SLIDERS = {brightness: slider(-1, 1, 0.05), contrast: slider(-2, 2, 0.1), gamma: slider(-2.3, 2.3, 0.1),
                   sharpen: slider(0, SHARPEN_MAX, 0.5)};

    function colorCss(encoded) {
        var c = encoded >>> 0;
        return "rgb(" + ((c >>> 24) & 255) + "," + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + ")";
    }

    // The palette's colour at a share of it, blended between its two nearest entries (from dji-thermal-ui)
    function paletteCss(encoded, t) {
        var x = Math.max(0, Math.min(1, t)) * (encoded.length - 1), i = Math.min(Math.floor(x), encoded.length - 2), f = x - i;
        if (i < 0) return colorCss(encoded[0]);
        var a = encoded[i] >>> 0, b = encoded[i + 1] >>> 0;
        var mix = function (shift) { return Math.round(((a >>> shift) & 255) * (1 - f) + ((b >>> shift) & 255) * f); };
        return "rgb(" + mix(24) + "," + mix(16) + "," + mix(8) + ")";
    }

    // A palette as a CSS gradient: from 16 of its colours, or, with shares (the palette's share at values evenly across
    // the range: how the image is drawn), one stop per share; with steps (stepsOf's), in flat bands, each the colour of
    // its middle (toned along shares), with hard edges
    function gradientCss(encoded, shares, steps) {
        if (!encoded || !encoded.length) return "";
        var stops = [];
        if (steps) {
            var pct = function (x) { return (Math.max(0, Math.min(1, x)) * 100).toFixed(3) + "%"; };
            var first = Math.floor((0 - steps.start) / steps.width), last = Math.floor((1 - steps.start) / steps.width);
            for (var k = first; k <= last; k++) {
                var a = steps.start + k * steps.width, b = a + steps.width;
                if (b <= 0 || a >= 1) continue;
                var c = paletteCss(encoded, tonedShare(Math.max(0, Math.min(1, a + steps.width / 2)), shares));
                stops.push(c + " " + pct(a), c + " " + pct(b));
            }
            return "linear-gradient(to right, " + stops.join(", ") + ")";
        }
        if (shares && shares.length > 1) {
            stops = shares.map(function (t) { return paletteCss(encoded, t); });
        } else {
            for (var i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
        }
        return "linear-gradient(to right, " + stops.join(", ") + ")";
    }

    // A share of the range toned along shares (interpolated between its samples), as recolour.js tones it
    function tonedShare(u, shares) {
        if (!shares || shares.length < 2) return u;
        var at = u * (shares.length - 1), i = Math.min(Math.floor(at), shares.length - 2), f = at - i;
        return shares[i] * (1 - f) + shares[i + 1] * f;
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

    // The marks of a colour scale from lo to hi (as shown): its ends with their own values (to the round values'
    // decimals, a tenth when that would round them), and the round values between them that don't crowd an end
    function rangeTicks(lo, hi, count) {
        var inner = scaleTicks(lo, hi, count);
        if (!(hi > lo)) return [];
        var digits = inner.length ? (inner[0].label.split(".")[1] || "").length : 1;
        var label = function (v) {
            var d = Math.abs(Number(v.toFixed(digits)) - v) < 1e-9 ? digits : Math.max(digits, 1);
            return v.toFixed(d).replace(/^-(0\.?0*)$/, "$1");
        };
        var between = inner.filter(function (t) { return t.at > END_ROOM && t.at < 1 - END_ROOM; });
        return [{value: lo, label: label(lo), at: 0, end: true}].concat(between, [{value: hi, label: label(hi), at: 1, end: true}]);
    }

    // -- the Image section: how the image is drawn ---------------------------------------------------------------------

    // tone: "linear" or "stepped" (flat bands); step: the bands' width in the user's unit, null for Auto (autoStep)
    function defaultAdjust() { return {gamma: 1, sharpen: 0, tone: "linear", step: null}; }
    function adjusted(adjust) {
        return !!adjust && ((adjust.gamma && adjust.gamma !== 1) || adjust.tone === "stepped" || !!adjust.sharpen);
    }

    // The adjustments as a query (&gamma=&sharpen=&stepped=width,origin), those not as by default; bands: bandsOf's
    function adjustQuery(adjust, bands) {
        if (!adjust) return "";
        return (adjust.gamma && adjust.gamma !== 1 ? "&gamma=" + adjust.gamma : "") + (adjust.sharpen ? "&sharpen=" + adjust.sharpen : "") +
            (bands ? "&stepped=" + bands.width + "," + bands.origin : "");
    }

    // The palette's share at CURVE_SAMPLES values evenly across the range, with gamma
    function toneShares(gamma) {
        var out = [];
        for (var i = 0; i < CURVE_SAMPLES; i++) out.push(Math.pow(i / (CURVE_SAMPLES - 1), 1 / (gamma || 1)));
        return out;
    }

    // The scale's shares as the image is drawn: gamma's, else none (linear)
    function adjustShares(adjust) {
        var a = adjust || defaultAdjust();
        return a.gamma && a.gamma !== 1 ? toneShares(a.gamma) : null;
    }

    // -- Stepped: flat bands of a fixed width, their edges at whole multiples of it in the user's unit ---------------

    var BANDS_MAX = 20;         // Auto's width gives at most this many bands over the range, and at least about half

    // Auto's width for a range span wide (the user's unit): the narrowest round one (1, 2, 2.5 or 5 times a power of
    // ten) giving at most BANDS_MAX bands
    function autoStep(span) {
        if (!(span > 0)) return 1;
        var mag = Math.pow(10, Math.floor(Math.log10(span / BANDS_MAX)));
        var found = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (w) { return span / w <= BANDS_MAX + 1e-9; })[0];
        return Number(found.toPrecision(6));
    }

    // The bands an image is drawn in, in its values' unit, or null when not stepped: {width, origin (an edge), shown
    // (the width in the user's unit), auto (Auto's)}. range: its values' [low, high]; toUser: how its values read in
    // the user's unit, {scale, offset} (shown = scale * value + offset; a difference's offset is 0)
    function bandsOf(adjust, range, toUser) {
        if (!adjust || adjust.tone !== "stepped" || !range) return null;
        var m = toUser || {scale: 1, offset: 0}, auto = autoStep(Math.abs((range[1] - range[0]) * m.scale));
        var shown = adjust.step > 0 ? adjust.step : auto;
        return {width: shown / Math.abs(m.scale), origin: -m.offset / m.scale, shown: shown, auto: auto, typed: adjust.step > 0};
    }

    // The width's field follows Auto's width as the range changes, until a width is typed or stepped to (not while
    // the field has the focus)
    function showAutoStep(field, bands) {
        if (!field || !bands || bands.typed || (field.ownerDocument && field.ownerDocument.activeElement === field)) return;
        field.value = bandText(bands.auto);
        field.step = field.min = String(stepIncrement(bands.auto));
    }

    // Bands as shares of the range (recolour.js's and colouring.band_steps'): {start, width}, or null
    function stepsOf(bands, range) {
        if (!bands || !range) return null;
        var span = (range[1] - range[0]) || 1;
        return {start: (bands.origin - range[0]) / span, width: bands.width / span};
    }

    // The brightness (-1 to 1) and contrast (-2 to 2) sliders move the range from ref (the Auto one): brightness
    // lowers its centre by up to its width, each step of contrast halves its width
    function slidRange(ref, brightness, contrast) {
        var centre = (ref[0] + ref[1]) / 2 - brightness * (ref[1] - ref[0]), half = (ref[1] - ref[0]) / Math.pow(2, contrast) / 2;
        var round = function (x) { return Math.round(x * 100) / 100; };
        return [round(centre - half), round(centre + half)];
    }

    // The range widened (by 1) or narrowed (by -1) by a tenth of its span, about its middle: each end a twentieth
    function spanRange(range, by) {
        var step = (range[1] - range[0]) / 20 * by;
        var round = function (x) { return Math.round(x * 100) / 100; };
        return [round(range[0] - step), round(range[1] + step)];
    }

    // The range raised (by 1) or lowered (by -1) by a tenth of its width, the width kept, never past the image's
    // highest (lowest) temperature (extent: [lowest, highest], in the range's unit; or null): the last step only as far
    // as it, none when the range is already past it
    function shiftRange(range, by, extent) {
        var step = (range[1] - range[0]) / 10 * by;
        if (extent && by > 0) step = Math.max(0, Math.min(step, extent[1] - range[1]));
        if (extent && by < 0) step = Math.min(0, Math.max(step, extent[0] - range[0]));
        var round = function (x) { return Math.round(x * 100) / 100; };
        return [round(range[0] + step), round(range[1] + step)];
    }

    // The D-pad between the range's fields: ◀ narrows and ▶ widens the range (spanRange), ▲ raises and ▼ lowers it
    // (shiftRange), Auto in the middle. field(name) gives each one's attributes (narrow, wider, raise, lower, auto),
    // size its Bootstrap button size, auto Auto's title and whether it is disabled ({title, disabled})
    function spanButtonsHtml(field, size, auto) {
        var button = function (name, label, title, more) {
            return '<button type="button" class="btn btn-default ' + size + ' dt-range-' + name + '" ' + field(name) + ' title="' + title +
                '"' + (more || "") + ">" + label + "</button>";
        };
        var arrow = function (name, icon, title) {
            return button(name, '<i class="fa fa-caret-' + icon + '"></i>', title, ' aria-label="' + title + '"');
        };
        return '<div class="dt-range-pad">' + arrow("raise", "up", "Raise the range") + arrow("narrow", "left", "Narrow the range") +
            button("auto", "Auto", auto.title, auto.disabled ? " disabled" : "") + arrow("wider", "right", "Widen the range") +
            arrow("lower", "down", "Lower the range") + "</div>";
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

    // The Image section's controls: brightness and contrast (at: their positions) move the range, gamma and the tone
    // curve share out the colours, sharpening brings out edges, and Reset. o.field(name) gives each control's attributes
    // (brightness, contrast, gamma, sharpen, their name-value labels, tone, step and reset); o.stepped offers Banded,
    // flat bands o.bands wide (bandsOf's, for the step field: the width typed, or Auto's), in o.unit (its symbol)
    function bandText(w) { return w > 0 ? String(Number(w.toPrecision(6))) : ""; }

    // The width field's arrows step by a round increment for its size (1 for 2.5 or 5, 0.1 for 0.5), from that
    // increment up, so they land on whole multiples of it
    function stepIncrement(w) { return w > 0 ? Number(Math.pow(10, Math.floor(Math.log10(w))).toPrecision(6)) : 1; }

    // A band width typed: a number above 0, or null (Auto) for anything else
    function typedStep(value) {
        var w = parseFloat(String(value).replace(",", "."));
        return w > 0 && isFinite(w) ? w : null;
    }

    function imageControlsHtml(adjust, at, o) {
        var a = adjust || defaultAdjust(), stepped = !!o.stepped && a.tone === "stepped";
        var inc = stepIncrement((o.bands && o.bands.shown) || (a.step > 0 ? a.step : 1));
        var range = function (name, value, title, label, shown) {
            var sl = SLIDERS[name];
            return '<label class="ta-slider" title="' + title + '"><span>' + label + '</span><input type="range" ' + o.field(name) +
                ' min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + value + '">' +
                '<span class="ta-slider-value" ' + o.field(name + "-value") + ">" + (shown === undefined ? "" : shown) + "</span></label>";
        };
        return range("brightness", at.brightness, "Moves the range down (brighter) or up", "Brightness") +
            range("contrast", at.contrast, "Narrows the range (more contrast) or widens it", "Contrast") +
            range("gamma", gammaSlider(a.gamma), "Above 1 brightens the cooler part of the range", "Gamma", a.gamma.toFixed(2)) +
            range("sharpen", a.sharpen, "Brings out edges (an unsharp mask)", "Sharpening", Number(a.sharpen).toFixed(1)) +
            '<div class="ta-viewer-tone"><select class="form-control input-sm" ' + o.field("tone") + ' aria-label="Tone" ' +
            'title="Banded draws flat bands of a fixed width, so each colour is one span of temperatures">' +
            '<option value="linear"' + (stepped ? "" : " selected") + ">Linear</option>" +
            (o.stepped ? '<option value="stepped"' + (stepped ? " selected" : "") + ">Banded</option>" : "") + "</select>" +
            (stepped ? '<input type="number" min="' + inc + '" step="' + inc + '" class="form-control input-sm dt-step-field" ' + o.field("step") +
                ' aria-label="Band width" title="Each band\'s width: Auto\'s (10 to 20 bands over the range, following it) until you change it; empty it for Auto again" placeholder="Auto" value="' +
                (a.step > 0 ? a.step : bandText(o.bands && o.bands.auto)) + '"><span class="dt-step-unit">' + (o.unit || "") + "</span>" : "") +
            '<button type="button" class="btn btn-default btn-sm" ' + o.field("reset") + ' title="The Auto range, no adjustments">Reset</button></div>';
    }

    var api = {colorCss: colorCss, paletteCss: paletteCss, gradientCss: gradientCss, scaleTicks: scaleTicks, rangeTicks: rangeTicks,
               SLIDERS: SLIDERS, defaultAdjust: defaultAdjust, adjusted: adjusted, adjustQuery: adjustQuery, toneShares: toneShares,
               adjustShares: adjustShares, autoStep: autoStep, bandsOf: bandsOf, stepsOf: stepsOf, typedStep: typedStep, stepIncrement: stepIncrement, showAutoStep: showAutoStep, tonedShare: tonedShare,
               slidRange: slidRange, spanRange: spanRange, shiftRange: shiftRange, spanButtonsHtml: spanButtonsHtml, sliderPositions: sliderPositions, sliderGamma: sliderGamma,
               gammaSlider: gammaSlider, imageControlsHtml: imageControlsHtml};
    root.ThermalScale = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
