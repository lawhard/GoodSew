// Generate a TEXT-HEAVY PES (many glyphs => many trims/jumps/color changes)
// and the expected centered stitch stream, for pyembroidery verification.
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { state, makeObject } from "../js/state.js";
import { compile } from "../js/compiler.js";
import { exportPES } from "../js/export/pes.js";
import { textToGlyphs } from "../js/fonts.js";

const require = createRequire(import.meta.url);
const opentype = require("../vendor/opentype.min.js");

function buildText(obj, fontFile) {
  const font = opentype.loadSync(new URL(`../fonts/${fontFile}`, import.meta.url).pathname);
  const r = textToGlyphs(font, obj.params.text, obj.params.size, { letterSpacing: obj.params.letterSpacing || 0 });
  obj._glyphs = r.glyphs;
}

state.objects = [];
const t1 = makeObject("text", [{ x: 8, y: 30 }], "#0a55a3");
t1.params.text = "Brother"; t1.params.size = 14; t1.params.outline = true;
buildText(t1, "Anton.ttf");

const t2 = makeObject("text", [{ x: 8, y: 60 }], "#ed171f");
t2.params.text = "SE700"; t2.params.size = 16;
buildText(t2, "Pacifico.ttf");

state.objects.push(t1, t2);

const compiled = compile();
const bytes = exportPES(compiled, "TextTest");
writeFileSync("/tmp/gs_sample.pes", Buffer.from(bytes));

const b = compiled.bounds;
const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
const full = [], expected = [];
for (const s of compiled.plan) {
  full.push({ x: Math.round(s.x * 10), y: Math.round(s.y * 10), cmd: s.cmd });
  if (s.cmd === "trim") continue;
  expected.push({ x: Math.round((s.x - cx) * 10), y: Math.round((s.y - cy) * 10), cmd: s.cmd });
}
const stitches = expected.filter((s) => s.cmd === "stitch");
writeFileSync("/tmp/gs_expected.json", JSON.stringify({
  stitchCount: stitches.length,
  colorBlocks: compiled.colors.length,
  stitches: stitches.map((s) => [s.x, s.y]),
}));
writeFileSync("/tmp/gs_plan.json", JSON.stringify(full));

const counts = compiled.plan.reduce((m, s) => ((m[s.cmd] = (m[s.cmd] || 0) + 1), m), {});
console.log(`text PES ${bytes.length} bytes; plan commands:`, counts);
