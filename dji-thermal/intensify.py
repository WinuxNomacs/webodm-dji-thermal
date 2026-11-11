"""
Intensify: each pixel's difference from its surroundings, the median of the pixels around it over SIZE_M. Gradients,
slopes and the sun's side, wider than that, go to about 0; a seam or a leak narrower than it keeps its difference from
the ground beside it. The mosaic viewer's Intensify tab (mosaics.py) shows the harmonized mosaic so, and its frames
window the frames. numpy only: the medians are taken over windows SIZE_M wide every half of it, then interpolated
between (a median filter that wide, pixel by pixel, is slow).
"""

import warnings

SIZE_M = 2.0            # the neighbourhood: wider than a seam, narrower than a roof's slope
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
