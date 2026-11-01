"""
The Thermal Inspector's correction of temperatures for another emissivity and reflected temperature than they were
measured with, as dji-thermal-ui corrects its mosaics. It is approximate: a broadband model (radiance as the fourth
power of the temperature in kelvin, the atmosphere's transmission taken as 1, as at mapping distances)

    W = eps * T_obj^4 + (1 - eps) * T_refl^4

finds the radiance the camera saw from a temperature and the parameters it was measured with (the baseline), then the
object's temperature again from that radiance with the parameters wanted. The camera's own model is spectral, so this
is for comparing surfaces, not for calibrated values.

A layer's baseline is what its temperatures were measured with: an orthophoto's, the median of what its task's TIFFs
record in their XMP (dji-thermal-cli's Emissivity and ReflectedTemperatureC); a workset mosaic's, the workset's
settings, else what normalizing used, else the median of what its frames recorded.
"""
import functools
import math
import os
import re
import statistics

from . import conversions, mosaics

KELVIN = 273.15
EMISSIVITY = conversions.LIMITS['emissivity']
REFLECTED = (-100.0, 1000.0)        # °C
SAMPLED_TIFFS = 9                   # the task's TIFFs read for its baseline, spread over them
DTC_NAMESPACE = b'urn:dji-thermal-cli:xmp:1.0'


def parse(value):
    """A request's correction {"emissivity", "reflected" (°C)} as (emissivity, reflected), None for none
    :raises ValueError: not numbers, or out of their limits
    """
    if value is None:
        return None
    found = []
    for key in ('emissivity', 'reflected'):
        v = value.get(key) if isinstance(value, dict) else None
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError("Invalid correction")
        found.append(float(v))
    emissivity, reflected = found
    if not EMISSIVITY[0] <= emissivity <= EMISSIVITY[1]:
        raise ValueError("The emissivity is between {:g} and {:g}".format(*EMISSIVITY))
    if not REFLECTED[0] <= reflected <= REFLECTED[1]:
        raise ValueError("The reflected temperature is between {:g} and {:g} °C".format(*REFLECTED))
    return emissivity, reflected


def is_identity(wanted, baseline):
    return all(abs(a - b) < 1e-9 for a, b in zip(wanted, baseline))


def gain_and_offset(wanted, baseline):
    """The object's radiance with the parameters wanted is gain * its radiance with the baseline's + offset"""
    e, r = wanted
    e0, r0 = baseline
    gain = e0 / e
    offset = ((1 - e0) * (r0 + KELVIN) ** 4 - (1 - e) * (r + KELVIN) ** 4) / e
    return gain, offset


def apply(values, wanted, baseline):
    """values (°C, a numpy array; NaN stays NaN) as measured with wanted ((emissivity, reflected °C)) instead of
    baseline"""
    import numpy as np
    if is_identity(wanted, baseline):
        return values
    gain, offset = gain_and_offset(wanted, baseline)
    values = np.asarray(values, dtype=np.float64)
    with np.errstate(invalid='ignore'):
        w = gain * (values + KELVIN) ** 4 + offset
        return np.where(np.isfinite(values), np.where(w > 0, w, 0) ** 0.25 - KELVIN, np.nan)


def value(celsius, wanted, baseline):
    """One temperature (°C) corrected, as apply"""
    if celsius is None or is_identity(wanted, baseline):
        return celsius
    gain, offset = gain_and_offset(wanted, baseline)
    w = gain * (celsius + KELVIN) ** 4 + offset
    return max(w, 0.0) ** 0.25 - KELVIN


def described(wanted, baseline):
    """A correction as a response and a saved measurement record it"""
    return {'emissivity': wanted[0], 'reflected': wanted[1],
            'baseline': {'emissivity': baseline[0], 'reflected': baseline[1]}}


def _median(found):
    found = [v for v in found if v is not None]
    return statistics.median(found) if found else None


def xmp_parameters(path):
    """(emissivity, reflected °C) a TIFF of dji-thermal-cli records in its XMP, either None"""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return None, None
    m = re.search(rb'xmlns:([\w.-]+)="' + re.escape(DTC_NAMESPACE) + b'"', data)
    if m is None:
        return None, None
    prefix = re.escape(m.group(1))
    found = []
    for name in (b'Emissivity', b'ReflectedTemperatureC'):
        v = re.search(prefix + b':' + name + rb'(?:="([^"]*)"|>([^<]*)<)', data)
        try:
            found.append(float((v.group(1) or v.group(2)).decode()) if v else None)
        except ValueError:
            found.append(None)
    return tuple(found)


def tiffs_baseline(paths):
    """The median of what some TIFFs (up to SAMPLED_TIFFS, spread over them) record: (emissivity, reflected °C), or
    None when they don't record both"""
    paths = sorted(paths)
    if len(paths) > SAMPLED_TIFFS:
        step = (len(paths) - 1) / (SAMPLED_TIFFS - 1)
        paths = [paths[round(i * step)] for i in range(SAMPLED_TIFFS)]
    stamped = []
    for p in paths:
        try:
            stamped.append((p, os.stat(p).st_mtime_ns))
        except OSError:
            pass
    return _tiffs_baseline(tuple(stamped))


@functools.lru_cache(maxsize=32)
def _tiffs_baseline(stamped):
    """tiffs_baseline of [(path, its time)], read once while they are unchanged"""
    found = [xmp_parameters(p) for p, _t in stamped]
    emissivity, reflected = _median(f[0] for f in found), _median(f[1] for f in found)
    return None if emissivity is None or reflected is None else (emissivity, reflected)


def task_baseline(task):
    """What a task's thermal orthophoto was measured with (its TIFFs'), or None when they don't say"""
    root = task.task_path()
    try:
        names = os.listdir(root)
    except OSError:
        return None
    return tiffs_baseline([os.path.join(root, n) for n in names if n.lower().endswith(('.tif', '.tiff'))])


def workset_baseline(task, cid):
    """What a workset's mosaics were measured with, or None when unknown"""
    settings = conversions.record(task, cid).get('settings') or {}
    unit = settings.get('unit') or 'C'
    emissivity = settings.get('emissivity')
    reflected = settings.get('reflected_temp')
    if reflected is not None:
        reflected = (reflected - 32) / 1.8 if unit == 'F' else reflected - KELVIN if unit == 'K' else reflected
    if reflected is None:
        reflected = (conversions.results(task, cid).get('normalization') or {}).get('reflected_c')
    if emissivity is None or reflected is None:
        rows = []
        for tab in ('as_converted', 'harmonized'):
            found = mosaics.tab_raster(task, cid, tab)
            if found:
                rows = [f.get('measurement') or {} for f in mosaics.sidecar(found[0])[0].get('frames') or []]
                break
        if emissivity is None:
            emissivity = _median(r.get('emissivity') for r in rows)
        if reflected is None:
            reflected = _median(r.get('reflection') for r in rows)
    return None if emissivity is None or reflected is None else (float(emissivity), float(reflected))
