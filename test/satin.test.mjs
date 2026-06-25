// SATIN + automatic stitch-type selection verification.
//
// Asserts:
//   1. A thin rectangle (2.5 x 30 mm) auto-fills as SATIN — rail-to-rail, ~2
//      penetrations per row, no interior points.
//   2. A wide rectangle (40 x 40 mm) stays TATAMI — many interior points per row.
//   3. A tall thin letter ('l'/'I', Anton 16) becomes satin (rails only); a small
//      'o' keeps its counter open (zero stitches in the eroded counter core).
//   4. An OUTLINE circle (fillMode:'outline', borderWidth:2) stitches a satin band
//      ON the outline — every stitch within ~1.5mm of the contour, interior empty.
//   5. No NaN/Infinity, and no stitch point outside the region (filled cases).
//
// Run from repo root:  node test/satin.test.mjs
import { createRequire } from "module";
import { textToGlyphs } from "../js/fonts.js";
import { generateForObject, fillContours } from "../js/stitches.js";
import { buildShape } from "../js/shapes.js";
import { pointInPolygon, pointInContours } from "../js/geometry.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

// ---- helpers ----
function perRowCounts(subs) {
  const m = new Map();
  for (const s of subs) for (const p of s) {
    const k = p.y.toFixed(2);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.values()];
}
function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function totalPts(subs) { return subs.reduce((n, s) => n + s.length, 0); }
function hasBadCoord(subs) {
  for (const s of subs) for (const p of s)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
  return false;
}
function erode(poly, frac) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => ({ x: p.x + (cx - p.x) * frac, y: p.y + (cy - p.y) * frac }));
}
function pointsInCore(subs, holes) {
  const er = holes.map((h) => erode(h, 0.4));
  let count = 0;
  for (const s of subs) for (const p of s)
    for (const h of er) if (pointInPolygon(p, h)) { count++; break; }
  return count;
}
function distToContours(p, contours) {
  let m = Infinity;
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      m = Math.min(m, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
  }
  return m;
}
function pointsOutside(subs, contours, eps = 0.15) {
  let count = 0;
  for (const s of subs) for (const p of s)
    if (!pointInContours(p, contours) && distToContours(p, contours) > eps) count++;
  return count;
}
function holeContours(contours) {
  const holes = [];
  for (let i = 0; i < contours.length; i++) {
    const probe = contours[i][0];
    let depth = 0;
    for (let j = 0; j < contours.length; j++)
      if (i !== j && pointInPolygon(probe, contours[j])) depth++;
    if (depth % 2 === 1) holes.push(contours[i]);
  }
  return holes;
}

// ===== 1. Thin rectangle → SATIN =====
console.log("\n=== Thin rectangle 2.5 x 30 — auto SATIN ===");
{
  const thin = buildShape("rect", { x: 0, y: 0, w: 2.5, h: 30 });
  const params = { spacing: 0.4, angle: 0, stitchLength: 3.0, underlay: false };
  const subs = fillContours([thin], params);
  const rows = perRowCounts(subs);
  const a = avg(rows);
  const twoCount = rows.filter((c) => c === 2).length;
  ok(rows.length > 20, `has many rows (${rows.length})`);
  ok(Math.abs(a - 2) < 0.05, `~2 penetrations per row (avg ${a.toFixed(2)}) — rails only`);
  ok(twoCount >= rows.length - 2, `essentially every row contributes exactly 2 (${twoCount}/${rows.length})`);
  ok(Math.abs(totalPts(subs) - 2 * rows.length) <= 2, `total penetrations ~= 2 x rows (${totalPts(subs)} vs ${2 * rows.length})`);
  ok(!hasBadCoord(subs), `no NaN/Infinity`);
  ok(pointsOutside(subs, [thin]) === 0, `every stitch inside region`);

  // With underlay → a center-run subpath is added before the satin rails.
  const withU = fillContours([thin], { ...params, underlay: true });
  ok(withU.length >= 2, `underlay adds a center-run subpath (subs=${withU.length})`);
  ok(pointsOutside(withU, [thin]) === 0, `underlay: every stitch inside region`);
}

// ===== 2. Wide rectangle → TATAMI =====
console.log("\n=== Wide rectangle 40 x 40 — stays TATAMI ===");
{
  const wide = buildShape("rect", { x: 0, y: 0, w: 40, h: 40 });
  const subs = fillContours([wide], { spacing: 0.45, angle: 0, stitchLength: 3.0, underlay: false });
  const a = avg(perRowCounts(subs));
  ok(a > 4, `many interior points per row (avg ${a.toFixed(2)}) — clearly > 2`);
  ok(!hasBadCoord(subs), `no NaN/Infinity`);
  ok(pointsOutside(subs, [wide]) === 0, `every stitch inside region`);
}

// ===== 3. Letters: thin stem → satin, 'o' counter open =====
console.log("\n=== Letters (Anton 16) ===");
{
  const font = opentype.loadSync(new URL("../fonts/Anton.ttf", import.meta.url).pathname);
  const fillGlyph = (letter) => {
    const r = textToGlyphs(font, letter, 16, { letterSpacing: 0 });
    const ax = 10, ay = 20;
    const moved = r.glyphs.map((cs) => cs.map((c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay }))));
    let subs = [];
    for (const cs of moved)
      subs = subs.concat(fillContours(cs, { spacing: 0.4, angle: 0, stitchLength: 2.5, underlay: false }));
    return { subs, contours: moved.flat() };
  };

  for (const letter of ["l", "I"]) {
    const { subs, contours } = fillGlyph(letter);
    const a = avg(perRowCounts(subs));
    ok(Math.abs(a - 2) < 0.2, `'${letter}' is satin — ~2 per row (avg ${a.toFixed(2)})`);
    ok(!hasBadCoord(subs), `'${letter}' no NaN/Infinity`);
    ok(pointsOutside(subs, contours) === 0, `'${letter}' every stitch inside glyph`);
  }

  const { subs, contours } = fillGlyph("o");
  const holes = holeContours(contours);
  ok(holes.length >= 1, `'o' has a counter (${holes.length})`);
  ok(pointsInCore(subs, holes) === 0, `'o' counter stays open — zero stitches in eroded core`);
  // 'o' is a thin ring → satin, so rows have only rail points (no interior fill).
  const a = avg(perRowCounts(subs));
  ok(a <= 4.5, `'o' ring is satin/rails (avg per row ${a.toFixed(2)})`);
  ok(!hasBadCoord(subs), `'o' no NaN/Infinity`);
  ok(pointsOutside(subs, contours) === 0, `'o' every stitch inside glyph`);
}

// ===== 4. Outline circle → satin band on the outline =====
console.log("\n=== Outline circle (fillMode:'outline', borderWidth:2) ===");
{
  const circ = buildShape("ellipse", { x: 0, y: 0, w: 30, h: 30 });
  const obj = { type: "fill", points: circ, contours: [circ], params: { fillMode: "outline", borderWidth: 2, spacing: 0.5 } };
  const subs = generateForObject(obj);
  ok(totalPts(subs) > 50, `outline produced stitches (${totalPts(subs)})`);
  ok(!hasBadCoord(subs), `no NaN/Infinity`);

  let maxD = 0, nearCenter = 0;
  const cx = 15, cy = 15;
  for (const s of subs) for (const p of s) {
    maxD = Math.max(maxD, distToContours(p, [circ]));
    if (Math.hypot(p.x - cx, p.y - cy) < 8) nearCenter++;
  }
  ok(maxD <= 1.5, `every stitch within ~1.5mm of the outline (max ${maxD.toFixed(2)})`);
  ok(nearCenter === 0, `interior is empty — no stitches near center (${nearCenter})`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
