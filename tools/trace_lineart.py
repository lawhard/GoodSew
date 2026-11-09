#!/usr/bin/env python3
"""Trace black-on-white line art into Good Sew assistant commands.

Every stroke becomes a paired-rail satin column: its centre line comes from the
stroke's skeleton and its width from the distance to the stroke's edge, so
tapers survive. Solid shapes (eyes, a nose) become filled regions and keep
their white highlights as holes. Strokes are ordered nearest-neighbour so the
jumps between them stay short.

usage: trace_lineart.py art.png out.json [--width 86] [--name "Timi"]
"""
import sys, json, math, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, remove_small_holes
from skimage.measure import label, find_contours, approximate_polygon

ap = argparse.ArgumentParser()
ap.add_argument('art'); ap.add_argument('out')
ap.add_argument('--width', type=float, default=86.0, help='finished width of the inked area, mm')
ap.add_argument('--name', default='Traced line art')
ap.add_argument('--min-stroke', type=float, default=2.2, help='drop strokes shorter than this, mm')
ap.add_argument('--blob', type=float, default=3.0, help='shapes wider than this (mm) are filled, not stroked')
ap.add_argument('--min-width', type=float, default=0.75)
ap.add_argument('--min-highlight', type=float, default=0.8, help='fill in highlights narrower than this, mm')
ap.add_argument('--open', type=float, default=0.18, help='grow small highlights by this much, mm')
ap.add_argument('--max-width', type=float, default=2.6)
a = ap.parse_args()

g = np.asarray(Image.open(a.art).convert('L')).astype(float)
ink = g < 140
ys, xs = np.nonzero(ink)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
S = a.width / (x1 - x0 + 1)                     # mm per pixel
H = (y1 - y0 + 1) * S
ox, oy = 50 - a.width / 2, 50 - H / 2            # centre in the 100 mm field
mm = lambda px, py: (round(ox + (px - x0) * S, 2), round(oy + (py - y0) * S, 2))

lab, n = label(ink, connectivity=2, return_num=True)
dt = ndi.distance_transform_edt(ink)
strokes, blobs = [], []

def longest_path(sk):
    """Longest geodesic through a skeleton mask (double breadth-first search)."""
    pts = list(zip(*np.nonzero(sk)))
    if len(pts) < 2: return []
    idx = {p: i for i, p in enumerate(pts)}
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

for k in range(1, n + 1):
    comp = lab == k
    area = comp.sum() * S * S
    if area < 0.5: continue
    wmax = dt[comp].max() * 2 * S
    if wmax > a.blob:
        # solid shape: outline plus white highlights as holes. A highlight too thin
        # to stay open once thread spreads is filled in; small ones are opened up.
        sl = ndi.find_objects(comp.astype(int))[0]
        pad = np.pad(comp[sl], 3)
        filled = ndi.binary_fill_holes(pad)
        holes, hn = label(filled & ~pad, connectivity=1, return_num=True)
        keep = np.zeros_like(pad)
        for h in range(1, hn + 1):
            hm = holes == h
            if ndi.distance_transform_edt(hm).max() * 2 * S < a.min_highlight: continue
            keep |= ndi.binary_dilation(hm, iterations=max(1, int(round(a.open / S)))) if hm.sum() * S * S < 4 else hm
        mask = filled & ~keep
        cs = sorted(find_contours(mask.astype(float), 0.5), key=len, reverse=True)
        polys = []
        for c in cs:
            c = approximate_polygon(c, 0.1 / S)
            if len(c) < 6: continue
            polys.append([mm(px + sl[1].start - 3, py + sl[0].start - 3) for py, px in c[:-1]])
        if polys: blobs.append(polys)
        continue
    sk = skeletonize(comp)
    while True:
        path = longest_path(sk)
        if len(path) * S < a.min_stroke * 0.7: break
        arr = np.array(path, float)                      # (y, x) pixels
        seg = np.hypot(*np.diff(arr, axis=0).T); arc = np.concatenate([[0], np.cumsum(seg)])
        half = np.array([dt[int(p[0]), int(p[1])] for p in arr])
        # extend both ends to the real tip of the stroke (the skeleton stops short)
        def tip(i, j):
            d = arr[i] - arr[j]; L = np.hypot(*d) or 1
            return arr[i] + d / L * half[i] * 0.85
        step = max(3, int(round(1.1 / S)))
        ids = list(range(0, len(arr), step))
        if ids[-1] != len(arr) - 1: ids.append(len(arr) - 1)
        w = ndi.uniform_filter1d(half, size=max(3, step // 2), mode='nearest') * 2 * S
        pts = [mm(arr[i][1], arr[i][0]) for i in ids]; ws = [float(w[i]) for i in ids]
        j0, j1 = min(len(arr) - 1, step), max(0, len(arr) - 1 - step)
        a0, a1 = tip(0, j0), tip(len(arr) - 1, j1)
        pts = [mm(a0[1], a0[0])] + pts + [mm(a1[1], a1[0])]
        ws = [min(ws[0] * .5, .5)] + ws + [min(ws[-1] * .5, .5)]
        length = arc[-1] * S + (half[0] + half[-1]) * .85 * S
        if length >= a.min_stroke:
            ws = [round(min(a.max_width, max(.4 if i in (0, len(ws) - 1) else .55 if i in (1, len(ws) - 2) else a.min_width, v)), 2) for i, v in enumerate(ws)]
            strokes.append({'pts': pts, 'w': ws})
        # remove this path (and a collar around it) and look for side branches
        rm = np.zeros_like(sk); 
        for p in path: rm[p] = True
        sk = sk & ~ndi.binary_dilation(rm, iterations=max(1, int(np.median(half))))

# nearest-neighbour ordering, reversing strokes when their far end is closer
todo = strokes[:]; order = []; cur = (0.0, 0.0)
while todo:
    best = min(range(len(todo)), key=lambda i: min(math.dist(cur, todo[i]['pts'][0]), math.dist(cur, todo[i]['pts'][-1])))
    s = todo.pop(best)
    if math.dist(cur, s['pts'][-1]) < math.dist(cur, s['pts'][0]): s = {'pts': s['pts'][::-1], 'w': s['w'][::-1]}
    order.append(s); cur = s['pts'][-1]

INK = '#0b0b0b'; ops = []
for i, s in enumerate(order):
    ops.append({'op': 'add_satin', 'name': f'Stroke {i + 1}', 'color': INK, 'smooth': True,
                'spine': [{'x': x, 'y': y} for x, y in s['pts']], 'width': s['w'],
                'params': {'density': .4, 'pull': .05, 'underlay': True}})
for i, polys in enumerate(blobs):
    ops.append({'op': 'add_region', 'name': f'Solid {i + 1}', 'color': INK,
                'points': [{'x': x, 'y': y} for x, y in polys[0]],
                **({'holes': [[{'x': x, 'y': y} for x, y in h] for h in polys[1:]]} if len(polys) > 1 else {}),
                'params': {'spacing': .38, 'angle': 90, 'stitchType': 'auto'}})
json.dump({'name': a.name, 'mmPerPixel': S, 'strokes': len(order), 'solids': len(blobs), 'operations': ops}, open(a.out, 'w'))
print(f'{len(order)} strokes, {len(blobs)} solid shapes, {a.width:.0f} x {H:.1f} mm, {S:.4f} mm/px')
