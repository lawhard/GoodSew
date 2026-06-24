// Generate a DST file + expected metadata, for cross-checking against
// pyembroidery (test/verify_dst.py).
import { writeFileSync } from "fs";
import { state, makeObject } from "../js/state.js";
import { compile } from "../js/compiler.js";
import { exportDST } from "../js/export/dst.js";

state.objects = [];
const square = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }];
state.objects.push(
  makeObject("fill", square, "#ed171f"),
  makeObject("running", [...square, { x: 20, y: 20 }], "#000000"),
  makeObject("satin", [{ x: 30, y: 90 }, { x: 70, y: 95 }], "#0a55a3"),
);

const compiled = compile();
const bytes = exportDST(compiled);
writeFileSync("/tmp/gs_sample.dst", Buffer.from(bytes));

const stitches = compiled.plan.filter((s) => s.cmd === "stitch");
writeFileSync("/tmp/gs_dst_expected.json", JSON.stringify({
  stitchCount: stitches.length,
  colorBlocks: compiled.colors.length,
  width: Math.round(compiled.bounds.w * 10),
  height: Math.round(compiled.bounds.h * 10),
}, null, 0));

console.log(`wrote /tmp/gs_sample.dst (${bytes.length} bytes), ${stitches.length} stitches, ${compiled.colors.length} colors`);
