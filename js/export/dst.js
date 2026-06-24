// Tajima DST writer. DST is the universal embroidery format read by almost every
// machine and digitizer. 512-byte ASCII header + 3-byte stitch records.
//
// Each record encodes a relative move (dx, dy) in 0.1 mm as balanced-ternary
// digits over the weights {1, 3, 9, 27, 81} (so each axis spans -121..+121),
// spread across the three bytes per the standard DST bit table, plus jump /
// color-change / end flags in byte 3. DST's Y axis points UP, so we flip Y.

const MAX = 121; // max move per record, in 0.1 mm units

// Balanced-ternary digits [w1, w3, w9, w27, w81], each in {-1, 0, +1}.
function ternary(n) {
  const d = [];
  let x = n;
  for (let i = 0; i < 5; i++) {
    let r = x % 3;
    x = (x - r) / 3;
    if (r === 2) { r = -1; x += 1; }
    else if (r === -2) { r = 1; x -= 1; }
    d.push(r);
  }
  return d; // d[0]=±1, d[1]=±3, d[2]=±9, d[3]=±27, d[4]=±81
}

// Encode one 3-byte record. flags: { jump, color, end }.
function encodeRecord(dx, dy, flags = {}) {
  if (flags.end) return [0x00, 0x00, 0xf3];
  let b0 = 0, b1 = 0, b2 = 0;
  const X = ternary(dx), Y = ternary(dy);
  // X bits
  if (X[0] > 0) b0 |= 0x01; else if (X[0] < 0) b0 |= 0x02; // ±1
  if (X[2] > 0) b0 |= 0x04; else if (X[2] < 0) b0 |= 0x08; // ±9
  if (X[1] > 0) b1 |= 0x01; else if (X[1] < 0) b1 |= 0x02; // ±3
  if (X[3] > 0) b1 |= 0x04; else if (X[3] < 0) b1 |= 0x08; // ±27
  if (X[4] > 0) b2 |= 0x04; else if (X[4] < 0) b2 |= 0x08; // ±81
  // Y bits
  if (Y[0] > 0) b0 |= 0x80; else if (Y[0] < 0) b0 |= 0x40; // ±1
  if (Y[2] > 0) b0 |= 0x20; else if (Y[2] < 0) b0 |= 0x10; // ±9
  if (Y[1] > 0) b1 |= 0x80; else if (Y[1] < 0) b1 |= 0x40; // ±3
  if (Y[3] > 0) b1 |= 0x20; else if (Y[3] < 0) b1 |= 0x10; // ±27
  if (Y[4] > 0) b2 |= 0x20; else if (Y[4] < 0) b2 |= 0x10; // ±81
  b2 |= 0x03;                       // fixed bits
  // Color change is the jump+stop bit pair (0xC3); a lone 0x40 reads as DST
  // sequin mode. Plain jumps use 0x80.
  if (flags.color) b2 |= 0xc0;
  else if (flags.jump) b2 |= 0x80;
  return [b0, b1, b2];
}

function headerLine(records, colorChanges, ext) {
  const pad = (s, n) => s.padEnd(n, " ").slice(0, n);
  const sgn = (v) => (v >= 0 ? "+" : "-") + String(Math.abs(Math.round(v))).padStart(5, "0");
  const lines =
    "LA:" + pad("GoodSew", 16) + "\r" +
    "ST:" + String(records).padStart(7, " ") + "\r" +
    "CO:" + String(colorChanges).padStart(3, " ") + "\r" +
    "+X:" + String(ext.maxX).padStart(5, " ") + "\r" +
    "-X:" + String(Math.abs(ext.minX)).padStart(5, " ") + "\r" +
    "+Y:" + String(ext.maxY).padStart(5, " ") + "\r" +
    "-Y:" + String(Math.abs(ext.minY)).padStart(5, " ") + "\r" +
    "AX:" + sgn(ext.ax) + "\r" +
    "AY:" + sgn(ext.ay) + "\r" +
    "MX:" + sgn(0) + "\r" +
    "MY:" + sgn(0) + "\r" +
    "PD:******\r";
  const bytes = [];
  for (let i = 0; i < lines.length; i++) bytes.push(lines.charCodeAt(i) & 0xff);
  bytes.push(0x1a); // EOF marker
  while (bytes.length < 512) bytes.push(0x20); // pad to 512 with spaces
  return bytes.slice(0, 512);
}

// Build a DST file from a compiled plan. compiled: { plan, colors, bounds }.
export function exportDST(compiled) {
  const { plan, bounds } = compiled;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const toX = (x) => Math.round((x - cx) * 10);
  const toY = (y) => Math.round((cy - y) * 10); // DST Y up → flip

  const records = [];
  let px = 0, py = 0;
  let minX = 0, minY = 0, maxX = 0, maxY = 0, colorChanges = 0;

  // Move to (tx,ty) emitting jump records for any leg over the DST per-record
  // limit, then a final record carrying the requested command flag.
  const move = (tx, ty, flags) => {
    let dx = tx - px, dy = ty - py;
    while (Math.abs(dx) > MAX || Math.abs(dy) > MAX) {
      const sx = Math.max(-MAX, Math.min(MAX, dx));
      const sy = Math.max(-MAX, Math.min(MAX, dy));
      records.push(encodeRecord(sx, sy, { jump: true }));
      px += sx; py += sy; dx -= sx; dy -= sy;
    }
    records.push(encodeRecord(dx, dy, flags));
    px += dx; py += dy;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  };

  for (const s of plan) {
    if (s.cmd === "trim") continue; // DST has no trim; the following jump travels
    const tx = toX(s.x), ty = toY(s.y);
    if (s.cmd === "stitch") move(tx, ty, {});
    else if (s.cmd === "jump") move(tx, ty, { jump: true });
    else if (s.cmd === "color") { records.push(encodeRecord(0, 0, { color: true })); colorChanges++; }
    else if (s.cmd === "end") { /* handled below */ }
  }
  records.push(encodeRecord(0, 0, { end: true }));

  const header = headerLine(records.length, colorChanges, {
    minX, minY, maxX, maxY, ax: px, ay: py,
  });

  const out = new Uint8Array(header.length + records.length * 3);
  out.set(header, 0);
  let o = header.length;
  for (const r of records) { out[o++] = r[0]; out[o++] = r[1]; out[o++] = r[2]; }
  return out;
}
