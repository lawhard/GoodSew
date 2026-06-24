// Stitch generators. Each takes an object's geometry + params and returns an
// array of needle penetration points {x,y} in mm — the raw stitch path for that
// object, before jumps/trims/color-changes are woven in by the compiler.

import {
  resample, pathLength, sub, add, scale, norm, perp, dist, bbox,
  rotatePoint, sampleAt, contoursScanline, contoursBBox,
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
  const half = width / 2;
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
export function fillContours(contours, params) {
  contours = contours.filter((c) => c.length >= 3);
  if (contours.length === 0) return [];
  const spacing = Math.max(0.25, params.spacing || 0.45);
  const stitchLen = Math.max(1, params.stitchLength || 3.0);
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
    for (let k = 0; k + 1 < xs.length; k += 2) spans.push([xs[k], xs[k + 1]]);
    if (spans.length) rows.push({ y, spans, rowIndex });
    rowIndex++;
  }

  // Boustrophedon traversal with a brick-offset stitch phase for a tatami look.
  const out = [];
  let dir = 1;
  for (const row of rows) {
    const ordered = dir > 0 ? row.spans : row.spans.slice().reverse();
    for (const span of ordered) {
      let [x0, x1] = dir > 0 ? span : [span[1], span[0]];
      const segLen = Math.abs(x1 - x0);
      const n = Math.max(1, Math.round(segLen / stitchLen));
      const phase = (row.rowIndex % 2) * (stitchLen / 2); // brick offset
      out.push({ x: x0, y: row.y });
      for (let k = 1; k <= n; k++) {
        let t = (k * stitchLen + phase) / segLen;
        if (t >= 1) break;
        out.push({ x: x0 + (x1 - x0) * t, y: row.y });
      }
      out.push({ x: x1, y: row.y });
    }
    dir = -dir;
  }

  // Rotate stitches back into design space.
  return out.map((p) => rotatePoint(p, center, angle));
}

// Optional zig-zag underlay for fills/satin: a sparse running outline pass that
// stabilizes fabric before the top stitching.
export function generateUnderlay(points, inset = 1.0) {
  if (points.length < 2) return [];
  return resample(points, 3.5);
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
    const f = fillContours(moved, obj.params);
    if (f.length) subs.push(f);
    if (obj.params.outline) {
      for (const c of moved) {
        if (c.length >= 2) subs.push(resample([...c, c[0]], obj.params.outlineLen || 2.0));
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
    case "satin":   return [generateSatin(obj.points, obj.params)];
    case "fill":
      if (obj.contours && obj.contours.length)
        return [fillContours(obj.contours, obj.params)];
      return [generateFill(obj.points, obj.params)];
    case "text":    return generateText(obj);
    default:        return [];
  }
}
