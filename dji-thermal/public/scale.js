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
    // the range: how the image is drawn), one stop per share
    function gradientCss(encoded, shares) {
        if (!encoded || !encoded.length) return "";
        var stops = [];
        if (shares && shares.length > 1) {
            stops = shares.map(function (t) { return paletteCss(encoded, t); });
        } else {
            for (var i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
        }
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

    function defaultAdjust() { return {gamma: 1, equalize: false, sharpen: 0}; }
    function adjusted(adjust) { return !!adjust && ((adjust.gamma && adjust.gamma !== 1) || !!adjust.equalize || !!adjust.sharpen); }

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

    // The scale's shares as the image is drawn: the server's curve (curve) with equalization, else gamma's, else none
    // (linear)
    function adjustShares(adjust, curve) {
        var a = adjust || defaultAdjust();
        if (a.equalize) return curve || null;
        return a.gamma !== 1 ? toneShares(a.gamma) : null;
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

    // The Image section's controls: brightness and contrast (at: their positions) move the range, gamma and the tone
    // curve share out the colours, sharpening brings out edges, and Reset. o.field(name) gives each control's attributes
    // (brightness, contrast, gamma, sharpen, their name-value labels, tone and reset); o.equalize offers Equalized,
    // spreading the colours over what the whole of o.whole has most of
    function imageControlsHtml(adjust, at, o) {
        var a = adjust || defaultAdjust();
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
            'title="Equalized spreads the colours over the temperatures the whole ' + o.whole + ' has most of">' +
            '<option value="linear"' + (a.equalize ? "" : " selected") + ">Linear</option>" +
            (o.equalize ? '<option value="equalize"' + (a.equalize ? " selected" : "") + ">Equalized</option>" : "") + "</select>" +
            '<button type="button" class="btn btn-default btn-sm" ' + o.field("reset") + ' title="The Auto range, no adjustments">Reset</button></div>';
    }

    var api = {colorCss: colorCss, paletteCss: paletteCss, gradientCss: gradientCss, scaleTicks: scaleTicks, rangeTicks: rangeTicks,
               SLIDERS: SLIDERS, defaultAdjust: defaultAdjust, adjusted: adjusted, adjustQuery: adjustQuery, toneShares: toneShares,
               adjustShares: adjustShares, slidRange: slidRange, sliderPositions: sliderPositions, sliderGamma: sliderGamma,
               gammaSlider: gammaSlider, imageControlsHtml: imageControlsHtml};
    root.ThermalScale = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
