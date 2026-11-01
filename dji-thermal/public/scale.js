// Colour scales, shared by the mosaic viewer (viewer.js) and the Thermal Inspector's legend (inspector.js): a palette
// (encoded as WebODM's tiler gives colour maps: 0xRRGGBBAA integers) as a CSS gradient, and the values to mark on it.
(function (root) {
    var END_ROOM = 0.18;        // a round value this close to an end of the scale (a share of it) is left to the end's label

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

    var api = {colorCss: colorCss, paletteCss: paletteCss, gradientCss: gradientCss, scaleTicks: scaleTicks, rangeTicks: rangeTicks};
    root.ThermalScale = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
