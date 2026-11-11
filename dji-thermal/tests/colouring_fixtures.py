"""
What the browser's colouring (public/recolour.js) is tested against: values coloured by colouring.py in each of its ways,
kept in public/__tests__/fixtures/colouring.json. test_analyzer checks the file is what colouring.py draws now; after
changing colouring.py, write it again (numpy and Pillow, as in the host's .venv):

    .venv/bin/python dji-thermal/tests/colouring_fixtures.py
"""
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(os.path.dirname(HERE), "public", "__tests__", "fixtures", "colouring.json")
SIZE, MARGIN = 30, 8


def build(colouring):
    """The fixtures: the values and palettes, and each case's style with the RGBA it is drawn in"""
    import numpy as np
    rng = np.random.default_rng(7)
    values = rng.normal(20, 8, (SIZE, SIZE))
    values[12:20, 10:18] += 15      # an edge for the unsharp mask
    values[rng.random((SIZE, SIZE)) < 0.06] = np.nan
    values[:, :3] = np.nan
    values = np.round(values, 3)
    flags = np.where(rng.random((SIZE, SIZE)) < 0.05, rng.integers(1, 3, (SIZE, SIZE)), 0)
    palettes = {
        "long": [(i << 24) | ((255 - i) << 16) | (((i * 7) % 256) << 8) | 255 for i in range(256)],
        "short": [0xFF0000FF, 0x00FF00FF, 0x0000FFFF, 0xFFFF00FF, 0xFFFFFFFF],
    }
    cases = [
        {"name": "linear", "palette": "long", "range": [10, 30]},
        {"name": "a short palette", "palette": "short", "range": [5, 40]},
        {"name": "gamma", "palette": "long", "range": [10, 30], "shares": colouring.curve_shares(10, 30, {"gamma": 2.0})},
        {"name": "stepped", "palette": "long", "range": [10, 30], "bands": [2.0, 0.0]},
        {"name": "stepped, bands off the range's ends, with gamma", "palette": "short", "range": [12.3, 34.1],
         "bands": [5.0, -17.78], "shares": colouring.curve_shares(12.3, 34.1, {"gamma": 1.8})},
        {"name": "stepped and sharpened, with an isotherm", "palette": "long", "range": [10, 30], "bands": [2.5, 1.0],
         "sharpen": 1.5, "sigma": 1.2, "isotherm": [15, 25]},
        {"name": "sharpened", "palette": "long", "range": [10, 30], "sharpen": 2.5, "sigma": 1.7},
        {"name": "sharpened wide, with gamma", "palette": "short", "range": [0, 45], "sharpen": 1.0, "sigma": 3.2,
         "shares": colouring.curve_shares(0, 45, {"gamma": 0.6})},
        {"name": "an isotherm", "palette": "long", "range": [10, 30], "isotherm": [15, 25],
         "shares": colouring.curve_shares(10, 30, {"gamma": 1.5})},
        {"name": "seams", "palette": "long", "range": [10, 30], "seams": True, "sharpen": 1.5, "sigma": 0.9},
    ]
    inner = (slice(MARGIN, -MARGIN), slice(MARGIN, -MARGIN))
    for case in cases:
        rgba = colouring.colour(values, palettes[case["palette"]], tuple(case["range"]), case.get("shares"),
                                case.get("sharpen", 0.0), case.get("isotherm"), case.get("sigma", 1.0), MARGIN,
                                case.get("bands"))
        if case.get("seams"):
            # as the source frames' tiles are drawn (mosaics.tile), only where there are values
            here = rgba[..., 3] > 0
            for flag, color in ((1, (0, 0, 0)), (2, (255, 255, 255))):
                rgba[(flags[inner] == flag) & here, :3] = color
        case["rgba"] = rgba.reshape(-1).tolist()
    return {"size": SIZE, "margin": MARGIN, "values": [None if np.isnan(v) else float(v) for v in values.reshape(-1)],
            "flags": flags.reshape(-1).tolist(), "palettes": palettes, "cases": cases}


def text(fixtures):
    return json.dumps(fixtures, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    # colouring.py without the plugin's package (whose __init__ needs WebODM)
    package = types.ModuleType("dji_thermal")
    package.__path__ = [os.path.dirname(HERE)]
    sys.modules["dji_thermal"] = package
    from dji_thermal import colouring
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as f:
        f.write(text(build(colouring)))
    print(PATH)
