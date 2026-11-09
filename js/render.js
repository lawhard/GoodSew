// Canvas rendering. Two phases:
//   - design : objects drawn as solid vector art + selection box/handles.
//   - stitch : compiled stitches, jumps/trims, needle path, simulation head.

import { getHoop } from "./hoop.js";
import { UNITS } from "./units.js";
import { rotatePoint, bbox } from "./geometry.js";

export const RULER = 22; // px width of the ruler strips

export const THEMES = {
  light: {
    outside: "#e7e4dd", field: "#ffffff", fieldBorder: "#c2a878",
    gridMajor: "rgba(0,0,0,0.10)", gridMinor: "rgba(0,0,0,0.045)",
    cross: "rgba(150,120,70,0.30)",
    rulerBg: "#f1efe9", rulerCorner: "#e4e1d9", rulerStroke: "#d4d1c9",
    rulerTick: "#b7b3aa", rulerText: "#7c8794",
    objStroke: "rgba(0,0,0,0.28)",
  },
  dark: {
    outside: "#11151c", field: "#f5f3ee", fieldBorder: "#8a6d3b",
    gridMajor: "rgba(0,0,0,0.10)", gridMinor: "rgba(0,0,0,0.045)",
    cross: "rgba(138,109,59,0.4)",
    rulerBg: "#1c2330", rulerCorner: "#11151c", rulerStroke: "#2a3340",
    rulerTick: "#3a4656", rulerText: "#8a96a6",
  },
};
const ACCENT = "#2e7df6";

export class Camera {
  constructor() { this.pxPerMm = 3; this.panX = 0; this.panY = 0; }
  // padMm reserves world-space around the field (e.g. for the physical hoop
  // frame drawing) so the whole hoop fits in view at the default zoom.
  fit(hoop, cw, ch, ruler = 0, padMm = 2) {
    const margin = 28;
    const availW = cw - ruler - margin * 2;
    const availH = ch - ruler - margin * 2;
    this.pxPerMm = Math.min(availW / (hoop.w + padMm * 2), availH / (hoop.h + padMm * 2));
    this.panX = ruler + margin + (availW - hoop.w * this.pxPerMm) / 2;
    this.panY = ruler + margin + (availH - hoop.h * this.pxPerMm) / 2;
  }
  toScreen(p) { return { x: p.x * this.pxPerMm + this.panX, y: p.y * this.pxPerMm + this.panY }; }
  toWorld(p) { return { x: (p.x - this.panX) / this.pxPerMm, y: (p.y - this.panY) / this.pxPerMm }; }
  zoomAt(sx, sy, factor) {
    const before = this.toWorld({ x: sx, y: sy });
    this.pxPerMm *= factor;
    this.pxPerMm = Math.max(0.5, Math.min(60, this.pxPerMm));
    const after = this.toScreen(before);
    this.panX += sx - after.x;
    this.panY += sy - after.y;
  }
}

const STITCH_DOT = 1.1;

// ---- editing transform of an object (unrotated content box + rotation) ----
export function getObjBox(obj) {
  const rot = obj.rotation || 0;
  if (obj.type === "text") {
    const lb = obj._localBox || { minX: 0, minY: 0, w: 0, h: 0 };
    const ax = obj.points[0] ? obj.points[0].x : 0;
    const ay = obj.points[0] ? obj.points[0].y : 0;
    return { cx: ax + lb.minX + lb.w / 2, cy: ay + lb.minY + lb.h / 2, w: lb.w, h: lb.h, rot };
  }
  if (obj.box) {
    const b = obj.box;
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot };
  }
  const bb = bbox(obj.points.length ? obj.points : [{ x: 0, y: 0 }]);
  return { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, w: bb.w, h: bb.h, rot: 0 };
}

// Named corner/edge points (world mm) of a (possibly rotated) box.
export function boxHandlesWorld(box) {
  const { cx, cy, w, h, rot } = box;
  const hw = w / 2, hh = h / 2;
  const c = { x: cx, y: cy };
  const r = (ox, oy) => rotatePoint({ x: cx + ox, y: cy + oy }, c, (rot * Math.PI) / 180);
  return {
    nw: r(-hw, -hh), n: r(0, -hh), ne: r(hw, -hh),
    e: r(hw, 0), se: r(hw, hh), s: r(0, hh),
    sw: r(-hw, hh), w: r(-hw, 0), center: c, rot,
  };
}

export function render(ctx, state, compiled, sim, opts) {
  const { cam, view } = opts;
  const TH = { ...(THEMES[state.theme] || THEMES.light) };
  if (state.fabricColor) TH.field = state.fabricColor; // project fabric colour
  const canvas = ctx.canvas;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const hoop = getHoop(state.hoopId);
  ctx.fillStyle = TH.outside;
  ctx.fillRect(0, 0, cw, ch);

  const o = cam.toScreen({ x: 0, y: 0 });
  const fw = hoop.w * cam.pxPerMm, fh = hoop.h * cam.pxPerMm;
  if (view.showHoop) drawHoopFrame(ctx, cam, o, fw, fh, TH);
  ctx.fillStyle = TH.field;
  ctx.fillRect(o.x, o.y, fw, fh);

  if (state.image && view.showImage) {
    const t = state.imageTransform;
    const ip = cam.toScreen({ x: t.x, y: t.y });
    ctx.globalAlpha = t.opacity;
    ctx.drawImage(state.image, ip.x, ip.y,
      state.image.width * t.scale * cam.pxPerMm, state.image.height * t.scale * cam.pxPerMm);
    ctx.globalAlpha = 1;
  }

  if (view.showGrid) drawGrid(ctx, cam, hoop, o, fw, fh, TH);

  ctx.strokeStyle = TH.fieldBorder; ctx.lineWidth = 1.5;
  ctx.strokeRect(o.x, o.y, fw, fh);
  ctx.strokeStyle = TH.cross; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x + fw / 2, o.y); ctx.lineTo(o.x + fw / 2, o.y + fh);
  ctx.moveTo(o.x, o.y + fh / 2); ctx.lineTo(o.x + fw, o.y + fh / 2);
  ctx.stroke();
  // Smart alignment guides while dragging: hoop-center snaps in accent blue,
  // object-edge/center snaps in magenta — spanning both aligned objects.
  for (const g of (opts.snapGuides || [])) {
    ctx.save();
    const col = g.kind === "hoop" ? ACCENT : "#e83e8c";
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.shadowColor = col; ctx.shadowBlur = 5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (g.axis === "v") {
      const sx = cam.toScreen({ x: g.pos, y: 0 }).x;
      const y0 = cam.toScreen({ x: 0, y: g.a }).y, y1 = cam.toScreen({ x: 0, y: g.b }).y;
      ctx.moveTo(sx, y0 - 8); ctx.lineTo(sx, y1 + 8);
    } else {
      const sy = cam.toScreen({ x: 0, y: g.pos }).y;
      const x0 = cam.toScreen({ x: g.a, y: 0 }).x, x1 = cam.toScreen({ x: g.b, y: 0 }).x;
      ctx.moveTo(x0 - 8, sy); ctx.lineTo(x1 + 8, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (state.mode === "stitch") {
    const simActive = sim && sim.total > 0 && sim.engaged;
    const upto = simActive ? sim.index : (compiled ? compiled.plan.length : 0);
    if (view.showStitches && compiled) drawStitches(ctx, cam, compiled, upto, view);
    if (simActive && upto > 0) drawNeedle(ctx, cam, compiled, upto);
  } else {
    drawObjectsSolid(ctx, cam, state, TH);
    const ids = state.selectedIds && state.selectedIds.length ? state.selectedIds
      : (state.selectedId != null ? [state.selectedId] : []);
    const withHandles = ids.length === 1; // resize/rotate handles only for a single object
    for (const id of ids) {
      const o = state.objects.find((x) => x.id === id);
      // spine/point objects (satin/run/drawn regions without a box) are
      // move-only: selection outline, no resize handles
      if (o && o.visible) drawSelection(ctx, cam, o, withHandles && (o.box != null || o.type === "text"));
    }
    if (opts.drawing) drawDraft(ctx, cam, opts.drawing);
  }

  drawGuides(ctx, cam, state, cw, ch, opts.hoverGuide);
  drawRulers(ctx, cam, cw, ch, opts.cursor, opts.unit || UNITS.mm, TH);
  ctx.restore();
}

// ---------------- design-mode solid drawing ----------------
function pathFromContours(ctx, cam, contours, ax = 0, ay = 0) {
  const p = new Path2D();
  for (const c of contours) {
    c.forEach((pt, i) => {
      const sp = cam.toScreen({ x: pt.x + ax, y: pt.y + ay });
      i === 0 ? p.moveTo(sp.x, sp.y) : p.lineTo(sp.x, sp.y);
    });
    p.closePath();
  }
  return p;
}

function drawObjectsSolid(ctx, cam, state, TH) {
  for (const obj of state.objects) {
    if (!obj.visible) continue;
    // Manual-digitized line objects: satin column band / running dash line.
    if (obj.kind === "satin-rails" && obj.contours) {
      const path=pathFromContours(ctx,cam,obj.contours); ctx.fillStyle=obj.color;ctx.fill(path,"evenodd");continue;
    } else if (obj.type === "satin" && obj.points.length >= 2) {
      const wpx = Math.max(2, (obj.params.width || 4) * cam.pxPerMm);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      obj.points.forEach((p, i) => { const s = cam.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.lineWidth = wpx; ctx.strokeStyle = obj.color; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    if (obj.type === "running" && obj.points.length >= 2) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      obj.points.forEach((p, i) => { const s = cam.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.lineWidth = Math.max(1.5, 0.7 * cam.pxPerMm);
      ctx.strokeStyle = obj.color;
      ctx.setLineDash([Math.max(4, 2.5 * cam.pxPerMm), Math.max(3, 1.2 * cam.pxPerMm)]);
      ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    let path;
    if (obj.type === "text" && obj._glyphs) {
      const ax = obj.points[0] ? obj.points[0].x : 0;
      const ay = obj.points[0] ? obj.points[0].y : 0;
      path = pathFromContours(ctx, cam, obj._glyphs.flat(), ax, ay);
    } else if (obj.contours && obj.contours.length) {
      path = pathFromContours(ctx, cam, obj.contours); // SVG art etc. (holes via evenodd)
    } else if (obj.points.length >= 3) {
      path = pathFromContours(ctx, cam, [obj.points]);
    } else { continue; }

    if (obj.params && obj.params.fillMode === "outline") {
      ctx.lineWidth = 2; ctx.strokeStyle = obj.color; ctx.stroke(path);
    } else {
      ctx.fillStyle = obj.color; ctx.fill(path, "evenodd");
      ctx.lineWidth = 1; ctx.strokeStyle = TH.objStroke; ctx.stroke(path);
    }
  }
}

// Live preview of an in-progress manual drawing (satin / run / region).
function drawDraft(ctx, cam, d) {
  const pts = d.cursor ? [...d.points, d.cursor] : d.points;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (d.type === "satin") {
    ctx.beginPath();
    pts.forEach((p, i) => { const s = cam.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.lineWidth = Math.max(2, 4 * cam.pxPerMm);
    ctx.strokeStyle = "rgba(46,125,246,0.30)";
    ctx.stroke();
  } else if (d.type === "poly" && pts.length >= 3) {
    ctx.beginPath();
    pts.forEach((p, i) => { const s = cam.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    ctx.fillStyle = "rgba(46,125,246,0.18)";
    ctx.fill();
  }
  // path line
  ctx.beginPath();
  pts.forEach((p, i) => { const s = cam.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  if (d.type === "poly" && pts.length >= 3) ctx.closePath();
  ctx.lineWidth = 1.5; ctx.strokeStyle = ACCENT;
  ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  // placed points
  ctx.fillStyle = ACCENT;
  for (const p of d.points) {
    const s = cam.toScreen(p);
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // once the drawing is finishable, ring the click-to-finish target (the
  // first corner for regions, the last point for lines)
  const need = d.type === "poly" ? 3 : 2;
  if (d.points.length >= need) {
    const t = cam.toScreen(d.type === "poly" ? d.points[0] : d.points[d.points.length - 1]);
    ctx.beginPath(); ctx.arc(t.x, t.y, 8, 0, Math.PI * 2);
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.beginPath(); ctx.arc(t.x, t.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
  }
  ctx.restore();
}

function drawSelection(ctx, cam, obj, withHandles = true) {
  const box = getObjBox(obj);
  const h = boxHandlesWorld(box);
  const S = (p) => cam.toScreen(p);
  const nw = S(h.nw), ne = S(h.ne), se = S(h.se), sw = S(h.sw);

  ctx.save();
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2; ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y); ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y); ctx.lineTo(sw.x, sw.y); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);

  if (!withHandles) { ctx.restore(); return; }

  // rotate handle (stick up from the top-mid)
  const nMid = S(h.n);
  const up = unitScreen(S(h.sw), S(h.nw)); // direction from bottom to top edge
  const rotPt = { x: nMid.x + up.x * 22, y: nMid.y + up.y * 22 };
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(nMid.x, nMid.y); ctx.lineTo(rotPt.x, rotPt.y); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.strokeStyle = ACCENT;
  ctx.beginPath(); ctx.arc(rotPt.x, rotPt.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // resize handles
  for (const key of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const sp = S(h[key]);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(sp.x - 4, sp.y - 4, 8, 8); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function unitScreen(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

// ---------------- shared chrome ----------------
function drawGuides(ctx, cam, state, cw, ch, hoverGuide) {
  for (const g of state.guides) {
    const isHover = hoverGuide && hoverGuide.id === g.id;
    ctx.strokeStyle = isHover ? "#1bb5a0" : "rgba(45,200,180,0.7)";
    ctx.lineWidth = isHover ? 1.6 : 1;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    if (g.axis === "x") {
      const sx = cam.toScreen({ x: g.pos, y: 0 }).x;
      ctx.moveTo(sx, RULER); ctx.lineTo(sx, ch);
    } else {
      const sy = cam.toScreen({ x: 0, y: g.pos }).y;
      ctx.moveTo(RULER, sy); ctx.lineTo(cw, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function niceStep(pxPerMm, unit) {
  const pxPerUnit = pxPerMm * unit.mmPer;
  const target = 64 / pxPerUnit;
  for (const s of unit.steps) if (s >= target) return s;
  return unit.steps[unit.steps.length - 1];
}

function drawRulers(ctx, cam, cw, ch, cursor, unit, TH) {
  const stepU = niceStep(cam.pxPerMm, unit);
  const step = stepU * unit.mmPer;
  const minor = step / unit.minorDiv;
  const lbl = (mm) => String(Number((mm / unit.mmPer).toFixed(3)));
  ctx.fillStyle = TH.rulerBg;
  ctx.fillRect(RULER, 0, cw - RULER, RULER);
  ctx.fillRect(0, RULER, RULER, ch - RULER);
  ctx.fillStyle = TH.rulerCorner;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.strokeStyle = TH.rulerStroke; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RULER, RULER); ctx.lineTo(cw, RULER);
  ctx.moveTo(RULER, RULER); ctx.lineTo(RULER, ch);
  ctx.stroke();

  ctx.font = "9px -apple-system, sans-serif";
  ctx.fillStyle = TH.rulerText;
  ctx.textBaseline = "alphabetic";

  const wx0 = cam.toWorld({ x: RULER, y: 0 }).x;
  const wx1 = cam.toWorld({ x: cw, y: 0 }).x;
  for (let mm = Math.ceil(wx0 / minor) * minor; mm <= wx1; mm += minor) {
    const sx = cam.toScreen({ x: mm, y: 0 }).x;
    const major = Math.abs(mm % step) < 1e-6;
    ctx.strokeStyle = TH.rulerTick;
    ctx.beginPath(); ctx.moveTo(sx, RULER); ctx.lineTo(sx, RULER - (major ? 8 : 4)); ctx.stroke();
    if (major) ctx.fillText(lbl(mm), sx + 2, 9);
  }
  const wy0 = cam.toWorld({ x: 0, y: RULER }).y;
  const wy1 = cam.toWorld({ x: 0, y: ch }).y;
  for (let mm = Math.ceil(wy0 / minor) * minor; mm <= wy1; mm += minor) {
    const sy = cam.toScreen({ x: 0, y: mm }).y;
    const major = Math.abs(mm % step) < 1e-6;
    ctx.strokeStyle = TH.rulerTick;
    ctx.beginPath(); ctx.moveTo(RULER, sy); ctx.lineTo(RULER - (major ? 8 : 4), sy); ctx.stroke();
    if (major) { ctx.save(); ctx.translate(9, sy - 2); ctx.rotate(-Math.PI / 2); ctx.fillText(lbl(mm), 0, 0); ctx.restore(); }
  }

  if (cursor) {
    ctx.fillStyle = ACCENT;
    if (cursor.sx >= RULER) ctx.fillRect(cursor.sx - 0.5, 0, 1.5, RULER);
    if (cursor.sy >= RULER) ctx.fillRect(0, cursor.sy - 0.5, RULER, 1.5);
  }
}

// The physical SE700 4×4" hoop drawn around the sewing field: outer plastic
// frame with rounded corners, inner ring, fabric peeking between, and the
// tightening screw on the left — so you always see the real hooping context.
function drawHoopFrame(ctx, cam, o, fw, fh, TH) {
  const mm = cam.pxPerMm;
  const rim = 9 * mm;            // plastic frame width
  const gap = 2.5 * mm;          // visible fabric between ring and field
  const r0 = 10 * mm;            // outer corner radius
  const x0 = o.x - rim - gap, y0 = o.y - rim - gap;
  const w0 = fw + (rim + gap) * 2, h0 = fh + (rim + gap) * 2;
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  ctx.save();
  // fabric under the whole hoop area
  rr(x0 - 4 * mm, y0 - 4 * mm, w0 + 8 * mm, h0 + 8 * mm, r0 + 4 * mm);
  ctx.fillStyle = TH.field;
  ctx.fill();
  // outer plastic frame
  rr(x0, y0, w0, h0, r0);
  ctx.fillStyle = "#eceff4";
  ctx.strokeStyle = "#b9c0cc"; ctx.lineWidth = Math.max(1, 0.5 * mm);
  ctx.fill(); ctx.stroke();
  // inner opening (fabric shows through)
  rr(o.x - gap, o.y - gap, fw + gap * 2, fh + gap * 2, 4 * mm);
  ctx.fillStyle = TH.field;
  ctx.fill();
  ctx.strokeStyle = "#c6ccd6"; ctx.lineWidth = Math.max(1, 0.4 * mm);
  ctx.stroke();
  // tightening screw block on the left rim
  const sy = o.y + fh / 2;
  ctx.fillStyle = "#dde2ea"; ctx.strokeStyle = "#aab2c0"; ctx.lineWidth = 1;
  rr(x0 - 7 * mm, sy - 7 * mm, 9 * mm, 14 * mm, 2 * mm);
  ctx.fill(); ctx.stroke();
  // screw
  ctx.beginPath(); ctx.arc(x0 - 2.5 * mm, sy, 2.2 * mm, 0, Math.PI * 2);
  ctx.fillStyle = "#c2c9d4"; ctx.fill(); ctx.strokeStyle = "#98a1b0"; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0 - 2.5 * mm - 1.4 * mm, sy); ctx.lineTo(x0 - 2.5 * mm + 1.4 * mm, sy);
  ctx.strokeStyle = "#7d8798"; ctx.lineWidth = Math.max(1, 0.35 * mm); ctx.stroke();
  // brand tab on top rim
  ctx.fillStyle = "#9aa4b4";
  ctx.font = `${Math.max(7, 3 * mm)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("brother SE700 · 4\" × 4\"", o.x + fw / 2, y0 + rim * 0.62);
  ctx.restore();
}

function drawGrid(ctx, cam, hoop, o, fw, fh, TH) {
  ctx.lineWidth = 1;
  for (let mm = 0; mm <= hoop.w + 0.01; mm += 5) {
    const x = o.x + mm * cam.pxPerMm;
    ctx.strokeStyle = mm % 10 === 0 ? TH.gridMajor : TH.gridMinor;
    ctx.beginPath(); ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + fh); ctx.stroke();
  }
  for (let mm = 0; mm <= hoop.h + 0.01; mm += 5) {
    const y = o.y + mm * cam.pxPerMm;
    ctx.strokeStyle = mm % 10 === 0 ? TH.gridMajor : TH.gridMinor;
    ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x + fw, y); ctx.stroke();
  }
}

// ---------------- stitch-mode drawing ----------------
// Nudge a hex color lighter (amt>0) or darker (amt<0). amt in -1..1.
function shade(hex, amt) {
  const h = (hex || "#333333").replace("#", "");
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { const f = 1 + amt; r *= f; g *= f; b *= f; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// Directional thread lighting. Real embroidery gets its texture from thread
// being a shiny cylinder: stitches angled toward the light read bright, those
// across it read dark. We quantize the (undirected) stitch angle into buckets
// and cache the lit body/sheen styles per thread color, so the whole effect is
// a lookup per stitch — no per-frame color math.
const LIGHT_ANGLE = -Math.PI / 3.4; // light from the upper-left
const LIT_BUCKETS = 10;
const _litCache = new Map(); // color -> { edge, dark, body[], sheen[] }
function litStyles(col) {
  let c = _litCache.get(col);
  if (!c) {
    const body = [], sheen = [];
    for (let b = 0; b < LIT_BUCKETS; b++) {
      const t = b / (LIT_BUCKETS - 1);            // 0 = across light, 1 = along
      body.push(shade(col, -0.22 + 0.4 * t));     // dark→bright with alignment
      sheen.push(shade(col, 0.3 + 0.4 * t));
    }
    c = { edge: shade(col, -0.45), body, sheen };
    _litCache.set(col, c);
  }
  return c;
}

function drawStitches(ctx, cam, compiled, upto, view) {
  const { plan, colors } = compiled;
  let penDown = false;
  let last = null;
  // Each stitch is a shiny thread cylinder, drawn in three strokes:
  //   1. a dark full-width edge (depth between neighboring threads — this is
  //      what keeps dense fills from merging into a flat blob),
  //   2. a directionally-LIT body (see litStyles),
  //   3. a bright sheen core whose strength grows with stitch length, so long
  //      satin throws glow while short tatami stitches stay matte.
  // Zoomed in (≥ 9 px/mm) penetration dimples appear at needle points.
  const bodyW = Math.max(1.2, cam.pxPerMm * 0.4);
  const coreW = Math.max(0.6, cam.pxPerMm * 0.13);
  const dimples = cam.pxPerMm >= 9;
  const dimpleR = cam.pxPerMm * 0.07;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };

  for (let i = 0; i < upto && i < plan.length; i++) {
    const s = plan[i];
    const sp = cam.toScreen(s);
    if (s.cmd === "stitch") {
      const col = colors[s.color] ? colors[s.color].color : "#333";
      if (penDown && last) {
        const dx = sp.x - last.x, dy = sp.y - last.y;
        const lenPx = Math.hypot(dx, dy);
        const lenMm = lenPx / cam.pxPerMm;
        // angle→light alignment, folded to undirected [0..π)
        let a = Math.atan2(dy, dx);
        if (a < 0) a += Math.PI;
        const align = Math.abs(Math.cos(a - LIGHT_ANGLE));
        const bucket = Math.min(LIT_BUCKETS - 1, (align * LIT_BUCKETS) | 0);
        const st = litStyles(col);

        ctx.globalAlpha = 1;
        ctx.strokeStyle = st.edge; ctx.lineWidth = bodyW; seg(last, sp);        // depth edge
        ctx.strokeStyle = st.body[bucket];
        ctx.lineWidth = Math.max(0.8, bodyW - Math.max(1.2, bodyW * 0.3));
        seg(last, sp);                                                          // lit body
        ctx.globalAlpha = Math.min(0.9, 0.35 + lenMm * 0.11 + align * 0.15);
        ctx.strokeStyle = st.sheen[bucket];
        ctx.lineWidth = lenMm > 1.8 ? Math.max(coreW, cam.pxPerMm * 0.16) : coreW;
        seg(last, sp);                                                          // sheen core
        ctx.globalAlpha = 1;
        if (dimples) {
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.beginPath(); ctx.arc(sp.x, sp.y, dimpleR, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (view.showPoints) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, STITCH_DOT, 0, Math.PI * 2); ctx.fill();
      }
      last = sp; penDown = true;
    } else if (s.cmd === "jump") {
      if (view.showJumps && last) {
        ctx.strokeStyle = "rgba(20,120,210,0.8)";
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      last = sp; penDown = false;
    } else if (s.cmd === "trim") {
      if (view.showJumps && last) {
        ctx.fillStyle = "rgba(220,40,40,0.9)";
        ctx.beginPath(); ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      penDown = false;
    } else if (s.cmd === "color") {
      penDown = false;
    }
  }
}

function drawNeedle(ctx, cam, compiled, upto) {
  const cur = compiled.plan[Math.min(upto - 1, compiled.plan.length - 1)];
  if (!cur) return;
  const sp = cam.toScreen(cur);
  ctx.strokeStyle = "#ff3b6b"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sp.x - 9, sp.y); ctx.lineTo(sp.x + 9, sp.y);
  ctx.moveTo(sp.x, sp.y - 9); ctx.lineTo(sp.x, sp.y + 9); ctx.stroke();
}
