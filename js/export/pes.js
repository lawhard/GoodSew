// Brother PES v1 + PEC writer. Byte-accurate per pyembroidery's format.
// See docs/pes-format-notes.md. Units: 0.1 mm, Y down. Long-form deltas BIG-endian.

class ByteWriter {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff); return this; }
  u16le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u24le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); return this; }
  u32le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); return this; }
  ascii(str) { for (let i = 0; i < str.length; i++) this.bytes.push(str.charCodeAt(i) & 0xff); return this; }
  raw(arr) { for (const b of arr) this.bytes.push(b & 0xff); return this; }
  pad(byte, count) { for (let i = 0; i < count; i++) this.bytes.push(byte & 0xff); return this; }
  get length() { return this.bytes.length; }
  setU24leAt(pos, v) {
    this.bytes[pos] = v & 0xff;
    this.bytes[pos + 1] = (v >> 8) & 0xff;
    this.bytes[pos + 2] = (v >> 16) & 0xff;
  }
  setU32leAt(pos, v) {
    this.bytes[pos] = v & 0xff;
    this.bytes[pos + 1] = (v >> 8) & 0xff;
    this.bytes[pos + 2] = (v >> 16) & 0xff;
    this.bytes[pos + 3] = (v >> 24) & 0xff;
  }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

const JUMP_FLAG = 0x10;
const TRIM_FLAG = 0x20;

// Encode one delta value into the writer (short or long form).
function writeValue(w, value, long, flag) {
  if (!long && value > -64 && value < 63) {
    w.u8(value & 0x7f); // short form
  } else {
    let v = value & 0x0fff;
    v |= 0x8000;
    v |= (flag << 8);
    w.u8((v >> 8) & 0xff); // BIG-endian high byte first
    w.u8(v & 0xff);
  }
}

function writeStitch(w, dx, dy) {
  writeValue(w, dx, false, 0);
  writeValue(w, dy, false, 0);
}
function writeJumpMove(w, dx, dy, flag) {
  writeValue(w, dx, true, flag);
  writeValue(w, dy, true, flag);
}

// Translate the app plan into the PEC stitch stream.
// commandStream: array of { ux, uy, cmd } in 0.1mm units, cmd in
// 'stitch' | 'jump' | 'color' | 'end'  (trims already folded into jumps).
function pecEncode(w, stream) {
  let xx = 0, yy = 0;
  let colorTwo = true;
  let jumping = true;
  let init = true;

  for (const s of stream) {
    const dx = Math.round(s.ux - xx);
    const dy = Math.round(s.uy - yy);

    if (s.cmd === "stitch") {
      if (jumping && (dx !== 0 || dy !== 0)) {
        writeStitch(w, 0, 0);
        jumping = false;
      }
      writeStitch(w, dx, dy);
      xx += dx; yy += dy;
    } else if (s.cmd === "jump") {
      jumping = true;
      if (init) writeJumpMove(w, dx, dy, JUMP_FLAG);
      else writeJumpMove(w, dx, dy, TRIM_FLAG);
      xx += dx; yy += dy;
    } else if (s.cmd === "color") {
      if (jumping) { writeStitch(w, 0, 0); jumping = false; }
      w.u8(0xfe).u8(0xb0).u8(colorTwo ? 0x02 : 0x01);
      colorTwo = !colorTwo;
    } else if (s.cmd === "end") {
      w.u8(0xff);
      break;
    }
    init = false;
  }
}

// --- PEC thumbnail graphics (48x38, 1bpp, stride 6) ---
function blankIcon() {
  const g = new Uint8Array(228);
  const mark = (x, y) => { if (x >= 0 && x < 48 && y >= 0 && y < 38) g[y * 6 + (x >> 3)] |= 1 << (x & 7); };
  for (let x = 0; x < 48; x++) { mark(x, 0); mark(x, 37); }
  for (let y = 0; y < 38; y++) { mark(0, y); mark(47, y); }
  return g;
}

function drawScaled(g, pts, bounds, buffer = 5) {
  if (pts.length === 0) return;
  const w = bounds.w || 1, h = bounds.h || 1;
  const scale = Math.min((48 - buffer) / w, (38 - buffer) / h);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  for (const p of pts) {
    const px = Math.floor(p.x * scale - cx * scale + 24);
    const py = Math.floor(p.y * scale - cy * scale + 19);
    if (px >= 0 && px < 48 && py >= 0 && py < 38) g[py * 6 + (px >> 3)] |= 1 << (px & 7);
  }
}

// Build the entire PES file from a compiled plan.
// compiled: { plan, colors, bounds }   name: design name string.
export function exportPES(compiled, name = "GoodSew") {
  const { plan, colors, bounds } = compiled;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const toU = (x, c) => Math.round((x - c) * 10);

  // Build the command stream (drop standalone trims; jumps carry the trim flag).
  const stream = [];
  for (const s of plan) {
    if (s.cmd === "trim") continue;
    stream.push({ ux: toU(s.x, cx), uy: toU(s.y, cy), cmd: s.cmd });
  }
  if (stream.length === 0 || stream[stream.length - 1].cmd !== "end") {
    stream.push({ ux: 0, uy: 0, cmd: "end" });
  }

  const width = Math.round(bounds.w * 10);
  const height = Math.round(bounds.h * 10);
  const paletteIdx = colors.map((c) => c.brother.i);
  const numColors = Math.max(1, paletteIdx.length);

  const w = new ByteWriter();

  // --- PES v1 truncated header (PEC pointer = 22) ---
  w.ascii("#PES0001");
  w.raw([0x16, 0x00, 0x00, 0x00]); // PEC pointer = 0x16 (22)
  w.pad(0x00, 10);                 // filler to reach offset 22

  // --- PEC header ---
  const pecStart = w.length;
  const shortName = name.substring(0, 8);
  const laLine = "LA:" + shortName.padEnd(16, " ");
  w.ascii(laLine).u8(0x0d);        // 20 bytes
  w.pad(0x20, 12).u8(0xff).u8(0x00); // 14 bytes
  w.u8(0x06);                      // icon stride
  w.u8(0x26);                      // icon height = 38

  let currentThreadCount;
  if (paletteIdx.length >= 1) {
    w.pad(0x20, 12);
    w.u8((paletteIdx.length - 1) & 0xff);
    for (const idx of paletteIdx) w.u8(idx);
    currentThreadCount = paletteIdx.length;
  } else {
    w.raw([0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff]);
    currentThreadCount = 0;
  }
  for (let i = currentThreadCount; i < 463; i++) w.u8(0x20);

  // --- PEC stitch block ---
  const blockStart = w.length;
  w.u8(0x00).u8(0x00);
  const lenPos = w.length;
  w.u24le(0x000000);               // block length placeholder
  w.raw([0x31, 0xff, 0xf0]);
  w.u16le(width & 0xffff);
  w.u16le(height & 0xffff);
  w.u16le(0x01e0);
  w.u16le(0x01b0);
  pecEncode(w, stream);
  w.setU24leAt(lenPos, w.length - blockStart);

  // --- PEC graphics (composite + per color) ---
  const stitchPts = plan.filter((s) => s.cmd === "stitch");
  const composite = blankIcon();
  drawScaled(composite, stitchPts, bounds, 4);
  w.raw(composite);
  for (let ci = 0; ci < numColors; ci++) {
    const g = blankIcon();
    drawScaled(g, stitchPts.filter((s) => s.color === ci), bounds, 5);
    w.raw(g);
  }

  return w.toUint8Array();
}
