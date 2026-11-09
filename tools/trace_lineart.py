#!/usr/bin/env python3
"""Trace flat-colour line art into Good Sew assistant commands.

Works on black-on-white drawings and on flat illustrations with a few colours.
Per colour: broad shapes become fills (tatami where wide, satin where narrow)
that keep any highlight big enough to stay open; strokes become paired-rail
satin columns whose centre line is the stroke's skeleton and whose width is
measured from the art, so tapers survive; hairlines become double running
stitch. Colours sew light to dark, fills before strokes, and strokes are
ordered nearest-neighbour so jumps stay short.

usage: trace_lineart.py art.png out.json [--colors 3] [--width 86] [--name "Timi"]
"""
import math, json, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.cluster.vq import kmeans2
from skimage.morphology import skeletonize
from skimage.measure import label, find_contours, approximate_polygon

ap = argparse.ArgumentParser()
ap.add_argument('art'); ap.add_argument('out')
ap.add_argument('--colors', type=int, default=1, help='thread colours in the art (not counting the white ground)')
ap.add_argument('--width', type=float, default=86.0, help='finished width of the inked area, mm')
ap.add_argument('--name', default='Traced line art')
ap.add_argument('--min-stroke', type=float, default=2.2, help='drop strokes shorter than this, mm')
ap.add_argument('--blob', type=float, default=3.0, help='shapes wider than this (mm) are filled, not stroked')
ap.add_argument('--min-width', type=float, default=0.75)
ap.add_argument('--max-width', type=float, default=2.6)
ap.add_argument('--hairline', type=float, default=0.6, help='strokes thinner than this (mm) become double running stitch')
ap.add_argument('--min-highlight', type=float, default=0.8, help='fill in highlights narrower than this, mm')
ap.add_argument('--open', type=float, default=0.3, help='grow small highlights by this much, mm')
ap.add_argument('--overlap', type=float, default=0.5, help='how far a fill runs under darker colours, mm')
ap.add_argument('--min-area', type=float, default=3.0, help='drop coloured fills smaller than this, mm2')
a = ap.parse_args()

rgb = np.asarray(Image.open(a.art).convert('RGB')).astype(float)
lum = rgb @ np.array([.299, .587, .114])
sat = rgb.max(axis=2) - rgb.min(axis=2)
ground = (lum > 200) & (sat < 40)
ys, xs = np.nonzero(~ground)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
S = a.width / (x1 - x0 + 1)                      # mm per pixel
H = (y1 - y0 + 1) * S
ox, oy = 50 - a.width / 2, 50 - H / 2            # centre in the 100 mm field
mm = lambda px, py: (round(ox + (px - x0) * S, 2), round(oy + (py - y0) * S, 2))
px_of = lambda v: max(1, int(round(v / S)))

# ── separate the thread colours ──
if a.colors == 1:
    classes = [(lum < 140) & ~ground]; hexes = ['#0b0b0b']
else:
    data = rgb[~ground]
    np.random.seed(7)
    cent, _ = kmeans2(data[::7], a.colors, minit='++', seed=7)
    cent = cent[np.argsort(-(cent @ np.array([.299, .587, .114])))]          # light → dark
    d = ((rgb[:, :, None, :] - cent[None, None]) ** 2).sum(axis=3)
    cls = d.argmin(axis=2); cls[ground] = -1
    dark = a.colors - 1
    # anti-aliased rims between black and white read as a mid colour: a coloured
    # area must survive a small opening, otherwise its pixels go back to black/white
    for k in range(a.colors - 1):
        m = cls == k
        keep = ndi.binary_opening(m, iterations=px_of(0.22))
        lost = m & ~keep
        cls[lost & (lum < 120)] = dark; cls[lost & (lum >= 120)] = -1
    classes = [cls == k for k in range(a.colors)]
    hexes = ['#%02x%02x%02x' % tuple(int(round(v)) for v in c) for c in cent]
    if cent[dark] @ np.array([.299, .587, .114]) < 45: hexes[dark] = '#0b0b0b'
    # a lighter fill runs a little way under the darker colours next to it
    for k in range(a.colors - 1):
        darker = np.any(classes[k + 1:], axis=0)
        classes[k] = classes[k] | (ndi.binary_dilation(classes[k], iterations=px_of(a.overlap)) & darker)

def longest_path(sk):
    """Longest geodesic through a skeleton mask (double breadth-first search)."""
    pts = list(zip(*np.nonzero(sk)))
    if len(pts) < 2: return []
    idx = set(pts)
    def bfs(src):
        prev = {src: None}; q = [src]; last = src
        for p in q:
            last = p
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    r = (p[0] + dy, p[1] + dx)
                    if r in idx and r not in prev: prev[r] = p; q.append(r)
        return last, prev
    e1, _ = bfs(pts[0]); e2, prev = bfs(e1)
    path = []; p = e2
    while p is not None: path.append(p); p = prev[p]
    return path

def solid(comp):
    """Outline plus highlights. A highlight too thin to stay open once thread
    spreads is filled in; small ones are opened up a little."""
    sl = ndi.find_objects(comp.astype(int))[0]
    pad = np.pad(comp[sl], 3)
    filled = ndi.binary_fill_holes(pad)
    holes, hn = label(filled & ~pad, connectivity=1, return_num=True)
    keep = np.zeros_like(pad)
    for h in range(1, hn + 1):
        hm = holes == h
        if ndi.distance_transform_edt(hm).max() * 2 * S < a.min_highlight: continue
        keep |= ndi.binary_dilation(hm, iterations=px_of(a.open)) if hm.sum() * S * S < 4 else hm
    polys = []
    for c in sorted(find_contours((filled & ~keep).astype(float), 0.5), key=len, reverse=True):
        c = approximate_polygon(c, 0.12 / S)
        if len(c) < 6: continue
        polys.append([mm(px + sl[1].start - 3, py + sl[0].start - 3) for py, px in c[:-1]])
    return polys

def strokes_of(comp, dt):
    out = []; sk = skeletonize(comp)
    while True:
        path = longest_path(sk)
        if len(path) * S < a.min_stroke * 0.7: break
        arr = np.array(path, float)                      # (y, x) pixels
        arc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(arr, axis=0).T))])
        half = np.array([dt[int(p[0]), int(p[1])] for p in arr])
        def tip(i, j):                                   # the skeleton stops short of the real tip
            d = arr[i] - arr[j]; L = np.hypot(*d) or 1
            return arr[i] + d / L * half[i] * 0.85
        step = max(3, int(round(1.1 / S)))
        ids = list(range(0, len(arr), step))
        if ids[-1] != len(arr) - 1: ids.append(len(arr) - 1)
        w = ndi.uniform_filter1d(half, size=max(3, step // 2), mode='nearest') * 2 * S
        pts = [mm(arr[i][1], arr[i][0]) for i in ids]; ws = [float(w[i]) for i in ids]
        j0, j1 = min(len(arr) - 1, step), max(0, len(arr) - 1 - step)
        t0, t1 = tip(0, j0), tip(len(arr) - 1, j1)
        pts = [mm(t0[1], t0[0])] + pts + [mm(t1[1], t1[0])]
        mean = float(np.median(half) * 2 * S)
        ws = [min(ws[0] * .5, .5)] + ws + [min(ws[-1] * .5, .5)]
        if arc[-1] * S + (half[0] + half[-1]) * .85 * S >= a.min_stroke:
            ws = [round(min(a.max_width, max(.4 if i in (0, len(ws) - 1) else .55 if i in (1, len(ws) - 2) else a.min_width, v)), 2) for i, v in enumerate(ws)]
            out.append({'pts': pts, 'w': ws, 'mean': mean})
        rm = np.zeros_like(sk)
        for p in path: rm[p] = True
        sk = sk & ~ndi.binary_dilation(rm, iterations=max(1, int(np.median(half))))
    return out

def ordered(strokes):
    todo = strokes[:]; order = []; cur = (0.0, 0.0)
    while todo:
        best = min(range(len(todo)), key=lambda i: min(math.dist(cur, todo[i]['pts'][0]), math.dist(cur, todo[i]['pts'][-1])))
        s = todo.pop(best)
        if math.dist(cur, s['pts'][-1]) < math.dist(cur, s['pts'][0]): s = {**s, 'pts': s['pts'][::-1], 'w': s['w'][::-1]}
        order.append(s); cur = s['pts'][-1]
    return order

P = lambda pts: [{'x': x, 'y': y} for x, y in pts]
ops = []; summary = []
for k, mask in enumerate(classes):
    color = hexes[k]; darkest = k == len(classes) - 1
    lab, n = label(mask, connectivity=2, return_num=True)
    dt = ndi.distance_transform_edt(mask)
    strokes, solids = [], []
    for c in range(1, n + 1):
        comp = lab == c
        area = comp.sum() * S * S
        if area < 0.5: continue
        if dt[comp].max() * 2 * S > a.blob:
            if not darkest and area < a.min_area: continue
            polys = solid(comp)
            if polys: solids.append(polys)
        else: strokes += strokes_of(comp, dt)
    for i, polys in enumerate(solids):
        ops.append({'op': 'add_region', 'name': f'{color} fill {i + 1}', 'color': color, 'points': P(polys[0]),
                    **({'holes': [P(h) for h in polys[1:]]} if len(polys) > 1 else {}),
                    'params': {'spacing': .38 if darkest else .42, 'angle': 90 if darkest else (35 + 70 * k) % 180, 'stitchType': 'auto'}})
    for i, s in enumerate(ordered(strokes)):
        if s['mean'] < a.hairline:
            ops.append({'op': 'add_running', 'name': f'{color} line {i + 1}', 'color': color, 'points': P(s['pts']),
                        'params': {'stitchLength': 2, 'returnPass': True, 'curveTolerance': .15}})
        else:
            ops.append({'op': 'add_satin', 'name': f'{color} stroke {i + 1}', 'color': color, 'smooth': True,
                        'spine': P(s['pts']), 'width': s['w'], 'params': {'density': .4, 'pull': .05, 'underlay': True}})
    summary.append(f'{color}: {len(solids)} fills, {len(strokes)} strokes')
json.dump({'name': a.name, 'mmPerPixel': S, 'colors': hexes, 'operations': ops}, open(a.out, 'w'))
print(f'{a.width:.0f} x {H:.1f} mm, {S:.4f} mm/px | ' + ' | '.join(summary))
