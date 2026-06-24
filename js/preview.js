// Product preview / mockup. Renders the compiled design at TRUE physical scale
// onto a garment so the user can judge real size and placement on common items.
//
// Each product declares the real-world width it spans (mm) and where the
// embroidery sits (as a fraction of the drawing), so the design is scaled
// correctly relative to the item. The SE700 maxes at 100mm, which on a shirt
// chest reads as a realistic left-chest logo.

export const PRODUCTS = [
  { id: "tshirt",  label: "Medium T-Shirt", realW: 520, draw: drawTshirt,  zone: { x: 0.355, y: 0.40 } },
  { id: "shoe",    label: "Shoe",           realW: 300, draw: drawShoe,    zone: { x: 0.55, y: 0.52 } },
  { id: "towel",   label: "Towel",          realW: 500, draw: drawTowel,   zone: { x: 0.5, y: 0.72 } },
  { id: "bathmat", label: "Bath Mat",       realW: 600, draw: drawBathmat, zone: { x: 0.5, y: 0.5 } },
  { id: "custom",  label: "Custom Rectangle", realW: 300, draw: drawCustom, zone: { x: 0.5, y: 0.5 }, custom: true },
];

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
}

// Render a product mockup with the design composited at real scale.
// opts: { customW, customH } in mm for the custom rectangle.
export function renderPreview(ctx, compiled, product, opts = {}) {
  const canvas = ctx.canvas;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, W, H);

  // The drawing fits in a centered box with margin.
  const margin = 0.10;
  const box = { x: W * margin, y: H * margin, w: W * (1 - margin * 2), h: H * (1 - margin * 2) };

  const realW = product.custom ? (opts.customW || 300) : product.realW;
  const realH = product.custom ? (opts.customH || 200) : null;
  const drawn = product.draw(ctx, box, { realW, realH });
  // drawn = { x, y, w, h } pixel rect actually occupied by the item body
  // and drawn.spanMm = real width the body spans.

  const spanMm = drawn.spanMm || realW;
  const mmToPx = drawn.w / spanMm;

  // Embroidery placement center (px).
  const zone = product.custom ? { x: 0.5, y: 0.5 } : product.zone;
  const cxPx = drawn.x + drawn.w * zone.x;
  const cyPx = drawn.y + drawn.h * zone.y;

  drawDesign(ctx, compiled, cxPx, cyPx, mmToPx);

  return { mmToPx, cxPx, cyPx };
}

// Paint the design's stitches centered at (cxPx,cyPx) scaled by mmToPx.
function drawDesign(ctx, compiled, cxPx, cyPx, mmToPx) {
  if (!compiled || !compiled.plan.length) return;
  const b = compiled.bounds;
  const dcx = (b.minX + b.maxX) / 2, dcy = (b.minY + b.maxY) / 2;
  const toPx = (p) => ({ x: cxPx + (p.x - dcx) * mmToPx, y: cyPx + (p.y - dcy) * mmToPx });

  // subtle backing shadow for legibility on light fabrics
  ctx.save();
  ctx.lineWidth = Math.max(0.8, mmToPx * 0.42);
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  let last = null, penDown = false;
  for (const s of compiled.plan) {
    if (s.cmd === "stitch") {
      const p = toPx(s);
      if (penDown && last) {
        const col = compiled.colors[s.color] ? compiled.colors[s.color].color : "#222";
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      last = p; penDown = true;
    } else { // jump/trim/color break the thread path
      if (s.cmd === "jump" || s.cmd === "stitch") last = toPx(s);
      penDown = false;
    }
  }
  ctx.restore();
}

// ---------------- product illustrations ----------------
// Each returns the body pixel rect plus the real width that rect spans (mm).

function drawTshirt(ctx, box, { realW }) {
  // Fit a tee into box; body width ~ realW. The drawing is taller than wide.
  const w = box.w, h = box.h;
  const cx = box.x + w / 2;
  // tee proportions
  const bodyW = Math.min(w * 0.62, h * 0.55);
  const bodyTop = box.y + h * 0.12;
  const bodyBot = box.y + h * 0.95;
  const shoulderY = bodyTop + bodyW * 0.10;
  const left = cx - bodyW / 2, right = cx + bodyW / 2;
  const sleeve = bodyW * 0.42;

  ctx.fillStyle = "#e9edf2"; ctx.strokeStyle = "#c4ccd6"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, shoulderY);
  ctx.lineTo(left - sleeve, shoulderY + sleeve * 0.7);
  ctx.lineTo(left - sleeve * 0.6, shoulderY + sleeve * 1.25);
  ctx.lineTo(left, shoulderY + sleeve * 0.75);
  ctx.lineTo(left, bodyBot);
  ctx.lineTo(right, bodyBot);
  ctx.lineTo(right, shoulderY + sleeve * 0.75);
  ctx.lineTo(right + sleeve * 0.6, shoulderY + sleeve * 1.25);
  ctx.lineTo(right + sleeve, shoulderY + sleeve * 0.7);
  ctx.lineTo(right, shoulderY);
  // collar
  ctx.quadraticCurveTo(cx + bodyW * 0.16, shoulderY + bodyW * 0.13, cx, shoulderY + bodyW * 0.12);
  ctx.quadraticCurveTo(cx - bodyW * 0.16, shoulderY + bodyW * 0.13, left, shoulderY);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  return { x: left, y: bodyTop, w: bodyW, h: bodyBot - bodyTop, spanMm: realW };
}

function drawShoe(ctx, box, { realW }) {
  const w = box.w, h = box.h;
  const x = box.x, baseY = box.y + h * 0.72;
  const len = w * 0.92, ht = h * 0.42;
  const sx = box.x + (w - len) / 2;
  ctx.fillStyle = "#dfe5ec"; ctx.strokeStyle = "#b9c2cd"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, baseY);
  ctx.lineTo(sx, baseY - ht * 0.5);
  ctx.quadraticCurveTo(sx + len * 0.30, baseY - ht * 1.15, sx + len * 0.52, baseY - ht * 0.95);
  ctx.quadraticCurveTo(sx + len * 0.74, baseY - ht * 0.8, sx + len, baseY - ht * 0.35);
  ctx.lineTo(sx + len, baseY);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // sole
  ctx.fillStyle = "#aeb7c2";
  ctx.fillRect(sx, baseY, len, ht * 0.16);
  return { x: sx, y: baseY - ht, w: len, h: ht, spanMm: realW };
}

function drawTowel(ctx, box, { realW }) {
  const w = Math.min(box.w * 0.7, box.h * 0.55), h = Math.min(box.h * 0.96, w * 1.5);
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  ctx.fillStyle = "#eaf0f5"; ctx.strokeStyle = "#c4ccd6"; ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
  // woven border stripes near bottom
  ctx.strokeStyle = "#9fc2d8"; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const yy = y + h * 0.80 + i * 8;
    ctx.beginPath(); ctx.moveTo(x + 10, yy); ctx.lineTo(x + w - 10, yy); ctx.stroke();
  }
  return { x, y, w, h, spanMm: realW };
}

function drawBathmat(ctx, box, { realW }) {
  const w = Math.min(box.w * 0.9, box.h * 1.4), h = w * 0.62;
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  ctx.fillStyle = "#e6ece2"; ctx.strokeStyle = "#c1cbb9"; ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 18); ctx.fill(); ctx.stroke();
  // fluffy texture dots
  ctx.fillStyle = "rgba(180,195,170,0.35)";
  for (let i = 0; i < 240; i++) {
    const px = x + 12 + Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1 * (w - 24);
    const py = y + 12 + Math.abs(Math.sin(i * 78.233) * 12345.6) % 1 * (h - 24);
    ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  return { x, y, w, h, spanMm: realW };
}

function drawCustom(ctx, box, { realW, realH }) {
  const aspect = realW / (realH || realW);
  let w = box.w, h = w / aspect;
  if (h > box.h) { h = box.h; w = h * aspect; }
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  ctx.fillStyle = "#e9edf2"; ctx.strokeStyle = "#c4ccd6"; ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  return { x, y, w, h, spanMm: realW };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
