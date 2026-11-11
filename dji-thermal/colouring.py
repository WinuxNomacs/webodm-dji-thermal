"""
How the mosaic viewer's tiles and frames are drawn, from dji-thermal-ui (analyzer/colouring.py and the colours of
analyzer/thermal_measure.py): values over a range, toned by a curve (gamma), in flat bands when stepped, sharpened with
an unsharp mask, an isotherm's pixels in the palette and the rest in grey. They change how values are drawn, never the
values.
"""
import math

import numpy as np

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
# The adjustments' limits and the legend's samples
GAMMA_LIMITS = (0.2, 5.0)
SHARPEN_LIMITS = (0.0, 5.0)
CURVE_SAMPLES = 65
ISOTHERM_MODES = ('above', 'below', 'between')
VALUE_CODES = 65535       # a value tile's codes run from 0 to this, a tile's lowest value to its highest


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


def banded(u, steps):
    """Shares of the range (0 to 1) in flat bands: each the share at the middle of its band (steps: (start, width), the
    bands' edges at start + k * width, in shares of the range), clipped to the range; as they are without steps"""
    x = np.asarray(u, dtype=np.float64)
    if not steps:
        return x
    start, width = steps
    return np.clip(start + (np.floor((x - start) / width) + 0.5) * width, 0.0, 1.0)


def band_steps(low, high, bands):
    """Bands of values ((width, origin): their edges at origin + k * width, in the values' unit) as shares of the
    range low..high, as banded takes them; None without bands"""
    if not bands:
        return None
    span = (high - low) or 1.0
    return ((bands[1] - low) / span, bands[0] / span)


def toned_palette(colors, shares=None, grey=False, steps=None):
    """The palette as drawn along the range: TONE_STEPS colours ((TONE_STEPS, 3) uint8), each the level (0 to 255) of
    its toned share in the palette (in flat bands with steps: banded's), or in grey"""
    u = banded(np.arange(TONE_STEPS) / (TONE_STEPS - 1), steps)
    levels = js_round(toned(u, shares) * LEVELS).astype(np.int64)
    if grey:
        return np.repeat(levels[:, None], 3, axis=1).astype(np.uint8)
    palette = rgb(colors)
    if not len(palette):
        return np.zeros((TONE_STEPS, 3), np.uint8)
    return palette[js_round(levels * (len(palette) - 1) / LEVELS).astype(np.int64)]


def colour(values, colors, value_range=None, shares=None, sharpen=0.0, isotherm=None, sigma=1.0, margin=0, bands=None):
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
    :param bands: flat bands of values, (width, origin): their edges at origin + k * width (None: smooth)
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
    steps = band_steps(low, high, bands)
    palette = toned_palette(colors, shares, steps=steps)
    out[..., :3] = palette[step]
    if isotherm:
        grey = toned_palette(colors, shares, grey=True, steps=steps)
        vals = v[inner]
        with np.errstate(invalid='ignore'):
            outside = ~((vals >= isotherm[0]) & (vals <= isotherm[1]))
        out[..., :3] = np.where(outside[..., None], grey[step], out[..., :3])
    out[..., 3] = 255
    out[~here] = 0
    return out


def value_png(values, flags=None):
    """
    Values (a 2-D array, NaN where there are none) as a value tile, which the browser colours (recolour.js): an RGBA PNG
    whose red and green hold a 16-bit code (the value is offset + code * step), blue a flag per pixel (flags, 0 to 255:
    the source frames' seams) and alpha 255 where there is a value, 0 elsewhere. Returns (PNG bytes, offset, step).
    """
    import io

    from PIL import Image
    v = np.asarray(values, dtype=np.float64)
    has = np.isfinite(v)
    offset, top = (float(v[has].min()), float(v[has].max())) if has.any() else (0.0, 0.0)
    step = (top - offset) / VALUE_CODES if top > offset else 1.0
    code = js_round((np.where(has, v, offset) - offset) / step).astype(np.uint16)
    out = np.zeros(v.shape + (4,), np.uint8)
    out[..., 0], out[..., 1] = code >> 8, code & 255
    if flags is not None:
        out[..., 2] = flags
    out[..., 3] = np.where(has, 255, 0)
    buf = io.BytesIO()
    Image.fromarray(out, 'RGBA').save(buf, 'PNG')
    return buf.getvalue(), offset, step


def sharpen_sigma(raster_pixel, drawn_pixel):
    """The unsharp mask's sigma in the pixels drawn, from the raster's pixel and the drawn one (the same unit), clamped"""
    s = raster_pixel / drawn_pixel if raster_pixel and raster_pixel > 0 and drawn_pixel and drawn_pixel > 0 else 1.0
    return float(min(max(s, SIGMA_LIMITS[0]), SIGMA_LIMITS[1]))


# The adjustments and the tone curve

def parse_adjust(params):
    """
    The adjustments a mosaic or frame is drawn with (gamma, sharpen, stepped=width,origin: flat bands of values, their
    edges at origin + k * width, in the values' unit), checked: {gamma, sharpen, bands: (width, origin) or None}, none by
    default
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

    return {'gamma': ranged('gamma', "Gamma", GAMMA_LIMITS, 1.0), 'sharpen': ranged('sharpen', "Sharpening", SHARPEN_LIMITS, 0.0),
            'bands': parse_bands(params.get('stepped'))}


def parse_bands(value):
    """stepped=width,origin as (width, origin), None when empty
    :raises ValueError: not two numbers, the width above 0 (the message is for the user)"""
    if value is None or value == "":
        return None
    try:
        width, origin = (float(p) for p in str(value).split(','))
    except ValueError:
        raise ValueError("Stepped's bands are width,origin") from None
    if not (math.isfinite(width) and math.isfinite(origin) and width > 0):
        raise ValueError("Stepped's band width must be above 0")
    return width, origin


def parse_isotherm(value):
    """
    "above,T", "below,T" or "between,A,B" as (mode, low, high): the values above low, below high or between both;
    None when value is empty
    :raises ValueError: not one of them (the message is for the user)
    """
    if value is None or value == "":
        return None
    parts = str(value).split(',')
    mode = parts[0]
    if mode not in ISOTHERM_MODES or len(parts) != (3 if mode == 'between' else 2):
        raise ValueError("The isotherm is above,T or below,T or between,A,B")
    try:
        values = [float(p) for p in parts[1:]]
    except ValueError:
        raise ValueError("The isotherm's temperature is not a number") from None
    if mode == 'above':
        return mode, values[0], None
    if mode == 'below':
        return mode, None, values[0]
    if not values[1] > values[0]:
        raise ValueError("The isotherm's second temperature must be above the first")
    return mode, values[0], values[1]


def isotherm_range(isotherm):
    """parse_isotherm's (mode, low, high) as the values inside it, as colour takes it, or None"""
    if not isotherm:
        return None
    _mode, low, high = isotherm
    return (-3e38 if low is None else low, 3e38 if high is None else high)


def tone(values, low, high, adjust=None):
    """Values' shares of the palette (0..1) over low..high, then gamma"""
    t = np.clip((np.asarray(values, dtype=np.float64) - low) / (high - low), 0.0, 1.0)
    gamma = (adjust or {}).get('gamma', 1.0)
    return t ** (1.0 / gamma) if gamma != 1.0 else t


def curve_shares(low, high, adjust=None):
    """The palette's share at CURVE_SAMPLES values evenly across low..high, for the tiles and the legend's gradient"""
    return [float(t) for t in tone(np.linspace(low, high, CURVE_SAMPLES), low, high, adjust)]
