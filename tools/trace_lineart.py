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
ap.add_argument('--overlap', type=float, default=0.7, help='how far a fill runs under darker colours, mm')
ap.add_argument('--ground-tolerance', type=float, default=60, help='colour distance still counted as fabric')
ap.add_argument('--min-area', type=float, default=3.0, help='drop coloured fills smaller than this, mm2')
a = ap.parse_args()

rgb = np.asarray(Image.open(a.art).convert('RGB')).astype(float)
lum = rgb @ np.array([.299, .587, .114])
sat = rgb.max(axis=2) - rgb.min(axis=2)
# the ground (fabric) is whatever colour the corners are: white paper, or a
# coloured cloth when white is one of the threads
corner = np.median(np.concatenate([rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3), rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3)]), axis=0)
white_ground = corner.min() > 200
ground = ((lum > 200) & (sat < 40)) if white_ground else (np.sqrt(((rgb - corner) ** 2).sum(axis=2)) < a.ground_tolerance)
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
    # Seed the clusters from flat interior colour only. Anti-aliased rims are
    # blends of two threads and would otherwise steal a cluster from a real one.
    flat = ~ground
    for dy, dx in ((0, 3), (3, 0), (0, -3), (-3, 0)):
        flat &= np.abs(rgb - np.roll(rgb, (dy, dx), axis=(0, 1))).max(axis=2) < 14
    data = rgb[flat]
    bins, counts = np.unique((data // 24).astype(int), axis=0, return_counts=True)
    seeds = []
    for i in np.argsort(-counts):
        c = bins[i] * 24 + 12
        if counts[i] < len(data) * 0.002: break
        if all(np.sqrt(((c - q) ** 2).sum()) > 55 for q in seeds): seeds.append(c.astype(float))
        if len(seeds) == a.colors: break
    if len(seeds) < a.colors: raise SystemExit(f'found only {len(seeds)} flat colours; lower --colors')
    cent, _ = kmeans2(data[::5], np.array(seeds), minit='matrix')
    cent = cent[np.argsort(-(cent @ np.array([.299, .587, .114])))]          # light → dark
    d = ((rgb[:, :, None, :] - cent[None, None]) ** 2).sum(axis=3)
    cls = d.argmin(axis=2); cls[ground] = -1
    dark = a.colors - 1
    # anti-aliased rims between black and white read as a mid colour: a coloured
    # area must survive a small opening, otherwise its pixels go back to black/white
    lost = np.zeros(cls.shape, bool)
    for k in range(a.colors - 1):
        m = cls == k
        lost |= m & ~ndi.binary_opening(m, iterations=px_of(0.22))
    # hand each lost pixel to the nearest surviving neighbour (thread or fabric)
    idx = ndi.distance_transform_edt(lost, return_distances=False, return_indices=True)
    cls = cls[idx[0], idx[1]]
    classes = [cls == k for k in range(a.colors)]
    hexes = ['#%02x%02x%02x' % tuple(int(round(v)) for v in c) for c in cent]
    if cent[dark] @ np.array([.299, .587, .114]) < 45: hexes[dark] = '#0b0b0b'
    if cent[0].min() > 225: hexes[0] = '#fbfaf5'
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

def solid(comp, keep_holes=True):
    """Outline plus highlights. A highlight too thin to stay open once thread
    spreads is filled in; small ones are opened up a little."""
    sl = ndi.find_objects(comp.astype(int))[0]
    pad = np.pad(comp[sl], 3)
    filled = ndi.binary_fill_holes(pad)
    holes, hn = label(filled & ~pad, connectivity=1, return_num=True)
    keep = np.zeros_like(pad)
    for h in range(1, hn + 1):
        hm = holes == h
        if not keep_holes or ndi.distance_transform_edt(hm).max() * 2 * S < a.min_highlight: continue
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
ops = []; summary = []; highlights = []
# On coloured cloth a highlight cannot be bare fabric: the darkest solids are
# sewn whole and their highlights go on top, last, in the lightest thread.
top_highlights = not white_ground and len(classes) > 1
if top_highlights:
    darkmask = classes[-1]
    hl, hn = label(ndi.binary_fill_holes(darkmask) & ~darkmask, connectivity=2, return_num=True)
    for h in range(1, hn + 1):
        yy, xx = np.nonzero(hl == h)
        if len(yy) * S * S < 0.4 or len(yy) * S * S > 14: continue
        pts = np.stack([xx, yy], 1).astype(float); c = pts.mean(0)
        vals, vecs = np.linalg.eigh(np.cov((pts - c).T))
        major = vecs[:, 1]; L = max(1.5 / S, 3.4 * math.sqrt(vals[1])); Wd = min(2.4, max(1.0, 3.4 * math.sqrt(max(vals[0], 0)) * S))
        highlights.append({'pts': [mm(*(c - major * L / 2)), mm(*c), mm(*(c + major * L / 2))], 'w': [round(Wd * .6, 2), round(Wd, 2), round(Wd * .6, 2)]})
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
            polys = solid(comp, keep_holes=not (top_highlights and darkest))
            if polys: solids.append(polys)
        else: strokes += strokes_of(comp, dt)
    for i, polys in enumerate(solids):
        ops.append({'op': 'add_region', 'name': f'{color} fill {i + 1}', 'color': color, 'points': P(polys[0]),
                    **({'holes': [P(h) for h in polys[1:]]} if len(polys) > 1 else {}),
                    'params': {'spacing': .38 if darkest else .36 if (k == 0 and not white_ground) else .42, 'angle': 90 if darkest else (35 + 70 * k) % 180, 'stitchType': 'auto'}})
    for i, s in enumerate(ordered(strokes)):
        if s['mean'] < a.hairline:
            ops.append({'op': 'add_running', 'name': f'{color} line {i + 1}', 'color': color, 'points': P(s['pts']),
                        'params': {'stitchLength': 2, 'returnPass': True, 'curveTolerance': .15}})
        else:
            ops.append({'op': 'add_satin', 'name': f'{color} stroke {i + 1}', 'color': color, 'smooth': True,
                        'spine': P(s['pts']), 'width': s['w'], 'params': {'density': .4, 'pull': .05, 'underlay': True}})
    summary.append(f'{color}: {len(solids)} fills, {len(strokes)} strokes')
for i, h in enumerate(highlights):
    ops.append({'op': 'add_satin', 'name': f'Highlight {i + 1}', 'color': hexes[0], 'spine': P(h['pts']), 'width': h['w'],
                'params': {'density': .38, 'pull': 0, 'underlay': False}})
if highlights: summary.append(f'{len(highlights)} highlights on top')
json.dump({'name': a.name, 'mmPerPixel': S, 'colors': hexes, 'fabric': '#ffffff' if white_ground else '#%02x%02x%02x' % tuple(int(v) for v in corner), 'operations': ops}, open(a.out, 'w'))
print(f'{a.width:.0f} x {H:.1f} mm, {S:.4f} mm/px | ' + ' | '.join(summary))
