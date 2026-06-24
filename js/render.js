// Canvas rendering: hoop, grid, background image, vector objects, compiled
// stitches, jump/trim travel lines, needle path and the live simulation head.

import { getHoop } from "./hoop.js";
import { generateForObject } from "./stitches.js";

export class Camera {
  constructor() { this.pxPerMm = 3; this.panX = 0; this.panY = 0; }
  // Fit a hoop (centered at 0,0 in mm world... actually hoop spans 0..w) to canvas.
  fit(hoop, cw, ch) {
    const margin = 40;
    const sx = (cw - margin * 2) / hoop.w;
    const sy = (ch - margin * 2) / hoop.h;
    this.pxPerMm = Math.min(sx, sy);
    this.panX = (cw - hoop.w * this.pxPerMm) / 2;
    this.panY = (ch - hoop.h * this.pxPerMm) / 2;
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

export function render(ctx, state, compiled, sim, opts) {
  const { cam, view } = opts;
  const canvas = ctx.canvas;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const hoop = getHoop(state.hoopId);

  // Background outside hoop.
  ctx.fillStyle = "#11151c";
  ctx.fillRect(0, 0, cw, ch);

  // Hoop field.
  const o = cam.toScreen({ x: 0, y: 0 });
  const fw = hoop.w * cam.pxPerMm, fh = hoop.h * cam.pxPerMm;
  ctx.fillStyle = "#f5f3ee";
  ctx.fillRect(o.x, o.y, fw, fh);

  // Background tracing image.
  if (state.image && view.showImage) {
    const t = state.imageTransform;
    const ip = cam.toScreen({ x: t.x, y: t.y });
    ctx.globalAlpha = t.opacity;
    ctx.drawImage(
      state.image, ip.x, ip.y,
      state.image.width * t.scale * cam.pxPerMm,
      state.image.height * t.scale * cam.pxPerMm
    );
    ctx.globalAlpha = 1;
  }

  // Grid (10mm major, 5mm minor).
  if (view.showGrid) drawGrid(ctx, cam, hoop, o, fw, fh);

  // Hoop border + center cross.
  ctx.strokeStyle = "#8a6d3b";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(o.x, o.y, fw, fh);
  ctx.strokeStyle = "rgba(138,109,59,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x + fw / 2, o.y); ctx.lineTo(o.x + fw / 2, o.y + fh);
  ctx.moveTo(o.x, o.y + fh / 2); ctx.lineTo(o.x + fw, o.y + fh / 2);
  ctx.stroke();

  // Simulation defines how much of the plan is "sewn".
  const simActive = sim && sim.total > 0;
  const upto = simActive ? sim.index : (compiled ? compiled.plan.length : 0);

  // Draw compiled stitches (the authoritative rendering).
  if (view.showStitches && compiled) {
    drawStitches(ctx, cam, compiled, upto, view);
  }

  // Draw vector object outlines + nodes (editing aids).
  drawObjectOverlays(ctx, cam, state, view);

  // Live needle head.
  if (simActive && upto > 0) {
    const cur = compiled.plan[Math.min(upto - 1, compiled.plan.length - 1)];
    if (cur) {
      const sp = cam.toScreen(cur);
      ctx.strokeStyle = "#ff3b6b";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sp.x - 9, sp.y); ctx.lineTo(sp.x + 9, sp.y);
      ctx.moveTo(sp.x, sp.y - 9); ctx.lineTo(sp.x, sp.y + 9); ctx.stroke();
    }
  }

  ctx.restore();
}

function drawGrid(ctx, cam, hoop, o, fw, fh) {
  ctx.lineWidth = 1;
  for (let mm = 0; mm <= hoop.w + 0.01; mm += 5) {
    const x = o.x + mm * cam.pxPerMm;
    ctx.strokeStyle = mm % 10 === 0 ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.045)";
    ctx.beginPath(); ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + fh); ctx.stroke();
  }
  for (let mm = 0; mm <= hoop.h + 0.01; mm += 5) {
    const y = o.y + mm * cam.pxPerMm;
    ctx.strokeStyle = mm % 10 === 0 ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.045)";
    ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x + fw, y); ctx.stroke();
  }
}

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

function drawObjectOverlays(ctx, cam, state, view) {
  for (const obj of state.objects) {
    if (!obj.visible) continue;
    const selected = obj.id === state.selectedId;
    if (obj.points.length >= 1) {
      if (selected || view.showPoints) {
        ctx.strokeStyle = selected ? "rgba(255,59,107,0.9)" : "rgba(0,0,0,0.25)";
        ctx.lineWidth = selected ? 1.5 : 1;
        ctx.setLineDash(obj.type === "fill" ? [] : [6, 4]);
        ctx.beginPath();
        obj.points.forEach((p, i) => {
          const sp = cam.toScreen(p);
          i === 0 ? ctx.moveTo(sp.x, sp.y) : ctx.lineTo(sp.x, sp.y);
        });
        if (obj.type === "fill" && obj.points.length >= 3) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (selected || view.showPoints) {
        for (let i = 0; i < obj.points.length; i++) {
          const sp = cam.toScreen(obj.points[i]);
          ctx.fillStyle = selected ? "#ff3b6b" : "rgba(0,0,0,0.4)";
          ctx.beginPath(); ctx.arc(sp.x, sp.y, selected ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }
}
