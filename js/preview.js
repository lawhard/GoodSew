// Product preview / mockup. Renders the compiled design at TRUE physical scale
// onto a garment so the user can judge real size and placement.
//
// Each product is drawn with realistic proportions keyed to real-world sizes
// (mm). The design is scaled by its mm size relative to the item's real body
// dimension, so a 100 mm SE700 design reads at a believable size on each item.

// Every product has ADJUSTABLE real-world dimensions (mm) with sensible
// medium/standard defaults; the design is composited at true scale against
// whichever size the user dials in.
export const PRODUCTS = [
  { id: "tshirt",  label: "T-Shirt",       draw: drawTshirt,
    dims: { w: 530, h: 720, wLabel: "Chest width", hLabel: "Body length" } },
  { id: "pocket",  label: "Pocket Tee",    draw: drawPocketTee,
    dims: { w: 530, h: 720, wLabel: "Chest width", hLabel: "Body length" } },
  { id: "socks",   label: "Socks",         draw: drawSocks,
    dims: { w: 250, h: 300, wLabel: "Foot length", hLabel: "Sock height" } },
  { id: "tote",    label: "Tote Bag",      draw: drawTote,
    dims: { w: 380, h: 400, wLabel: "Bag width", hLabel: "Bag height" } },
  { id: "shoe",    label: "Sneaker",       draw: drawShoe,
    dims: { w: 300, h: 120, wLabel: "Shoe length", hLabel: "Upper height" } },
  { id: "towel",   label: "Bath Towel",    draw: drawTowel,
    dims: { w: 686, h: 980, wLabel: "Width", hLabel: "Length" } },
  { id: "bathmat", label: "Bath Mat",      draw: drawBathmat,
    dims: { w: 810, h: 510, wLabel: "Width", hLabel: "Height" } },
  { id: "custom",  label: "Custom",        draw: drawCustom, custom: true,
    dims: { w: 150, h: 100, wLabel: "Width", hLabel: "Height" } },
];

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
}

// Render a product mockup with the design composited at real scale.
export function renderPreview(ctx, compiled, product, opts = {}) {
  const canvas = ctx.canvas;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Studio backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#20262e");
  bg.addColorStop(1, "#11151b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const margin = 0.07;
  const box = { x: W * margin, y: H * margin, w: W * (1 - margin * 2), h: H * (1 - margin * 2) };

  // draw() returns the body rect (px) + spanMm (real width that rect spans) +
  // the embroidery zone center as a fraction of that rect.
  const dims = opts.dims || { ...product.dims };
  const item = product.draw(ctx, box, {
    customW: opts.customW || dims.w || 300, customH: opts.customH || dims.h || 200,
    dims,
  });
  const mmToPx = item.w / item.spanMm;
  const cxPx = item.x + item.w * item.zone.x;
  const cyPx = item.y + item.h * item.zone.y;
  drawDesign(ctx, compiled, cxPx, cyPx, mmToPx);
  return { mmToPx };
}

// Paint the design centered at (cxPx,cyPx) scaled by mmToPx, with a soft
// raised-stitch shadow so it reads on light fabric.
function drawDesign(ctx, compiled, cxPx, cyPx, mmToPx) {
  if (!compiled || !compiled.plan.length) return;
  const b = compiled.bounds;
  const dcx = (b.minX + b.maxX) / 2, dcy = (b.minY + b.maxY) / 2;
  const toPx = (p) => ({ x: cxPx + (p.x - dcx) * mmToPx, y: cyPx + (p.y - dcy) * mmToPx });
  const lw = Math.max(0.7, mmToPx * 0.45);

  for (const pass of [0, 1]) {
    ctx.save();
    ctx.lineWidth = pass === 0 ? lw * 1.5 : lw;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (pass === 0) { ctx.translate(lw * 0.5, lw * 0.6); ctx.globalAlpha = 0.18; }
    let last = null, penDown = false;
    for (const s of compiled.plan) {
      if (s.cmd === "stitch") {
        const p = toPx(s);
        if (penDown && last) {
          ctx.strokeStyle = pass === 0 ? "#000" : (compiled.colors[s.color]?.color || "#222");
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        last = p; penDown = true;
      } else { if (s.cmd === "jump") last = toPx(s); penDown = false; }
    }
    ctx.restore();
  }
}

// ---------------- helpers ----------------
function fit(box, Wmm, Hmm) {
  const pp = Math.min(box.w / Wmm, box.h / Hmm);
  const ox = box.x + (box.w - Wmm * pp) / 2;
  const oy = box.y + (box.h - Hmm * pp) / 2;
  return { pp, M: (mx, my) => ({ x: ox + mx * pp, y: oy + my * pp }) };
}

function groundShadow(ctx, cx, cy, rx, ry) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.filter = "blur(8px)";
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function poly(ctx, pts, close = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}

// ---------------- T-Shirt (medium: 530mm chest flat, 720mm length) ----------------
function drawTshirt(ctx, box, opts = {}) {
  const chestMm = (opts.dims && opts.dims.w) || 530;
  const Wmm = 820, Hmm = 760, chest = 530, cx = 410;
  const { pp, M } = fit(box, Wmm, Hmm);
  const sideL = cx - chest / 2, sideR = cx + chest / 2;       // 145 / 675
  const hemHalf = chest / 2 + 6, hemY = 720, armY = 250, shoY = 60;
  const neckHalf = 70, neckY = 36, neckDip = 86;

  groundShadow(ctx, M(cx, hemY).x, M(cx, hemY + 18).y, chest * pp * 0.55, 26);

  // Body + sleeves silhouette (smooth).
  ctx.save();
  ctx.beginPath();
  let p = M(cx - neckHalf, neckY); ctx.moveTo(p.x, p.y);
  p = M(cx - 205, shoY); ctx.lineTo(p.x, p.y);                 // shoulder L
  p = M(48, 150); ctx.lineTo(p.x, p.y);                        // sleeve outer top L
  p = M(96, 262); ctx.quadraticCurveTo(M(60, 215).x, M(60, 215).y, p.x, p.y); // sleeve outer round
  p = M(192, 250); ctx.lineTo(p.x, p.y);                       // sleeve inner (underarm) L
  p = M(sideL, armY); ctx.lineTo(p.x, p.y);                    // body underarm L
  p = M(cx - hemHalf, hemY); ctx.quadraticCurveTo(M(sideL - 10, 480).x, M(sideL - 10, 480).y, p.x, p.y); // side seam L (slight curve)
  p = M(cx + hemHalf, hemY); ctx.quadraticCurveTo(M(cx, hemY + 16).x, M(cx, hemY + 16).y, p.x, p.y);      // hem (slight dip)
  p = M(sideR, armY); ctx.quadraticCurveTo(M(sideR + 10, 480).x, M(sideR + 10, 480).y, p.x, p.y);          // side seam R
  p = M(Wmm - 192, 250); ctx.lineTo(p.x, p.y);                 // underarm R
  p = M(Wmm - 96, 262); ctx.lineTo(p.x, p.y);                  // sleeve inner R
  p = M(Wmm - 48, 150); ctx.quadraticCurveTo(M(Wmm - 60, 215).x, M(Wmm - 60, 215).y, p.x, p.y); // sleeve outer R
  p = M(cx + 205, shoY); ctx.lineTo(p.x, p.y);                 // shoulder R
  p = M(cx + neckHalf, neckY); ctx.lineTo(p.x, p.y);           // neck R
  ctx.quadraticCurveTo(M(cx, neckDip).x, M(cx, neckDip).y, M(cx - neckHalf, neckY).x, M(cx - neckHalf, neckY).y); // collar
  ctx.closePath();

  const g = ctx.createLinearGradient(0, M(0, shoY).y, 0, M(0, hemY).y);
  g.addColorStop(0, "#fbfcfd"); g.addColorStop(0.5, "#eef1f5"); g.addColorStop(1, "#dfe4ea");
  ctx.fillStyle = g; ctx.fill();
  // soft side shading
  ctx.save(); ctx.clip();
  const sh = ctx.createLinearGradient(M(sideL, 0).x, 0, M(sideR, 0).x, 0);
  sh.addColorStop(0, "rgba(80,90,105,0.22)"); sh.addColorStop(0.18, "rgba(0,0,0,0)");
  sh.addColorStop(0.82, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(80,90,105,0.22)");
  ctx.fillStyle = sh; ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
  ctx.strokeStyle = "#c2c9d2"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();

  // Collar ribbing (inner band).
  ctx.strokeStyle = "#cfd6df"; ctx.lineWidth = 4;
  ctx.beginPath();
  p = M(cx - neckHalf + 8, neckY + 8); ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(M(cx, neckDip - 10).x, M(cx, neckDip - 10).y, M(cx + neckHalf - 8, neckY + 8).x, M(cx + neckHalf - 8, neckY + 8).y);
  ctx.stroke();

  // Hem + sleeve hem lines.
  ctx.strokeStyle = "rgba(150,160,172,0.6)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M(cx - hemHalf + 12, hemY - 24).x, M(cx - hemHalf + 12, hemY - 24).y);
  ctx.quadraticCurveTo(M(cx, hemY - 10).x, M(cx, hemY - 10).y, M(cx + hemHalf - 12, hemY - 24).x, M(cx + hemHalf - 24, hemY - 24).y); ctx.stroke();

  return { x: M(sideL, 0).x, y: M(0, shoY).y, w: chest * pp, h: (hemY - shoY) * pp, spanMm: chestMm, zone: { x: 0.31, y: 0.27 } };
}

// ---------------- Sneaker (men's ~300mm length, low-top side profile) --------
function drawShoe(ctx, box, opts = {}) {
  const lenMm = (opts.dims && opts.dims.w) || 300;
  const Wmm = 320, Hmm = 168;
  const { pp, M } = fit(box, Wmm, Hmm);
  const ground = 150, midTop = 122, outTop = 140; // thin sole

  groundShadow(ctx, M(162, ground).x, M(162, ground + 4).y, 148 * pp, 9);

  // Upper (drawn first, sits on the sole). Toe -> instep -> collar dip -> heel.
  ctx.save();
  ctx.beginPath();
  let p = M(44, midTop); ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(M(46, 92).x, M(46, 92).y, M(80, 86).x, M(80, 86).y);            // toe cap (low, blunt)
  ctx.quadraticCurveTo(M(126, 80).x, M(126, 80).y, M(150, 74).x, M(150, 74).y);        // vamp
  ctx.quadraticCurveTo(M(168, 60).x, M(168, 60).y, M(186, 60).x, M(186, 60).y);        // up to collar front
  ctx.quadraticCurveTo(M(206, 78).x, M(206, 78).y, M(232, 70).x, M(232, 70).y);        // ankle opening dip
  ctx.quadraticCurveTo(M(268, 60).x, M(268, 60).y, M(286, 66).x, M(286, 66).y);        // heel collar
  ctx.quadraticCurveTo(M(296, 74).x, M(296, 74).y, M(290, midTop).x, M(290, midTop).y);// heel counter down
  ctx.lineTo(M(44, midTop).x, M(44, midTop).y);                                        // along sole top
  ctx.closePath();
  const ug = ctx.createLinearGradient(0, M(0, 56).y, 0, M(0, midTop).y);
  ug.addColorStop(0, "#fbfcfd"); ug.addColorStop(1, "#dde3ea");
  ctx.fillStyle = ug; ctx.fill();
  ctx.strokeStyle = "#b7c0ca"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();

  // Athletic side panel (generic swoosh-like) on the quarter.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(M(120, 118).x, M(120, 118).y);
  ctx.quadraticCurveTo(M(210, 96).x, M(210, 96).y, M(276, 78).x, M(276, 78).y);
  ctx.quadraticCurveTo(M(220, 110).x, M(220, 110).y, M(128, 120).x, M(128, 120).y);
  ctx.closePath();
  ctx.fillStyle = "rgba(176,186,198,0.55)"; ctx.fill();
  ctx.restore();

  // Toe-cap + heel seams.
  ctx.strokeStyle = "rgba(150,162,175,0.7)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(M(84, 86).x, M(84, 86).y);
  ctx.quadraticCurveTo(M(72, 104).x, M(72, 104).y, M(72, midTop).x, M(72, midTop).y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(M(274, 64).x, M(274, 64).y);
  ctx.quadraticCurveTo(M(282, 92).x, M(282, 92).y, M(282, midTop).x, M(282, midTop).y); ctx.stroke();

  // Tongue (small nub at the throat, behind laces).
  ctx.fillStyle = "#e7ecf1"; ctx.strokeStyle = "#c4ccd4"; ctx.lineWidth = 1;
  poly(ctx, [M(150, 74), M(170, 58), M(184, 62), M(168, 78)]); ctx.fill(); ctx.stroke();

  // Eyestay throat line + laces + eyelets.
  ctx.strokeStyle = "rgba(150,162,175,0.5)"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(M(126, 86).x, M(126, 86).y); ctx.quadraticCurveTo(M(170, 78).x, M(170, 78).y, M(192, 70).x, M(192, 70).y); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = "#cfd6de"; ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const y = 70 + i * 11, xl = 138 + i * 5, xr = 184 - i * 2;
    ctx.beginPath(); ctx.moveTo(M(xl, y).x, M(xl, y).y); ctx.lineTo(M(xr, y).x, M(xr, y).y); ctx.stroke();
  }
  ctx.fillStyle = "#8b95a1";
  for (let i = 0; i < 4; i++) {
    const y = 70 + i * 11;
    let e = M(138 + i * 5, y); ctx.beginPath(); ctx.arc(e.x, e.y, 1.9, 0, 7); ctx.fill();
    e = M(184 - i * 2, y); ctx.beginPath(); ctx.arc(e.x, e.y, 1.9, 0, 7); ctx.fill();
  }

  // Midsole (clean white) + outsole (darker), thin.
  ctx.save();
  ctx.beginPath();
  p = M(28, outTop); ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(M(20, midTop).x, M(20, midTop).y, M(48, midTop - 2).x, M(48, midTop - 2).y);
  ctx.lineTo(M(286, midTop - 2).x, M(286, midTop - 2).y);
  ctx.quadraticCurveTo(M(300, midTop).x, M(300, midTop).y, M(296, outTop).x, M(296, outTop).y);
  ctx.lineTo(M(28, outTop).x, M(28, outTop).y); ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.strokeStyle = "#cdd4db"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath();                                              // outsole
  p = M(30, ground); ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(M(22, outTop + 2).x, M(22, outTop + 2).y, M(40, outTop).x, M(40, outTop).y);
  ctx.lineTo(M(294, outTop).x, M(294, outTop).y);
  ctx.quadraticCurveTo(M(304, outTop + 3).x, M(304, outTop + 3).y, M(296, ground).x, M(296, ground).y);
  ctx.closePath(); ctx.fillStyle = "#7f8a98"; ctx.fill();
  ctx.restore();

  return { x: M(44, 0).x, y: M(0, 56).y, w: 246 * pp, h: (midTop - 56) * pp, spanMm: lenMm * 0.84, zone: { x: 0.74, y: 0.62 } };
}

// ---------------- Bath Towel (686mm wide, terry, dobby border) ----------------
function drawTowel(ctx, box, opts = {}) {
  const Wmm = (opts.dims && opts.dims.w) || 686, Hmm = (opts.dims && opts.dims.h) || 980;
  const { pp, M } = fit(box, Wmm, Hmm);
  const x = M(0, 0).x, y = M(0, 0).y, w = Wmm * pp, h = Hmm * pp;

  groundShadow(ctx, x + w / 2, y + h + 8, w * 0.5, 16);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 10);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "#dce7ee"); g.addColorStop(0.5, "#eef4f8"); g.addColorStop(1, "#dce7ee");
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "#c3d0d8"; ctx.lineWidth = 1.5; ctx.stroke();
  // terry pile texture (faint vertical lines)
  ctx.clip();
  ctx.strokeStyle = "rgba(160,178,190,0.35)"; ctx.lineWidth = 1;
  for (let mx = 10; mx < Wmm; mx += 10) {
    ctx.beginPath(); ctx.moveTo(M(mx, 6).x, M(mx, 6).y); ctx.lineTo(M(mx, Hmm - 6).x, M(mx, Hmm - 6).y); ctx.stroke();
  }
  // dobby border band (where the logo goes) near lower third
  ctx.fillStyle = "#cdd9e1";
  ctx.fillRect(M(0, 640).x, M(0, 640).y, w, 120 * pp);
  ctx.strokeStyle = "#b3c2cc"; ctx.lineWidth = 2;
  for (const yy of [648, 752]) { ctx.beginPath(); ctx.moveTo(M(0, yy).x, M(0, yy).y); ctx.lineTo(M(Wmm, yy).x, M(Wmm, yy).y); ctx.stroke(); }
  ctx.restore();

  return { x, y, w, h, spanMm: Wmm, zone: { x: 0.5, y: 0.71 } };
}

// ---------------- Bath Mat (810x510mm, plush, rounded) ----------------
function drawBathmat(ctx, box, opts = {}) {
  const Wmm = (opts.dims && opts.dims.w) || 810, Hmm = (opts.dims && opts.dims.h) || 510;
  const { pp, M } = fit(box, Wmm, Hmm);
  const x = M(0, 0).x, y = M(0, 0).y, w = Wmm * pp, h = Hmm * pp;

  groundShadow(ctx, x + w / 2, y + h + 6, w * 0.5, 18);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 26);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#eef0ea"); g.addColorStop(1, "#dde1d6");
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "#c6ccbd"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.clip();
  // plush stipple
  ctx.fillStyle = "rgba(176,186,166,0.45)";
  for (let i = 0; i < 520; i++) {
    const rx = Math.abs(Math.sin(i * 12.9898) * 43758.5) % 1;
    const ry = Math.abs(Math.sin(i * 78.233) * 12345.6) % 1;
    ctx.beginPath(); ctx.arc(x + 14 + rx * (w - 28), y + 14 + ry * (h - 28), 1.5, 0, 7); ctx.fill();
  }
  // inner border
  ctx.strokeStyle = "rgba(150,160,138,0.5)"; ctx.lineWidth = 2;
  roundRectPath(ctx, x + 16, y + 16, w - 32, h - 32, 18); ctx.stroke();
  ctx.restore();

  return { x, y, w, h, spanMm: Wmm, zone: { x: 0.5, y: 0.5 } };
}

// ---------------- Custom rectangle (user dimensions) ----------------
function drawCustom(ctx, box, { customW, customH }) {
  const Wmm = customW, Hmm = customH;
  const { pp, M } = fit(box, Wmm, Hmm);
  const x = M(0, 0).x, y = M(0, 0).y, w = Wmm * pp, h = Hmm * pp;
  groundShadow(ctx, x + w / 2, y + h + 6, w * 0.5, 14);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#f3f5f8"); g.addColorStop(1, "#e2e7ec");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#c2c9d2"; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  return { x, y, w, h, spanMm: Wmm, zone: { x: 0.5, y: 0.5 } };
}

// ---------------- Pocket Tee (medium tee + left-chest pocket) ----------------
function drawPocketTee(ctx, box, opts = {}) {
  const item = drawTshirt(ctx, box, opts);
  const mmToPx = item.w / item.spanMm;
  const pw = 110 * mmToPx, ph = 115 * mmToPx;   // standard 110×115mm patch pocket
  const pcx = item.x + item.w * 0.31, pcy = item.y + item.h * 0.27;
  const px = pcx - pw / 2, py = pcy - ph * 0.45;
  const pocket = () => {
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + pw, py);
    ctx.lineTo(px + pw, py + ph * 0.72);
    ctx.lineTo(px + pw / 2, py + ph);
    ctx.lineTo(px, py + ph * 0.72);
    ctx.closePath();
  };
  ctx.save();
  pocket();
  ctx.fillStyle = "rgba(228,233,240,0.95)"; ctx.fill();
  ctx.strokeStyle = "#b7c0cb"; ctx.lineWidth = 1.5; ctx.stroke();
  // topstitch detail just inside the pocket edge
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(130,142,156,0.75)"; ctx.lineWidth = 1;
  ctx.save();
  ctx.translate(pcx, py + ph / 2); ctx.scale(0.94, 0.94); ctx.translate(-pcx, -(py + ph / 2));
  pocket(); ctx.stroke();
  ctx.restore();
  ctx.restore();
  // the embroidery zone is the POCKET center
  return { ...item, zone: { x: (pcx - item.x) / item.w, y: (pcy + ph * 0.02 - item.y) / item.h } };
}

// ---------------- Socks (crew pair; foot length × sock height adjustable) ----
function drawSocks(ctx, box, opts = {}) {
  const foot = (opts.dims && opts.dims.w) || 250;   // heel to toe
  const sockH = (opts.dims && opts.dims.h) || 300;  // cuff to sole
  const legW = Math.max(66, foot * 0.34);
  const Wmm = foot + 80, Hmm = sockH + 70;
  const { pp, M } = fit(box, Wmm, Hmm);

  const sock = (ox, oy, base, edge, shade2) => {
    const ankleY = oy + sockH - legW * 1.02;
    const soleY = oy + sockH;
    const toeX = ox + foot;
    ctx.beginPath();
    let p = M(ox, oy); ctx.moveTo(p.x, p.y);
    p = M(ox + legW, oy); ctx.lineTo(p.x, p.y);                       // cuff top
    p = M(ox + legW, ankleY); ctx.lineTo(p.x, p.y);                   // leg front
    // instep down toward the toe
    p = M(toeX - legW * 0.55, soleY - legW * 0.8);
    ctx.quadraticCurveTo(M(ox + legW + 8, ankleY + legW * 0.5).x, M(ox + legW + 8, ankleY + legW * 0.5).y, p.x, p.y);
    // toe cap
    p = M(toeX, soleY - legW * 0.34);
    ctx.quadraticCurveTo(M(toeX - 6, soleY - legW * 0.72).x, M(toeX - 6, soleY - legW * 0.72).y, p.x, p.y);
    p = M(toeX - legW * 0.28, soleY);
    ctx.quadraticCurveTo(M(toeX + 4, soleY - 4).x, M(toeX + 4, soleY - 4).y, p.x, p.y);
    // sole back to the heel
    p = M(ox + legW * 0.42, soleY); ctx.lineTo(p.x, p.y);
    // heel round
    p = M(ox, ankleY + legW * 0.28);
    ctx.quadraticCurveTo(M(ox - legW * 0.28, soleY - 4).x, M(ox - legW * 0.28, soleY - 4).y, p.x, p.y);
    ctx.lineTo(M(ox, oy).x, M(ox, oy).y);                             // leg back up to cuff
    ctx.closePath();
    const g = ctx.createLinearGradient(M(ox, 0).x, 0, M(ox + legW + foot * 0.4, 0).x, 0);
    g.addColorStop(0, base); g.addColorStop(1, shade2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
    // ribbed cuff
    ctx.strokeStyle = "rgba(150,160,172,0.55)"; ctx.lineWidth = 1.2;
    for (let i = 1; i <= 3; i++) {
      const yy = oy + i * 7;
      ctx.beginPath(); ctx.moveTo(M(ox + 2, yy).x, M(ox + 2, yy).y); ctx.lineTo(M(ox + legW - 2, yy).x, M(ox + legW - 2, yy).y); ctx.stroke();
    }
    // heel/toe shading patches
    ctx.fillStyle = "rgba(170,180,192,0.35)";
    ctx.beginPath(); ctx.ellipse(M(ox + legW * 0.16, soleY - legW * 0.26).x, M(ox + legW * 0.16, soleY - legW * 0.26).y, legW * 0.34 * pp, legW * 0.3 * pp, 0.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(M(toeX - legW * 0.2, soleY - legW * 0.34).x, M(toeX - legW * 0.2, soleY - legW * 0.34).y, legW * 0.3 * pp, legW * 0.26 * pp, -0.4, 0, 7); ctx.fill();
  };

  groundShadow(ctx, M(Wmm / 2, sockH + 44).x, M(Wmm / 2, sockH + 52).y, foot * pp * 0.55, 12);
  sock(52, 16, "#e3e8ee", "#c0c8d2", "#cdd5de");   // back sock
  sock(22, 36, "#fbfcfd", "#b7c0ca", "#dde3ea");   // front sock
  // Design sits on the OUTER LEG of the front sock.
  const bodyX = M(22, 0).x, bodyY = M(0, 36).y;
  return { x: bodyX, y: bodyY, w: foot * pp, h: sockH * pp, spanMm: foot,
           zone: { x: (legW * 0.5) / foot, y: 0.34 } };
}

// ---------------- Tote Bag (canvas; width × height adjustable) ----------------
function drawTote(ctx, box, opts = {}) {
  const W = (opts.dims && opts.dims.w) || 380;
  const H = (opts.dims && opts.dims.h) || 400;
  const handleRise = Math.min(200, H * 0.45);
  const Wmm = W + 70, Hmm = H + handleRise + 40;
  const { pp, M } = fit(box, Wmm, Hmm);
  const bx = 35, by = handleRise + 20;

  groundShadow(ctx, M(bx + W / 2, by + H).x, M(bx + W / 2, by + H + 10).y, W * pp * 0.52, 16);

  // handles (behind the bag top): two straps looping up
  const strapW = Math.max(3, 16 * pp);
  const handle = (x0, x1) => {
    ctx.beginPath();
    let p = M(x0, by + 6); ctx.moveTo(p.x, p.y);
    ctx.bezierCurveTo(M(x0, 26).x, M(x0, 26).y, M(x1, 26).x, M(x1, 26).y, M(x1, by + 6).x, M(x1, by + 6).y);
    ctx.strokeStyle = "#cfc4a2"; ctx.lineWidth = strapW; ctx.lineCap = "round"; ctx.stroke();
    ctx.strokeStyle = "rgba(120,110,80,0.45)"; ctx.lineWidth = Math.max(1, strapW * 0.2); ctx.stroke();
  };
  handle(bx + W * 0.28, bx + W * 0.72);

  // bag body — natural canvas
  const x = M(bx, by).x, y = M(bx, by).y, w = W * pp, h = H * pp;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 6);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "#ddd3b4"); g.addColorStop(0.5, "#efe7cd"); g.addColorStop(1, "#d8cdae");
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "#b3a884"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.clip();
  // canvas weave (faint)
  ctx.strokeStyle = "rgba(140,128,95,0.16)"; ctx.lineWidth = 1;
  for (let mx = 8; mx < W; mx += 8) { ctx.beginPath(); ctx.moveTo(M(bx + mx, by).x, y); ctx.lineTo(M(bx + mx, by).x, y + h); ctx.stroke(); }
  for (let my = 8; my < H; my += 8) { ctx.beginPath(); ctx.moveTo(x, M(0, by + my).y); ctx.lineTo(x + w, M(0, by + my).y); ctx.stroke(); }
  // top hem band + strap attachments
  ctx.fillStyle = "rgba(190,178,144,0.55)";
  ctx.fillRect(x, y, w, Math.max(3, 22 * pp));
  ctx.fillStyle = "#cfc4a2"; ctx.strokeStyle = "#a99e7b";
  for (const hx of [bx + W * 0.28, bx + W * 0.72]) {
    const sx = M(hx, by).x;
    ctx.fillRect(sx - strapW / 2, y, strapW, Math.max(4, 30 * pp));
    ctx.strokeRect(sx - strapW / 2, y, strapW, Math.max(4, 30 * pp));
  }
  // bottom gusset crease
  ctx.strokeStyle = "rgba(140,128,95,0.4)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 6, M(0, by + H - 26).y); ctx.lineTo(x + w - 6, M(0, by + H - 26).y); ctx.stroke();
  ctx.restore();

  return { x, y, w, h, spanMm: W, zone: { x: 0.5, y: 0.52 } };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
