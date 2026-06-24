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
  fit(hoop, cw, ch, ruler = 0) {
    const margin = 28;
    const availW = cw - ruler - margin * 2;
    const availH = ch - ruler - margin * 2;
    this.pxPerMm = Math.min(availW / hoop.w, availH / hoop.h);
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
  const TH = THEMES[state.theme] || THEMES.light;
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

  if (state.mode === "stitch") {
    const simActive = sim && sim.total > 0 && sim.engaged;
    const upto = simActive ? sim.index : (compiled ? compiled.plan.length : 0);
    if (view.showStitches && compiled) drawStitches(ctx, cam, compiled, upto, view);
    if (simActive && upto > 0) drawNeedle(ctx, cam, compiled, upto);
  } else {
    drawObjectsSolid(ctx, cam, state, TH);
    const sel = state.objects.find((x) => x.id === state.selectedId);
    if (sel && sel.visible) drawSelection(ctx, cam, sel);
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
    let path;
    if (obj.type === "text" && obj._glyphs) {
      const ax = obj.points[0] ? obj.points[0].x : 0;
      const ay = obj.points[0] ? obj.points[0].y : 0;
      path = pathFromContours(ctx, cam, obj._glyphs.flat(), ax, ay);
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

function drawSelection(ctx, cam, obj) {
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
function drawStitches(ctx, cam, compiled, upto, view) {
  const { plan, colors } = compiled;
  let penDown = false;
  let last = null;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < upto && i < plan.length; i++) {
    const s = plan[i];
    const sp = cam.toScreen(s);
    if (s.cmd === "stitch") {
      const col = colors[s.color] ? colors[s.color].color : "#333";
      if (penDown && last) {
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
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
