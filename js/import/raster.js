// Raster logo import: turn a PNG/JPG logo into embroidery-ready vector regions.
//
// Pipeline (all pure functions on {width, height, data} ImageData-likes, so the
// whole thing is unit-testable in Node):
//   1. background detection — transparency if present, else corner voting
//   2. color quantization — median cut to ≤ maxColors, tiny/similar clusters
//      merged (absorbs anti-aliasing halos)
//   3. despeckle — 3×3 majority filter + minimum region area
//   4. per color: boundary tracing (pixel-edge walking, holes included)
//   5. simplify — corner-preserving RDP + one Chaikin pass (kills staircase)
//   6. normalize to the shared [0,1] base-contour space used by SVG import,
//      fitted ~80% into the hoop
//
// Returns { items: [{ base, color }], box } — the same shape parseSVG returns,
// so the app instantiates both through one path.

import { colorDistance } from "../threads.js";

// ---------------------------------------------------------------- background
// Returns a Uint8Array mask: 1 = foreground, 0 = background.
function foregroundMask(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const mask = new Uint8Array(n);

  // transparency wins if the image actually uses it
  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;
  if (transparent > n * 0.02) {
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return mask;
  }

  // corner voting: average a 3×3 patch in each corner; if ≥3 agree, that color
  // is the canvas/background (the classic white logo card)
  const patch = (cx, cy) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = cy; y < cy + 3 && y < h; y++) for (let x = cx; x < cx + 3 && x < w; x++) {
      const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
    }
    return [r / c, g / c, b / c];
  };
  const corners = [patch(0, 0), patch(w - 3, 0), patch(0, h - 3), patch(w - 3, h - 3)];
  const TOL = 2400; // compuphase distance — perceptually "same color"
  let bg = null;
  for (let i = 0; i < 4 && !bg; i++) {
    let agree = 0;
    for (let j = 0; j < 4; j++) if (colorDistance(corners[i], corners[j]) < TOL) agree++;
    if (agree >= 3) bg = corners[i];
  }
  if (!bg) { mask.fill(1); return mask; } // logo fills the frame — keep all

  for (let i = 0; i < n; i++) {
    const p = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    mask[i] = colorDistance(p, bg) < TOL ? 0 : 1;
  }
  return mask;
}

// ---------------------------------------------------------------- quantize
// Median-cut the foreground pixels to ≤ maxColors clusters, then merge clusters
// that are perceptually close or too small to stitch. Returns { assign, colors }
// where assign[i] = cluster index (or -1 for background).
function quantize(img, mask, maxColors) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const idxs = [];
  for (let i = 0; i < n; i++) if (mask[i]) idxs.push(i);
  if (!idxs.length) return { assign: new Int16Array(n).fill(-1), colors: [] };

  // median cut
  let boxes = [idxs];
  while (boxes.length < maxColors) {
    // split the box with the largest channel spread
    let bi = -1, bch = 0, bspread = 12; // require some spread to split
    for (let k = 0; k < boxes.length; k++) {
      const bx = boxes[k];
      if (bx.length < 64) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const i of bx) { const v = data[i * 4 + ch]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > bspread) { bspread = hi - lo; bi = k; bch = ch; }
      }
    }
    if (bi < 0) break;
    const bx = boxes[bi];
    bx.sort((a, b) => data[a * 4 + bch] - data[b * 4 + bch]);
    const mid = bx.length >> 1;
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }

  const centroid = (bx) => {
    let r = 0, g = 0, b = 0;
    for (const i of bx) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; }
    return [Math.round(r / bx.length), Math.round(g / bx.length), Math.round(b / bx.length)];
  };
  let clusters = boxes.filter((b) => b.length).map((bx) => ({ px: bx.length, rgb: centroid(bx) }));

  // merge perceptually-close clusters (anti-alias blends), then absorb dust
  const MERGE = 2100;
  for (;;) {
    let a = -1, b = -1, best = MERGE;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const d = colorDistance(clusters[i].rgb, clusters[j].rgb);
      if (d < best) { best = d; a = i; b = j; }
    }
    if (a < 0) break;
    const A = clusters[a], B = clusters[b];
    const t = A.px + B.px;
    A.rgb = [0, 1, 2].map((c) => Math.round((A.rgb[c] * A.px + B.rgb[c] * B.px) / t));
    A.px = t;
    clusters.splice(b, 1);
  }
  const minPx = Math.max(24, idxs.length * 0.008); // < 0.8% of foreground = halo dust
  clusters = clusters.filter((c) => c.px >= minPx);
  if (!clusters.length) clusters = [{ px: idxs.length, rgb: centroid(idxs) }];

  // assign every foreground pixel to its nearest surviving cluster
  const assign = new Int16Array(n).fill(-1);
  for (const i of idxs) {
    const p = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    let bi = 0, bd = Infinity;
    for (let k = 0; k < clusters.length; k++) {
      const d = colorDistance(p, clusters[k].rgb);
      if (d < bd) { bd = d; bi = k; }
    }
    assign[i] = bi;
  }
  return { assign, colors: clusters.map((c) => c.rgb) };
}

// 3×3 majority filter over cluster assignments — one pass eats single-pixel
// speckle and smooths ragged anti-aliased edges without moving real boundaries.
function majority(assign, w, h, passes = 2) {
  let cur = assign;
  for (let p = 0; p < passes; p++) {
    const out = new Int16Array(cur);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const counts = new Map();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const v = cur[i + dy * w + dx];
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        let bv = cur[i], bc = 0;
        for (const [v, c] of counts) if (c > bc) { bc = c; bv = v; }
        if (bc >= 5) out[i] = bv;
      }
    }
    cur = out;
  }
  return cur;
}

// Remove connected components of a binary mask smaller than minPx (4-connected).
function dropSmallComponents(bin, w, h, minPx) {
  const seen = new Uint8Array(bin.length);
  const stack = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || seen[s]) continue;
    stack.length = 0; stack.push(s); seen[s] = 1;
    const comp = [s];
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && bin[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); comp.push(i - 1); }
      if (x < w - 1 && bin[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); comp.push(i + 1); }
      if (y > 0 && bin[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); comp.push(i - w); }
      if (y < h - 1 && bin[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); comp.push(i + w); }
    }
    if (comp.length < minPx) for (const i of comp) bin[i] = 0;
  }
}

// ------------------------------------------------------------ boundary trace
// Walk the exposed pixel edges of a binary mask into closed loops (outer
// boundaries and holes alike). Edges are oriented with the filled pixel on
// their left, so loops always close; at pinch points we prefer the tightest
// right turn, which keeps loops simple.
function traceLoops(bin, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x]) ? 1 : 0;
  // directed edges keyed by start vertex "x,y"
  const edges = new Map();
  const addEdge = (x0, y0, x1, y1) => {
    const k = x0 + "," + y0;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ x0, y0, x1, y1, used: false });
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge(x, y, x + 1, y);         // top → right
      if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // right → down
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bottom → left
      if (!at(x - 1, y)) addEdge(x, y + 1, x, y);         // left → up
    }
  }
  const loops = [];
  for (const list of edges.values()) {
    for (const e0 of list) {
      if (e0.used) continue;
      const loop = [];
      let e = e0;
      let guard = 0;
      while (!e.used && guard++ < 500000) {
        e.used = true;
        loop.push({ x: e.x0, y: e.y0 });
        const cands = edges.get(e.x1 + "," + e.y1) || [];
        // prefer the sharpest right turn relative to incoming direction
        const inDx = e.x1 - e.x0, inDy = e.y1 - e.y0;
        let next = null, bestTurn = -Infinity;
        for (const c of cands) {
          if (c.used) continue;
          const cross = inDx * (c.y1 - c.y0) - inDy * (c.x1 - c.x0);
          const dot = inDx * (c.x1 - c.x0) + inDy * (c.y1 - c.y0);
          const turn = Math.atan2(cross, dot); // right turn = positive (y down)
          if (turn > bestTurn) { bestTurn = turn; next = c; }
        }
        if (!next) break;
        e = next;
        if (e === e0) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

// ------------------------------------------------------------ simplification
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    let worst = -1, wd = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const d = L < 1e-9
        ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
        : Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0 && wd > eps) { keep[worst] = true; stack.push([i0, worst], [worst, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// One Chaikin corner-cutting pass (closed loop) — softens the residual pixel
// staircase into gentle curves without shrinking features meaningfully.
function chaikin(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

function loopArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(a / 2);
}

// ------------------------------------------------------------------- main
// img: {width, height, data(Uint8ClampedArray RGBA)}; hoop: {w, h} in mm.
// opts.maxColors (default 6).
export function traceRaster(img, hoop, opts = {}) {
  const { width: w, height: h } = img;
  if (!w || !h) throw new Error("empty image");
  const maxColors = Math.max(1, Math.min(8, opts.maxColors ?? 6));

  const mask = foregroundMask(img);
  const { assign: rawAssign, colors } = quantize(img, mask, maxColors);
  if (!colors.length) throw new Error("no foreground found — is the logo blank?");
  const assign = majority(rawAssign, w, h);

  // Refine each cluster's color from INTERIOR pixels only (all 4 neighbors in
  // the same cluster). Edge pixels are anti-aliased blends with the background
  // and neighbors — including them muddies the thread color noticeably.
  {
    const sum = colors.map(() => [0, 0, 0, 0]);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, k = assign[i];
        if (k < 0) continue;
        if (assign[i - 1] === k && assign[i + 1] === k && assign[i - w] === k && assign[i + w] === k) {
          const s = sum[k];
          s[0] += img.data[i * 4]; s[1] += img.data[i * 4 + 1]; s[2] += img.data[i * 4 + 2]; s[3]++;
        }
      }
    }
    for (let k = 0; k < colors.length; k++) {
      if (sum[k][3] > 16) {
        colors[k] = [0, 1, 2].map((c) => Math.round(sum[k][c] / sum[k][3]));
      }
    }
  }

  // real-world scale: how many mm one pixel will cover after the hoop fit
  const targetMm = Math.min(hoop.w, hoop.h) * 0.8;
  const mmPerPx = targetMm / Math.max(w, h);
  const minRegionPx = Math.max(6, Math.round(2.0 / (mmPerPx * mmPerPx)));   // ≥2mm²
  const minLoopAreaPx = Math.max(4, 1.2 / (mmPerPx * mmPerPx));             // holes ≥1.2mm²

  const rawItems = [];
  for (let k = 0; k < colors.length; k++) {
    const bin = new Uint8Array(w * h);
    let px = 0;
    for (let i = 0; i < bin.length; i++) if (assign[i] === k) { bin[i] = 1; px++; }
    if (!px) continue;
    dropSmallComponents(bin, w, h, minRegionPx);
    let loops = traceLoops(bin, w, h);
    loops = loops
      .map((L) => rdp([...L, L[0]], 0.8).slice(0, -1))
      .map(chaikin)
      .map((L) => rdp([...L, L[0]], 0.3).slice(0, -1))
      .filter((L) => L.length >= 3 && loopArea(L) >= minLoopAreaPx);
    if (!loops.length) continue;
    const hex = "#" + colors[k].map((c) => c.toString(16).padStart(2, "0")).join("");
    rawItems.push({ loops, color: hex, px });
  }
  if (!rawItems.length) throw new Error("nothing traceable at stitch size — try a larger/cleaner logo");

  // shared bbox across every loop → the normalized base space
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of rawItems) for (const L of it.loops) for (const p of L) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
  const sc = targetMm / Math.max(bw, bh);
  const tw = bw * sc, th = bh * sc;
  const box = { x: (hoop.w - tw) / 2, y: (hoop.h - th) / 2, w: tw, h: th };

  // largest coverage first → stitched first → details land on top
  rawItems.sort((a, b) => b.px - a.px);
  const items = rawItems.map((it) => ({
    base: it.loops.map((L) => L.map((p) => ({ x: (p.x - minX) / bw, y: (p.y - minY) / bh }))),
    color: it.color,
  }));
  return { items, box };
}

// Working-resolution cap for the app side. 512px on the long side keeps
// tracing fast while giving contours ~4× the detail of the old 280px cap —
// at an 80mm stitch-out that's ~0.16mm per pixel, finer than thread itself,
// so curves come out smooth instead of chunky.
export const RASTER_MAX_DIM = 512;
