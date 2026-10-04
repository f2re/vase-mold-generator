"""Maximum radial chord deviation of new circular features, in millimetres.
Input STL facets are immutable: tessellation cannot reconstruct lost curvature.
"""
import math
from .stl import ModelError
PRESETS = {'draft': 0.10, 'standard': 0.03, 'fine': 0.01}

def tolerance(p):
    detail = p.get('detail', 'standard')
    if not isinstance(detail, str) or detail not in (*PRESETS, 'custom'):
        raise ModelError('Неизвестный уровень детализации.')
    custom = p.get('chordTolerance', 0.03)
    if isinstance(custom, bool) or not isinstance(custom, (int,float)) or not math.isfinite(custom) or not .005 <= custom <= .2:
        raise ModelError('Отклонение дуги: допустимо 0,005–0,2 мм.')
    return PRESETS.get(detail, custom)

def segments(radius, error):
    if not math.isfinite(radius) or radius <= 0 or not math.isfinite(error) or error <= 0:
        raise ModelError('Некорректные параметры аппроксимации.')
    n = max(32, math.ceil(math.pi / math.acos(max(-1, 1-error/radius))))
    n = math.ceil(n/8)*8
    if n > 4096:
        raise ModelError('Слишком высокая детализация для данного радиуса.')
    return n

def report(p):
    error = tolerance(p)
    offset_radius = p['clearance'] + p['wall'] + 3
    channel_radius = max(p['sprueDiameter']*.775, p['ventDiameter']/2, p['keyDiameter']/2+p['keyClearance'])
    radii = {'offset': offset_radius, 'channels': channel_radius}
    return dict(detail=p['detail'], chordToleranceMm=error,
                features={name: {'segments': segments(r, error), 'radiusMm': r,
                                 'maxDeviationMm': r*(1-math.cos(math.pi/segments(r, error)))} for name,r in radii.items()},
                sourcePreserved=True)
