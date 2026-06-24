// Fill QUALITY verification.
//
// Asserts the three fill-quality fixes hold across Anton + ArchivoBlack and a
// heart shape:
//   1. Counters open — for O e a B 8, ZERO stitch segments have a midpoint
//      inside the counter eroded inward ~20%, ZERO stitch POINTS land inside the
//      counter near its centroid, and the legacy "no hole crossing" check holds.
//   2. Concave folds — a heart filled as a SHAPE has ZERO connector segments
//      that exit the region (no jump over the notch) and ≤2 subpaths.
//   3. Inset / pull-comp — every stitch point lies inside the region (even-odd)
//      within a small epsilon, for the heart and for "O".
//   4. No NaN/Infinity, reasonable penetration counts.
//
// Run from repo root:  node test/fill.test.mjs
import { createRequire } from "module";
import { textToGlyphs } from "../js/fonts.js";
import { generateText, generateForObject, fillContours } from "../js/stitches.js";
import { buildShape } from "../js/shapes.js";
import { pointInPolygon, pointInContours, segmentInContours } from "../js/geometry.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

const FONTS = ["Anton.ttf", "ArchivoBlack.ttf"];
const SIZE = 40;

// A glyph contour is a HOLE when it is nested inside an ODD number of the OTHER
// contours. A single boundary VERTEX is an unambiguous probe (a centroid of an
// outer ring lands in the counter and misclassifies).
function holeContours(contours) {
  const holes = [];
  for (let i = 0; i < contours.length; i++) {
    const probe = contours[i][0];
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i !== j && pointInPolygon(probe, contours[j])) depth++;
    }
    if (depth % 2 === 1) holes.push(contours[i]);
  }
  return holes;
}

// Erode a polygon toward its centroid by fraction `frac` (0..1). frac=0.2 keeps
// the inner 80%; a point in there is unambiguously well inside the counter.
function erode(poly, frac) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => ({ x: p.x + (cx - p.x) * frac, y: p.y + (cy - p.y) * frac }));
}

function centroid(poly) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

// Count stitch SEGMENTS whose midpoint falls strictly inside a counter eroded
// ~20% (so legitimate boundary stitching far from center isn't flagged, but a
// counter-ring or fill is).
function segMidpointsInCounters(subs, holes) {
  const er = holes.map((h) => erode(h, 0.2));
  let count = 0;
  for (const sub of subs) {
    for (let i = 1; i < sub.length; i++) {
      const a = sub[i - 1], b = sub[i];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const h of er) if (pointInPolygon(m, h)) { count++; break; }
    }
  }
  return count;
}

// Count stitch POINTS landing inside a counter eroded ~40% — i.e. in the
// centroid neighborhood of the hole. Must be zero (counter fully open).
function pointsInCounterCore(subs, holes) {
  const er = holes.map((h) => erode(h, 0.4));
  let count = 0;
  for (const sub of subs) {
    for (const p of sub) {
      for (const h of er) if (pointInPolygon(p, h)) { count++; break; }
    }
  }
  return count;
}

function hasBadCoord(subs) {
  for (const sub of subs) for (const p of sub) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
  }
  return false;
}

function totalPts(subs) { return subs.reduce((n, s) => n + s.length, 0); }

// Distance from a point to the nearest edge of a polygon set (for epsilon slack
// on points sitting exactly on the boundary).
function distToContours(p, contours) {
  let m = Infinity;
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * dx, qy = a.y + t * dy;
      m = Math.min(m, Math.hypot(p.x - qx, p.y - qy));
    }
  }
  return m;
}

// Stitch points outside the region by more than `eps` mm (a point exactly on the
// boundary is inside within epsilon).
function pointsOutside(subs, contours, eps = 0.15) {
  let count = 0;
  for (const sub of subs) {
    for (const p of sub) {
      if (!pointInContours(p, contours) && distToContours(p, contours) > eps) count++;
    }
  }
  return count;
}

function buildText(font, text) {
  const r = textToGlyphs(font, text, SIZE, { letterSpacing: 0 });
  const ax = 10, ay = 60;
  const obj = {
    type: "text",
    points: [{ x: ax, y: ay }],
    params: { text, size: SIZE, spacing: 0.4, stitchLength: 2.5, angle: 0, outline: false, underlay: true },
    _glyphs: r.glyphs,
  };
  const subs = generateText(obj);
  const allHoles = [];
  const allContours = [];
  for (const contours of r.glyphs) {
    const moved = contours.map((c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay })));
    allHoles.push(...holeContours(moved));
    allContours.push(...moved);
  }
  return { subs, holes: allHoles, contours: allContours };
}

const TRUE_HOLED = ["O", "e", "a", "B", "8"];

// ===== 1. Counters open across both fonts =====
for (const fontFile of FONTS) {
  console.log(`\n=== Font: ${fontFile} — counters open ===`);
  const font = opentype.loadSync(new URL(`../fonts/${fontFile}`, import.meta.url).pathname);

  for (const letter of TRUE_HOLED) {
    const { subs, holes, contours } = buildText(font, letter);
    const midIn = segMidpointsInCounters(subs, holes);
    const ptsIn = pointsInCounterCore(subs, holes);
    const pts = totalPts(subs);
    const label = `"${letter}" subs=${subs.length} pts=${pts} holes=${holes.length}`;
    ok(holes.length >= 1, `${label} — has a counter`);
    ok(midIn === 0, `${label} — zero segment midpoints inside counter (eroded 20%) [${midIn}]`);
    ok(ptsIn === 0, `${label} — zero stitch points in counter core (eroded 40%) [${ptsIn}]`);
    ok(pts > 30, `${label} — reasonable penetration count`);
    ok(!hasBadCoord(subs), `${label} — no NaN/Infinity`);
    // Inset: every point inside the glyph (within epsilon).
    const out = pointsOutside(subs, contours);
    ok(out === 0, `${label} — every stitch point inside glyph within eps [${out}]`);
  }

  // The word "good" — counters in g, o, o, d; multiple glyphs → multiple subpaths.
  const { subs, holes } = buildText(font, "good");
  ok(segMidpointsInCounters(subs, holes) === 0, `"good" — zero counter crossings`);
  ok(pointsInCounterCore(subs, holes) === 0, `"good" — zero stitch points in counter cores`);
  ok(totalPts(subs) > 200, `"good" — reasonable penetration count (${totalPts(subs)})`);
  ok(subs.length > 1, `"good" — multiple subpaths across glyphs (${subs.length})`);
  ok(!hasBadCoord(subs), `"good" — no NaN/Infinity`);
}

// ===== 2. Heart: concave fold — no jumps over the notch =====
console.log(`\n=== Heart shape — concave fold serpentine ===`);
const heartPoly = buildShape("heart", { x: 0, y: 0, w: 60, h: 55 });
const heartParams = { spacing: 0.45, angle: 0, stitchLength: 3.0 };

// (a) Fill ONLY (no underlay) — the serpentine itself must not jump the fold.
const heartFill = fillContours([heartPoly], heartParams);
let fillExit = 0, fillSegs = 0;
for (const s of heartFill) for (let i = 1; i < s.length; i++) {
  fillSegs++;
  if (!segmentInContours(s[i - 1], s[i], [heartPoly])) fillExit++;
}
ok(fillExit === 0, `heart FILL: zero connectors exit region (${fillExit}/${fillSegs})`);
ok(heartFill.length <= 2, `heart FILL: ≤2 subpaths — no fold jumps (${heartFill.length})`);
ok(totalPts(heartFill) > 100, `heart FILL: reasonable penetration count (${totalPts(heartFill)})`);
ok(!hasBadCoord(heartFill), `heart FILL: no NaN/Infinity`);

// (b) Full shape fill WITH underlay (generateForObject) — every segment interior
//     stays inside (edge walk is inset, perpendicular underlay is serpentined).
const heartObj = {
  type: "fill", points: heartPoly, contours: [heartPoly],
  params: { ...heartParams, underlay: true },
};
const heartSubs = generateForObject(heartObj);
let exit = 0, segs = 0;
for (const s of heartSubs) for (let i = 1; i < s.length; i++) {
  segs++;
  if (!segmentInContours(s[i - 1], s[i], [heartPoly])) exit++;
}
ok(exit === 0, `heart shape (w/ underlay): zero segments exit region (${exit}/${segs})`);
ok(!hasBadCoord(heartSubs), `heart shape: no NaN/Infinity`);

// (c) Inset: every stitch point inside the heart within epsilon.
const heartOut = pointsOutside(heartSubs, [heartPoly]);
ok(heartOut === 0, `heart shape: every stitch point inside region within eps (${heartOut})`);

// ===== 3. Inset on "O" (already checked per-letter above, restated explicitly) =====
console.log(`\n=== Inset / pull-comp on "O" ===`);
{
  const font = opentype.loadSync(new URL(`../fonts/Anton.ttf`, import.meta.url).pathname);
  const { subs, contours } = buildText(font, "O");
  const out = pointsOutside(subs, contours);
  ok(out === 0, `"O": every stitch point inside glyph within eps (${out})`);
}

// ===== 4. Plain fill object with an interior hole stays hole-aware =====
console.log(`\n=== Fill object (square with hole) ===`);
const outer = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }];
const inner = [{ x: 22, y: 22 }, { x: 38, y: 22 }, { x: 38, y: 38 }, { x: 22, y: 38 }];
const fillObj = {
  type: "fill", points: outer, contours: [outer, inner],
  params: { spacing: 0.45, angle: 0, stitchLength: 3.0, underlay: true },
};
const fsubs = generateForObject(fillObj);
ok(segMidpointsInCounters(fsubs, [inner]) === 0, `fill object: zero hole crossings`);
ok(pointsInCounterCore(fsubs, [inner]) === 0, `fill object: zero stitch points in hole core`);
ok(totalPts(fsubs) > 50, `fill object: reasonable penetration count (${totalPts(fsubs)})`);
ok(!hasBadCoord(fsubs), `fill object: no NaN/Infinity`);
ok(pointsOutside(fsubs, [outer, inner]) === 0, `fill object: every stitch point inside region within eps`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
