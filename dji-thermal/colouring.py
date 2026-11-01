"""
How the mosaic viewer's tiles and frames are drawn, from dji-thermal-ui (analyzer/colouring.py and the colours of
analyzer/thermal_measure.py): values over a range, toned by a curve (gamma, or a histogram equalization), sharpened with
an unsharp mask, an isotherm's pixels in the palette and the rest in grey. They change how values are drawn, never the
values.
"""
import json
import os
import tempfile

import numpy as np

from . import portable

# The palette's entries along the range, the tone curve baked into them, and the server's 256 levels of a palette
TONE_STEPS = 1024
LEVELS = 255
# The unsharp mask's sigma, in the pixels of the values drawn
SIGMA_LIMITS = (0.5, 4.0)
# A binomial blur: its variance is the spacing's square
TAPS = (-2, -1, 0, 1, 2)
WEIGHTS = (1, 4, 6, 4, 1)
# The pixels the unsharp mask reads around one: a tile is read with this many more on each side
MARGIN = int(np.floor(TAPS[-1] * SIGMA_LIMITS[1] + 0.5))
# The adjustments' limits, the histogram equalization reads and the legend's samples
GAMMA_LIMITS = (0.2, 5.0)
SHARPEN_LIMITS = (0.0, 5.0)
EQUALIZE_BINS = 1024
EQUALIZE_SPAN = (0.1, 99.9)     # the percentiles a mosaic's histogram spans: its outliers would empty all its bins but one
CURVE_SAMPLES = 65
HISTOGRAMS_KEPT = 16      # the mosaics' histograms kept in memory

_histograms = {}


def js_round(x):
    """Math.round: halves up"""
    return np.floor(np.asarray(x, dtype=np.float64) + 0.5)


def rgb(encoded):
    """A palette as the API gives it (0xRRGGBBAA integers) as an (n, 3) uint8 array"""
    c = np.asarray(encoded, dtype=np.uint64) & 0xFFFFFFFF
    return np.stack([(c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255], axis=-1).astype(np.uint8)


def toned(u, shares=None):
    """Shares of the range (0 to 1) toned: along shares (interpolated between its samples), else as they are"""
    x = np.clip(np.asarray(u, dtype=np.float64), 0.0, 1.0)
    if shares is None or len(shares) < 2:
        return x
    s = np.asarray(shares, dtype=np.float64)
    at = x * (len(s) - 1)
    i = np.minimum(np.floor(at), len(s) - 2).astype(np.int64)
    f = at - i
    return s[i] * (1 - f) + s[i + 1] * f


def toned_palette(colors, shares=None, grey=False):
    """The palette as drawn along the range: TONE_STEPS colours ((TONE_STEPS, 3) uint8), each the level (0 to 255) of
    its toned share in the palette, or in grey"""
    levels = js_round(toned(np.arange(TONE_STEPS) / (TONE_STEPS - 1), shares) * LEVELS).astype(np.int64)
    if grey:
        return np.repeat(levels[:, None], 3, axis=1).astype(np.uint8)
    palette = rgb(colors)
    if not len(palette):
        return np.zeros((TONE_STEPS, 3), np.uint8)
    return palette[js_round(levels * (len(palette) - 1) / LEVELS).astype(np.int64)]


def colour(values, colors, value_range=None, shares=None, sharpen=0.0, isotherm=None, sigma=1.0, margin=0):
    """
    Values (a 2-D array, NaN where there are none) coloured: an (h, w, 4) uint8 RGBA image, clear where there are no
    values.

    :param colors: the palette, as the API gives it (0xRRGGBBAA)
    :param value_range: the values at either end of the palette (low, high)
    :param shares: the palette's share at values evenly across the range (None: linear)
    :param sharpen: the unsharp mask's amount (0: none)
    :param isotherm: the values drawn in the palette, (low, high), the rest in grey (None: all in the palette)
    :param sigma: the unsharp mask's, in the pixels drawn
    :param margin: the pixels around the image only read (by the unsharp mask), not coloured
    """
    v = np.asarray(values, dtype=np.float64)
    inner = (slice(margin, v.shape[0] - margin), slice(margin, v.shape[1] - margin))
    has = np.isfinite(v)
    here = has[inner]
    out = np.zeros(here.shape + (4,), np.uint8)
    low, high = value_range or (0.0, 1.0)
    span = (high - low) or 1.0
    with np.errstate(invalid='ignore'):
        share = np.clip((np.where(has, v, low) - low) / span, 0.0, 1.0)
    u = share[inner]
    if sharpen > 0:
        s = float(np.clip(sigma, *SIGMA_LIMITS))
        h, w = v.shape
        total = np.zeros_like(u)
        weight = np.zeros_like(u)
        ys = np.arange(margin, h - margin)
        xs = np.arange(margin, w - margin)
        for j, dy in enumerate(TAPS):
            for i, dx in enumerate(TAPS):
                oy, ox = int(js_round(dy * s)), int(js_round(dx * s))
                ny, nx = ys + oy, xs + ox
                iny, inx = (ny >= 0) & (ny < h), (nx >= 0) & (nx < w)
                taken = np.zeros_like(u, dtype=bool)
                taken[np.ix_(iny, inx)] = has[np.ix_(ny[iny], nx[inx])]
                n = np.zeros_like(u)
                n[np.ix_(iny, inx)] = share[np.ix_(ny[iny], nx[inx])]
                wt = WEIGHTS[i] * WEIGHTS[j]
                total = total + np.where(taken, wt * n, 0.0)
                weight = weight + np.where(taken, wt, 0)
        with np.errstate(invalid='ignore', divide='ignore'):
            u = np.clip(u + sharpen * (u - total / weight), 0.0, 1.0)
    step = js_round(np.where(here, u, 0) * (TONE_STEPS - 1)).astype(np.int64)
    palette = toned_palette(colors, shares)
    out[..., :3] = palette[step]
    if isotherm:
        grey = toned_palette(colors, shares, grey=True)
        vals = v[inner]
        with np.errstate(invalid='ignore'):
            outside = ~((vals >= isotherm[0]) & (vals <= isotherm[1]))
        out[..., :3] = np.where(outside[..., None], grey[step], out[..., :3])
    out[..., 3] = 255
    out[~here] = 0
    return out


def sharpen_sigma(raster_pixel, drawn_pixel):
    """The unsharp mask's sigma in the pixels drawn, from the raster's pixel and the drawn one (the same unit), clamped"""
    s = raster_pixel / drawn_pixel if raster_pixel and raster_pixel > 0 and drawn_pixel and drawn_pixel > 0 else 1.0
    return float(min(max(s, SIGMA_LIMITS[0]), SIGMA_LIMITS[1]))


# The adjustments and the tone curve

def parse_adjust(params):
    """
    The adjustments a mosaic or frame is drawn with (gamma, equalize=1, sharpen), checked: {gamma, equalize, sharpen},
    none by default
    :raises ValueError: one is not valid (the message is for the user)
    """
    def ranged(name, label, limits, default):
        raw = params.get(name)
        if raw is None or raw == "":
            return default
        try:
            v = float(raw)
        except ValueError:
            raise ValueError("{} is not a number".format(label)) from None
        if not limits[0] <= v <= limits[1]:
            raise ValueError("{} is from {:g} to {:g}".format(label, *limits))
        return v

    equalize = params.get('equalize') or '0'
    if equalize not in ('0', '1'):
        raise ValueError("equalize is 1 or 0")
    return {'gamma': ranged('gamma', "Gamma", GAMMA_LIMITS, 1.0), 'equalize': equalize == '1',
            'sharpen': ranged('sharpen', "Sharpening", SHARPEN_LIMITS, 0.0)}


def value_histogram(values, span=None):
    """
    The EQUALIZE_BINS histogram ((counts, edges)) of an array's finite values within span (low, high; by default its
    EQUALIZE_SPAN percentiles), or None when there are none
    """
    v = values[np.isfinite(values)]
    if span is None and v.size:
        span = tuple(float(p) for p in np.percentile(v, EQUALIZE_SPAN))
    if not v.size or span[1] < span[0]:
        return None
    counts, edges = np.histogram(v, bins=EQUALIZE_BINS, range=span)
    return (counts, edges) if counts.any() else None


def equalization(histogram, low, high):
    """
    Histogram equalization over low..high: (values, shares) to interpolate a value's share of the palette from (the
    share of the histogram's values within the range below it), or None when none of them are in it
    """
    if histogram is None:
        return None
    counts, edges = np.asarray(histogram[0], dtype=np.float64), np.asarray(histogram[1], dtype=np.float64)
    left, right = np.clip(edges[:-1], low, high), np.clip(edges[1:], low, high)
    width = edges[1:] - edges[:-1]
    # a bin's values taken as spread evenly over it: the part of it within the range counts
    inside = counts * np.where(width > 0, (right - left) / np.where(width > 0, width, 1), 0)
    total = inside.sum()
    if not total > 0:
        return None
    values = np.concatenate([[low], right, [high]])
    shares = np.concatenate([[0.0], np.cumsum(inside) / total, [1.0]])
    return values, shares


def tone(values, low, high, adjust=None, curve=None):
    """Values' shares of the palette (0..1) over low..high: linear, or along curve (equalization), then gamma"""
    if curve is not None:
        t = np.interp(values, curve[0], curve[1])
    else:
        t = (np.asarray(values, dtype=np.float64) - low) / (high - low)
    t = np.clip(t, 0.0, 1.0)
    gamma = (adjust or {}).get('gamma', 1.0)
    return t ** (1.0 / gamma) if gamma != 1.0 else t


def curve_shares(low, high, adjust=None, curve=None):
    """The palette's share at CURVE_SAMPLES values evenly across low..high, for the tiles and the legend's gradient"""
    return [float(t) for t in tone(np.linspace(low, high, CURVE_SAMPLES), low, high, adjust, curve)]


def kept_histogram(path, read, kept):
    """
    A raster's histogram (value_histogram of read(path)), kept in the file kept for the raster's version (it is read
    whole once), and in memory
    """
    st = os.stat(path)
    key = [[st.st_ino, st.st_size, st.st_mtime_ns], EQUALIZE_BINS, list(EQUALIZE_SPAN)]
    memo = _histograms.get((path, kept))
    if memo and memo[0] == key:
        return memo[1]
    histogram = None
    try:
        with open(kept) as f:
            found = json.load(f)
        if found.get('key') != key:
            raise ValueError("another version")
        if found.get('counts') is not None:
            histogram = (np.array(found['counts']), np.array(found['edges']))
    except (OSError, ValueError, AttributeError):
        histogram = value_histogram(read(path))
        os.makedirs(os.path.dirname(kept), exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=os.path.dirname(kept), suffix='.tmp')
        with os.fdopen(fd, 'w') as f:
            json.dump({'key': key, 'counts': histogram[0].tolist() if histogram else None,
                       'edges': histogram[1].tolist() if histogram else None}, f)
        portable.replace(temporary, kept)
    if len(_histograms) >= HISTOGRAMS_KEPT:
        _histograms.pop(next(iter(_histograms)))
    _histograms[(path, kept)] = (key, histogram)
    return histogram
