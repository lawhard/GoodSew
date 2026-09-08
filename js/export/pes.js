import { assertExportable } from "../qa.js";

// Brother PES v1 + PEC writer. Byte-accurate per pyembroidery's format.
// See docs/pes-format-notes.md. Units: 0.1 mm, Y down. Long-form deltas BIG-endian.

class ByteWriter {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff); return this; }
  u16le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u24le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); return this; }
  u32le(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); return this; }
  f32le(v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return this.raw(b); }
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

  // Mirrors pyembroidery pec_encode exactly (xx/yy advance for every command).
  for (const s of stream) {
    const dx = Math.round(s.ux - xx);
    const dy = Math.round(s.uy - yy);
    xx += dx; yy += dy;

    if (s.cmd === "stitch") {
      if (jumping) {
        if (dx !== 0 && dy !== 0) writeStitch(w, 0, 0);
        jumping = false;
      }
      writeStitch(w, dx, dy);
    } else if (s.cmd === "jump") {
      jumping = true;
      if (init) writeJumpMove(w, dx, dy, JUMP_FLAG);
      else writeJumpMove(w, dx, dy, TRIM_FLAG);
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
// Exact pyembroidery blank template: a bordered box inset by one row so the
// FIRST byte is 0x00. This matters: the PEC reader (and the machine) treat the
// END of stitches as 0xFF followed by 0x00 — i.e. the first graphics byte must
// be 0x00, otherwise the reader runs past END into the thumbnail data.
const PEC_BLANK = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x10, 0x04, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x04, 0x00, 0x00, 0x00, 0x00, 0x20, 0x08, 0x00, 0x00, 0x00, 0x00, 0x10,
  0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

function blankIcon() {
  return Uint8Array.from(PEC_BLANK);
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

// Full PES v1 layout, following pyembroidery PesWriter's CEmbOne/CSewSeg
// representation. A PEC-only round trip cannot validate this second copy of
// the design. Keep its coordinates on the SAME integer grid as the PEC data.
function writePESLayout(w, stream, palette, b) {
  const sections = [];
  let color = 0, lastStitch = {ux: 0, uy: 0};
  for (let i = 0; i < stream.length;) {
    const cmd = stream[i].cmd;
    if (cmd === 'end') break;
    if (cmd === 'color') { color++; i++; continue; }
    let j = i + 1;
    while (j < stream.length && stream[j].cmd === cmd) j++;
    if (cmd === 'jump') {
      sections.push({flag: 1, color: palette[color], points: [lastStitch, stream[j - 1]]});
    } else if (cmd === 'stitch') {
      // Segment point counts are uint16, even though the SE700 accepts 100k
      // stitches. Repeat the boundary point when splitting a long path.
      for (let start = i; start < j;) {
        const end = Math.min(j, start + 65535);
        sections.push({flag: 0, color: palette[color], points: stream.slice(start, end)});
        if (end === j) break;
        start = end - 1;
      }
      lastStitch = stream[j - 1];
    }
    i = j;
  }
  if (sections.length > 65535) throw new Error('Too many separate paths for PES v1. Simplify the design.');

  w.ascii('#PES0001').u32le(0);
  // Standard v1 flags used by the reference writer; SE700 hoop fit is
  // enforced separately against actual encoded motion extents by QA.
  w.u16le(1).u16le(1).u16le(1).u16le(0xffff).u16le(0);
  w.u16le(7).ascii('CEmbOne').pad(0, 16);
  // CSewSeg has a bottom-left local origin. PES's design-page center is
  // (1000,1000), independent of the PEC stream's centered origin.
  w.f32le(1).f32le(0).f32le(0).f32le(1)
    .f32le(1000 - b.w / 2).f32le(1000 + b.h / 2);
  w.u16le(1).u16le(0).u16le(0).u16le(b.w).u16le(b.h).pad(0, 8);
  w.u16le(sections.length).u16le(0xffff).u16le(0);
  w.u16le(7).ascii('CSewSeg');
  const colorLog = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (i) w.u16le(0x8003);
    if (!i || sections[i - 1].color !== s.color) colorLog.push([i, s.color]);
    w.u16le(s.flag).u16le(s.color).u16le(s.points.length);
    for (const p of s.points) w.u16le(p.ux - b.minX).u16le(p.uy - b.maxY);
  }
  w.u16le(colorLog.length);
  for (const [section, thread] of colorLog) w.u16le(section).u16le(thread);
  w.u16le(0).u16le(0);
  w.setU32leAt(8, w.length);
}

// Build the entire PES file from a compiled plan.
// compiled: { plan, colors, bounds }   name: design name string.
export function exportPES(compiled, name = "GoodSew") {
  assertExportable(compiled);
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

  // Quantize endpoints first: round(max-min) can differ from the actual
  // round(max)-round(min) stitch extent by 0.1 mm.
  const encoded = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
  for (const s of stream) if (s.cmd === 'stitch' || s.cmd === 'jump') {
    encoded.minX = Math.min(encoded.minX, s.ux); encoded.maxX = Math.max(encoded.maxX, s.ux);
    encoded.minY = Math.min(encoded.minY, s.uy); encoded.maxY = Math.max(encoded.maxY, s.uy);
  }
  const width = encoded.w = encoded.maxX - encoded.minX;
  const height = encoded.h = encoded.maxY - encoded.minY;
  const paletteIdx = colors.map((c) => c.brother.i);
  const numColors = Math.max(1, paletteIdx.length);

  const w = new ByteWriter();

  writePESLayout(w, stream, paletteIdx, encoded);

  // --- PEC header ---
  const shortName = name.replace(/[^A-Za-z0-9]/g, "").substring(0, 8) || 'GoodSew';
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
  // PEC has a separate four-byte origin record BEFORE the first movement.
  // Brother/current pystitch skip it when decoding stitches. Omitting it
  // makes the machine discard the first positioning jump, shifting/clipping
  // the entire design. Older pyembroidery readers instead count it as a jump.
  writeJumpMove(w, -encoded.minX, -encoded.minY, JUMP_FLAG);
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
