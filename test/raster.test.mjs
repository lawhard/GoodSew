// Raster logo vectorization: background removal, quantization, hole-aware
// tracing, and normalized output on a synthetic logo.
import { traceRaster } from "../js/import/raster.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };

// ---- synthetic 160×120 logo: white bg, red donut, green rectangle ----
const W = 160, H = 120;
const data = new Uint8ClampedArray(W * H * 4);
const put = (x, y, r, g, b) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 255, 255, 255);
// red donut centered (55,60): outer r=34, hole r=13
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - 55, y - 60);
  if (d <= 34 && d >= 13) put(x, y, 205, 30, 40);
}
// green rectangle
for (let y = 30; y < 92; y++) for (let x = 105; x < 140; x++) put(x, y, 20, 130, 60);
// a couple of speckle pixels that must be cleaned away
put(10, 10, 0, 0, 255); put(150, 110, 0, 0, 255);

const hoop = { w: 100, h: 100 };
const { items, box } = traceRaster({ width: W, height: H, data }, hoop);

ok(items.length === 2, `2 color regions (got ${items.length}: ${items.map(i => i.color).join(", ")})`);

const red = items.find((it) => { const r = parseInt(it.color.slice(1, 3), 16); return r > 150; });
const green = items.find((it) => { const g = parseInt(it.color.slice(3, 5), 16); return g > 90 && it !== red; });
ok(!!red, `red region found (${red && red.color})`);
ok(!!green, `green region found (${green && green.color})`);

if (red) {
  ok(red.base.length === 2, `donut traced with outer + hole (${red.base.length} loops)`);
  // hole loop should be markedly smaller
  const area = (L) => { let a = 0; for (let i = 0, j = L.length - 1; i < L.length; j = i++) a += L[j].x * L[i].y - L[i].x * L[j].y; return Math.abs(a / 2); };
  if (red.base.length === 2) {
    const [a, b] = red.base.map(area).sort((p, q) => q - p);
    ok(b < a * 0.4, `hole is much smaller than outer (${(b / a * 100).toFixed(0)}%)`);
  }
}
if (green) ok(green.base.length === 1, `rectangle traced as a single loop (${green.base.length})`);

// normalized space + placement
let inRange = true;
for (const it of items) for (const L of it.base) for (const p of L) {
  if (p.x < -0.01 || p.x > 1.01 || p.y < -0.01 || p.y > 1.01) inRange = false;
}
ok(inRange, "all base points within [0,1]");
ok(box.w > 0 && box.h > 0 && box.w <= hoop.w && box.h <= hoop.h, `box fits hoop (${box.w.toFixed(1)}×${box.h.toFixed(1)}mm)`);
ok(Math.abs((box.x + box.w / 2) - hoop.w / 2) < 1, "box centered");

// white background must not be an item; blue speckles must be gone
ok(!items.some((it) => it.color === "#ffffff" || parseInt(it.color.slice(1, 3), 16) > 230 && parseInt(it.color.slice(3, 5), 16) > 230), "background not imported");
ok(!items.some((it) => { const b = parseInt(it.color.slice(5, 7), 16); const r = parseInt(it.color.slice(1, 3), 16); return b > 180 && r < 80; }), "speckles cleaned");

// transparent-background variant: alpha channel drives the mask
{
  const d2 = new Uint8ClampedArray(W * H * 4); // all alpha 0
  for (let y = 40; y < 80; y++) for (let x = 40; x < 120; x++) {
    const i = (y * W + x) * 4; d2[i] = 10; d2[i + 1] = 40; d2[i + 2] = 160; d2[i + 3] = 255;
  }
  const r2 = traceRaster({ width: W, height: H, data: d2 }, hoop);
  ok(r2.items.length === 1, `transparent bg: 1 region (${r2.items.length})`);
  ok(r2.items[0].base.length === 1, "transparent bg: single loop");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
