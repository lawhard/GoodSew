// Hole-aware fill verification.
//
// For holed glyphs (O U e a B 8) and the word "good" across two fonts, assert:
//   1. ZERO stitch segments cross any interior hole.
//   2. A reasonable total penetration count, and >1 subpath for holed glyphs
//      (proving the hole-aware split happened).
//   3. No NaN/Infinity coordinates.
//
// Run from repo root:  node test/fill.test.mjs
import { createRequire } from "module";
import { textToGlyphs } from "../js/fonts.js";
import { generateText, generateForObject } from "../js/stitches.js";
import { pointInPolygon } from "../js/geometry.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

const FONTS = ["Anton.ttf", "ArchivoBlack.ttf"];
const SIZE = 40;

// A glyph contour set (even-odd). A contour is a HOLE when it is nested inside an
// ODD number of the OTHER contours. Contours of a glyph never cross, so testing a
// single boundary VERTEX of C against another contour D reliably tells whether C
// is inside D (a centroid or scanline-midpoint of an outer ring lands in the
// counter and misclassifies — vertices are unambiguous).
function holeContours(contours) {
  const holes = [];
  for (let i = 0; i < contours.length; i++) {
    const probe = contours[i][0]; // a vertex on contour i's boundary
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(probe, contours[j])) depth++;
    }
    if (depth % 2 === 1) holes.push(contours[i]);
  }
  return holes;
}

// Shrink a polygon slightly toward its centroid so a strictly-interior test
// ignores points that merely sit ON the boundary (e.g. the counter edge-walk,
// which traces the hole outline and is legitimate — not a crossing).
function shrink(poly, eps = 0.4) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map((p) => {
    const dx = cx - p.x, dy = cy - p.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * eps, y: p.y + (dy / l) * eps };
  });
}

// Count stitch segments that TRAVERSE a hole interior (the visual defect: a
// connector dragged straight across a counter, filling it solid). We sample the
// segment at 1/4, 1/2 and 3/4 and require ALL three to fall strictly inside the
// hole (tested against a slightly shrunk copy, so a segment running ALONG the
// hole's boundary — the legitimate counter edge-walk — is NOT counted).
function midpointsInHoles(subs, holes) {
  const shrunk = holes.map((h) => shrink(h));
  let count = 0;
  for (const sub of subs) {
    for (let i = 1; i < sub.length; i++) {
      const a = sub[i - 1], b = sub[i];
      const samples = [0.25, 0.5, 0.75].map((t) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }));
      for (const h of shrunk) {
        if (samples.every((p) => pointInPolygon(p, h))) { count++; break; }
      }
    }
  }
  return count;
}

function hasBadCoord(subs) {
  for (const sub of subs) {
    for (const p of sub) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
    }
  }
  return false;
}

function totalPts(subs) {
  return subs.reduce((n, s) => n + s.length, 0);
}

// Build glyph contours (offset to a positive anchor so coords are sane) and the
// list of hole contours across the whole string.
function buildText(font, text) {
  const r = textToGlyphs(font, text, SIZE, { letterSpacing: 0 });
  const ax = 10, ay = 60; // anchor so baseline glyphs land in positive space
  const obj = {
    type: "text",
    points: [{ x: ax, y: ay }],
    params: { text, size: SIZE, spacing: 0.4, stitchLength: 2.5, angle: 0, outline: false },
    _glyphs: r.glyphs,
  };
  const subs = generateText(obj);
  // Holes in design space (apply same anchor shift the generator uses).
  const allHoles = [];
  for (const contours of r.glyphs) {
    const moved = contours.map((c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay })));
    allHoles.push(...holeContours(moved));
  }
  return { subs, holes: allHoles, glyphs: r.glyphs };
}

const HOLED = ["O", "U", "e", "a", "B", "8"]; // U has no true hole but is concave
const TRUE_HOLED = ["O", "e", "a", "B", "8"]; // glyphs with an actual counter

for (const fontFile of FONTS) {
  console.log(`\n=== Font: ${fontFile} ===`);
  const font = opentype.loadSync(new URL(`../fonts/${fontFile}`, import.meta.url).pathname);

  for (const letter of HOLED) {
    const { subs, holes } = buildText(font, letter);
    const cross = midpointsInHoles(subs, holes);
    const pts = totalPts(subs);
    const label = `"${letter}"  subs=${subs.length} pts=${pts} holes=${holes.length} cross=${cross}`;
    ok(cross === 0, `${label} — zero hole crossings`);
    ok(pts > 30, `${label} — reasonable penetration count`);
    ok(!hasBadCoord(subs), `${label} — no NaN/Infinity`);
    if (TRUE_HOLED.includes(letter)) {
      ok(subs.length > 1, `${label} — split into >1 subpath (holed glyph)`);
    }
  }

  // The word "good" — has counters in g, o, o, d.
  const { subs, holes } = buildText(font, "good");
  const cross = midpointsInHoles(subs, holes);
  const pts = totalPts(subs);
  const label = `"good" subs=${subs.length} pts=${pts} holes=${holes.length} cross=${cross}`;
  ok(cross === 0, `${label} — zero hole crossings`);
  ok(pts > 200, `${label} — reasonable penetration count`);
  ok(subs.length > 1, `${label} — split into >1 subpath`);
  ok(!hasBadCoord(subs), `${label} — no NaN/Infinity`);
}

// Also exercise a plain fill object with an interior hole (square + counter)
// through generateForObject to confirm the fill path is hole-aware too.
console.log(`\n=== Fill object (square with hole) ===`);
const outer = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }];
const inner = [{ x: 22, y: 22 }, { x: 38, y: 22 }, { x: 38, y: 38 }, { x: 22, y: 38 }];
const fillObj = {
  type: "fill",
  points: outer,
  contours: [outer, inner],
  params: { spacing: 0.45, angle: 0, stitchLength: 3.0, underlay: true },
};
const fsubs = generateForObject(fillObj);
const fcross = midpointsInHoles(fsubs, [inner]);
ok(fcross === 0, `fill object: zero hole crossings (cross=${fcross}, subs=${fsubs.length})`);
ok(totalPts(fsubs) > 50, `fill object: reasonable penetration count (${totalPts(fsubs)})`);
ok(!hasBadCoord(fsubs), `fill object: no NaN/Infinity`);
ok(fsubs.length > 1, `fill object: underlay + hole splits → >1 subpath (${fsubs.length})`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
