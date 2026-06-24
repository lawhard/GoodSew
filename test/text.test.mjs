// Verify text → glyph contours → tatami fill produces sane stitches.
import { createRequire } from "module";
import { textToGlyphs } from "../js/fonts.js";
import { generateText } from "../js/stitches.js";
import { buildShape } from "../js/shapes.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };

console.log("Text → contours:");
const font = opentype.loadSync(new URL("../fonts/Anton.ttf", import.meta.url).pathname);
const r = textToGlyphs(font, "AB", 16, { letterSpacing: 0 });
ok(r.glyphs.length === 2, `2 glyphs (got ${r.glyphs.length})`);
ok(r.width > 0, `advance width ${r.width.toFixed(1)}mm`);
// 'A' has a counter (hole) → its glyph should have 2 contours
ok(r.glyphs[0].length >= 2, `'A' has ${r.glyphs[0].length} contours (outer + counter)`);

console.log("Text → stitches:");
const obj = { type: "text", points: [{ x: 10, y: 20 }], params: { text: "AB", size: 16, spacing: 0.5, stitchLength: 2.5, angle: 0, outline: true, outlineLen: 2 }, _glyphs: r.glyphs };
const subs = generateText(obj);
ok(subs.length >= 2, `${subs.length} sub-paths (fills + outlines)`);
const totalPts = subs.reduce((n, s) => n + s.length, 0);
ok(totalPts > 50, `${totalPts} penetration points`);
// check anchor offset applied: all points should be near x>=10, y>=~5
const all = subs.flat();
const minX = Math.min(...all.map((p) => p.x));
ok(minX >= 9, `points offset by anchor (minX=${minX.toFixed(1)})`);

console.log("Shapes:");
for (const kind of ["rect", "ellipse", "star5", "heart", "hexagon"]) {
  const pts = buildShape(kind, { x: 0, y: 0, w: 30, h: 30 });
  ok(pts.length >= 3, `${kind}: ${pts.length} points`);
}

console.log(fails === 0 ? "\nALL PASS ✓" : `\n${fails} FAILURE(S) ✗`);
process.exit(fails ? 1 : 0);
