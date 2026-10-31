// Colour scales, shared by the mosaic viewer (viewer.js) and the Thermal Inspector's legend (inspector.js): a palette
// (encoded as WebODM's tiler gives colour maps: 0xRRGGBBAA integers) as a CSS gradient, and round values to mark on it.
(function (root) {
    function colorCss(encoded) {
        var c = encoded >>> 0;
        return "rgb(" + ((c >>> 24) & 255) + "," + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + ")";
    }

    // A palette as a CSS gradient, from 16 of its colours
    function gradientCss(encoded) {
        if (!encoded || !encoded.length) return "";
        var stops = [];
        for (var i = 0; i < 16; i++) stops.push(colorCss(encoded[Math.round(i * (encoded.length - 1) / 15)]));
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

    var api = {colorCss: colorCss, gradientCss: gradientCss, scaleTicks: scaleTicks};
    root.ThermalScale = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
