// Hidden travel inside a filled shape. When the fill generator finishes one
// section and the next begins somewhere else, the machine would otherwise tie
// off, trim and jump. Here we route a running stitch through the inside of the
// shape instead (it ends up under, or sunk into, the fill of the same colour),
// so a tufted or branching shape sews as one unbroken thread.
import { dist, pointInContours, resample, contoursBBox } from "./geometry.js";

export function linkSubpaths(subs, contours, { occluders = [], cell = 0.5, inset = 0.35, maxTravel = 90 } = {}) {
  subs = subs.filter((s) => s && s.length);
  if (subs.length < 2) return subs;
  const bb = contoursBBox(contours), W = Math.ceil(bb.w / cell) + 3, H = Math.ceil(bb.h / cell) + 3;
  if (W * H > 250000) return subs;
  const X = (i) => bb.minX + (i - 1) * cell, Y = (j) => bb.minY + (j - 1) * cell;
  // grid values: 0 outside, 1 inside but under a covering shape, 2 inside and open
  let grid = null, level = 1;
  // how much thread already lies in each cell; dense = finished top stitching
  const sewn = new Uint16Array(W * H);
  const lay = (pts) => { for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], n = Math.max(1, Math.ceil(dist(a, b) / (cell * 0.7)));
    for (let q = 0; q <= n; q++) { const i = Math.round((a.x + (b.x - a.x) * q / n - bb.minX) / cell) + 1, j = Math.round((a.y + (b.y - a.y) * q / n - bb.minY) / cell) + 1; if (i >= 0 && j >= 0 && i < W && j < H) sewn[j * W + i]++; } } };
  let cov = new Uint8Array(W * H), costly = false;
  const survey = () => { for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const c = j * W + i;
    cov[c] = sewn[c - W - 1] + sewn[c - W] + sewn[c - W + 1] + sewn[c - 1] + sewn[c] + sewn[c + 1] + sewn[c + W - 1] + sewn[c + W] + sewn[c + W + 1] >= 14 ? 1 : 0; } };
  const covered = (c) => costly && cov[c] === 1;
  const build = () => {
    grid = new Uint8Array(W * H);
    const off = [[0, 0], [inset, 0], [-inset, 0], [0, inset], [0, -inset]];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let ok = 1;
      for (const [dx, dy] of off) if (!pointInContours({ x: X(i) + dx, y: Y(j) + dy }, contours)) { ok = 0; break; }
      if (ok && !occluders.some((reg) => pointInContours({ x: X(i), y: Y(j) }, reg))) ok = 2;
      grid[j * W + i] = ok;
    }
  };
  const nearest = (p) => {
    const ci = Math.round((p.x - bb.minX) / cell) + 1, cj = Math.round((p.y - bb.minY) / cell) + 1;
    let best = -1, bd = Infinity;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H || grid[j * W + i] < level) continue;
      const d = (X(i) - p.x) ** 2 + (Y(j) - p.y) ** 2;
      if (d < bd) { bd = d; best = j * W + i; }
    }
    return best;
  };
  const clear = (a, b) => {
    const n = Math.max(1, Math.ceil(dist(a, b) / (cell * 0.5)));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
      const i = Math.round((x - bb.minX) / cell) + 1, j = Math.round((y - bb.minY) / cell) + 1;
      if (i < 0 || j < 0 || i >= W || j >= H || grid[j * W + i] < level) return false;
    }
    return true;
  };
  // First try to stay clear of shapes stacked on top (keeps the overlap flat);
  // if the shape is cut in two by one, pass underneath it.
  // a shortcut must not drag the run back over finished fill
  const open = (a, b) => { const n = Math.max(1, Math.ceil(dist(a, b) / cell)); for (let k = 0; k <= n; k++) { const i = Math.round((a.x + (b.x - a.x) * k / n - bb.minX) / cell) + 1, j = Math.round((a.y + (b.y - a.y) * k / n - bb.minY) / cell) + 1; if (covered(j * W + i)) return false; } return true; };
  const route = (a, b, avoidCovered, useCost) => {
    if (!grid) build();
    level = avoidCovered ? 2 : 1; costly = useCost;
    const s = nearest(a), t = nearest(b);
    if (s < 0 || t < 0) return null;
    // Cheapest path, where crossing already-filled cloth costs far more than
    // crossing cloth that later stitching will cover (Dijkstra, binary heap).
    const prev = new Int32Array(W * H).fill(-1), cost = new Float64Array(W * H).fill(Infinity), heap = [[0, s]];
    cost[s] = 0; prev[s] = s;
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } }
      return top;
    };
    const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const up = (i - 1) >> 1; if (heap[up][0] <= heap[i][0]) break; [heap[up], heap[i]] = [heap[i], heap[up]]; i = up; } };
    while (heap.length) {
      const [d, c] = pop(); if (c === t) break; if (d > cost[c]) continue;
      const ci = c % W, cj = (c / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj, n = j * W + i;
        if (!(di || dj) || i < 0 || j < 0 || i >= W || j >= H || grid[n] < level) continue;
        const nd = d + (di && dj ? 1.414 : 1) * (covered(n) ? 5 : 1);
        if (nd < cost[n]) { cost[n] = nd; prev[n] = c; push([nd, n]); }
      }
    }
    if (prev[t] < 0) return null;
    const cells = []; for (let c = t; c !== s; c = prev[c]) cells.push(c); cells.push(s); cells.reverse();
    const pts = cells.map((c) => ({ x: X(c % W), y: Y((c / W) | 0) }));
    // pull the staircase path taut wherever a straight run stays inside
    const taut = [pts[0]]; let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = Math.min(pts.length - 1, k + 40); m > k + 1; m--) if (clear(pts[k], pts[m]) && open(pts[k], pts[m])) { far = m; break; }
      taut.push(pts[far]); k = far;
    }
    let length = 0; for (let i = 1; i < taut.length; i++) length += dist(taut[i - 1], taut[i]);
    return length > maxTravel ? null : resample(taut, 2);
  };
  // Sub-paths keep their identity; a routed travel is appended to the one before,
  // so the compiler sees a join it can sew straight across without a trim.
  const out = [subs[0]]; lay(subs[0]);
  for (let n = 1; n < subs.length; n++) {
    const A = out[out.length - 1]; let B = subs[n]; const gap = dist(A[A.length - 1], B[0]);
    const needs = B._trimBefore || gap > 3.0;
    let path = null;
    if (needs) { survey(); const a = A[A.length - 1], b = B[0]; path = route(a, b, true, true) || route(a, b, true, false) || route(a, b, false, true) || route(a, b, false, false); }
    if (path) { const joined = [...A, ...path]; if (A._trimBefore) joined._trimBefore = true; out[out.length - 1] = joined; B = B.slice(); }
    out.push(B); lay(B);
  }
  return out;
}
