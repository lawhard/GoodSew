// Generate a PES file + the expected centered stitch stream, for cross-checking
// against pyembroidery (test/verify_pes.py).
import { writeFileSync } from "fs";
import { state, makeObject } from "../js/state.js";
import { compile } from "../js/compiler.js";
import { exportPES } from "../js/export/pes.js";

state.objects = [];
const square = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }];
state.objects.push(
  makeObject("fill", square, "#ed171f"),
  makeObject("running", [...square, { x: 20, y: 20 }], "#000000"),
  makeObject("satin", [{ x: 30, y: 90 }, { x: 70, y: 95 }], "#0a55a3"),
);

const compiled = compile();
const bytes = exportPES(compiled, "Verify");
writeFileSync("/tmp/gs_sample.pes", Buffer.from(bytes));

// Recreate the exporter's centered-units stream (trims folded into jumps).
const b = compiled.bounds;
const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
const expected = [];
for (const s of compiled.plan) {
  if (s.cmd === "trim") continue;
  expected.push({ x: Math.round((s.x - cx) * 10), y: Math.round((s.y - cy) * 10), cmd: s.cmd });
}
const stitches = expected.filter((s) => s.cmd === "stitch");
writeFileSync("/tmp/gs_expected.json", JSON.stringify({
  stitchCount: stitches.length,
  colorBlocks: compiled.colors.length,
  stitches: stitches.map((s) => [s.x, s.y]),
}, null, 0));

// Full plan as absolute 0.1mm commands (uncentered) for pyembroidery to re-encode.
const full = compiled.plan.map((s) => ({
  x: Math.round(s.x * 10), y: Math.round(s.y * 10), cmd: s.cmd,
}));
writeFileSync("/tmp/gs_plan.json", JSON.stringify(full));

console.log(`wrote /tmp/gs_sample.pes (${bytes.length} bytes), ${stitches.length} stitches, ${compiled.colors.length} colors`);
