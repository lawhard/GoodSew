// Headless verification of the compile → stats → PES-export pipeline.
// Run with: node test/pipeline.test.mjs
import { state, makeObject } from "../js/state.js";
import { compile } from "../js/compiler.js";
import { computeStats } from "../js/stats.js";
import { exportPES } from "../js/export/pes.js";

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  ✗ " + msg); failures++; } else console.log("  ✓ " + msg); };

// --- Build a design: a filled square + a running outline (different colors) ---
state.objects = [];
const square = [
  { x: 30, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 70 }, { x: 30, y: 70 },
];
const fill = makeObject("fill", square, "#ed171f");
const outline = makeObject("running", [...square, { x: 30, y: 30 }], "#000000");
const satin = makeObject("satin", [{ x: 40, y: 90 }, { x: 90, y: 95 }, { x: 120, y: 88 }], "#0a55a3");
state.objects.push(fill, outline, satin);

console.log("Compile:");
const compiled = compile();
ok(compiled.plan.length > 100, `plan has ${compiled.plan.length} entries`);
ok(compiled.colors.length === 3, `3 color blocks (got ${compiled.colors.length})`);
const cmds = compiled.plan.reduce((m, s) => ((m[s.cmd] = (m[s.cmd] || 0) + 1), m), {});
console.log("  commands:", cmds);
ok(cmds.stitch > 50, "has stitches");
ok((cmds.color || 0) === 2, `2 color changes (got ${cmds.color || 0})`);
ok((cmds.trim || 0) >= 1, "has trims");
ok(compiled.plan[compiled.plan.length - 1].cmd === "end", "plan ends with 'end'");

console.log("Stats:");
const st = computeStats(compiled);
ok(st.threadColors === 3, `3 thread colors (got ${st.threadColors})`);
ok(st.seconds > 0, `run time ${st.seconds.toFixed(1)}s`);
console.log(`  ${st.stitches} stitches, ${st.colorChanges} changes, ${st.jumps} jumps, ${st.trims} trims, ${st.width.toFixed(1)}x${st.height.toFixed(1)}mm`);

console.log("PES export:");
const bytes = exportPES(compiled, "TestDsgn");
ok(bytes.length > 600, `file is ${bytes.length} bytes`);

const magic = String.fromCharCode(...bytes.slice(0, 8));
ok(magic === "#PES0001", `magic '${magic}'`);
const pecPtr = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
ok(pecPtr === 22, `PEC pointer = ${pecPtr} (expect 22)`);
const la = String.fromCharCode(...bytes.slice(22, 25));
ok(la === "LA:", `PEC label '${la}'`);
// icon stride/height at fixed offset after 20(LA)+14 = pecStart(22)+34 = 56
ok(bytes[22 + 34] === 0x06, "icon stride 0x06");
ok(bytes[22 + 35] === 0x26, "icon height 0x26 (38)");
ok(bytes.includes(0xff), "stream contains 0xFF end marker");
// color change marker FE B0 must appear
let feb0 = false;
for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0xfe && bytes[i + 1] === 0xb0) feb0 = true;
ok(feb0, "contains FE B0 color-change marker");

// --- decode the PEC stitch stream and confirm it round-trips bounds ---
console.log("PEC stream round-trip:");
// locate stitch block: after header padding. We know structure: find '31 FF F0'.
let bp = -1;
for (let i = 22 + 34; i < bytes.length - 3; i++) {
  if (bytes[i] === 0x31 && bytes[i + 1] === 0xff && bytes[i + 2] === 0xf0) { bp = i + 3; break; }
}
ok(bp > 0, "found 31 FF F0 marker");
let p = bp + 8; // skip width,height,0x01E0,0x01B0 (4 x int16)
let x = 0, y = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, decoded = 0;
function readDelta() {
  let b = bytes[p++];
  if (b & 0x80) {
    let val = ((b & 0x0f) << 8) | bytes[p++];
    if (val & 0x800) val -= 0x1000;
    return val;
  } else {
    if (b & 0x40) b -= 0x80; // sign-extend 7-bit
    return b;
  }
}
let guard = 0;
while (p < bytes.length && guard++ < 100000) {
  const b = bytes[p];
  if (b === 0xff) { break; }
  if (b === 0xfe && bytes[p + 1] === 0xb0) { p += 3; continue; }
  const dx = readDelta();
  const dy = readDelta();
  x += dx; y += dy; decoded++;
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
const decW = (maxX - minX) / 10, decH = (maxY - minY) / 10;
console.log(`  decoded ${decoded} moves, bbox ${decW.toFixed(1)} x ${decH.toFixed(1)} mm`);
ok(Math.abs(decW - st.width) < 1.0, `decoded width ${decW.toFixed(1)} ~= ${st.width.toFixed(1)}`);
ok(Math.abs(decH - st.height) < 1.0, `decoded height ${decH.toFixed(1)} ~= ${st.height.toFixed(1)}`);

console.log(failures === 0 ? "\nALL PASS ✓" : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
