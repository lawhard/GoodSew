// FILL AUDIT — verifies the sew-fill generators across every mode.
//
// Asserts:
//   1. Outline pass (params.outline) on a SHAPE adds a subpath that traces the
//      contour edge (a closed-ish run whose points are all within ~0.6mm of the
//      contour) — and WITHOUT it, no such run exists. Same holds for TEXT.
//   2. Forced satin: thin rect → ~2 penetrations/row (rails only); wide rect →
//      no single consecutive-stitch gap exceeds ~7.5mm (split-satin fix).
//   3. Auto: thin → satin, wide → tatami.
//   4. Tatami holes: a square-with-hole and Anton 'O' → ZERO stitches in the
//      eroded counter core.
//   5. Cross-hatch: materially more stitches than a single-angle pass; stays in
//      the region.
//   6. Outline border (fillMode:'outline'): a band hugging the contour, interior
//      empty.
//   7. Underlay on/off behaves (on adds subpaths; both stay in region).
//   8. No NaN/Infinity, representative point-in-region checks pass.
//
// Run from repo root:  node test/fillaudit.test.mjs
import { createRequire } from "module";
import { textToGlyphs } from "../js/fonts.js";
import { generateForObject, generateText, fillContours } from "../js/stitches.js";
import { buildShape } from "../js/shapes.js";
import { pointInPolygon, pointInContours } from "../js/geometry.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

// ---- helpers ----
const totalPts = (subs) => subs.reduce((n, s) => n + s.length, 0);
function hasBadCoord(subs) {
  for (const s of subs) for (const p of s)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
  return false;
}
function perRowCounts(subs) {
  const m = new Map();
  for (const s of subs) for (const p of s) {
    const k = p.y.toFixed(2);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.values()];
}
function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function maxConsecGap(subs) {
  let g = 0;
  for (const s of subs) for (let i = 1; i < s.length; i++)
    g = Math.max(g, Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
  return g;
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
// Is `s` a run that traces the contour edge? (long enough, every point near edge.)
function tracesContour(s, contours, near = 0.6, minPts = 8) {
  if (s.length < minPts) return false;
  for (const p of s) if (distToContours(p, contours) > near) return false;
  return true;
}
function hasOutlineRun(subs, contours) {
  return subs.some((s) => tracesContour(s, contours));
}

// ===== 1. Outline pass on a SHAPE =====
console.log("\n=== Outline pass on a SHAPE (ellipse) ===");
{
  const circ = buildShape("ellipse", { x: 0, y: 0, w: 30, h: 30 });
  const base = { spacing: 0.5, angle: 0, stitchLength: 3.0, underlay: false };
  const noO = generateForObject({ type: "fill", points: circ, contours: [circ], params: { ...base } });
  const yesO = generateForObject({ type: "fill", points: circ, contours: [circ], params: { ...base, outline: true, outlineLen: 2.0 } });
  ok(!hasOutlineRun(noO, [circ]), `without outline:true — no edge-tracing run present`);
  ok(hasOutlineRun(yesO, [circ]), `with outline:true — an edge-tracing run is added`);
  ok(yesO.length > noO.length, `outline adds a subpath (${noO.length} -> ${yesO.length})`);
  ok(!hasBadCoord(yesO), `no NaN/Infinity`);
  ok(pointsOutside(yesO, [circ]) === 0, `every stitch inside region`);
}

// ===== 1b. Outline pass on TEXT (hole-aware: counter NOT ringed) =====
console.log("\n=== Outline pass on TEXT (Anton 'O') ===");
{
  const font = opentype.loadSync(new URL("../fonts/Anton.ttf", import.meta.url).pathname);
  const r = textToGlyphs(font, "O", 40, { letterSpacing: 0 });
  const ax = 10, ay = 60;
  const moved = r.glyphs.flat().map((c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay })));
  const mk = (outline) => generateText({
    type: "text", points: [{ x: ax, y: ay }],
    params: { text: "O", size: 40, spacing: 0.4, stitchLength: 2.5, angle: 0, outline, outlineLen: 2.0, underlay: false },
    _glyphs: r.glyphs,
  });
  const noO = mk(false), yesO = mk(true);
  ok(!hasOutlineRun(noO, moved), `text without outline — no edge-tracing run`);
  ok(hasOutlineRun(yesO, moved), `text with outline — edge-tracing run present`);
  const holes = holeContours(moved);
  ok(pointsInCore(yesO, holes) === 0, `text outline is hole-aware — counter stays open`);
  ok(!hasBadCoord(yesO), `no NaN/Infinity`);
  ok(pointsOutside(yesO, moved) === 0, `every stitch inside glyph`);
}

// ===== 2. Forced satin: thin rails-only, wide split (no gap > 7.5mm) =====
console.log("\n=== Forced satin ===");
{
  const thin = buildShape("rect", { x: 0, y: 0, w: 3, h: 30 });
  const ts = fillContours([thin], { spacing: 0.5, angle: 0, stitchLength: 3, underlay: false, stitchType: "satin" });
  const a = avg(perRowCounts(ts));
  ok(Math.abs(a - 2) < 0.1, `thin forced satin ~2 penetrations/row (avg ${a.toFixed(2)})`);
  ok(maxConsecGap(ts) <= 7.5, `thin forced satin: no stitch gap > 7.5mm (max ${maxConsecGap(ts).toFixed(2)})`);

  const wide = buildShape("rect", { x: 0, y: 0, w: 40, h: 25 });
  const ws = fillContours([wide], { spacing: 0.5, angle: 0, stitchLength: 3, underlay: false, stitchType: "satin" });
  const g = maxConsecGap(ws);
  ok(g <= 7.5, `wide forced satin: no consecutive-stitch gap > 7.5mm (max ${g.toFixed(2)})`);
  ok(pointsOutside(ws, [wide]) === 0, `wide forced satin: every stitch inside region`);
  ok(!hasBadCoord(ws), `no NaN/Infinity`);
}

// ===== 3. Auto selection: thin -> satin, wide -> tatami =====
console.log("\n=== Auto stitch-type selection ===");
{
  const thin = buildShape("rect", { x: 0, y: 0, w: 2.5, h: 30 });
  const wide = buildShape("rect", { x: 0, y: 0, w: 40, h: 40 });
  const ta = avg(perRowCounts(fillContours([thin], { spacing: 0.4, angle: 0, stitchLength: 3, underlay: false })));
  const wa = avg(perRowCounts(fillContours([wide], { spacing: 0.45, angle: 0, stitchLength: 3, underlay: false })));
  ok(Math.abs(ta - 2) < 0.1, `auto thin -> satin (~2/row, avg ${ta.toFixed(2)})`);
  ok(wa > 4, `auto wide -> tatami (>4/row, avg ${wa.toFixed(2)})`);
}

// ===== 4. Tatami holes: ZERO stitches in eroded counter =====
console.log("\n=== Tatami holes ===");
{
  // (a) square with a square hole
  const outer = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const inner = [{ x: 14, y: 14 }, { x: 26, y: 14 }, { x: 26, y: 26 }, { x: 14, y: 26 }];
  const s = fillContours([outer, inner], { spacing: 0.5, angle: 0, stitchLength: 3, underlay: false });
  ok(pointsInCore(s, [inner]) === 0, `square+hole: zero stitches in eroded counter`);
  ok(pointsOutside(s, [outer, inner]) === 0, `square+hole: every stitch inside region`);
  ok(!hasBadCoord(s), `square+hole: no NaN/Infinity`);
  ok(totalPts(s) > 100, `square+hole: reasonable count (${totalPts(s)})`);

  // (b) Anton 'O'
  const font = opentype.loadSync(new URL("../fonts/Anton.ttf", import.meta.url).pathname);
  const r = textToGlyphs(font, "O", 40, { letterSpacing: 0 });
  const moved = r.glyphs.flat().map((c) => c.map((p) => ({ x: p.x + 10, y: p.y + 60 })));
  const os = fillContours(moved, { spacing: 0.5, angle: 0, stitchLength: 3, underlay: false });
  const holes = holeContours(moved);
  ok(holes.length >= 1, `'O' has a counter`);
  ok(pointsInCore(os, holes) === 0, `'O': zero stitches in eroded counter`);
}

// ===== 5. Cross-hatch: more stitches than single pass, stays inside =====
console.log("\n=== Cross-hatch ===");
{
  const wide = buildShape("rect", { x: 0, y: 0, w: 40, h: 40 });
  const base = { spacing: 0.5, angle: 0, stitchLength: 3, underlay: false };
  const single = generateForObject({ type: "fill", points: wide, contours: [wide], params: { ...base } });
  const cross = generateForObject({ type: "fill", points: wide, contours: [wide], params: { ...base, crosshatch: true } });
  ok(totalPts(cross) > totalPts(single) * 1.1, `cross-hatch materially more stitches (${totalPts(single)} -> ${totalPts(cross)})`);
  ok(pointsOutside(cross, [wide]) === 0, `cross-hatch stays inside region`);
  ok(!hasBadCoord(cross), `cross-hatch: no NaN/Infinity`);
}

// ===== 6. Outline border (fillMode:'outline') =====
console.log("\n=== Outline border (fillMode:'outline') ===");
{
  const circ = buildShape("ellipse", { x: 0, y: 0, w: 30, h: 30 });
  const subs = generateForObject({ type: "fill", points: circ, contours: [circ], params: { fillMode: "outline", borderWidth: 2, spacing: 0.5 } });
  let maxD = 0, nearCenter = 0;
  for (const s of subs) for (const p of s) {
    maxD = Math.max(maxD, distToContours(p, [circ]));
    if (Math.hypot(p.x - 15, p.y - 15) < 8) nearCenter++;
  }
  ok(totalPts(subs) > 50, `border produced stitches (${totalPts(subs)})`);
  ok(maxD <= 1.5, `border hugs the contour (max ${maxD.toFixed(2)}mm)`);
  ok(nearCenter === 0, `border interior empty (${nearCenter} near center)`);
  ok(!hasBadCoord(subs), `border: no NaN/Infinity`);
}

// ===== 7. Underlay on/off =====
console.log("\n=== Underlay on/off ===");
{
  const heart = buildShape("heart", { x: 0, y: 0, w: 50, h: 45 });
  const base = { spacing: 0.5, angle: 0, stitchLength: 3 };
  const off = generateForObject({ type: "fill", points: heart, contours: [heart], params: { ...base, underlay: false } });
  const on = generateForObject({ type: "fill", points: heart, contours: [heart], params: { ...base, underlay: true } });
  ok(on.length > off.length, `underlay adds subpaths (${off.length} -> ${on.length})`);
  ok(pointsOutside(on, [heart]) === 0, `underlay on: every stitch inside region`);
  ok(pointsOutside(off, [heart]) === 0, `underlay off: every stitch inside region`);
  ok(!hasBadCoord(on) && !hasBadCoord(off), `no NaN/Infinity`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
