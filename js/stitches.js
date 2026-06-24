// Stitch generators. Each takes an object's geometry + params and returns an
// array of needle penetration points {x,y} in mm — the raw stitch path for that
// object, before jumps/trims/color-changes are woven in by the compiler.

import {
  resample, pathLength, sub, add, scale, norm, perp, dist, bbox,
  rotatePoint, sampleAt, contoursScanline, contoursBBox,
  segmentInContours,
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
// Returns an ARRAY OF SUBPATHS (each an array of {x,y} points). The fill is
// HOLE-AWARE: two consecutive penetration points are only connected within the
// same subpath when the segment between them stays strictly inside the filled
// region. When the next point can't be reached by an interior segment (because
// the connector would cross a counter/hole or exit a concave outline), a NEW
// subpath is started so the compiler trims+jumps across the gap instead of
// dragging a stitch across the hole.
export function fillContours(contours, params) {
  contours = contours.filter((c) => c.length >= 3);
  if (contours.length === 0) return [];
  const spacing = Math.max(0.25, params.spacing ?? 0.4);
  const stitchLen = Math.max(1, params.stitchLength ?? 3.0);
  const angle = ((params.angle || 0) * Math.PI) / 180;

  // Rotate region so fill rows are horizontal, scan, then rotate stitches back.
  const bb = contoursBBox(contours);
  const center = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const rot = contours.map((poly) => poly.map((p) => rotatePoint(p, center, -angle)));
  const rb = contoursBBox(rot);

  const rows = [];
  let rowIndex = 0;
  for (let y = rb.minY + spacing / 2; y < rb.maxY; y += spacing) {
    const xs = contoursScanline(rot, y);
    // Pair up intersections into spans (even-odd fill rule).
    const spans = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > 1e-6) spans.push([xs[k], xs[k + 1]]);
    }
    if (spans.length) rows.push({ y, spans, rowIndex });
    rowIndex++;
  }

  // Build the stitch points for one span (in rotated space) with a brick-offset
  // phase so penetrations on adjacent rows don't line up into a visible ridge.
  const spanPoints = (x0, x1, y, rowIndex) => {
    const segLen = Math.abs(x1 - x0);
    const n = Math.max(1, Math.round(segLen / stitchLen));
    const phase = (rowIndex % 2) * (stitchLen / 2); // brick offset
    const pts = [{ x: x0, y }];
    for (let k = 1; k <= n; k++) {
      const t = (k * stitchLen + phase) / segLen;
      if (t >= 1) break;
      pts.push({ x: x0 + (x1 - x0) * t, y });
    }
    pts.push({ x: x1, y });
    return pts;
  };

  // Boustrophedon traversal. Order spans within a row by the current travel
  // direction so the snake stays tight, and only stay in the same subpath when
  // the connector to the next span/row stays inside the region.
  const subs = [];
  let cur = [];
  let prev = null; // last emitted point (rotated space)
  let dir = 1;

  const flush = () => {
    if (cur.length >= 2) subs.push(cur);
    cur = [];
  };

  for (const row of rows) {
    const ordered = dir > 0 ? row.spans : row.spans.slice().reverse();
    for (const span of ordered) {
      const [x0, x1] = dir > 0 ? span : [span[1], span[0]];
      const pts = spanPoints(x0, x1, row.y, row.rowIndex);
      const head = pts[0];
      // Decide whether we can connect from the previous point to this span's
      // head with an ordinary stitch (segment must remain inside the region).
      if (prev && !segmentInContours(prev, head, rot)) flush();
      cur.push(...pts);
      prev = pts[pts.length - 1];
    }
    dir = -dir;
  }
  flush();

  // Rotate every subpath back into design space.
  return subs.map((sub) => sub.map((p) => rotatePoint(p, center, angle)));
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
function edgeWalk(contour, spacing) {
  if (contour.length < 2) return [];
  const out = [contour[0]];
  const closed = [...contour, contour[0]];
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
    // Fill each glyph with the same smart underlay + hole-aware tatami used for
    // shapes, so lettering reads as solid, stabilized fill (not thin stripes).
    for (const f of fillWithUnderlay(moved, obj.params)) {
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
//   (a) an edge walk around each contour (~2.5mm running stitch) — walking the
//       outline is inherently hole-safe, and
//   (b) a low-density fill pass roughly perpendicular to the top fill (spacing
//       ~1.8mm, angle = topAngle + 90) to stabilize the fabric.
// Then the top tatami fill (default spacing ~0.4mm, stitch length ~3.0mm, with
// a brick offset between rows). All passes are hole-aware via fillContours.
function fillWithUnderlay(contours, params) {
  const valid = contours.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const topAngle = params.angle ?? 0;
  const topSpacing = Math.max(0.25, params.spacing ?? 0.4);
  const subs = [];

  if (params.underlay) {
    // (a) Edge walk around each contour outline (closed loop, corner-preserving).
    for (const c of valid) subs.push(edgeWalk(c, 2.5));
    // (b) Perpendicular low-density stabilizing fill (hole-aware).
    for (const f of fillContours(valid, {
      ...params,
      spacing: Math.max(1.8, topSpacing * 4),
      stitchLength: Math.max(2.5, params.stitchLength ?? 3.0),
      angle: topAngle + 90,
    })) {
      if (f.length) subs.push(f);
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
