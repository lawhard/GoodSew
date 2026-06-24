// Stitch generators. Each takes an object's geometry + params and returns an
// array of needle penetration points {x,y} in mm — the raw stitch path for that
// object, before jumps/trims/color-changes are woven in by the compiler.

import {
  resample, pathLength, sub, add, scale, norm, perp, dist, bbox,
  rotatePoint, sampleAt, contoursScanline, contoursBBox,
  segmentInContours, classifyHoles, offsetContourInward,
} from "./geometry.js";

// --- Running stitch: evenly spaced stitches along the polyline. ---
export function generateRunning(points, params) {
  if (points.length < 2) return [];
  const sl = Math.max(0.5, params.stitchLength || 2.5);
  let out = resample(points, sl);
  const repeats = Math.max(1, params.repeats || 1);
  if (repeats > 1) {
    const full = [];
    for (let r = 0; r < repeats; r++) {
      const seq = r % 2 === 0 ? out : out.slice().reverse();
      full.push(...(r === 0 ? seq : seq.slice(1)));
    }
    return full;
  }
  return out;
}

// --- Satin column: zig-zag between two rails offset from a center spine. ---
// The spine is the drawn polyline; width is the column width (mm).
export function generateSatin(points, params) {
  if (points.length < 2) return [];
  const width = Math.max(0.5, params.width || 4);
  const spacing = Math.max(0.2, params.density || 0.4);
  // Pull compensation: satin draws fabric inward as it sews, narrowing the
  // column. Widen each rail by `pull` mm to counteract it.
  const half = width / 2 + Math.max(0, params.pull || 0);
  const total = pathLength(points);
  const steps = Math.max(2, Math.round(total / spacing));
  const out = [];
  let side = 1;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * total;
    const { point, tangent } = sampleAt(points, s);
    const n = perp(tangent);
    out.push(add(point, scale(n, half * side)));
    side = -side;
  }
  return out;
}

// --- Tatami / fill: parallel rows of running stitch clipped to a region. ---
// Accepts one polygon (points) — wrapper around the multi-contour version.
export function generateFill(points, params) {
  if (points.length < 3) return [];
  return fillContours([points], params);
}

// Multi-contour tatami fill (even-odd rule, so inner contours become holes).
//
// Returns an ARRAY OF SUBPATHS (each an array of {x,y} points). The fill walks
// a CONNECTED-COMPONENT serpentine: scan rows are cut into spans (even-odd),
// vertically-adjacent spans that overlap in x are linked into connected
// components, and each component is traversed as ONE continuous subpath. Travel
// between consecutive spans therefore stays INSIDE the region (overlapping spans
// guarantee an interior connector), so concave folds (a heart's notch) are sewn
// without a jump across the fold. A NEW subpath (→ trim+jump by the compiler) is
// started only between genuinely DISCONNECTED components (separate islands, or
// across a counter/hole). Hole-aware via the even-odd scanline.
//
// Pull compensation: each span is inset inward from the region boundary by
// `params.inset` mm (default ~0.2mm) at both ends so rendered thread (~0.4mm
// wide) does not bleed over the outline or pinch shut thin apertures. Spans that
// become too short to stitch after the inset are dropped (the inset is skipped
// for a span only implicitly — short features just lose that row, never the
// whole feature).
export function fillContours(contours, params) {
  contours = contours.filter((c) => c.length >= 3);
  if (contours.length === 0) return [];
  const spacing = Math.max(0.25, params.spacing ?? 0.4);
  const stitchLen = Math.max(1, params.stitchLength ?? 3.0);
  const angle = ((params.angle || 0) * Math.PI) / 180;
  const inset = Math.max(0, params.inset ?? 0.2);
  // A span must keep at least this much length after the inset to be worth
  // stitching; below it, drop the span (preserves thin apertures rather than
  // bridging them, and avoids zero/negative-length spans).
  const minSpan = Math.max(0.3, inset);

  // Rotate region so fill rows are horizontal, scan, then rotate stitches back.
  const bb = contoursBBox(contours);
  const center = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const rot = contours.map((poly) => poly.map((p) => rotatePoint(p, center, -angle)));
  const rb = contoursBBox(rot);

  // rows[i] = array of spans; spans[k] = { x0, x1 } (x0 < x1, already inset).
  // rowYs[i] = scan y of rows[i]; rowIdxs[i] = its index in the full scan order
  // (used to detect non-adjacent rows so a row fully removed by inset breaks
  // vertical connectivity — the desired behavior at a pinch/thin aperture).
  const rows = [];
  const rowYs = [];
  let rowIndex = 0;
  const rowIdxs = [];
  for (let y = rb.minY + spacing / 2; y < rb.maxY; y += spacing) {
    const xs = contoursScanline(rot, y);
    const spans = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let x0 = xs[k], x1 = xs[k + 1];
      if (x1 - x0 <= 1e-6) continue;
      // Inset both ends; drop spans that collapse below the stitchable minimum.
      const ix0 = x0 + inset, ix1 = x1 - inset;
      if (ix1 - ix0 >= minSpan) spans.push({ x0: ix0, x1: ix1 });
    }
    if (spans.length) { rows.push(spans); rowYs.push(y); rowIdxs.push(rowIndex); }
    rowIndex++;
  }
  if (rows.length === 0) return [];

  const span = (ri, si) => rows[ri][si];
  const id = (ri, si) => `${ri}:${si}`;

  // Build the stitch points for one span (rotated space) with a brick-offset
  // phase so penetrations on adjacent rows don't line up into a visible ridge.
  // `dir` > 0 = left→right.
  const spanPoints = (x0, x1, y, rIdx, dir) => {
    const segLen = Math.abs(x1 - x0);
    const n = Math.max(1, Math.round(segLen / stitchLen));
    const phase = (rIdx % 2) * (stitchLen / 2); // brick offset
    const pts = [];
    const lo = dir > 0 ? x0 : x1, hiSign = dir > 0 ? 1 : -1;
    pts.push({ x: lo, y });
    for (let k = 1; k <= n; k++) {
      const t = (k * stitchLen + phase) / segLen;
      if (t >= 1) break;
      pts.push({ x: lo + hiSign * segLen * t, y });
    }
    pts.push({ x: dir > 0 ? x1 : x0, y });
    return pts;
  };

  // --- Adjacency: vertically-overlapping spans linked by an interior connector.
  // Used to walk the fill as a continuous serpentine. A naive row-by-row snake
  // would, for a two-lobe row (a heart above its notch), connect the left lobe's
  // span to the right lobe's across the NOTCH — an exiting jump. Instead we walk
  // the adjacency GRAPH: descend a vertical chain, then continue to whatever
  // unvisited neighbor is reachable by an interior connector. Each lobe is sewn
  // down-and-up before crossing, so the connector never leaves the region.
  const adj = new Map(); // id -> [{ ri, si }]
  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (let ri = 0; ri + 1 < rows.length; ri++) {
    if (rowIdxs[ri + 1] - rowIdxs[ri] !== 1) continue;
    for (let si = 0; si < rows[ri].length; si++) {
      const A = span(ri, si);
      for (let sj = 0; sj < rows[ri + 1].length; sj++) {
        const B = span(ri + 1, sj);
        const ov = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        if (ov <= 1e-6) continue;
        const sx = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
        if (segmentInContours({ x: sx, y: rowYs[ri] }, { x: sx, y: rowYs[ri + 1] }, rot)) {
          addAdj(id(ri, si), { ri: ri + 1, si: sj });
          addAdj(id(ri + 1, sj), { ri, si });
        }
      }
    }
  }

  // --- Walk each connected component as a continuous serpentine subpath. ---
  const subs = [];
  const visited = new Set();
  // Stitch a span in travel direction `dir` (>0 left→right) and append, opening a
  // new subpath if the interior connector from the previous point fails.
  let cur = [];
  let prev = null;
  const flush = () => { if (cur.length >= 2) subs.push(cur); cur = []; prev = null; };
  const emit = (ri, si, dir) => {
    const S = span(ri, si);
    const pts = spanPoints(S.x0, S.x1, rowYs[ri], rowIdxs[ri], dir);
    if (prev && !segmentInContours(prev, pts[0], rot)) flush();
    cur.push(...pts);
    prev = pts[pts.length - 1];
    visited.add(id(ri, si));
  };
  // Pick the next unvisited span to continue to: prefer a neighbor of the current
  // span (keeps the path local & interior), else fall back to scanning.
  const reachableNeighbor = (ri, si) => {
    const ns = adj.get(id(ri, si)) || [];
    let best = null;
    for (const n of ns) {
      if (visited.has(id(n.ri, n.si))) continue;
      // Prefer going DOWN, then by proximity, to keep a tidy vertical snake.
      if (!best || n.ri > best.ri) best = n;
    }
    return best;
  };

  // Seed order: spans top-to-bottom, left-to-right.
  const seeds = [];
  for (let ri = 0; ri < rows.length; ri++)
    for (let si = 0; si < rows[ri].length; si++) seeds.push({ ri, si });
  seeds.sort((a, b) => (a.ri - b.ri) || (span(a.ri, a.si).x0 - span(b.ri, b.si).x0));

  for (const seed of seeds) {
    if (visited.has(id(seed.ri, seed.si))) continue;
    flush(); // new island / unreachable continuation → new subpath
    let cur_ri = seed.ri, cur_si = seed.si, dir = 1;
    while (cur_ri !== -1) {
      emit(cur_ri, cur_si, dir);
      dir = -dir;
      // Continue along adjacency to an unvisited reachable neighbor.
      let next = reachableNeighbor(cur_ri, cur_si);
      if (!next) {
        // Dead end in the local chain: hop to the nearest unvisited span in the
        // SAME component still reachable by an interior connector from here.
        next = null;
        let bestD = Infinity;
        for (let ri = 0; ri < rows.length; ri++) {
          for (let si = 0; si < rows[ri].length; si++) {
            if (visited.has(id(ri, si))) continue;
            const S = span(ri, si);
            const cx = (S.x0 + S.x1) / 2;
            const here = { x: cx, y: rowYs[ri] };
            const d = dist(prev, here);
            if (d < bestD && segmentInContours(prev, here, rot)) { bestD = d; next = { ri, si }; }
          }
        }
      }
      if (next) { cur_ri = next.ri; cur_si = next.si; } else cur_ri = -1;
    }
  }
  flush();

  // Rotate every subpath back into design space.
  return subs.map((s) => s.map((p) => rotatePoint(p, center, angle)));
}

// Optional zig-zag underlay for fills/satin: a sparse running outline pass that
// stabilizes fabric before the top stitching.
export function generateUnderlay(points, inset = 1.0) {
  if (points.length < 2) return [];
  return resample(points, 3.5);
}

// Walk a CLOSED contour with running stitches, preserving every original vertex
// so the path never chords across a corner. Resampling a closed loop as one
// polyline (the old approach) cuts corners; for a hole/counter boundary that
// chord can dip INTO the hole. Resampling edge-by-edge keeps the walk exactly on
// the outline, which is inherently hole-safe.
//
// `inset` (mm) pulls the walk just INSIDE the boundary (pull compensation) so the
// rendered thread doesn't bleed over the edge and so every walked point lies
// strictly inside the region. `region` (contours for an even-odd test) keeps the
// inset from spiking outside at a sharp concave corner (e.g. a heart's notch).
function edgeWalk(contour, spacing, inset = 0, region = null) {
  if (contour.length < 2) return [];
  const base = inset > 0 ? offsetContourInward(contour, inset, region) : contour;
  const out = [base[0]];
  const closed = [...base, base[0]];
  for (let i = 1; i < closed.length; i++) {
    const seg = resample([closed[i - 1], closed[i]], spacing);
    // resample includes the start point; skip it to avoid duplicates.
    for (let k = 1; k < seg.length; k++) out.push(seg[k]);
  }
  return out;
}

// Generate stitches for a text object from its cached glyph contours
// (obj._glyphs: array of glyphs; each glyph is an array of contours in mm).
// Returns an array of sub-paths so the compiler can trim/jump between glyphs.
export function generateText(obj) {
  const glyphs = obj._glyphs || [];
  const ax = (obj.points && obj.points[0]) ? obj.points[0].x : 0;
  const ay = (obj.points && obj.points[0]) ? obj.points[0].y : 0;
  const shift = (c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay }));
  const subs = [];
  for (const contours of glyphs) {
    const moved = contours.map(shift);
    // Fill each glyph with hole-aware tatami + a LIGHT underlay (outer edge run
    // only; no perpendicular tatami) so small lettering stays crisp and counters
    // stay open.
    for (const f of fillWithUnderlay(moved, obj.params, { light: true })) {
      if (f.length) subs.push(f);
    }
    if (obj.params.outline) {
      for (const c of moved) {
        if (c.length >= 2) subs.push(edgeWalk(c, obj.params.outlineLen || 2.0));
      }
    }
  }
  return subs;
}

// Returns an array of sub-paths (each an array of penetration points). Multiple
// sub-paths within one object are connected by jumps/trims by the compiler.
export function generateForObject(obj) {
  switch (obj.type) {
    case "running": return [generateRunning(obj.points, obj.params)];
    case "satin": {
      const subs = [];
      // Underlay: a center run down the spine stabilizes before the satin.
      if (obj.params.underlay) subs.push(resample(obj.points, 2.5));
      subs.push(generateSatin(obj.points, obj.params));
      return subs;
    }
    case "fill": {
      const contours = (obj.contours && obj.contours.length) ? obj.contours : [obj.points];
      return fillWithUnderlay(contours, obj.params);
    }
    case "text":    return generateText(obj);
    default:        return [];
  }
}

// Fill plus optional underlay, tuned so a freshly-rendered object looks good
// with no manual tuning. Underlay (before the top fill):
//   (a) an edge walk around each OUTER contour (~2.5mm running stitch). The walk
//       runs ONLY on outer contours — never on holes/counters — so a letter's
//       counter (the inside of an O/e/a/B/8) stays fully open instead of being
//       ringed shut. Holes are classified by even-odd nesting.
//   (b) for SHAPES, a low-density fill pass roughly perpendicular to the top
//       fill (spacing ~1.8mm) to stabilize the fabric. Skipped for TEXT (the
//       `light` option), where the perpendicular tatami muddies small lettering;
//       the outer edge run alone is enough to keep letters crisp.
// Then the top tatami fill (default spacing ~0.4mm, stitch length ~3.0mm, with
// a brick offset between rows). All passes are hole-aware via fillContours.
//
// `opts.light` (default false) → light underlay: outer edge walk only, no
// perpendicular tatami. generateText passes light:true; shape fills do not.
function fillWithUnderlay(contours, params, opts = {}) {
  const valid = contours.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const topAngle = params.angle ?? 0;
  const topSpacing = Math.max(0.25, params.spacing ?? 0.4);
  const light = !!opts.light;
  const subs = [];

  const inset = Math.max(0, params.inset ?? 0.2);
  if (params.underlay) {
    const isHole = classifyHoles(valid);
    // (a) Edge walk around each OUTER contour outline (corner-preserving), pulled
    //     just inside by the pull-comp inset so the run stays under the top fill
    //     and never bleeds over the edge. Never walk holes/counters, or the
    //     counter gets ringed shut.
    for (let i = 0; i < valid.length; i++) {
      if (!isHole[i]) subs.push(edgeWalk(valid[i], 2.5, inset, valid));
    }
    // (b) Perpendicular low-density stabilizing fill (hole-aware) — shapes only.
    if (!light) {
      for (const f of fillContours(valid, {
        ...params,
        spacing: Math.max(1.8, topSpacing * 4),
        stitchLength: Math.max(2.5, params.stitchLength ?? 3.0),
        angle: topAngle + 90,
      })) {
        if (f.length) subs.push(f);
      }
    }
  }

  // Top tatami fill — apply the smart defaults so the look is good untuned.
  for (const f of fillContours(valid, {
    ...params,
    spacing: topSpacing,
    stitchLength: Math.max(1, params.stitchLength ?? 3.0),
    angle: topAngle,
  })) {
    if (f.length) subs.push(f);
  }
  return subs;
}
