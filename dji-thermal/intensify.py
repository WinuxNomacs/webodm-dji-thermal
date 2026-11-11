"""
Intensify: each pixel's difference from its surroundings, the median of the pixels around it over SIZE_M. Gradients,
slopes and the sun's side, wider than that, go to about 0; a seam or a leak narrower than it keeps its difference from
the ground beside it. The mosaic viewer's Intensify tab (mosaics.py) shows the harmonized mosaic so, and its frames
window the frames. numpy only: the medians are taken over windows SIZE_M wide every half of it, then interpolated
between (a median filter that wide, pixel by pixel, is slow).

Under Pointer Info (the mosaic viewer, the frame page, the Thermal Inspector), a point's difference from its
surroundings is the point less the median of the pixels within a circle around it, its radius the user's (RADIUS_M
until they choose one; raster_difference, disc_difference).
"""

import warnings

SIZE_M = 2.0            # the neighbourhood: wider than a seam, narrower than a roof's slope
RADIUS_M = 1.0          # Pointer Info's circle, until the user chooses another (about SIZE_M across)
RADIUS_MIN, RADIUS_MAX = 0.25, 10.0
STRIP_ROWS = 512        # the background interpolated this many rows at a time (a large mosaic is not copied whole)


def differences(values, gsd_m, size_m=SIZE_M):
    """
    values less their background (see background), over a neighbourhood size_m wide at gsd_m metres a pixel: float32,
    NaN where values are NaN. A difference of temperatures is in their unit (a median shifts with them, and scales).
    """
    import numpy as np
    values = np.asarray(values, dtype=np.float32)
    size_px = size_m / gsd_m if gsd_m and gsd_m > 0 else 1.0
    return values - background(values, size_px)


def background(values, size_px):
    """
    Each pixel's surroundings: the medians of windows about size_px pixels wide (odd), centred every half of it and on
    the last row and column, interpolated linearly between their centres, a window with no values left out of the
    interpolation. float32, NaN where no window has values.
    """
    import numpy as np
    values = np.asarray(values, dtype=np.float32)
    height, width = values.shape
    half = max(1, int(size_px / 2 + 0.5))
    rows, cols = _centres(height, half), _centres(width, half)
    medians = _window_medians(values, half, rows, cols)
    known = np.isfinite(medians)
    filled, weights = np.where(known, medians, 0.0), known.astype(np.float32)
    out = np.empty_like(values)
    x0, x1, fx = _between(cols, np.arange(width))
    for top in range(0, height, STRIP_ROWS):
        y0, y1, fy = _between(rows, np.arange(top, min(height, top + STRIP_ROWS)))
        total, weight = _bilinear(filled, y0, y1, fy, x0, x1, fx), _bilinear(weights, y0, y1, fy, x0, x1, fx)
        with np.errstate(invalid='ignore', divide='ignore'):
            out[top:top + len(fy)] = np.where(weight > 1e-6, total / weight, np.nan)
    return out


def _centres(length, step):
    """The windows' centres along an axis: every step pixels from 0, and the last pixel"""
    import numpy as np
    c = np.arange(0, length, step)
    return c if c[-1] == length - 1 else np.append(c, length - 1)


def _window_medians(values, half, rows, cols):
    """The median of the finite values in each window 2 * half + 1 pixels wide centred at (rows x cols), NaN for one
    with none"""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view
    size = 2 * half + 1
    padded = np.pad(values, half, constant_values=np.nan)
    out = np.full((len(rows), len(cols)), np.nan, dtype=np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)     # All-NaN slice: a window with no values stays NaN
        for i, r in enumerate(rows):
            strip = padded[r:r + size]                                       # (size, width + 2 half)
            windows = sliding_window_view(strip, size, axis=1)[:, cols]      # (size, len(cols), size)
            out[i] = np.nanmedian(windows.transpose(1, 0, 2).reshape(len(cols), -1), axis=1)
    return out


def _between(centres, at):
    """For each position, the centres either side (indices) and how far it is from the first to the second"""
    import numpy as np
    i0 = np.clip(np.searchsorted(centres, at, side='right') - 1, 0, len(centres) - 1)
    i1 = np.minimum(i0 + 1, len(centres) - 1)
    span = (centres[i1] - centres[i0]).astype(np.float32)
    f = np.where(span > 0, (at - centres[i0]) / np.where(span > 0, span, 1), 0.0).astype(np.float32)
    return i0, i1, f


def _bilinear(grid, y0, y1, fy, x0, x1, fx):
    rows = grid[y0] * (1 - fy)[:, None] + grid[y1] * fy[:, None]
    return rows[:, x0] * (1 - fx)[None, :] + rows[:, x1] * fx[None, :]


def parse_radius(raw):
    """A circle's radius (m) as a request or a preference gives it, RADIUS_M when not given
    :raises ValueError: not a number from RADIUS_MIN to RADIUS_MAX"""
    import math
    if raw is None or raw == '':
        return RADIUS_M
    try:
        radius = float('nan') if isinstance(raw, bool) else float(raw)
    except (TypeError, ValueError):
        radius = float('nan')
    if not (math.isfinite(radius) and RADIUS_MIN <= radius <= RADIUS_MAX):
        raise ValueError("Must be from {:g} to {:g} m".format(RADIUS_MIN, RADIUS_MAX))
    return radius


def disc(pixel_m, radius_m=RADIUS_M):
    """The pixels within radius_m of a pixel's centre, at pixel_m metres a pixel (its neighbours at least): a square
    boolean array 2 * half + 1 pixels wide, the pixel at its centre, and half"""
    import numpy as np
    radius = max(1.0, radius_m / pixel_m) if pixel_m and pixel_m > 0 else 1.0
    half = int(radius)
    d = np.arange(-half, half + 1)
    return d[:, None] ** 2 + d[None, :] ** 2 <= radius * radius, half


def from_surroundings(value, around):
    """value less the median of around's finite values (an array, the point's included), None when there are none"""
    import numpy as np
    around = np.asarray(around, dtype=np.float64)
    around = around[np.isfinite(around)]
    if value is None or not around.size:
        return None
    return float(value - np.median(around))


def disc_difference(values, row, col, pixel_m, radius_m=RADIUS_M):
    """A pixel of an array (NaN where it has none) less the median of the pixels within radius_m around it, None
    when it has none"""
    import numpy as np
    values = np.asarray(values)
    if not (0 <= row < values.shape[0] and 0 <= col < values.shape[1]) or not np.isfinite(values[row, col]):
        return None
    inside, half = disc(pixel_m, radius_m)
    r0, c0 = max(0, row - half), max(0, col - half)
    window = values[r0:row + half + 1, c0:col + half + 1]
    mask = inside[r0 - row + half:r0 - row + half + window.shape[0], c0 - col + half:c0 - col + half + window.shape[1]]
    return from_surroundings(float(values[row, col]), window[mask])


def raster_difference(src, row, col, value, pixel_m, usable=None, radius_m=RADIUS_M):
    """
    value, a rasterio dataset's first band at (row, col), less the median of the pixels within radius_m around it
    (usable(window, data): the window's pixels that hold values, beside the finite ones); None when none do
    """
    import numpy as np
    from rasterio.windows import Window
    inside, half = disc(pixel_m, radius_m)
    r0, c0 = max(0, row - half), max(0, col - half)
    r1, c1 = min(src.height, row + half + 1), min(src.width, col + half + 1)
    if value is None or r1 <= r0 or c1 <= c0:
        return None
    window = Window(c0, r0, c1 - c0, r1 - r0)
    data = src.read(1, window=window).astype(np.float64)
    keep = np.isfinite(data) if usable is None else np.isfinite(data) & usable(window, data)
    keep &= inside[r0 - row + half:r1 - row + half, c0 - col + half:c1 - col + half]
    return from_surroundings(value, data[keep])
