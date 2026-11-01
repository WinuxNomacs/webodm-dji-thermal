// Tiles coloured in the browser, shared by the mosaic viewer (viewer.js) and the Thermal Inspector (inspector.js): the
// server sends a tile's values once (a value tile: colouring.value_png), and the browser colours them as the server's
// colouring.colour does (palette, range, tone curve, unsharp mask, isotherm, seams), on every change, with no requests.
(function (root) {
    // As colouring.py has them
    var TONE_STEPS = 1024, LEVELS = 255, SIGMA_LIMITS = [0.5, 4], CURVE_SAMPLES = 65;
    var TAPS = [-2, -1, 0, 1, 2], WEIGHTS = [1, 4, 6, 4, 1];
    var SEAM_COLORS = [[0, 0, 0], [255, 255, 255]];

    function clip01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

    // A value tile's pixels (RGBA, as a canvas gives them) as its values: red and green a 16-bit code (offset + code *
    // step), blue a flag, alpha where there is a value. {values (NaN where none), flags, width, height}
    function decode(rgba, width, height, offset, step) {
        var n = width * height, values = new Float32Array(n), flags = new Uint8Array(n);
        for (var i = 0, p = 0; i < n; i++, p += 4) {
            values[i] = rgba[p + 3] ? offset + (rgba[p] * 256 + rgba[p + 1]) * step : NaN;
            flags[i] = rgba[p + 2];
        }
        return {values: values, flags: flags, width: width, height: height};
    }

    // A value tile fetched and decoded: decode's, with its margin and the unsharp mask's sigma (from its headers); null
    // when there is none there (404). fetchFn: window.fetch, or a test's
    function fetchValues(url, fetchFn, signal) {
        var doc = root.document;
        return fetchFn(url, {credentials: "same-origin", signal: signal}).then(function (r) {
            if (r.status === 404) return null;
            if (!r.ok) throw new Error("HTTP " + r.status);
            var header = function (name) { return parseFloat(r.headers.get(name)); };
            var offset = header("X-Values-Offset"), step = header("X-Values-Step");
            var margin = header("X-Values-Margin") || 0, sigma = header("X-Sharpen-Sigma") || 1;
            return r.blob().then(function (blob) {
                // Not colour-managed, nor premultiplied: the bytes are numbers
                return root.createImageBitmap(blob, {colorSpaceConversion: "none", premultiplyAlpha: "none"});
            }).then(function (bitmap) {
                var canvas = doc.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                var ctx = canvas.getContext("2d", {willReadFrequently: true});
                ctx.drawImage(bitmap, 0, 0);
                if (bitmap.close) bitmap.close();
                var tile = decode(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, offset, step);
                tile.margin = margin;
                tile.sigma = sigma;
                return tile;
            });
        });
    }

    // -- the tone curve (colouring.equalization, tone and curve_shares) -------------------------------------------------

    // numpy's interp: x's place along xs (increasing, perhaps with repeats), ys's value there
    function interp(x, xs, ys) {
        var n = xs.length;
        if (x < xs[0]) return ys[0];
        if (x > xs[n - 1]) return ys[n - 1];
        var lo = 0, hi = n;     // the last index whose xs is at most x
        while (hi - lo > 1) {
            var mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        if (lo === n - 1 || xs[lo] === x) return ys[lo];
        return (ys[lo + 1] - ys[lo]) / (xs[lo + 1] - xs[lo]) * (x - xs[lo]) + ys[lo];
    }

    // Histogram equalization over low..high ({counts, edges}: the server's histogram): [values, shares] to interpolate
    // a value's share of the palette from, or null when none of its values are in the range
    function equalization(histogram, low, high) {
        if (!histogram || !histogram.counts || !histogram.edges) return null;
        var counts = histogram.counts, edges = histogram.edges, inside = [], total = 0;
        var clamp = function (x) { return Math.min(Math.max(x, low), high); };
        for (var i = 0; i < counts.length; i++) {
            var width = edges[i + 1] - edges[i];
            // a bin's values taken as spread evenly over it: the part of it within the range counts
            inside.push(counts[i] * (width > 0 ? (clamp(edges[i + 1]) - clamp(edges[i])) / width : 0));
            total += inside[i];
        }
        if (!(total > 0)) return null;
        var values = [low], shares = [0], sum = 0;
        for (var j = 0; j < counts.length; j++) {
            sum += inside[j];
            values.push(clamp(edges[j + 1]));
            shares.push(sum / total);
        }
        values.push(high);
        shares.push(1);
        return [values, shares];
    }

    // The palette's share at CURVE_SAMPLES values evenly across low..high: linear, or along curve (equalization), then
    // gamma
    function curveShares(low, high, adjust, curve) {
        var gamma = (adjust && adjust.gamma) || 1, out = [];
        for (var i = 0; i < CURVE_SAMPLES; i++) {
            var v = low + (high - low) * i / (CURVE_SAMPLES - 1);
            var t = clip01(curve ? interp(v, curve[0], curve[1]) : (v - low) / (high - low));
            out.push(gamma !== 1 ? Math.pow(t, 1 / gamma) : t);
        }
        return out;
    }

    // The shares a tile is drawn with (as the server's tiles are): with equalization, along the histogram's curve; with
    // gamma alone, gamma's; else none (linear)
    function drawnShares(low, high, adjust, histogram) {
        var a = adjust || {};
        if (a.equalize) return curveShares(low, high, a, equalization(histogram, low, high));
        return a.gamma && a.gamma !== 1 ? curveShares(low, high, a, null) : null;
    }

    // -- colouring (colouring.colour) --------------------------------------------------------------------------------

    function toned(u, shares) {
        var x = clip01(u);
        if (!shares || shares.length < 2) return x;
        var at = x * (shares.length - 1), i = Math.min(Math.floor(at), shares.length - 2), f = at - i;
        return shares[i] * (1 - f) + shares[i + 1] * f;
    }

    // The palette as drawn along the range: TONE_STEPS colours (r, g, b each), each the level of its toned share in the
    // palette (encoded: 0xRRGGBBAA), or in grey
    function tonedPalette(colors, shares, grey) {
        var out = new Uint8Array(TONE_STEPS * 3), n = colors.length;
        for (var i = 0; i < TONE_STEPS; i++) {
            var level = Math.round(toned(i / (TONE_STEPS - 1), shares) * LEVELS);
            if (grey) {
                out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = level;
            } else if (n) {
                var c = colors[Math.round(level * (n - 1) / LEVELS)] >>> 0;
                out[i * 3] = (c >>> 24) & 255;
                out[i * 3 + 1] = (c >>> 16) & 255;
                out[i * 3 + 2] = (c >>> 8) & 255;
            }
        }
        return out;
    }

    // The unsharp mask's blur of a tile's shares: the binomial mean of the taken neighbours of each inner pixel
    function blurred(share, has, w, h, margin, sigma) {
        var s = Math.min(Math.max(sigma, SIGMA_LIMITS[0]), SIGMA_LIMITS[1]);
        var iw = w - 2 * margin, ih = h - 2 * margin;
        var total = new Float64Array(iw * ih), weight = new Float64Array(iw * ih);
        for (var j = 0; j < TAPS.length; j++) {
            var oy = Math.round(TAPS[j] * s);
            for (var i = 0; i < TAPS.length; i++) {
                var ox = Math.round(TAPS[i] * s), wt = WEIGHTS[i] * WEIGHTS[j];
                for (var y = 0; y < ih; y++) {
                    var ny = y + margin + oy;
                    if (ny < 0 || ny >= h) continue;
                    for (var x = 0; x < iw; x++) {
                        var nx = x + margin + ox;
                        if (nx < 0 || nx >= w || !has[ny * w + nx]) continue;
                        total[y * iw + x] += wt * share[ny * w + nx];
                        weight[y * iw + x] += wt;
                    }
                }
            }
        }
        for (var k = 0; k < total.length; k++) total[k] = total[k] / weight[k];
        return total;
    }

    // A tile ({values, flags, width, height, margin, sigma}) coloured into out (the RGBA of its inner pixels, a canvas's
    // ImageData's data). style: {colors (encoded), range: [low, high], shares (null: linear), sharpen, isotherm: [low,
    // high] (the values drawn in the palette, the rest in grey) or null, seams: draw the flagged seams}. The blur is kept
    // on the tile for the same range and sigma.
    function colour(tile, style, out) {
        var w = tile.width, h = tile.height, m = tile.margin || 0, iw = w - 2 * m, ih = h - 2 * m, v = tile.values;
        var low = style.range[0], high = style.range[1], span = (high - low) || 1;
        var palette = tonedPalette(style.colors, style.shares), grey = style.isotherm ? tonedPalette(style.colors, style.shares, true) : null;
        var blur = null;
        if (style.sharpen > 0) {
            var key = low + "," + high + "," + tile.sigma;
            if (tile.blurKey !== key) {
                var share = new Float64Array(w * h), has = new Uint8Array(w * h);
                for (var p = 0; p < w * h; p++) {
                    has[p] = v[p] === v[p] ? 1 : 0;
                    share[p] = has[p] ? clip01((v[p] - low) / span) : 0;
                }
                tile.blur = blurred(share, has, w, h, m, tile.sigma);
                tile.blurKey = key;
            }
            blur = tile.blur;
        }
        var iso = style.isotherm;
        for (var y = 0; y < ih; y++) {
            for (var x = 0; x < iw; x++) {
                var at = (y + m) * w + x + m, o = (y * iw + x) * 4, value = v[at];
                if (value !== value) {
                    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
                    continue;
                }
                var u = clip01((value - low) / span);
                if (blur) u = clip01(u + style.sharpen * (u - blur[y * iw + x]));
                var step = Math.round(u * (TONE_STEPS - 1)) * 3;
                var from = iso && !(value >= iso[0] && value <= iso[1]) ? grey : palette;
                out[o] = from[step];
                out[o + 1] = from[step + 1];
                out[o + 2] = from[step + 2];
                out[o + 3] = 255;
                var flag = style.seams && tile.flags ? tile.flags[at] : 0;
                if (flag === 1 || flag === 2) {
                    out[o] = SEAM_COLORS[flag - 1][0];
                    out[o + 1] = SEAM_COLORS[flag - 1][1];
                    out[o + 2] = SEAM_COLORS[flag - 1][2];
                }
            }
        }
        return out;
    }

    var api = {decode: decode, fetchValues: fetchValues, interp: interp, equalization: equalization, curveShares: curveShares,
               drawnShares: drawnShares, tonedPalette: tonedPalette, colour: colour, CURVE_SAMPLES: CURVE_SAMPLES};
    root.ThermalRecolour = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
