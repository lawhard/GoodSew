// GoodSew — SE700 embroidery designer. Main application controller.
//
// Two phases:
//   design : lay out solid vector objects (text + shapes), move/resize/rotate.
//   stitch : "Render" compiles objects into a stitch plan to simulate & export.

import { state, makeObject, selectedObject, markDirty, serialize, deserialize, nextId, defaultParams } from "./state.js";
import { HOOPS, getHoop, SE700 } from "./hoop.js";
import { BROTHER_PALETTE, rgbToHex } from "./threads.js";
import { compile } from "./compiler.js";
import { computeStats, formatTime } from "./stats.js";
import { exportPES } from "./export/pes.js";
import { exportDST } from "./export/dst.js";
import { Camera, render, RULER, getObjBox, boxHandlesWorld } from "./render.js";
import { Simulator } from "./simulator.js";
import { dist, bbox, rotatePoint, pointInPolygon } from "./geometry.js";
import { SHAPES, buildShape } from "./shapes.js";
import { FONTS, loadFont, loadedFont, textToGlyphs, cssFamily } from "./fonts.js";
import { UNITS, fmt, toUnit, fromUnit } from "./units.js";
import { PRODUCTS, getProduct, renderPreview } from "./preview.js";

const APP_VERSION = "0.4.4"; // keep in sync with the badge in index.html

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const cam = new Camera();

const view = { showImage: true, showStitches: true, showJumps: true, showPoints: false, showGrid: true };

let compiled = null;
let tool = "select";
let drag = null;
let needsRender = true;
let spaceDown = false;
let shiftDown = false;
let cursor = null;
let hoverGuide = null;
let shapeKind = "rect";

const $ = (id) => document.getElementById(id);
const rad = (d) => (d * Math.PI) / 180;
const rotVec = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

const sim = new Simulator((s) => {
  $("sim-scrub").value = s.index;
  $("sim-stitch-idx").textContent = `${s.index} / ${s.total}`;
  $("sim-play").textContent = s.playing ? "⏸" : "▶";
  updateSimColor(s);
  needsRender = true;
});

// ---------------------------------------------------------------- canvas size
function resize() {
  const wrap = $("canvas-wrap");
  const r = wrap.getBoundingClientRect();
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  if (!cam._fitted) { cam.fit(getHoop(state.hoopId), r.width, r.height, RULER); cam._fitted = true; }
  needsRender = true;
}
window.addEventListener("resize", resize);

// ----------------------------------------------------------------- compile
function recompile() {
  compiled = compile();
  state.plan = compiled;
  state.planDirty = false;
  sim.setPlan(compiled.plan);
  $("sim-scrub").max = compiled.plan.length;
  refreshStats();
  needsRender = true;
}
function ensureCompiled() { if (state.planDirty || !compiled) recompile(); }

function refreshStats() {
  if (!compiled) return;
  const st = computeStats(compiled);
  $("stat-stitches").textContent = st.stitches.toLocaleString();
  $("stat-colors").textContent = st.colorChanges;
  $("stat-jumps").textContent = st.jumps;
  $("stat-trims").textContent = st.trims;
  $("stat-dims").textContent = st.width > 0 ? `${fmt(st.width, state.units)} × ${fmt(st.height, state.units)}` : "—";
  $("stat-time").textContent = formatTime(st.seconds);
}

// ----------------------------------------------------------- history (undo/redo)
let undoStack = [], redoStack = [], commitTimer = null;

function historySnapshot() {
  return JSON.stringify({
    objects: state.objects.map((o) => ({
      id: o.id, type: o.type, name: o.name, color: o.color, kind: o.kind,
      box: o.box, rotation: o.rotation || 0, points: o.points,
      params: { ...o.params }, visible: o.visible,
    })),
    guides: state.guides,
    selectedId: state.selectedId,
  });
}
// Record the current state as a new undo step (immediate).
function commit() {
  const snap = historySnapshot();
  if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
// Debounced commit for rapid edits (typing, dragging a slider).
function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 350); }
function resetHistory() { undoStack = []; redoStack = []; commit(); }

function restore(snap) {
  const data = JSON.parse(snap);
  state.objects = data.objects.map((o) => ({ ...o, params: { ...o.params } }));
  state.guides = data.guides || [];
  state.selectedId = data.selectedId;
  state.objects.forEach((o) => { if (o.type === "text") bakeText(o); else rebuildShape(o); });
  markDirty();
  if (state.mode === "stitch") recompile();
  refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
}
function undo() {
  clearTimeout(commitTimer);
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  restore(undoStack[undoStack.length - 1]);
  updateUndoButtons();
}
function redo() {
  if (!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(snap);
  restore(snap);
  updateUndoButtons();
}
function updateUndoButtons() {
  const u = $("btn-undo"), r = $("btn-redo");
  if (u) u.disabled = undoStack.length < 2;
  if (r) r.disabled = redoStack.length === 0;
}

// ----------------------------------------------------------- layer reorder
// Move the object within the draw order. delta>0 = toward the top of the layer
// list (drawn later / on top = later in the array).
function reorder(id, delta) {
  const i = state.objects.findIndex((o) => o.id === id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= state.objects.length) return;
  const [obj] = state.objects.splice(i, 1);
  state.objects.splice(j, 0, obj);
  markDirty();
  if (state.mode === "stitch") recompile();
  commit();
  refreshObjectList(); needsRender = true;
}

// ------------------------------------------------------------ object baking
function rebuildShape(obj) {
  if (!obj.box) return;
  let pts = buildShape(obj.kind || "rect", obj.box);
  const a = rad(obj.rotation || 0);
  if (a) {
    const c = { x: obj.box.x + obj.box.w / 2, y: obj.box.y + obj.box.h / 2 };
    pts = pts.map((p) => rotatePoint(p, c, a));
  }
  obj.points = pts;
}

// Build cached glyph contours for a text object. Synchronous when the font is
// already loaded; otherwise loads then re-bakes.
function bakeText(obj, after) {
  const font = loadedFont(obj.params.font);
  if (!font) {
    loadFont(obj.params.font).then(() => { bakeText(obj, after); markDirty(); refreshObjectList(); needsRender = true; })
      .catch((err) => toast("Font load failed: " + err.message, true));
    return;
  }
  const p = obj.params;
  const r = textToGlyphs(font, p.text || "", p.size, {
    letterSpacing: p.letterSpacing || 0, bold: p.bold, italic: p.italic, underline: p.underline, curve: (p.curve || 0) / 100,
  });
  const lb = r.bbox;
  obj._localBox = { minX: lb.minX, minY: lb.minY, w: lb.w, h: lb.h };
  obj._textW = r.width;
  const a = rad(obj.rotation || 0);
  if (a) {
    const cx = lb.minX + lb.w / 2, cy = lb.minY + lb.h / 2, c = { x: cx, y: cy };
    obj._glyphs = r.glyphs.map((cs) => cs.map((c2) => c2.map((pt) => rotatePoint(pt, c, a))));
  } else {
    obj._glyphs = r.glyphs;
  }
  if (after) after();
}

// ----------------------------------------------------------------- modes
function setMode(mode) {
  if (editing) closeTextEditor(true);
  state.mode = mode;
  document.body.dataset.mode = mode;
  if (mode === "stitch") { ensureCompiled(); sim.toStart(); sim.engaged = false; sim.seek(0); sim.engaged = false; needsRender = true; }
  setTool("select");
  refreshProps();
  updateEmptyHint();
  needsRender = true;
}

async function renderStitches() {
  if (!state.objects.length) { toast("Add some text or shapes first.", true); return; }
  // Make sure every text object's font is loaded & baked before compiling.
  const texts = state.objects.filter((o) => o.type === "text");
  await Promise.all(texts.map((o) => loadFont(o.params.font).then(() => bakeText(o)).catch(() => {})));
  markDirty();
  setMode("stitch");
  recompile();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing rendered — check your objects.", true); }
}

// ----------------------------------------------------------------- tools
function setTool(t) {
  if (t !== "shape") $("shape-popover").classList.add("hidden");
  if (t === "image") { $("file-image").click(); return; }
  tool = t;
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  const hints = {
    select: "Click to select. Drag to move. Drag handles to resize, top knob to rotate. Double-click text to edit.",
    text: "Click on the canvas to drop your text, then type.",
    shape: "Pick a shape, then drag on the canvas. Hold Shift for an even shape.",
  };
  $("hud-hint").textContent = hints[t] || "";
  canvas.style.cursor = t === "select" ? "default" : "crosshair";
  if (t === "shape") openShapePopover();
}

// ----------------------------------------------------------------- creators
function addText(anchor) {
  const obj = makeObject("text", [anchor], state.activeColor);
  obj.name = "Text";
  obj.params.text = "Text";
  state.objects.push(obj);
  state.selectedId = obj.id;
  bakeText(obj, () => { markDirty(); refreshObjectList(); refreshProps(); needsRender = true; });
  setTool("select");
  refreshObjectList(); refreshProps(); updateEmptyHint();
  commit();
}

function addShape(kind, box) {
  const obj = makeObject("fill", [], state.activeColor);
  obj.kind = kind;
  obj.box = { ...box };
  obj.name = SHAPES.find((s) => s.kind === kind)?.label || "Shape";
  rebuildShape(obj);
  state.objects.push(obj);
  state.selectedId = obj.id;
  markDirty(); refreshObjectList(); refreshProps(); updateEmptyHint();
  return obj;
}

// ------------------------------------------------------------- coordinate map
function mouseWorld(e) {
  const r = canvas.getBoundingClientRect();
  return cam.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
}

// --------------------------------------------------------- mouse interaction
const HANDLE_HIT = 9;

function selectionHandlesScreen(obj) {
  const box = getObjBox(obj);
  const h = boxHandlesWorld(box);
  const out = {};
  for (const k of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) out[k] = cam.toScreen(h[k]);
  // rotate handle: above the top-mid edge
  const nMid = cam.toScreen(h.n);
  const swS = cam.toScreen(h.sw), nwS = cam.toScreen(h.nw);
  const dx = nwS.x - swS.x, dy = nwS.y - swS.y, l = Math.hypot(dx, dy) || 1;
  out.rotate = { x: nMid.x + (dx / l) * 22, y: nMid.y + (dy / l) * 22 };
  out._box = box;
  return out;
}

const OPP = { nw: "se", ne: "sw", se: "nw", sw: "ne", n: "s", s: "n", e: "w", w: "e" };

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2) return;
  const world = mouseWorld(e);
  const mx = e.offsetX, my = e.offsetY;

  if (e.button === 1 || spaceDown) {
    drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY };
    return;
  }

  // ruler → guides
  if (my < RULER && mx >= RULER) { const g = { id: nextId(), axis: "x", pos: world.x }; state.guides.push(g); drag = { mode: "guide", guide: g }; return; }
  if (mx < RULER && my >= RULER) { const g = { id: nextId(), axis: "y", pos: world.y }; state.guides.push(g); drag = { mode: "guide", guide: g }; return; }
  if (mx < RULER || my < RULER) return;
  const gh = guideAt(mx, my);
  if (gh) { drag = { mode: "guide", guide: gh }; return; }

  if (state.mode === "stitch") {
    // stitch view: click an object to fine-tune it; drag empty space to pan.
    const hit = hitTestObject(world);
    if (hit) { state.selectedId = hit.id; }
    else { state.selectedId = null; drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY }; }
    refreshProps(); refreshObjectList(); needsRender = true;
    return;
  }

  if (tool === "shape") {
    const obj = addShape(shapeKind, { x: world.x, y: world.y, w: 0.1, h: 0.1 });
    drag = { mode: "draw-shape", obj, start: world };
    $("shape-popover").classList.add("hidden");
    return;
  }
  if (tool === "text") { addText(world); return; }

  // select tool — handles first, then objects
  const sel = selectedObject();
  if (sel && sel.visible) {
    const H = selectionHandlesScreen(sel);
    if (dist(H.rotate, { x: mx, y: my }) <= HANDLE_HIT + 2) {
      const box = H._box;
      drag = { mode: "rotate", obj: sel, center: { x: box.cx, y: box.cy }, startAngle: Math.atan2(world.y - box.cy, world.x - box.cx), startRot: sel.rotation || 0 };
      return;
    }
    for (const k of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      if (dist(H[k], { x: mx, y: my }) <= HANDLE_HIT) {
        const box = H._box;
        const anchorW = boxHandlesWorld(box)[OPP[k]];
        drag = { mode: "resize", obj: sel, handle: k, anchorW, rot: rad(box.rot), startW: box.w, startH: box.h };
        return;
      }
    }
  }

  const hit = hitTestObject(world);
  if (hit) {
    state.selectedId = hit.id;
    drag = { mode: "move", obj: hit, start: world, orig: snapshot(hit) };
    refreshProps(); refreshObjectList(); needsRender = true;
  } else {
    // empty space: deselect and pan the view (drag to move the build plate)
    state.selectedId = null;
    drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY };
    refreshProps(); refreshObjectList(); needsRender = true;
  }
});

function snapshot(obj) {
  return { points: obj.points.map((p) => ({ ...p })), box: obj.box ? { ...obj.box } : null };
}

canvas.addEventListener("mousemove", (e) => {
  const world = mouseWorld(e);
  cursor = { sx: e.offsetX, sy: e.offsetY };
  $("hud-coords").textContent = `${fmt(world.x, state.units)}, ${fmt(world.y, state.units)}`;

  if (!drag) {
    const gh = guideAt(e.offsetX, e.offsetY);
    if (gh !== hoverGuide) hoverGuide = gh;
    canvas.style.cursor = gh ? (gh.axis === "x" ? "ew-resize" : "ns-resize")
      : hoverCursor(e.offsetX, e.offsetY);
    needsRender = true;
    return;
  }

  if (drag.mode === "pan") {
    cam.panX = drag.panX + (e.clientX - drag.startX);
    cam.panY = drag.panY + (e.clientY - drag.startY);
  } else if (drag.mode === "guide") {
    drag.guide.pos = drag.guide.axis === "x" ? world.x : world.y;
  } else if (drag.mode === "draw-shape") {
    const s = drag.start;
    let box;
    if (shiftDown) {
      const r = Math.max(Math.abs(world.x - s.x), Math.abs(world.y - s.y)) || 0.1;
      box = { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
    } else {
      box = { x: Math.min(s.x, world.x), y: Math.min(s.y, world.y), w: Math.abs(world.x - s.x) || 0.1, h: Math.abs(world.y - s.y) || 0.1 };
    }
    drag.obj.box = box; rebuildShape(drag.obj); markDirty();
  } else if (drag.mode === "move") {
    const dx = world.x - drag.start.x, dy = world.y - drag.start.y;
    const o = drag.obj;
    o.points = drag.orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (drag.orig.box) o.box = { ...drag.orig.box, x: drag.orig.box.x + dx, y: drag.orig.box.y + dy };
    markDirty();
  } else if (drag.mode === "resize") {
    doResize(drag, world);
    markDirty();
  } else if (drag.mode === "rotate") {
    let deg = drag.startRot + (Math.atan2(world.y - drag.center.y, world.x - drag.center.x) - drag.startAngle) * 180 / Math.PI;
    if (shiftDown) deg = Math.round(deg / 15) * 15;
    drag.obj.rotation = deg;
    if (drag.obj.type === "text") bakeText(drag.obj); else rebuildShape(drag.obj);
    markDirty();
  }
  needsRender = true;
});

function doResize(d, world) {
  const o = d.obj;
  const k = d.handle;
  const sx = k.includes("e") ? 1 : k.includes("w") ? -1 : 0;
  const sy = k.includes("s") ? 1 : k.includes("n") ? -1 : 0;
  // pointer in local (un-rotated) frame relative to the fixed anchor
  const local = rotVec({ x: world.x - d.anchorW.x, y: world.y - d.anchorW.y }, -d.rot);
  const MIN = 1.0;

  if (o.type === "text") {
    // uniform scale by distance ratio from anchor
    const startDiag = Math.hypot(d.startW || 1, d.startH || 1);
    const ratio = Math.max(0.05, Math.hypot(local.x, local.y) / startDiag);
    o.params.size = Math.max(2, (o._sizeAtDragStart ?? o.params.size) * ratio);
    if (d._sizeBase == null) d._sizeBase = o.params.size; // not used; kept for clarity
    bakeText(o);
    // reposition so the anchor handle stays put
    const lb = o._localBox;
    const half = { x: (-sx) * lb.w / 2, y: (-sy) * lb.h / 2 }; // anchor offset from center
    const center = { x: d.anchorW.x - rotVec(half, d.rot).x, y: d.anchorW.y - rotVec(half, d.rot).y };
    o.points[0] = { x: center.x - (lb.minX + lb.w / 2), y: center.y - (lb.minY + lb.h / 2) };
    return;
  }

  let w = sx !== 0 ? Math.max(MIN, Math.abs(local.x)) : d.startW;
  let h = sy !== 0 ? Math.max(MIN, Math.abs(local.y)) : d.startH;
  if (shiftDown && sx !== 0 && sy !== 0) {
    const s = Math.max(w / d.startW, h / d.startH);
    w = d.startW * s; h = d.startH * s;
  }
  const center = { x: d.anchorW.x + rotVec({ x: sx * w / 2, y: sy * h / 2 }, d.rot).x,
                   y: d.anchorW.y + rotVec({ x: sx * w / 2, y: sy * h / 2 }, d.rot).y };
  o.box = { x: center.x - w / 2, y: center.y - h / 2, w, h };
  rebuildShape(o);
}

window.addEventListener("mouseup", () => {
  if (drag) {
    if (drag.mode === "guide") {
      const inRuler = cursor && (cursor.sx < RULER || cursor.sy < RULER);
      if (inRuler) state.guides = state.guides.filter((g) => g.id !== drag.guide.id);
      commit();
    } else if (drag.mode === "draw-shape") {
      const b = drag.obj.box;
      if (b.w < 1.2 && b.h < 1.2) {
        state.objects = state.objects.filter((o) => o !== drag.obj);
        state.selectedId = null;
      }
      setTool("select");
      refreshObjectList(); refreshProps();
      commit();
    } else if (drag.mode === "resize" || drag.mode === "rotate" || drag.mode === "move") {
      refreshProps();
      commit();
    }
  }
  drag = null;
  needsRender = true;
});

// remember size at drag start for text resize
canvas.addEventListener("mousedown", () => { const s = selectedObject(); if (s && s.type === "text") s._sizeAtDragStart = s.params.size; });

canvas.addEventListener("dblclick", (e) => {
  const gh = guideAt(e.offsetX, e.offsetY);
  if (gh) { state.guides = state.guides.filter((g) => g.id !== gh.id); hoverGuide = null; needsRender = true; return; }
  if (state.mode !== "design") return;
  const world = mouseWorld(e);
  const hit = hitTestObject(world);
  if (hit && hit.type === "text") { state.selectedId = hit.id; openTextEditor(hit); refreshProps(); refreshObjectList(); }
});

canvas.addEventListener("mouseleave", () => { cursor = null; needsRender = true; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  cam.zoomAt(e.offsetX, e.offsetY, factor);
  $("hud-zoom").textContent = Math.round(cam.pxPerMm / baseScale() * 100) + "%";
  needsRender = true;
}, { passive: false });

function baseScale() {
  const r = canvas.getBoundingClientRect();
  const hoop = getHoop(state.hoopId);
  return Math.min((r.width - 80) / hoop.w, (r.height - 80) / hoop.h);
}

function hoverCursor(mx, my) {
  if (state.mode !== "design") return "grab"; // stitch view: drag empty space to pan
  const sel = selectedObject();
  if (sel && sel.visible) {
    const H = selectionHandlesScreen(sel);
    if (dist(H.rotate, { x: mx, y: my }) <= HANDLE_HIT + 2) return "grab";
    for (const k of ["nw", "ne", "se", "sw"]) if (dist(H[k], { x: mx, y: my }) <= HANDLE_HIT) return "nwse-resize";
    for (const k of ["n", "s"]) if (dist(H[k], { x: mx, y: my }) <= HANDLE_HIT) return "ns-resize";
    for (const k of ["e", "w"]) if (dist(H[k], { x: mx, y: my }) <= HANDLE_HIT) return "ew-resize";
  }
  // select tool: grab affordance on the (pannable) plate; crosshair while placing
  return tool === "select" ? "grab" : "crosshair";
}

function guideAt(mx, my) {
  const tol = 5;
  for (const g of state.guides) {
    if (g.axis === "x") { if (my < RULER) continue; if (Math.abs(cam.toScreen({ x: g.pos, y: 0 }).x - mx) <= tol) return g; }
    else { if (mx < RULER) continue; if (Math.abs(cam.toScreen({ x: 0, y: g.pos }).y - my) <= tol) return g; }
  }
  return null;
}

function hitTestObject(world) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    if (!obj.visible) continue;
    const box = getObjBox(obj);
    // transform world into object-local frame
    const a = rad(box.rot);
    const local = rotVec({ x: world.x - box.cx, y: world.y - box.cy }, -a);
    if (Math.abs(local.x) <= box.w / 2 + 1 && Math.abs(local.y) <= box.h / 2 + 1) return obj;
  }
  return null;
}

// --------------------------------------------------------------- text editor
let editing = null;
function openTextEditor(obj) {
  editing = obj;
  const ed = $("text-editor");
  const box = getObjBox(obj);
  const sp = cam.toScreen(boxHandlesWorld(box).nw);
  ed.style.left = sp.x + "px";
  ed.style.top = sp.y + "px";
  ed.style.fontFamily = cssFamily(obj.params.font);
  ed.value = obj.params.text;
  ed.classList.remove("hidden");
  ed.focus(); ed.select();
}
function closeTextEditor(doCommit) {
  if (!editing) return;
  const ed = $("text-editor");
  if (doCommit) { editing.params.text = ed.value || " "; editing.name = ed.value.slice(0, 18) || "Text"; bakeText(editing); markDirty(); }
  ed.classList.add("hidden");
  editing = null;
  refreshObjectList(); refreshProps(); needsRender = true;
  if (doCommit) commit();
}
$("text-editor").addEventListener("input", (e) => { if (editing) { editing.params.text = e.target.value || " "; bakeText(editing); needsRender = true; } });
$("text-editor").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); closeTextEditor(true); }
  else if (e.key === "Escape") { e.preventDefault(); closeTextEditor(true); }
  e.stopPropagation();
});
$("text-editor").addEventListener("blur", () => closeTextEditor(true));

// --------------------------------------------------------------- keyboard
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") shiftDown = true;
  // Undo/redo work at the canvas level (only when not typing in a field).
  if ((e.ctrlKey || e.metaKey) && !(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === " ") spaceDown = true;
  if (state.mode === "design") {
    switch (e.key.toLowerCase()) {
      case "v": setTool("select"); break;
      case "t": setTool("text"); break;
      case "s": setTool("shape"); break;
    }
  }
  if ((e.key === "Delete" || e.key === "Backspace") && state.selectedId && state.mode === "design") { deleteSelected(); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; if (e.key === "Shift") shiftDown = false; });

function deleteSelected() {
  state.objects = state.objects.filter((o) => o.id !== state.selectedId);
  state.selectedId = null;
  markDirty(); refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
  commit();
}

// ----------------------------------------------------------------- UI build
function buildThreadPicker() {
  const sel = $("thread-picker");
  sel.innerHTML = "";
  for (const t of BROTHER_PALETTE) {
    const opt = document.createElement("option");
    opt.value = rgbToHex(t.rgb);
    opt.textContent = `#${t.i} ${t.name}`;
    sel.appendChild(opt);
  }
  sel.value = state.activeColor;
  sel.addEventListener("change", () => {
    state.activeColor = sel.value;
    updateActiveSwatch();
    const s = selectedObject();
    if (s) { s.color = sel.value; markDirty(); refreshObjectList(); refreshProps(); needsRender = true; commit(); }
  });
  updateActiveSwatch();
}
function updateActiveSwatch() { $("active-thread-swatch").style.background = state.activeColor; }

function buildUnitToggle() {
  const wrap = $("unit-toggle");
  const sync = () => wrap.querySelectorAll(".unit-btn").forEach((b) => b.classList.toggle("active", b.dataset.unit === state.units));
  wrap.querySelectorAll(".unit-btn").forEach((b) => b.addEventListener("click", () => {
    state.units = b.dataset.unit; sync(); updateHoopDims(); refreshStats(); refreshProps(); needsRender = true;
  }));
  sync();
}
function updateHoopDims() {
  const h = getHoop(state.hoopId);
  $("hoop-dims").textContent = `${SE700.model} • field ${fmt(h.w, "in")} × ${fmt(h.h, "in")} (${h.w}×${h.h} mm) • max ${SE700.maxSpeedSpm} spm`;
}

// ----------------------------------------------------------- shape popover
function buildShapeGrid() {
  const grid = $("shape-grid");
  grid.innerHTML = "";
  for (const s of SHAPES) {
    if (s.kind === "line") continue; // lines aren't fillable objects in this phase
    const cell = document.createElement("button");
    cell.className = "shape-cell" + (s.kind === shapeKind ? " active" : "");
    cell.title = s.label;
    cell.innerHTML = shapeSVG(s.kind);
    cell.onclick = () => {
      shapeKind = s.kind;
      tool = "shape";
      document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === "shape"));
      $("hud-hint").textContent = `Drag on the canvas to place your ${s.label.toLowerCase()}. Hold Shift for an even shape.`;
      $("shape-popover").classList.add("hidden"); // free the whole canvas to draw on
    };
    grid.appendChild(cell);
  }
}
function openShapePopover() { buildShapeGrid(); $("shape-popover").classList.remove("hidden"); }

function shapeSVG(kind) {
  const pts = buildShape(kind, { x: 4, y: 4, w: 40, h: 40 });
  const d = pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ") + " Z";
  return `<svg viewBox="0 0 48 48"><path d="${d}"/></svg>`;
}

// ----------------------------------------------------------- objects list
function refreshObjectList() {
  const ul = $("object-list");
  ul.innerHTML = "";
  $("object-count").textContent = `(${state.objects.length})`;
  if (!state.objects.length) { ul.innerHTML = `<li class="empty-objects">No objects yet.</li>`; return; }
  // top of list = drawn last; show in reverse so newest is on top
  state.objects.slice().reverse().forEach((obj) => {
    const li = document.createElement("li");
    li.className = "object-item" + (obj.id === state.selectedId ? " selected" : "");
    const icon = document.createElement("span");
    icon.className = "obj-icon"; icon.style.background = obj.color;
    icon.textContent = obj.type === "text" ? "T" : "◆";
    const main = document.createElement("div"); main.className = "obj-main";
    const label = document.createElement("span"); label.className = "obj-label";
    label.textContent = obj.type === "text" ? (obj.params.text || "Text") : obj.name;
    const sub = document.createElement("span"); sub.className = "obj-sub";
    sub.textContent = obj.type === "text" ? `Text · ${obj.params.font}` : `Shape · ${obj.name}`;
    main.append(label, sub);
    const idx = state.objects.indexOf(obj);
    const up = document.createElement("button");
    up.className = "obj-btn"; up.textContent = "▲"; up.title = "Move up (forward)";
    up.disabled = idx === state.objects.length - 1;
    up.onclick = (e) => { e.stopPropagation(); reorder(obj.id, +1); };
    const down = document.createElement("button");
    down.className = "obj-btn"; down.textContent = "▼"; down.title = "Move down (back)";
    down.disabled = idx === 0;
    down.onclick = (e) => { e.stopPropagation(); reorder(obj.id, -1); };
    const vis = document.createElement("button");
    vis.className = "obj-btn"; vis.textContent = obj.visible ? "👁" : "🚫"; vis.title = "Show / hide";
    vis.onclick = (e) => { e.stopPropagation(); obj.visible = !obj.visible; markDirty(); if (state.mode === "stitch") recompile(); refreshObjectList(); needsRender = true; commit(); };
    const del = document.createElement("button");
    del.className = "obj-btn danger"; del.textContent = "🗑"; del.title = "Delete";
    del.onclick = (e) => { e.stopPropagation(); state.selectedId = obj.id; deleteSelected(); };
    li.append(icon, main, up, down, vis, del);
    li.onclick = () => { state.selectedId = obj.id; refreshProps(); refreshObjectList(); needsRender = true; };
    ul.appendChild(li);
  });
}

// ----------------------------------------------------------- properties
function refreshProps() {
  if (state.mode === "stitch") { refreshStitchSettings(); return; }
  const host = $("object-props");
  $("props-title").textContent = "Properties";
  const obj = selectedObject();
  if (!obj) { host.className = "props-empty"; host.textContent = "Select or add an object to edit it."; return; }
  host.className = ""; host.innerHTML = "";

  if (obj.type === "text") buildTextProps(host, obj);
  else buildShapeProps(host, obj);

  const del = document.createElement("button");
  del.className = "btn btn-danger"; del.textContent = "Delete object";
  del.style.width = "100%"; del.style.marginTop = "6px";
  del.onclick = deleteSelected;
  host.appendChild(del);
}

function rowFull(host, labelText, el) {
  const d = document.createElement("div"); d.className = "prop-full";
  const l = document.createElement("label"); l.textContent = labelText;
  d.append(l, el); host.appendChild(d);
}
function row(host, labelText, el) {
  const d = document.createElement("div"); d.className = "prop-row";
  const l = document.createElement("label"); l.textContent = labelText;
  d.append(l, el); host.appendChild(d);
}
function numInput(val, step, min, onChange) {
  const i = document.createElement("input");
  i.type = "number"; i.value = round(val); i.step = step; if (min != null) i.min = min;
  i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) { onChange(v); commitSoon(); } };
  return i;
}
const round = (v) => Math.round(v * 1000) / 1000;

function buildTextProps(host, obj) {
  $("props-title").textContent = "Text";
  const t = document.createElement("input");
  t.type = "text"; t.value = obj.params.text;
  t.oninput = () => { obj.params.text = t.value || " "; obj.name = t.value.slice(0, 18); bakeText(obj); markDirty(); refreshObjectList(); needsRender = true; commitSoon(); };
  rowFull(host, "Text", t);

  const fb = document.createElement("button");
  fb.className = "font-btn";
  fb.innerHTML = `<span class="fname" style="font-family:${cssFamily(obj.params.font)}">${obj.params.font}</span><span class="chev">▾ Library</span>`;
  fb.onclick = () => openFontGallery(obj);
  rowFull(host, "Font", fb);

  const u = state.units;
  row(host, `Size (${u})`, numInput(toUnit(obj.params.size, u), u === "in" ? 0.05 : 1, 0.05, (v) => { obj.params.size = fromUnit(v, u); bakeText(obj); markDirty(); needsRender = true; }));

  // B / I / U
  const styleWrap = document.createElement("div"); styleWrap.className = "style-btns";
  const mk = (label, key, cls) => {
    const b = document.createElement("button"); b.className = "style-btn" + (obj.params[key] ? " active" : "");
    b.innerHTML = cls ? `<span class="${cls}">${label}</span>` : `<b>${label}</b>`;
    b.onclick = () => { obj.params[key] = !obj.params[key]; b.classList.toggle("active"); bakeText(obj); markDirty(); needsRender = true; commit(); };
    return b;
  };
  styleWrap.append(mk("B", "bold"), mk("I", "italic", "i"), mk("U", "underline", "u"));
  rowFull(host, "Style", styleWrap);

  const curve = document.createElement("input");
  curve.type = "range"; curve.min = -100; curve.max = 100; curve.value = obj.params.curve || 0;
  curve.oninput = () => { obj.params.curve = parseInt(curve.value, 10); bakeText(obj); markDirty(); needsRender = true; commitSoon(); };
  row(host, "Arc / circle", curve);

  row(host, "Rotation (°)", numInput(obj.rotation || 0, 5, null, (v) => { obj.rotation = v; bakeText(obj); markDirty(); needsRender = true; }));

  buildColorRow(host, obj);
}

function buildShapeProps(host, obj) {
  $("props-title").textContent = "Shape";
  const sel = document.createElement("select"); sel.className = "select";
  for (const s of SHAPES) { if (s.kind === "line") continue; const o = document.createElement("option"); o.value = s.kind; o.textContent = s.label; sel.appendChild(o); }
  sel.value = obj.kind || "rect";
  sel.onchange = () => { obj.kind = sel.value; obj.name = SHAPES.find((s) => s.kind === sel.value)?.label || "Shape"; rebuildShape(obj); markDirty(); refreshObjectList(); needsRender = true; commit(); };
  row(host, "Shape", sel);

  const u = state.units;
  if (obj.box) {
    row(host, `Width (${u})`, numInput(toUnit(obj.box.w, u), u === "in" ? 0.05 : 1, 0.1, (v) => { obj.box.w = Math.max(1, fromUnit(v, u)); rebuildShape(obj); markDirty(); needsRender = true; }));
    row(host, `Height (${u})`, numInput(toUnit(obj.box.h, u), u === "in" ? 0.05 : 1, 0.1, (v) => { obj.box.h = Math.max(1, fromUnit(v, u)); rebuildShape(obj); markDirty(); needsRender = true; }));
  }
  row(host, "Rotation (°)", numInput(obj.rotation || 0, 5, null, (v) => { obj.rotation = v; rebuildShape(obj); markDirty(); needsRender = true; }));

  const fillSel = document.createElement("select"); fillSel.className = "select";
  fillSel.innerHTML = `<option value="fill">Filled</option><option value="outline">Outline only</option>`;
  fillSel.value = obj.params.fillMode || "fill";
  fillSel.onchange = () => { obj.params.fillMode = fillSel.value; markDirty(); needsRender = true; commit(); };
  row(host, "Style", fillSel);

  buildColorRow(host, obj);
}

function buildColorRow(host, obj) {
  const wrap = document.createElement("div"); wrap.className = "color-row";
  const dot = document.createElement("span"); dot.className = "color-dot"; dot.style.background = obj.color;
  const sel = document.createElement("select"); sel.className = "select";
  for (const t of BROTHER_PALETTE) { const o = document.createElement("option"); o.value = rgbToHex(t.rgb); o.textContent = `#${t.i} ${t.name}`; sel.appendChild(o); }
  sel.value = obj.color;
  sel.onchange = () => { obj.color = sel.value; dot.style.background = sel.value; markDirty(); refreshObjectList(); needsRender = true; commit(); };
  wrap.append(dot, sel);
  rowFull(host, "Thread color", wrap);
}

// ----------------------------------------------------- stitch settings panel
function refreshStitchSettings() {
  const host = $("stitch-settings");
  const obj = selectedObject();
  if (!obj) { host.className = "props-empty"; host.textContent = "Select an object to fine-tune its fill."; return; }
  host.className = ""; host.innerHTML = "";
  const p = obj.params;
  const recompileLive = () => { markDirty(); recompile(); needsRender = true; };

  row(host, "Density (mm)", numInput(p.spacing ?? 0.4, 0.05, 0.25, (v) => { p.spacing = v; recompileLive(); }));
  row(host, "Stitch length (mm)", numInput(p.stitchLength ?? 3.0, 0.1, 1, (v) => { p.stitchLength = v; recompileLive(); }));
  row(host, "Fill angle (°)", numInput(p.angle ?? 0, 5, -180, (v) => { p.angle = v; recompileLive(); }));

  const under = document.createElement("input"); under.type = "checkbox"; under.checked = p.underlay !== false;
  under.onchange = () => { p.underlay = under.checked; recompileLive(); commit(); };
  row(host, "Underlay", under);

  const out = document.createElement("input"); out.type = "checkbox"; out.checked = !!p.outline;
  out.onchange = () => { p.outline = out.checked; recompileLive(); commit(); };
  row(host, "Outline pass", out);
}

// ----------------------------------------------------------- font gallery
let fontTarget = null;
function buildFontGrid() {
  const grid = $("font-grid");
  const sample = $("font-sample").value || (fontTarget && fontTarget.params.text) || "Embroidery";
  grid.innerHTML = "";
  for (const f of FONTS) {
    const card = document.createElement("div");
    card.className = "font-card" + (fontTarget && fontTarget.params.font === f.name ? " active" : "");
    const s = document.createElement("div"); s.className = "font-sample";
    s.style.fontFamily = cssFamily(f.name); s.textContent = sample;
    const meta = document.createElement("div"); meta.className = "font-meta";
    meta.innerHTML = `<div class="nm">${f.name}</div><div class="cat">${f.category}</div>`;
    card.append(s, meta);
    card.onclick = () => {
      if (fontTarget) { fontTarget.params.font = f.name; bakeText(fontTarget, () => { markDirty(); refreshObjectList(); refreshProps(); needsRender = true; }); commit(); }
      closeFontGallery();
    };
    grid.appendChild(card);
  }
}
function openFontGallery(obj) {
  fontTarget = obj;
  // ensure all faces are fetched so glyph baking is instant after pick
  FONTS.forEach((f) => loadFont(f.name).catch(() => {}));
  $("font-sample").value = obj.params.text && obj.params.text.trim() ? obj.params.text : "";
  $("font-modal").classList.remove("hidden");
  buildFontGrid();
}
function closeFontGallery() { $("font-modal").classList.add("hidden"); }
$("font-close").onclick = closeFontGallery;
$("font-sample").oninput = buildFontGrid;
$("font-modal").addEventListener("click", (e) => { if (e.target.id === "font-modal") closeFontGallery(); });

// ----------------------------------------------------------------- toolbar
document.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
[["chk-show-image", "showImage"], ["chk-show-stitches", "showStitches"], ["chk-show-jumps", "showJumps"],
 ["chk-show-points", "showPoints"], ["chk-show-grid", "showGrid"]].forEach(([id, key]) => {
  const el = $(id); if (el) el.addEventListener("change", (e) => { view[key] = e.target.checked; needsRender = true; });
});

// ----------------------------------------------------------------- sim bar
$("sim-play").onclick = () => sim.toggle();
$("sim-start").onclick = () => sim.toStart();
$("sim-end").onclick = () => sim.toEnd();
$("sim-scrub").oninput = (e) => sim.seek(parseInt(e.target.value, 10));
$("sim-speed").oninput = (e) => { sim.speed = parseInt(e.target.value, 10); };

// ----------------------------------------------------------------- top bar
$("btn-render").onclick = () => renderStitches();
$("btn-back").onclick = () => setMode("design");
$("btn-theme").onclick = () => { state.theme = state.theme === "light" ? "dark" : "light"; document.body.dataset.theme = state.theme; needsRender = true; };
$("btn-undo").onclick = undo;
$("btn-redo").onclick = redo;

$("btn-new").onclick = () => {
  if (!confirm("Start a new design? Unsaved work will be lost.")) return;
  state.objects = []; state.selectedId = null; state.image = null;
  markDirty(); setMode("design"); refreshObjectList(); refreshProps(); updateEmptyHint();
  resetHistory();
  toast("New design");
};
$("btn-import-image").onclick = () => $("file-image").click();
$("file-image").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    state.image = img;
    const hoop = getHoop(state.hoopId);
    const sc = (hoop.w * 0.8) / img.width;
    state.imageTransform = { x: hoop.w * 0.1, y: hoop.h * 0.1, scale: sc, opacity: 0.5 };
    needsRender = true; toast("Image imported — trace over it with shapes & text");
  };
  img.src = URL.createObjectURL(f);
  e.target.value = "";
};
$("btn-save-json").onclick = () => { download(serialize(), "design.gsew", "application/json"); toast("Project saved"); };
$("btn-load-json").onclick = () => $("file-json").click();
$("file-json").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      deserialize(reader.result);
      document.body.dataset.theme = state.theme;
      state.objects.forEach((o) => { if (o.type === "text") bakeText(o); else rebuildShape(o); });
      setMode("design");
      refreshObjectList(); refreshProps(); updateEmptyHint();
      cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight, RULER);
      resetHistory();
      toast("Project loaded");
    } catch (err) { toast("Could not load file: " + err.message, true); }
  };
  reader.readAsText(f);
  e.target.value = "";
};

// ----------------------------------------------------------------- preview
let previewProduct = "tshirt";
function buildPreviewProducts() {
  const host = $("preview-products"); host.innerHTML = "";
  for (const p of PRODUCTS) {
    const b = document.createElement("button");
    b.className = "pp-btn" + (p.id === previewProduct ? " active" : "");
    b.textContent = p.label;
    b.onclick = () => { previewProduct = p.id; buildPreviewProducts(); drawPreview(); };
    host.appendChild(b);
  }
  $("preview-custom").classList.toggle("hidden", getProduct(previewProduct).custom !== true);
}
function drawPreview() {
  ensureCompiled();
  const pc = $("preview-canvas");
  const r = pc.getBoundingClientRect();
  pc.width = Math.round(r.width * devicePixelRatio);
  pc.height = Math.round(r.height * devicePixelRatio);
  const pctx = pc.getContext("2d");
  const product = getProduct(previewProduct);
  const cu = state.units;
  const customW = fromUnit(parseFloat($("custom-w").value) || 6, cu);
  const customH = fromUnit(parseFloat($("custom-h").value) || 4, cu);
  renderPreview(pctx, compiled, product, { customW, customH });
  const st = computeStats(compiled);
  $("preview-scale").textContent = st.width > 0 ? `— design ${fmt(st.width, cu)} × ${fmt(st.height, cu)}` : "";
  $("custom-unit").textContent = cu;
}
function openPreview() {
  ensureCompiled();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing to preview — render first.", true); return; }
  $("preview-modal").classList.remove("hidden");
  buildPreviewProducts();
  requestAnimationFrame(drawPreview);
}
$("btn-preview").onclick = openPreview;
$("preview-close").onclick = () => $("preview-modal").classList.add("hidden");
$("preview-modal").addEventListener("click", (e) => { if (e.target.id === "preview-modal") e.currentTarget.classList.add("hidden"); });
$("custom-w").oninput = drawPreview;
$("custom-h").oninput = drawPreview;

$("btn-export-pes").onclick = () => {
  ensureCompiled();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing to export — render first.", true); return; }
  const hoop = getHoop(state.hoopId);
  if (st.width > hoop.w + 0.5 || st.height > hoop.h + 0.5) {
    if (!confirm(`Design (${st.width.toFixed(0)}×${st.height.toFixed(0)} mm) exceeds the ${hoop.name} field. Export anyway?`)) return;
  }
  const bytes = exportPES(compiled, "GoodSew");
  download(bytes, "design.pes", "application/octet-stream");
  toast(`Exported design.pes — ${st.stitches.toLocaleString()} stitches, ${st.threadColors} colors`);
};

$("btn-export-dst").onclick = () => {
  ensureCompiled();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing to export — render first.", true); return; }
  const bytes = exportDST(compiled);
  download(bytes, "design.dst", "application/octet-stream");
  toast(`Exported design.dst — ${st.stitches.toLocaleString()} stitches (Tajima, universal)`);
};

// ----------------------------------------------------------------- helpers
function download(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer = null;
function toast(msg, isError) {
  const el = $("toast"); el.textContent = msg;
  el.classList.remove("hidden"); el.classList.toggle("error", !!isError);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}
function updateEmptyHint() {
  $("empty-hint").style.display = (state.mode === "design" && state.objects.length === 0) ? "block" : "none";
}
function updateSimColor(s) {
  const host = $("sim-color");
  if (!compiled || s.index === 0) { host.textContent = ""; host.style.background = "transparent"; return; }
  const entry = compiled.plan[Math.min(s.index - 1, compiled.plan.length - 1)];
  const c = compiled.colors[entry.color];
  if (c) { host.style.background = c.color; host.textContent = `#${c.brother.i} ${c.brother.name}`; }
}

// ----------------------------------------------------------------- main loop
function frame() {
  if (needsRender) {
    if (state.mode === "stitch") ensureCompiled();
    render(ctx, state, compiled, sim, { cam, view, cursor, hoverGuide, unit: UNITS[state.units] });
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- boot
function boot() {
  console.log(`GoodSew v${APP_VERSION} — JS bundle active`);
  const badge = $("version-badge"); if (badge) badge.textContent = `GoodSew v${APP_VERSION}`;
  document.body.dataset.theme = state.theme;
  document.body.dataset.mode = state.mode;
  buildThreadPicker();
  buildUnitToggle();
  buildShapeGrid();
  updateHoopDims();
  setTool("select");
  resize();
  seedDemo();
  refreshObjectList();
  refreshProps();
  updateEmptyHint();
  resetHistory();
  frame();

  window.__gs = {
    state, sim, setTool, setMode, renderStitches, undo, redo, reorder,
    setActiveColor: (hex) => { state.activeColor = hex; updateActiveSwatch(); },
    addText, addShape, bakeText,
    // test helper: screen-space handle positions for the given object
    handlesScreen: (id) => { const o = state.objects.find((x) => x.id === id); if (!o) return null; state.selectedId = o.id; return selectionHandlesScreen(o); },
    compiledStats: () => { ensureCompiled(); return computeStats(compiled); },
    exportBytes: () => { ensureCompiled(); return Array.from(exportPES(compiled, "GoodSew")); },
    exportDSTBytes: () => { ensureCompiled(); return Array.from(exportDST(compiled)); },
  };
}

// A friendly starter so the canvas isn't empty.
function seedDemo() {
  if (state.objects.length) return;
  const cx = getHoop(state.hoopId).w / 2;
  const heart = makeObject("fill", [], rgbToHex([209, 41, 71]));
  heart.kind = "heart"; heart.box = { x: cx - 18, y: 10, w: 36, h: 32 }; heart.name = "Heart";
  rebuildShape(heart);
  const text = makeObject("text", [{ x: cx - 30, y: 78 }], rgbToHex([14, 31, 124]));
  text.name = "GoodSew"; text.params.text = "GoodSew"; text.params.font = "Anton"; text.params.size = 16;
  state.objects.push(heart, text);
  state.selectedId = text.id;
  bakeText(text, () => { markDirty(); refreshObjectList(); needsRender = true; });
  markDirty();
}

boot();
