import {bakeRails} from './satin.js';
import {createDesignController,DESIGN_TOOLS} from './design-commands.js';
import {mountAssistantPanel} from './assistant-panel.js';
// GoodSew — SE700 embroidery designer. Main application controller.
//
// Two phases:
//   design : lay out solid vector objects (text + shapes), move/resize/rotate.
//   stitch : "Render" compiles objects into a stitch plan to simulate & export.

import { state, makeObject, selectedObject, markDirty, serialize, deserialize, nextId, defaultParams } from "./state.js";
import { HOOPS, getHoop, SE700 } from "./hoop.js";
import { NEWBROTHREAD, NB_GROUPS, nbHex, nearestNewBrothread, rgbToHex, hexToRgb } from "./threads.js";
import { compile } from "./compiler.js";
import { computeStats, formatTime } from "./stats.js";
import { exportPES } from "./export/pes.js";
import { exportDST } from "./export/dst.js";
import { Camera, render, RULER, getObjBox, boxHandlesWorld } from "./render.js";
import { Simulator } from "./simulator.js";
import { dist, bbox, rotatePoint, pointInPolygon } from "./geometry.js";
import { SHAPES, buildShape } from "./shapes.js";
import { FONTS, FONT_CATEGORIES, fontsInCategory, fontFaceCSS, loadFont, loadedFont, textToGlyphs, cssFamily } from "./fonts.js";
import { UNITS, fmt, toUnit, fromUnit } from "./units.js";
import { PRODUCTS, getProduct, renderPreview } from "./preview.js";
import { parseSVG } from "./import/svg.js";
import { traceRaster, RASTER_MAX_DIM } from "./import/raster.js";
import { optimizeObjects } from "./order.js";
import { buildSewSheet, FABRICS, fileStem } from "./sewing.js";
import { analyzeQuality } from "./qa.js";

const APP_VERSION = "0.15.0"; // keep in sync with the badge in index.html

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const cam = new Camera();

const view = { showImage: true, showStitches: true, showJumps: true, showPoints: false, showGrid: true, showHoop: true };

let compiled = null;
let tool = "select";
let drag = null;
// In-progress manual digitizing: { type: 'satin'|'run'|'poly', points, cursor }
let drawing = null;
let needsRender = true;
let spaceDown = false;
let shiftDown = false;
let cursor = null;
let hoverGuide = null;
let shapeKind = "rect";
// Smart alignment guides shown while dragging: the moving selection snaps to
// other objects' edges/centers and the hoop centerlines (Illustrator-style).
// Each guide: { axis:'v'|'h', pos, a, b, kind:'hoop'|'obj' } in world mm.
let snapGuides = [];

// How close (in screen pixels) an edge/center must come to a snap target
// before it pulls in. Pixel-based so the feel is the same at any zoom.
const SNAP_PX = 7;

// Static snap targets for a move drag: the hoop centerlines plus every other
// visible object's left/center/right (xs) and top/middle/bottom (ys), with
// the source extent so the guide line can span both objects.
function collectAlignTargets(excludeIds) {
  const hoop = getHoop(state.hoopId);
  const t = { xs: [], ys: [] };
  t.xs.push({ pos: hoop.w / 2, a: 0, b: hoop.h, kind: "hoop" });
  t.ys.push({ pos: hoop.h / 2, a: 0, b: hoop.w, kind: "hoop" });
  for (const o of state.objects) {
    if (!o.visible || excludeIds.has(o.id)) continue;
    const bx = getObjBox(o);
    const L = bx.cx - bx.w / 2, R = bx.cx + bx.w / 2;
    const T = bx.cy - bx.h / 2, B = bx.cy + bx.h / 2;
    for (const pos of [L, bx.cx, R]) t.xs.push({ pos, a: T, b: B, kind: "obj" });
    for (const pos of [T, bx.cy, B]) t.ys.push({ pos, a: L, b: R, kind: "obj" });
  }
  return t;
}

// Axis-aligned union bounds (+ center) of a set of objects, in world mm.
function groupBounds(objs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    const b = getObjBox(o);
    minX = Math.min(minX, b.cx - b.w / 2); maxX = Math.max(maxX, b.cx + b.w / 2);
    minY = Math.min(minY, b.cy - b.h / 2); maxY = Math.max(maxY, b.cy + b.h / 2);
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

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
  if (!cam._fitted) { cam.fit(getHoop(state.hoopId), r.width, r.height, RULER, view.showHoop ? 17 : 2); cam._fitted = true; }
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
  refreshQuality();
  refreshSewing();
  needsRender = true;
}
function ensureCompiled() { if (state.planDirty || !compiled) recompile(); }

// ----------------------------------------------------------- quality check
function refreshQuality() {
  const host = $("quality-list");
  if (!host || !compiled) return;
  const { warnings } = analyzeQuality(compiled, getHoop(state.hoopId));
  const list = warnings.slice();
  // Overlap detection over visible objects' boxes. Hidden fill is knocked out
  // automatically now, so this is informational, not a defect.
  const vis = state.objects.filter((o) => o.visible);
  let overlaps = 0;
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = getObjBox(vis[i]), b = getObjBox(vis[j]);
    const ox = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
    const oy = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
    if (ox > 1 && oy > 1) overlaps++;
  }
  if (overlaps > 0) list.push({ sev: "info", msg: `${overlaps} overlapping object pair${overlaps === 1 ? "" : "s"} — check the stitch preview; solid fill overlaps are reduced, outlines and lettering sew on top` });

  host.innerHTML = "";
  if (!list.length) { host.className = "quality-list ok"; host.textContent = "✓ Automated checks passed. Test on matching scrap before stitching your project."; return; }
  host.className = "quality-list";
  for (const w of list) {
    const d = document.createElement("div");
    d.className = "qa-item qa-" + w.sev;
    d.textContent = (w.sev === "error" ? "● " : w.sev === "warn" ? "▲ " : "• ") + w.msg;
    host.appendChild(d);
  }
}

// Reorder objects to group same colors (fewer thread changes) and nearest-
// neighbor within each color (less travel), reducing jumps/trims.
function optimizeOrder() {
  if (state.objects.length < 3) { toast("Nothing to optimize."); return; }
  state.objects = optimizeObjects(state.objects, (o) => {
    const pts = o.type === "text" ? (o._glyphs || []).flat(2).map(p => ({x:p.x + o.points[0].x,y:p.y + o.points[0].y})) : (o.contours || [o.points]).flat();
    const b = pts.length ? bbox(pts) : { minX:0,minY:0,maxX:0,maxY:0 };
    const pad = o.kind === "satin-rails" ? .2+(o.params.pull||0) : o.type === "satin" ? (o.params.width || 4)/2 + (o.params.pull || 0) : o.params.fillMode === "outline" ? (o.params.borderWidth || 2)/2 : 0.8;
    return { minX:b.minX-pad,minY:b.minY-pad,maxX:b.maxX+pad,maxY:b.maxY+pad };
  });
  markDirty(); recompile(); commit();
  refreshObjectList(); needsRender = true;
  toast("Order optimized; overlapping layers kept in sequence.");
}

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

// ----------------------------------------------------------- browser storage
// The current design autosaves to localStorage on every committed change
// (debounced), and is restored on the next visit — closing the tab can't lose
// work. Manual Save/Open .gsew files still work for real backups/sharing.
const AUTOSAVE_KEY = "goodsew.design.v1";
let autosaveTimer = null;
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 600);
}
function flushAutosave() {
  clearTimeout(autosaveTimer);
  try { localStorage.setItem(AUTOSAVE_KEY, serialize()); $("save-status").textContent = "Saved in this browser"; }
  catch { $("save-status").textContent = "Browser storage unavailable — download a project backup"; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAutosave(); });
window.addEventListener("pagehide", flushAutosave);

// Restore the autosaved design (boot). Returns true if something was restored.
function restoreAutosaved() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (!s) return false;
    const data = JSON.parse(s);
    if (!data || !Array.isArray(data.objects) ) return false;
    deserialize(s);
    state.objects.forEach((o) => { if (o.type === "text") bakeText(o); else rebuildShape(o); });
    return true;
  } catch { return false; }
}

// ----------------------------------------------------------- history (undo/redo)
let undoStack = [], redoStack = [], commitTimer = null;

function historySnapshot() {
  return JSON.stringify({
    name: state.name, fabric: state.fabric, fabricColor: state.fabricColor,
    objects: state.objects.map((o) => ({
      id: o.id, type: o.type, name: o.name, color: o.color, kind: o.kind,
      box: o.box, rotation: o.rotation || 0, points: o.points, contours: o.contours, base: o._base, groupId: o.groupId,
      params: { ...o.params }, visible: o.visible,
    })),
    guides: state.guides,
    selectedIds: state.selectedIds,
  });
}
// Record the current state as a new undo step (immediate).
function commit() {
  clearTimeout(commitTimer);
  const snap = historySnapshot();
  if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
  autosave();
}
// Debounced commit for rapid edits (typing, dragging a slider).
function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 350); }
function resetHistory() { clearTimeout(commitTimer); undoStack = []; redoStack = []; commit(); }

function restore(snap) {
  const data = JSON.parse(snap);
  state.name = data.name || "My design"; state.fabric = data.fabric || "woven"; state.fabricColor = data.fabricColor || null; syncProjectUI();
  state.objects = data.objects.map((o) => ({ ...o, _base: o.base, params: { ...o.params } }));
  state.guides = data.guides || [];
  setSel((data.selectedIds || (data.selectedId != null ? [data.selectedId] : [])).filter((id) => data.objects.some((o) => o.id === id)));
  state.objects.forEach((o) => { if (o.type === "text") bakeText(o); else rebuildShape(o); });
  markDirty();
  if (state.mode === "stitch") recompile();
  refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
  autosave(); // undo/redo should persist across reloads too
}
function undo() {
  if (historySnapshot() !== undoStack[undoStack.length - 1]) commit();
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

// ----------------------------------------------------------- selection
function setSel(ids) {
  state.selectedIds = ids.slice();
  state.selectedId = ids.length ? ids[ids.length - 1] : null;
}
function selectedObjects() {
  return (state.selectedIds || []).map((id) => state.objects.find((o) => o.id === id)).filter(Boolean);
}

// Move an object by (dx,dy) mm, keeping its baked geometry in sync.
function translateObject(obj, dx, dy) {
  obj.points = (obj.points || []).map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (obj.contours && !obj.box) obj.contours = obj.contours.map(c => c.map(p => ({x:p.x+dx,y:p.y+dy})));
  if (obj.box) { obj.box = { ...obj.box, x: obj.box.x + dx, y: obj.box.y + dy }; rebuildShape(obj); }
}

// Fine-tune the selected objects by (dx,dy) mm (arrow-key nudging). Commits are
// debounced so a burst of taps collapses into a single undo step.
function nudgeSelected(dx, dy) {
  const objs = selectedObjects();
  if (!objs.length) return;
  for (const o of objs) translateObject(o, dx, dy);
  markDirty();
  if (state.mode === "stitch") recompile();
  refreshProps(); needsRender = true;
  commitSoon();
}

// Center the selected objects (as a group) on the hoop. axis: "both" | "x" | "y".
function centerSelected(axis = "both") {
  const objs = selectedObjects();
  if (!objs.length) return;
  const hoop = getHoop(state.hoopId);
  const gb = groupBounds(objs);
  const dx = axis === "y" ? 0 : hoop.w / 2 - gb.cx;
  const dy = axis === "x" ? 0 : hoop.h / 2 - gb.cy;
  if (!dx && !dy) return;
  for (const o of objs) translateObject(o, dx, dy);
  markDirty();
  if (state.mode === "stitch") recompile();
  refreshProps(); needsRender = true;
  commit();
}

// ----------------------------------------------------------- clipboard / dup
let clipboard = [];
function cloneData(o) {
  return JSON.parse(JSON.stringify({
    type: o.type, name: o.name, color: o.color, kind: o.kind, box: o.box,
    rotation: o.rotation || 0, points: o.points, params: o.params,
    visible: o.visible, groupId: o.groupId, base: o._base, contours: o.contours,
  }));
}
// Instantiate cloned object data offset by `off` mm, select the new copies.
function pasteData(dataArr, off = 5) {
  if (!dataArr.length) return;
  const groupMap = {};
  const ids = [];
  for (const d of dataArr) {
    const o = JSON.parse(JSON.stringify(d));
    o.id = nextId();
    o._base = o.base; // SVG art base contours (cloneData stores them as `base`)
    if (o.box) { o.box.x += off; o.box.y += off; }
    o.points = (o.points || []).map((p) => ({ x: p.x + off, y: p.y + off }));
    if (o.groupId != null) { // keep a copied group together under a fresh id
      if (!(o.groupId in groupMap)) groupMap[o.groupId] = nextId();
      o.groupId = groupMap[o.groupId];
    }
    if (o.type === "text") bakeText(o); else rebuildShape(o);
    state.objects.push(o);
    ids.push(o.id);
  }
  setSel(ids);
  markDirty(); if (state.mode === "stitch") recompile();
  commit(); refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
}
// Instantiate parsed logo items ({items, box}) as one grouped set of editable
// fill/outline objects — shared by the SVG and raster (PNG/JPG) importers.
function addLogoItems(parsed, srcLabel) {
  const ids = [];
  const gid = nextId(); // group every piece so the logo selects/moves as one
  parsed.items.forEach((it, i) => {
    const obj = makeObject(it.running ? "running" : "fill", [], it.color);
    obj.kind = "svg"; obj._base = it.base; obj.box = { ...parsed.box };
    obj.params.fillMode = it.outline ? "outline" : "fill";
    obj.name = `Logo part ${i + 1}`;
    obj.groupId = gid;
    rebuildShape(obj);
    state.objects.push(obj); ids.push(obj.id);
  });
  setSel(ids);
  markDirty(); refreshObjectList(); refreshProps(); updateEmptyHint(); commit(); needsRender = true;
  toast(`Imported ${ids.length} part${ids.length === 1 ? "" : "s"} from ${srcLabel}`);
}

// Import an SVG's geometry as editable fill/outline objects.
function importSVG(text) {
  let parsed;
  try { parsed = parseSVG(text, getHoop(state.hoopId), {removeBackground:$("import-background").checked}); }
  catch (e) { toast("SVG import failed: " + e.message, true); return; }
  addLogoItems(parsed, "SVG");
}

// Import a raster logo (PNG/JPG/WebP): auto-vectorize into per-color regions.
function importRasterImage(imgEl) {
  // Downscale in HALVING steps with high-quality resampling. A single big
  // drawImage jump (e.g. 3000px → 512px) uses a small filter kernel and
  // produces aliased, chewed-up edges — which then trace into low-quality
  // contours. Repeated 2× reductions keep edges clean.
  let src = imgEl;
  let sw = imgEl.naturalWidth || imgEl.width;
  let sh = imgEl.naturalHeight || imgEl.height;
  while (Math.max(sw, sh) > RASTER_MAX_DIM * 2) {
    const half = document.createElement("canvas");
    half.width = Math.max(2, Math.round(sw / 2));
    half.height = Math.max(2, Math.round(sh / 2));
    const g = half.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, half.width, half.height);
    src = half; sw = half.width; sh = half.height;
  }
  const scale = Math.min(1, RASTER_MAX_DIM / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c2 = cv.getContext("2d", { willReadFrequently: true });
  c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = "high";
  c2.drawImage(src, 0, 0, w, h);
  const imgData = c2.getImageData(0, 0, w, h);
  importRasterData(imgData);
}
function importRasterData(imgData) {
  let parsed;
  try { parsed = traceRaster(imgData, getHoop(state.hoopId), {maxColors:Number($("import-colors").value),removeBackground:$("import-background").checked}); }
  catch (e) { toast("Logo trace failed: " + e.message, true); return; }
  addLogoItems(parsed, "your logo");
}

// Route an uploaded logo file to the right importer by type.
function importLogoFile(f) {
  if (f.size > 20 * 1024 * 1024) {toast("Choose an image smaller than 20 MB.",true);return;}
  const isSvg = /\.svg$/i.test(f.name) || f.type === "image/svg+xml";
  if (isSvg) {
    const reader = new FileReader();
    reader.onload = () => importSVG(reader.result);
    reader.readAsText(f);
    return;
  }
  toast("Tracing logo…");
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => { try { importRasterImage(img); } finally { URL.revokeObjectURL(url); } };
  img.onerror = () => { URL.revokeObjectURL(url); toast("Could not read that image file.", true); };
  img.src = url;
}

function copySelection() { const o = selectedObjects(); if (o.length) clipboard = o.map(cloneData); }
function pasteClipboard() { pasteData(clipboard); }
function duplicateSelection() { pasteData(selectedObjects().map(cloneData)); }

// ----------------------------------------------------------- group / align
function groupSelection() {
  const objs = selectedObjects(); if (objs.length < 2) return;
  const gid = nextId(); objs.forEach((o) => (o.groupId = gid));
  commit(); refreshObjectList(); refreshProps();
}
function ungroupSelection() {
  selectedObjects().forEach((o) => (o.groupId = null));
  commit(); refreshObjectList(); refreshProps();
}
function afterLayout() {
  markDirty(); if (state.mode === "stitch") recompile();
  commit(); refreshObjectList(); refreshProps(); needsRender = true;
}
function alignSelected(mode) {
  const arr = selectedObjects().map((o) => ({ o, b: getObjBox(o) }));
  if (arr.length < 2) return;
  const L = (x) => x.b.cx - x.b.w / 2, R = (x) => x.b.cx + x.b.w / 2;
  const T = (x) => x.b.cy - x.b.h / 2, B = (x) => x.b.cy + x.b.h / 2;
  let target;
  if (mode === "left")   { target = Math.min(...arr.map(L)); arr.forEach((x) => translateObject(x.o, target - L(x), 0)); }
  if (mode === "right")  { target = Math.max(...arr.map(R)); arr.forEach((x) => translateObject(x.o, target - R(x), 0)); }
  if (mode === "centerH"){ target = arr.reduce((s, x) => s + x.b.cx, 0) / arr.length; arr.forEach((x) => translateObject(x.o, target - x.b.cx, 0)); }
  if (mode === "top")    { target = Math.min(...arr.map(T)); arr.forEach((x) => translateObject(x.o, 0, target - T(x))); }
  if (mode === "bottom") { target = Math.max(...arr.map(B)); arr.forEach((x) => translateObject(x.o, 0, target - B(x))); }
  if (mode === "middleV"){ target = arr.reduce((s, x) => s + x.b.cy, 0) / arr.length; arr.forEach((x) => translateObject(x.o, 0, target - x.b.cy)); }
  afterLayout();
}
function distributeSelected(axis) {
  const arr = selectedObjects().map((o) => ({ o, b: getObjBox(o) }));
  if (arr.length < 3) return;
  const key = axis === "h" ? "cx" : "cy";
  arr.sort((a, b) => a.b[key] - b.b[key]);
  const lo = arr[0].b[key], hi = arr[arr.length - 1].b[key];
  const step = (hi - lo) / (arr.length - 1);
  arr.forEach((x, i) => {
    const d = (lo + step * i) - x.b[key];
    translateObject(x.o, axis === "h" ? d : 0, axis === "h" ? 0 : d);
  });
  afterLayout();
}

// ------------------------------------------------------------ object baking
function rebuildShape(obj) {
  if(obj.kind === "satin-rails") { bakeRails(obj); return; }
  if (!obj.box) return;
  // Imported SVG art: map its normalized base contours into the box (+rotation).
  if (obj.kind === "svg" && obj._base) {
    const b = obj.box, a = rad(obj.rotation || 0), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const map = (p) => { const q = { x: b.x + p.x * b.w, y: b.y + p.y * b.h }; return a ? rotatePoint(q, c, a) : q; };
    obj.contours = obj._base.map((ct) => ct.map(map));
    obj.points = obj.contours[0] || [];
    return;
  }
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
  // The simulator footer shows/hides with the mode, which changes the canvas
  // area's height — re-fit the canvas so it doesn't overflow onto (and block)
  // the transport controls.
  resize();
  if (mode === "stitch") { ensureCompiled(); sim.toStart(); sim.engaged = false; sim.seek(0); sim.engaged = false; needsRender = true; }
  setTool("select");
  refreshProps();
  updateEmptyHint();
  needsRender = true;
}

async function renderStitches() {
  if (drawing) finishDrawing();
  if (editing) closeTextEditor(true);
  if (!state.objects.some(o => o.visible)) { toast("Add visible text or shapes first.", true); return; }
  const button = $("btn-render"); button.disabled = true; button.textContent = "Generating…";
  try {
    const texts = state.objects.filter(o => o.visible && o.type === "text");
    await Promise.all(texts.map(async o => { await loadFont(o.params.font); bakeText(o); }));
    markDirty(); setMode("stitch");
    if (!computeStats(compiled).stitches) toast("Nothing rendered — check your objects.", true);
  } catch (err) { toast("Could not generate stitches: " + err.message, true); }
  finally { button.disabled = false; button.textContent = "Generate stitches →"; }
}

// ----------------------------------------------------------------- tools
function setTool(t) {
  if (t !== "shape") $("shape-popover").classList.add("hidden");
  if (t === "svglogo") { $("file-svg").click(); return; }
  tool = t;
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  const hints = {
    select: "Click to select. Drag to move. Drag handles to resize, top knob to rotate. Double-click text to edit.",
    text: "Click on the canvas to drop your text, then type.",
    shape: "Pick a shape, then drag on the canvas. Hold Shift for an even shape.",
    satin: "Click points along the column's center line, then hit ✓ Finish (or double-click / Enter / right-click).",
    run: "Click points along the stitch path, then hit ✓ Finish (or double-click / Enter / right-click).",
    poly: "Click the corners of your shape, then hit ✓ Finish (or click the first point / double-click / Enter).",
  };
  $("hud-hint").textContent = hints[t] || "";
  canvas.style.cursor = t === "select" ? "default" : "crosshair";
  if (t !== "satin" && t !== "run" && t !== "poly") {
    // Leaving a draw tool commits the in-progress drawing instead of silently
    // throwing away the user's clicks (cancel is Esc / the ✕ button).
    if (drawing) finishDrawing({ switchTool: false, quiet: true });
  }
  updateDrawBar();
  updateEmptyHint();
  if (t === "shape") openShapePopover();
}

// The floating "N points — ✓ Finish / ✕ Cancel" bar shown while drawing.
function updateDrawBar() {
  const active = state.mode === "design" && (tool === "satin" || tool === "run" || tool === "poly");
  $("draw-bar").classList.toggle("hidden", !active);
  if (!active) return;
  const n = drawing ? drawing.points.length : 0;
  const need = tool === "poly" ? 3 : 2;
  $("draw-bar-msg").textContent = n === 0
    ? (tool === "poly" ? "Click the corners of your shape" : "Click points on the canvas")
    : n < need
      ? `${n} point${n === 1 ? "" : "s"} — place at least ${need}`
      : `${n} points`;
  $("draw-finish").disabled = n < need;
}


function cancelDrawing() {
  drawing = null;
  updateDrawBar();
  needsRender = true;
}

// ----------------------------------------------------------------- creators
function addText(anchor) {
  const obj = makeObject("text", [anchor], state.activeColor);
  obj.name = "Text";
  obj.params.text = "Text";
  state.objects.push(obj);
  setSel([obj.id]);
  bakeText(obj, () => { markDirty(); refreshObjectList(); refreshProps(); needsRender = true; });
  setTool("select");
  refreshObjectList(); refreshProps(); updateEmptyHint();
  commit();
  return obj;
}

function addShape(kind, box) {
  const obj = makeObject("fill", [], state.activeColor);
  obj.kind = kind;
  obj.box = { ...box };
  obj.name = SHAPES.find((s) => s.kind === kind)?.label || "Shape";
  rebuildShape(obj);
  state.objects.push(obj);
  setSel([obj.id]);
  markDirty(); refreshObjectList(); refreshProps(); updateEmptyHint();
  return obj;
}

// Turn the in-progress manual drawing into a real object. Satin lines become
// proper satin columns (spine + width), Run lines become running stitch, and
// Regions become ordinary fill shapes with the full stitch settings.
function finishDrawing({ switchTool = true, quiet = false } = {}) {
  if (!drawing) return;
  // drop double-click / accidental duplicate points
  const pts = [];
  for (const p of drawing.points) {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 0.4) pts.push(p);
  }
  const type = drawing.type;
  drawing = null;
  const need = type === "poly" ? 3 : 2;
  if (pts.length < need) {
    if (!quiet) toast(type === "poly" ? "Click at least 3 corners." : "Click at least 2 points.", true);
    updateDrawBar(); needsRender = true; return;
  }

  let obj;
  if (type === "satin") {
    obj = makeObject("satin", pts, state.activeColor);
    obj.name = "Satin line";
  } else if (type === "run") {
    obj = makeObject("running", pts, state.activeColor);
    obj.name = "Run stitch";
  } else {
    obj = makeObject("fill", pts, state.activeColor);
    obj.name = "Drawn shape";
  }
  state.objects.push(obj);
  setSel([obj.id]);
  if (switchTool) setTool("select");
  else updateDrawBar();
  toast(`${obj.name} added — ${pts.length} points.`);
  markDirty(); refreshObjectList(); refreshProps(); updateEmptyHint(); commit(); needsRender = true;
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
  if (e.button === 2) { if (drawing) finishDrawing(); return; }
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
    // stitch view: click a layer to fine-tune it (shift adds); drag empty to pan.
    const hit = hitTestObject(world);
    if (hit) {
      if (e.shiftKey) {
        const ids = state.selectedIds.slice();
        const i = ids.indexOf(hit.id);
        if (i >= 0) ids.splice(i, 1); else ids.push(hit.id);
        setSel(ids);
      } else setSel([hit.id]);
    } else { setSel([]); drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY }; }
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

  // Manual digitizing: click to place points. Finishing works several ways so
  // it can't be missed: the ✓ Finish button, double-click (detected here via
  // e.detail — more reliable than the dblclick event), Enter, right-click, or
  // clicking back on the first/last placed point.
  if (tool === "satin" || tool === "run" || tool === "poly") {
    if (drawing && e.detail >= 2) { finishDrawing(); return; }
    if (drawing && drawing.points.length >= (tool === "poly" ? 3 : 2)) {
      const first = cam.toScreen(drawing.points[0]);
      const last = cam.toScreen(drawing.points[drawing.points.length - 1]);
      const m = { x: mx, y: my };
      if (dist(first, m) <= HANDLE_HIT || dist(last, m) <= HANDLE_HIT) { finishDrawing(); return; }
    }
    if (!drawing) drawing = { type: tool, points: [] };
    drawing.points.push({ x: world.x, y: world.y });
    updateDrawBar();
    needsRender = true;
    return;
  }

  // select tool — resize/rotate handles (single selection only), then objects
  const sel = selectedObject();
  if (sel && sel.visible && state.selectedIds.length === 1 && (sel.box || sel.type === "text")) {
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
    // Click selects the INDIVIDUAL layer under the cursor (even within a logo
    // group), so you can recolor / re-pattern one piece. Shift-click adds/
    // removes. Clicking an already-selected item keeps the multi-selection so
    // the whole set can be dragged together.
    if (e.shiftKey) {
      const ids = state.selectedIds.slice();
      const i = ids.indexOf(hit.id);
      if (i >= 0) ids.splice(i, 1); else ids.push(hit.id);
      setSel(ids);
    } else if (state.selectedIds.includes(hit.id)) {
      setSel([...state.selectedIds.filter((id) => id !== hit.id), hit.id]);
    } else {
      setSel([hit.id]);
    }
    drag = { mode: "move", start: world, c0: groupBounds(selectedObjects()),
             alignTargets: collectAlignTargets(new Set(state.selectedIds)),
             items: selectedObjects().map((o) => ({ obj: o, orig: snapshot(o) })) };
    refreshProps(); refreshObjectList(); needsRender = true;
  } else {
    // empty space: deselect (unless extending) and pan the view
    if (!e.shiftKey) setSel([]);
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

  if (drawing) { drawing.cursor = world; needsRender = true; }
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
    let dx = world.x - drag.start.x, dy = world.y - drag.start.y;
    // Smart alignment: snap the moving selection's edges/center to other
    // objects' edges/centers and the hoop centerlines, drawing a guide line
    // through both (Illustrator-style). Hold Alt to move freely.
    snapGuides = [];
    if (!e.altKey && drag.c0 && drag.alignTargets) {
      const tol = SNAP_PX / cam.pxPerMm; // px → mm at the current zoom
      const b = drag.c0;
      const pick = (targets, mine) => {
        let best = null;
        for (const t of targets) {
          for (const m of mine) {
            const d = t.pos - m;
            if (Math.abs(d) < (best ? Math.abs(best.d) : tol)) best = { d, t };
          }
        }
        return best;
      };
      const myXs = [b.minX + dx, (b.minX + b.maxX) / 2 + dx, b.maxX + dx];
      const myYs = [b.minY + dy, (b.minY + b.maxY) / 2 + dy, b.maxY + dy];
      const bx = pick(drag.alignTargets.xs, myXs);
      const by = pick(drag.alignTargets.ys, myYs);
      if (bx) dx += bx.d;
      if (by) dy += by.d;
      if (bx) snapGuides.push({ axis: "v", pos: bx.t.pos, kind: bx.t.kind,
        a: Math.min(bx.t.a, b.minY + dy), b: Math.max(bx.t.b, b.maxY + dy) });
      if (by) snapGuides.push({ axis: "h", pos: by.t.pos, kind: by.t.kind,
        a: Math.min(by.t.a, b.minX + dx), b: Math.max(by.t.b, b.maxX + dx) });
    }
    for (const it of drag.items) {
      it.obj.points = it.orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (it.orig.box) {
        it.obj.box = { ...it.orig.box, x: it.orig.box.x + dx, y: it.orig.box.y + dy };
        if (["svg","satin-rails"].includes(it.obj.kind)) rebuildShape(it.obj); // remap contours to the moved box
      }
    }
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
        setSel([]);
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
  snapGuides = [];
  needsRender = true;
});

// remember size at drag start for text resize
canvas.addEventListener("mousedown", () => { const s = selectedObject(); if (s && s.type === "text") s._sizeAtDragStart = s.params.size; });

canvas.addEventListener("dblclick", (e) => {
  if (drawing) { finishDrawing(); return; }
  const gh = guideAt(e.offsetX, e.offsetY);
  if (gh) { state.guides = state.guides.filter((g) => g.id !== gh.id); hoverGuide = null; needsRender = true; return; }
  if (state.mode !== "design") return;
  const world = mouseWorld(e);
  const hit = hitTestObject(world);
  if (hit && hit.type === "text") { setSel([hit.id]); openTextEditor(hit); refreshProps(); refreshObjectList(); }
});

canvas.addEventListener("mouseleave", () => { cursor = null; needsRender = true; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  // Normalize the wheel delta across mice / trackpads and delta modes so the
  // feel is consistent everywhere.
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;                       // lines → px
  else if (e.deltaMode === 2) dy *= canvas.clientHeight; // pages → px

  // Two-finger scroll (or shift+wheel for horizontal) pans instead of zooming,
  // which keeps zoom from feeling twitchy on trackpads.
  if (!e.ctrlKey && !e.metaKey && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
    let dx = e.shiftKey && !e.deltaX ? dy : e.deltaX;
    if (e.deltaMode === 1) dx *= 16; else if (e.deltaMode === 2) dx *= canvas.clientWidth;
    cam.panX -= dx; cam.panY -= (e.shiftKey ? 0 : e.deltaY);
    needsRender = true;
    return;
  }

  // Gentle, proportional zoom. Clamp the per-event delta so a hard flick (or a
  // big trackpad gesture) can't jump several steps at once.
  dy = Math.max(-50, Math.min(50, dy));
  const factor = Math.exp(-dy * 0.0016);
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

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hitTestObject(world) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    if (!obj.visible) continue;
    // line objects (satin column / running stitch): hit along the spine
    if ((obj.type === "satin" || obj.type === "running") && obj.points.length >= 2) {
      const tol = obj.type === "satin" ? Math.max(1.5, (obj.params.width || 4) / 2 + 0.5) : 1.6;
      for (let k = 1; k < obj.points.length; k++) {
        if (distToSeg(world, obj.points[k - 1], obj.points[k]) <= tol) return obj;
      }
      continue;
    }
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
    if (state.mode === "design") {
      if (k === "c") { copySelection(); e.preventDefault(); return; }
      if (k === "x") { copySelection(); deleteSelected(); e.preventDefault(); return; }
      if (k === "v") { pasteClipboard(); e.preventDefault(); return; }
      if (k === "d") { duplicateSelection(); e.preventDefault(); return; }
      if (k === "a") { setSel(state.objects.filter((o) => o.visible).map((o) => o.id)); refreshProps(); refreshObjectList(); needsRender = true; e.preventDefault(); return; }
    }
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === " ") spaceDown = true;
  if (drawing) {
    if (e.key === "Enter") { finishDrawing(); e.preventDefault(); return; }
    if (e.key === "Escape") { cancelDrawing(); e.preventDefault(); return; }
  }

  // Arrow keys fine-tune the selected object(s). Default 0.5 mm steps; hold
  // Shift for a coarse 5 mm jump, Alt for a precise 0.1 mm tweak.
  if (state.mode === "design" && state.selectedIds.length && e.key.startsWith("Arrow")) {
    const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    nudgeSelected(dx, dy);
    e.preventDefault();
    return;
  }
  // "C" centers the current selection on the hoop.
  if (state.mode === "design" && state.selectedIds.length && e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey) {
    centerSelected("both"); e.preventDefault(); return;
  }

  if (state.mode === "design") {
    switch (e.key.toLowerCase()) {
      case "v": setTool("select"); break;
      case "t": setTool("text"); break;
      case "s": setTool("shape"); break;
    }
  }
  if ((e.key === "Delete" || e.key === "Backspace") && state.selectedIds.length && state.mode === "design") { deleteSelected(); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; if (e.key === "Shift") shiftDown = false; });

function deleteSelected() {
  const ids = new Set(state.selectedIds);
  if (state.selectedId != null) ids.add(state.selectedId);
  state.objects = state.objects.filter((o) => !ids.has(o.id));
  setSel([]);
  markDirty(); if (state.mode === "stitch") recompile();
  refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
  commit();
}

// ----------------------------------------------------------- thread colors
// A short, human label for a hex color: its New brothread code + name (using
// the nearest catalog color for arbitrary/legacy hex values).
function threadLabel(hex) {
  const e = nearestNewBrothread(hexToRgb(hex));
  return `${e.code} · ${e.name}`;
}

function buildThreadPicker() {
  const btn = $("thread-button");
  if (btn) btn.onclick = () => openColorPicker(btn, state.activeColor, (hex) => {
    state.activeColor = hex;
    updateActiveSwatch();
    const s = selectedObject();
    if (s) { s.color = hex; markDirty(); refreshObjectList(); refreshProps(); needsRender = true; commit(); }
  });
  updateActiveSwatch();
}
function updateActiveSwatch() {
  $("active-thread-swatch").style.background = state.activeColor;
  const lbl = $("active-thread-label");
  if (lbl) lbl.textContent = threadLabel(state.activeColor);
}

// ---- reusable New brothread swatch picker popover ----
let colorPickState = { onPick: null, current: null };

// Open the picker anchored near `anchorEl`. `onPick(hex)` fires on selection.
function openColorPicker(anchorEl, currentHex, onPick) {
  colorPickState = { onPick, current: (currentHex || "").toLowerCase() };
  const pop = $("color-popover");
  $("color-search").value = "";
  $("color-own-only").checked = false;
  buildColorGroups();
  pop.classList.remove("hidden");
  // position under the anchor, clamped to the viewport
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 12) + "px";
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 12) + "px";
  setTimeout(() => $("color-search").focus(), 0);
}
function closeColorPicker() { $("color-popover").classList.add("hidden"); colorPickState.onPick = null; }

function buildColorGroups() {
  const host = $("color-groups");
  host.innerHTML = "";
  const q = ($("color-search").value || "").trim().toLowerCase();
  const ownOnly = $("color-own-only").checked;
  const match = (c) => (!ownOnly || c.set40) &&
    (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));

  let shown = 0;
  for (const g of NB_GROUPS) {
    const items = NEWBROTHREAD.filter((c) => c.grp === g.id && match(c));
    if (!items.length) continue;
    const lbl = document.createElement("div");
    lbl.className = "color-group-label";
    lbl.textContent = `${g.label} · ${items.length}`;
    host.appendChild(lbl);
    const grid = document.createElement("div"); grid.className = "swatch-grid";
    for (const c of items) {
      const hex = nbHex(c);
      const cell = document.createElement("button");
      cell.className = "swatch-cell" + (c.vari ? " vari" : "") +
        (hex.toLowerCase() === colorPickState.current ? " active" : "");
      cell.title = `${c.code} · ${c.name}${c.set40 ? " (in 40-kit)" : ""}`;
      if (c.vari) cell.style.background = `linear-gradient(135deg, ${hex}, #ffffff 45%, ${hex} 90%)`;
      else cell.style.background = hex;
      cell.onclick = () => { const cb = colorPickState.onPick; closeColorPicker(); if (cb) cb(hex); };
      grid.appendChild(cell);
      shown++;
    }
    host.appendChild(grid);
  }
  if (!shown) host.innerHTML = `<div class="color-empty">No thread matches “${q}”.</div>`;
}
$("color-search").addEventListener("input", buildColorGroups);
$("color-own-only").addEventListener("change", buildColorGroups);
// dismiss on outside click / Escape
document.addEventListener("mousedown", (e) => {
  const pop = $("color-popover");
  if (pop.classList.contains("hidden")) return;
  if (!pop.contains(e.target) && !e.target.closest(".thread-button, .color-swatch-btn")) closeColorPicker();
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeColorPicker(); });

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
  const cats = [...new Set(SHAPES.filter((s) => s.kind !== "line").map((s) => s.cat || "Shapes"))];
  for (const cat of cats) {
    const head = document.createElement("div");
    head.className = "shape-cat";
    head.textContent = cat;
    grid.appendChild(head);
    const row = document.createElement("div");
    row.className = "shape-grid-row";
    for (const s of SHAPES) {
      if (s.kind === "line" || (s.cat || "Shapes") !== cat) continue;
      const cell = document.createElement("button");
      cell.className = "shape-cell" + (s.kind === shapeKind ? " active" : "");
      cell.title = s.label;
      cell.innerHTML = shapeSVG(s.kind) + `<span class="shape-name">${s.label}</span>`;
      cell.onclick = () => {
        shapeKind = s.kind;
        tool = "shape";
        document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === "shape"));
        $("hud-hint").textContent = `Drag on the canvas to place your ${s.label.toLowerCase()}. Hold Shift for an even shape.`;
        $("shape-popover").classList.add("hidden"); // free the whole canvas to draw on
      };
      row.appendChild(cell);
    }
    grid.appendChild(row);
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
  refreshSewing();
  const ul = $("object-list");
  ul.innerHTML = "";
  $("object-count").textContent = `(${state.objects.length})`;
  if (!state.objects.length) { ul.innerHTML = `<li class="empty-objects">No objects yet.</li>`; return; }
  // top of list = drawn last; show in reverse so newest is on top
  state.objects.slice().reverse().forEach((obj) => {
    const li = document.createElement("li");
    li.className = "object-item" + (state.selectedIds.includes(obj.id) ? " selected" : "");
    const icon = document.createElement("span");
    icon.className = "obj-icon"; icon.style.background = obj.color;
    icon.textContent = ({text:'T',running:'┄',satin:'〰'})[obj.type] || '◆';
    const main = document.createElement("div"); main.className = "obj-main";
    const label = document.createElement("span"); label.className = "obj-label";
    label.textContent = obj.type === "text" ? (obj.params.text || "Text") : obj.name;
    const sub = document.createElement("span"); sub.className = "obj-sub";
    sub.textContent = obj.type === 'text' ? `Text · ${obj.params.font}` : obj.type === 'running' ? (obj.params.returnPass ? 'Double run' : obj.params.repeats >= 3 ? 'Bean stitch' : 'Running stitch') : obj.type === 'satin' ? (obj.kind === 'satin-rails' ? 'Paired-rail satin' : 'Satin line') : 'Filled shape';
    main.append(label, sub);
    const handle = document.createElement("span");
    handle.className = "obj-handle"; handle.textContent = "⠿"; handle.title = "Drag to reorder layer";
    const vis = document.createElement("button");
    vis.className = "obj-btn"; vis.textContent = obj.visible ? "👁" : "🚫"; vis.title = "Show / hide";
    vis.onclick = (e) => { e.stopPropagation(); obj.visible = !obj.visible; markDirty(); if (state.mode === "stitch") recompile(); refreshObjectList(); needsRender = true; commit(); };
    const del = document.createElement("button");
    del.className = "obj-btn danger"; del.textContent = "🗑"; del.title = "Delete";
    del.onclick = (e) => { e.stopPropagation(); setSel([obj.id]); deleteSelected(); };
    li.append(handle, icon, main, vis, del);
    li.onclick = (e) => {
      const order = state.objects.map((o) => o.id);
      if (e.shiftKey && selAnchorId != null && order.includes(selAnchorId)) {
        // range select: every layer between the anchor and this one
        const a = order.indexOf(selAnchorId), b = order.indexOf(obj.id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSel(order.slice(lo, hi + 1));
      } else if (e.ctrlKey || e.metaKey) {
        const ids = state.selectedIds.slice();
        const i = ids.indexOf(obj.id);
        if (i >= 0) ids.splice(i, 1); else ids.push(obj.id);
        setSel(ids); selAnchorId = obj.id;
      } else { setSel([obj.id]); selAnchorId = obj.id; }
      refreshProps(); refreshObjectList(); needsRender = true;
    };
    // drag-and-drop layer reordering
    li.draggable = true;
    li.dataset.id = obj.id;
    li.ondragstart = (e) => { dragLayerId = obj.id; e.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); };
    li.ondragend = () => { dragLayerId = null; ul.querySelectorAll(".object-item").forEach((x) => x.classList.remove("drop-above", "drop-below", "dragging")); };
    li.ondragover = (e) => {
      if (dragLayerId == null || dragLayerId === obj.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      li.classList.toggle("drop-below", after);
      li.classList.toggle("drop-above", !after);
    };
    li.ondragleave = () => li.classList.remove("drop-above", "drop-below");
    li.ondrop = (e) => {
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      if (dragLayerId != null && dragLayerId !== obj.id) moveLayer(dragLayerId, obj.id, after);
    };
    ul.appendChild(li);
  });
}

let dragLayerId = null;
let selAnchorId = null; // anchor for shift-range selection in the Objects list
function selectAllObjects() {
  setSel(state.objects.filter((o) => o.visible).map((o) => o.id));
  refreshProps(); refreshObjectList(); needsRender = true;
}
// Move a layer (by id) to just above/below the target id, in the displayed
// (reversed) order, then sync the draw-order array.
function moveLayer(draggedId, targetId, after) {
  const disp = state.objects.slice().reverse(); // display order: top = drawn last
  const from = disp.findIndex((o) => o.id === draggedId);
  if (from < 0) return;
  const [m] = disp.splice(from, 1);
  let to = disp.findIndex((o) => o.id === targetId);
  if (to < 0) disp.push(m);
  else disp.splice(after ? to + 1 : to, 0, m);
  state.objects = disp.reverse();
  markDirty(); if (state.mode === "stitch") recompile();
  commit(); refreshObjectList(); needsRender = true;
}

// ----------------------------------------------------------- properties
function refreshProps() {
  if (state.mode === "stitch") { refreshStitchSettings(); return; }
  const host = $("object-props");
  $("props-title").textContent = "Properties";
  const obj = selectedObject();
  if (!obj) { host.className = "props-empty"; host.textContent = "Select or add an object to edit it."; return; }
  host.className = ""; host.innerHTML = "";

  if (state.selectedIds.length > 1) { buildMultiProps(host); return; }

  if (obj.type === "text") buildTextProps(host, obj);
  else if (obj.type === "satin") buildSatinProps(host, obj);
  else if (obj.type === "running") buildRunningProps(host, obj);
  else buildShapeProps(host, obj);

  // Position helpers: one-click centering + a discoverability hint for the
  // drag-snap and arrow-key nudging.
  const posLbl = document.createElement("div");
  posLbl.className = "prop-sublabel"; posLbl.textContent = "Position";
  host.appendChild(posLbl);
  const posRow = document.createElement("div"); posRow.className = "layout-grid";
  for (const [txt, axis, title] of [
    ["Center", "both", "Center on the hoop (C)"],
    ["Center H", "x", "Center horizontally"],
    ["Center V", "y", "Center vertically"],
  ]) {
    const b = document.createElement("button");
    b.className = "layout-btn"; b.textContent = txt; b.title = title;
    b.onclick = () => centerSelected(axis);
    posRow.appendChild(b);
  }
  host.appendChild(posRow);
  const nudgeHint = document.createElement("div");
  nudgeHint.className = "prop-hint";
  nudgeHint.textContent = "Drag snaps to center · arrow keys nudge (Shift = 5 mm, Alt = 0.1 mm)";
  host.appendChild(nudgeHint);

  const del = document.createElement("button");
  del.className = "btn btn-danger"; del.textContent = "Delete object";
  del.style.width = "100%"; del.style.marginTop = "6px";
  del.onclick = deleteSelected;
  host.appendChild(del);
}

// Panel shown when 2+ objects are selected: align / distribute / group.
function buildMultiProps(host) {
  const objs = selectedObjects();
  const grid = (labels) => {
    const g = document.createElement("div"); g.className = "layout-grid";
    for (const [txt, fn, title] of labels) {
      const b = document.createElement("button"); b.className = "layout-btn"; b.textContent = txt; b.title = title;
      b.onclick = fn; g.appendChild(b);
    }
    return g;
  };
  const lbl = (t) => { const d = document.createElement("div"); d.className = "prop-sublabel"; d.textContent = t; host.appendChild(d); };

  // Logo (grouped) selection: offer a per-color recolor submenu for its parts.
  const grouped = objs.length > 1 && objs.every((o) => o.groupId != null && o.groupId === objs[0].groupId);
  $("props-title").textContent = grouped ? `Logo · ${objs.length} parts` : `${state.selectedIds.length} objects`;
  if (grouped) {
    lbl("Logo colors — change a thread used by the logo");
    const colors = [...new Set(objs.map((o) => o.color))];
    for (const col of colors) {
      const wrap = document.createElement("div"); wrap.className = "color-row";
      const btn = document.createElement("button"); btn.className = "thread-button color-swatch-btn";
      const dot = document.createElement("span"); dot.className = "active-swatch"; dot.style.background = col;
      const lab = document.createElement("span"); lab.className = "thread-label"; lab.textContent = threadLabel(col);
      const chev = document.createElement("span"); chev.className = "chev"; chev.textContent = "▾";
      btn.append(dot, lab, chev);
      btn.onclick = () => openColorPicker(btn, col, (nc) => {
        objs.filter((o) => o.color === col).forEach((o) => (o.color = nc));
        markDirty(); if (state.mode === "stitch") recompile();
        commit(); refreshObjectList(); refreshProps(); needsRender = true;
      });
      const cnt = document.createElement("span"); cnt.className = "muted"; cnt.style.fontSize = "10.5px";
      cnt.textContent = `${objs.filter((o) => o.color === col).length}×`;
      wrap.append(btn, cnt); host.appendChild(wrap);
    }
  }

  lbl("Align");
  host.appendChild(grid([
    ["⊏ Left", () => alignSelected("left"), "Align left edges"],
    ["↔ Center", () => alignSelected("centerH"), "Center horizontally"],
    ["Right ⊐", () => alignSelected("right"), "Align right edges"],
    ["⊓ Top", () => alignSelected("top"), "Align top edges"],
    ["↕ Middle", () => alignSelected("middleV"), "Center vertically"],
    ["Bottom ⊔", () => alignSelected("bottom"), "Align bottom edges"],
  ]));

  lbl("Distribute (needs 3+)");
  host.appendChild(grid([
    ["↔ Across", () => distributeSelected("h"), "Distribute horizontally"],
    ["↕ Down", () => distributeSelected("v"), "Distribute vertically"],
  ]));

  lbl("Arrange");
  host.appendChild(grid([
    ["Group", groupSelection, "Group"],
    ["Ungroup", ungroupSelection, "Ungroup"],
    ["Duplicate", duplicateSelection, "Duplicate (Ctrl+D)"],
  ]));

  const del = document.createElement("button");
  del.className = "btn btn-danger"; del.textContent = `Delete ${state.selectedIds.length} objects`;
  del.style.width = "100%"; del.style.marginTop = "8px";
  del.onclick = deleteSelected;
  host.appendChild(del);
}

function rowFull(host, labelText, el) {
  const d = document.createElement("div"); d.className = "prop-full";
  const l = document.createElement("label"); l.textContent = labelText;
  if (!el.id) el.id = `control-${nextId()}`; l.htmlFor = el.id;
  d.append(l, el); host.appendChild(d);
}
function row(host, labelText, el) {
  const d = document.createElement("div"); d.className = "prop-row";
  const l = document.createElement("label"); l.textContent = labelText;
  if (!el.id) el.id = `control-${nextId()}`; l.htmlFor = el.id;
  d.append(l, el); host.appendChild(d);
}
function numInput(val, step, min, onChange) {
  const i = document.createElement("input");
  i.type = "number"; i.value = round(val); i.step = step; if (min != null) i.min = min;
  i.oninput = () => { const v = Number(i.value); if (i.value !== "" && Number.isFinite(v) && (min == null || v >= min) && Math.abs(v) <= 10000) { onChange(v); commitSoon(); } };
  return i;
}
const round = (v) => Math.round(v * 1000) / 1000;

function buildTextProps(host, obj) {
  const round=document.createElement('button');round.className='btn';round.textContent='Use Satin Round lettering';
  round.onclick=()=>replaceWithSatinRound(obj);host.append(round);
  const info=document.createElement('p');info.className='prop-hint';info.textContent='Satin Round uses authored curved columns. Converts this text to editable satin objects; Undo restores the outline font.';host.append(info);
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

// Satin column: simple by default (just a width), detail if you want it.
function buildSatinProps(host, obj) {
  $("props-title").textContent = "Satin line";
  if(obj.kind!=="satin-rails") row(host, "Width (mm)", numInput(obj.params.width ?? 4, 0.5, 0.5, (v) => { obj.params.width = Math.max(0.5, Math.min(10, v)); markDirty(); needsRender = true; commitSoon(); }));
  row(host, "Row spacing (mm)", numInput(obj.params.density ?? 0.4, 0.05, 0.2, (v) => { obj.params.density = Math.max(0.2, Math.min(1.2, v)); markDirty(); if(state.mode==='stitch')recompile(); commitSoon(); }));
  row(host, "Pull comp (mm)", numInput(obj.params.pull ?? 0.2, 0.1, 0, (v) => { obj.params.pull = Math.max(0, Math.min(1, v)); markDirty(); if(state.mode==='stitch')recompile(); commitSoon(); }));
  if (obj.kind === "satin-rails") {
    const tune = (key, max) => (v) => { obj.params[key] = Math.max(0, Math.min(max, v)); markDirty(); if(state.mode==='stitch')recompile(); commitSoon(); };
    row(host, "Split satin: longest stitch (mm, 0 = off)", numInput(obj.params.split ?? 0, 0.5, 0, tune("split", 12)));
    row(host, "Fur edge, first rail (mm)", numInput(obj.params.featherA ?? 0, 0.2, 0, tune("featherA", 8)));
    row(host, "Fur edge, second rail (mm)", numInput(obj.params.featherB ?? 0, 0.2, 0, tune("featherB", 8)));
  }
  const u = document.createElement("label"); u.className = "check";
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = obj.params.underlay !== false;
  cb.onchange = () => { obj.params.underlay = cb.checked; markDirty(); if(state.mode==='stitch')recompile(); commit(); };
  u.append(cb, document.createTextNode(" Underlay (center run)"));
  rowFull(host, "", u);
  const hint = document.createElement("div"); hint.className = "prop-hint";
  hint.textContent = obj.kind==='satin-rails' ? 'Paired rails control width and direction; thread lies rail to rail. Split satin breaks long throws into staggered stitches so wide areas keep their sheen. Fur edge makes a rail irregular. Use Assistant control to edit rail nodes in millimeters.' : 'A satin column: zig-zag rails across the line you drew.';
  host.appendChild(hint);
  buildColorRow(host, obj);
}

// Running stitch line: length + repeats (3 = bean stitch).
function buildRunningProps(host, obj) {
  $("props-title").textContent = "Run stitch";
  row(host, "Stitch length (mm)", numInput(obj.params.stitchLength ?? 2.5, 0.25, 1, (v) => { obj.params.stitchLength = Math.max(1, Math.min(6, v)); markDirty(); commitSoon(); }));
  const sel = document.createElement("select"); sel.className = "select";
  sel.innerHTML = `<option value="1">Single</option><option value="double">Double run (return pass)</option><option value="3">Bean (3-pass)</option><option value="5">Heavy (5-pass)</option>`;
  sel.value = obj.params.returnPass ? 'double' : String(obj.params.repeats || 1);
  sel.onchange = () => { obj.params.returnPass = sel.value === 'double'; obj.params.repeats = obj.params.returnPass ? 1 : parseInt(sel.value, 10); markDirty(); if(state.mode==='stitch')recompile(); commit(); };
  row(host, "Passes", sel);
  const curve = document.createElement('label'); curve.className='check';
  const follow = document.createElement('input'); follow.type='checkbox'; follow.checked=!!obj.params.curveTolerance;
  follow.onchange=()=>{obj.params.curveTolerance=follow.checked ? .15 : 0;markDirty();if(state.mode==='stitch')recompile();commit();host.innerHTML='';buildRunningProps(host,obj);};
  curve.append(follow,document.createTextNode(' Follow curves more closely'));rowFull(host,'',curve);
  if(obj.params.curveTolerance)row(host,'Curve tolerance (mm)',numInput(obj.params.curveTolerance,.05,.05,v=>{obj.params.curveTolerance=Math.max(.05,Math.min(.5,v));markDirty();if(state.mode==='stitch')recompile();commitSoon();}));
  const hint = document.createElement("div"); hint.className = "prop-hint";
  hint.textContent = "Double run retraces the whole line once. Bean reverses at every stitch and can look beaded on tiny fur turns. Lower curve tolerance adds stitches; simplify small wiggles for cleaner fabric results.";
  host.appendChild(hint);
  buildColorRow(host, obj);
}

function buildColorRow(host, obj) {
  const btn = document.createElement("button"); btn.className = "thread-button color-swatch-btn";
  const dot = document.createElement("span"); dot.className = "active-swatch"; dot.style.background = obj.color;
  const lab = document.createElement("span"); lab.className = "thread-label"; lab.textContent = threadLabel(obj.color);
  const chev = document.createElement("span"); chev.className = "chev"; chev.textContent = "▾";
  btn.append(dot, lab, chev);
  btn.onclick = () => openColorPicker(btn, obj.color, (hex) => {
    obj.color = hex; dot.style.background = hex; lab.textContent = threadLabel(hex);
    markDirty(); refreshObjectList(); needsRender = true; commit();
  });
  rowFull(host, "Thread color", btn);
}

// ----------------------------------------------------- stitch settings panel
function refreshStitchSettings() {
  const host = $("stitch-settings");
  const obj = selectedObject();
  if (!obj) { host.className = "props-empty"; host.textContent = "Select an object to fine-tune its fill."; return; }
  host.className = ""; host.innerHTML = "";
  // Edits apply to EVERY selected layer (so a multi-part logo updates as one),
  // while the displayed values come from the primary selection.
  const objs = selectedObjects().length ? selectedObjects() : [obj];
  const p = obj.params;
  if (obj.type === "running") { buildRunningProps(host, obj); return; }
  if (obj.type === "satin") { buildSatinProps(host, obj); return; }
  const setAll = (k, v) => objs.forEach((o) => { o.params[k] = v; });
  const recompileLive = () => { markDirty(); recompile(); needsRender = true; };

  if (objs.length > 1) {
    const note = document.createElement("div"); note.className = "prop-sublabel";
    note.textContent = `Applies to ${objs.length} selected layers`;
    host.appendChild(note);
  }

  // --- Thread-pattern (texture) picker with little pattern thumbnails ---
  const sub = document.createElement("div"); sub.className = "prop-sublabel"; sub.textContent = "Thread pattern";
  host.appendChild(sub);
  const tex = document.createElement("div"); tex.className = "texture-grid";
  const TEXTURES = [
    { id: "auto", label: "Auto", title: "Satin for narrow areas, fill for wide", set: { stitchType: "auto", crosshatch: false } },
    { id: "satin", label: "Satin", title: "Smooth side-to-side columns", set: { stitchType: "satin", crosshatch: false } },
    { id: "tatami", label: "Tatami", title: "Flat parallel-row fill", set: { stitchType: "fill", crosshatch: false } },
    { id: "crosshatch", label: "Cross-hatch", title: "Two perpendicular fill passes (grid)", set: { stitchType: "fill", crosshatch: true } },
  ];
  const cur = p.crosshatch ? "crosshatch" : (p.stitchType === "satin" ? "satin" : p.stitchType === "fill" ? "tatami" : "auto");
  for (const t of TEXTURES) {
    const cell = document.createElement("button");
    cell.className = "texture-cell" + (cur === t.id ? " active" : "");
    cell.title = t.title;
    const cv = document.createElement("canvas"); cv.width = 96; cv.height = 40;
    drawTextureThumb(cv, t.id);
    const cap = document.createElement("span"); cap.textContent = t.label;
    cell.append(cv, cap);
    cell.onclick = () => { objs.forEach((o) => Object.assign(o.params, t.set)); recompileLive(); commit(); refreshStitchSettings(); };
    tex.appendChild(cell);
  }
  host.appendChild(tex);

  const satinPreset = document.createElement("button"); satinPreset.className = "btn";
  satinPreset.textContent = "Smooth satin lettering";
  satinPreset.title = "Apply 0.4 mm satin cycle spacing, center underlay and automatic wide-area fill";
  satinPreset.onclick = () => {
    objs.filter(o=>o.type==='text'||o.type==='fill').forEach(o=>Object.assign(o.params,
      {satinZigzag:true,spacing:0.4,underlay:true,stitchType:'auto',crosshatch:false,inset:0.1}));
    recompileLive(); commit(); refreshStitchSettings();
  };
  host.appendChild(satinPreset);
  const smooth = document.createElement("input"); smooth.type = "checkbox"; smooth.checked = !!p.satinZigzag;
  smooth.onchange = () => { setAll("satinZigzag", smooth.checked); recompileLive(); commit(); };
  row(host, "Smooth satin zigzag", smooth);
  const satinHint = document.createElement("p"); satinHint.className = "prop-hint";
  satinHint.textContent = "Smooth satin: spacing is one full zigzag cycle (two crossing stitches). Smaller spacing adds coverage. Wide areas still use fill in Auto. Inspect counters and corners in 3D; test on scrap.";
  host.appendChild(satinHint);

  row(host, "Row spacing (mm)", numInput(p.spacing ?? 0.4, 0.05, 0.25, (v) => { setAll("spacing", v); recompileLive(); }));
  row(host, "Stitch length (mm)", numInput(p.stitchLength ?? 3.0, 0.1, 1, (v) => { setAll("stitchLength", v); recompileLive(); }));
  row(host, "Fill angle (°)", numInput(p.angle ?? 0, 5, -180, (v) => { setAll("angle", v); recompileLive(); }));
  if (cur === "auto") {
    // Only relevant in Auto mode: regions narrower than this become satin.
    row(host, "Satin ≤ width (mm)", numInput(p.satinMaxWidth ?? 6, 0.5, 0, (v) => { setAll("satinMaxWidth", v); recompileLive(); }));
  }
  if (p.fillMode === "outline") {
    row(host, "Border width (mm)", numInput(p.borderWidth ?? 2, 0.2, 0.5, (v) => { setAll("borderWidth", v); recompileLive(); }));
  }

  const under = document.createElement("input"); under.type = "checkbox"; under.checked = p.underlay !== false;
  under.onchange = () => { setAll("underlay", under.checked); recompileLive(); commit(); };
  row(host, "Underlay", under);
  if(obj.type==='fill'){
    const support=document.createElement('select');support.className='select';support.setAttribute('aria-label','Fill underlay style');
    support.innerHTML='<option value="full">Edge + sparse fill</option><option value="edge">Light · edge only</option>';
    support.value=p.underlayStyle==='edge'?'edge':'full';
    support.onchange=()=>{setAll('underlayStyle',support.value);recompileLive();commit();};row(host,'Fill support',support);
  }

  const out = document.createElement("input"); out.type = "checkbox"; out.checked = !!p.outline;
  out.onchange = () => { setAll("outline", out.checked); recompileLive(); commit(); };
  row(host, "Outline pass", out);
}

// Draw a small thumbnail of a stitch texture (satin / tatami / auto) so the
// user can pick by sight.
function drawTextureThumb(cv, kind) {
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#eef1f5"; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = "#2e4a82"; g.lineWidth = 1.4; g.lineCap = "round";
  const W = cv.width, H = cv.height, pad = 5;
  const satin = (x0, x1) => { // dense vertical zig-zag column between x0..x1
    g.beginPath();
    let up = true;
    for (let x = x0; x <= x1; x += 3) { g.moveTo(x, up ? pad : H - pad); g.lineTo(x, up ? H - pad : pad); up = !up; }
    g.stroke();
  };
  const fill = (x0, x1) => { // horizontal tatami rows
    g.beginPath();
    for (let y = pad + 2; y <= H - pad; y += 5) { g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();
  };
  const cross = (x0, x1) => { // diagonal grid
    g.beginPath();
    for (let d = -H; d < W; d += 6) { g.moveTo(x0 + d, pad); g.lineTo(x0 + d + H, H - pad); g.moveTo(x0 + d + H, pad); g.lineTo(x0 + d, H - pad); }
    g.stroke();
  };
  g.save(); g.beginPath(); g.rect(pad, pad, W - 2 * pad, H - 2 * pad); g.clip();
  if (kind === "satin") satin(pad, W - pad);
  else if (kind === "tatami") fill(pad, W - pad);
  else if (kind === "crosshatch") cross(pad, W - pad);
  else { satin(pad, W / 2 - 3); fill(W / 2 + 3, W - pad); } // auto = both
  g.restore();
}

// ----------------------------------------------------------- font gallery
let fontTarget = null;
let fontCatFilter = "all"; // "all" or a category id

// The chip row that lets you jump to / filter by category. Each chip's label is
// drawn in a font representative of that category so the styles read at a glance.
function buildFontCats() {
  const bar = $("font-cats");
  if (!bar) return;
  bar.innerHTML = "";
  const mk = (id, label, repName) => {
    const chip = document.createElement("button");
    chip.className = "font-cat-chip" + (fontCatFilter === id ? " active" : "");
    chip.textContent = label;
    if (repName) chip.style.fontFamily = cssFamily(repName) + ", sans-serif";
    chip.onclick = () => { fontCatFilter = id; buildFontCats(); buildFontGrid(); };
    bar.appendChild(chip);
  };
  mk("all", "All", "Anton");
  for (const c of FONT_CATEGORIES) mk(c.id, c.label, c.rep);
}

function buildFontGrid() {
  const grid = $("font-grid");
  const sample = $("font-sample").value || (fontTarget && fontTarget.params.text) || "Embroidery";
  grid.innerHTML = "";

  const cats = fontCatFilter === "all" ? FONT_CATEGORIES : FONT_CATEGORIES.filter((c) => c.id === fontCatFilter);
  for (const cat of cats) {
    const fonts = fontsInCategory(cat.id);
    if (!fonts.length) continue;

    // Category heading, set in a representative font for that group.
    const head = document.createElement("div");
    head.className = "font-cat-head";
    head.innerHTML =
      `<span class="cat-name" style="font-family:${cssFamily(cat.rep)},sans-serif">${cat.label}</span>` +
      `<span class="cat-blurb">${cat.blurb} · ${fonts.length}</span>`;
    grid.appendChild(head);

    for (const f of fonts) {
      const card = document.createElement("div");
      card.className = "font-card" + (fontTarget && fontTarget.params.font === f.name ? " active" : "");
      const s = document.createElement("div"); s.className = "font-sample";
      s.style.fontFamily = cssFamily(f.name); s.textContent = sample;
      const meta = document.createElement("div"); meta.className = "font-meta";
      meta.innerHTML = `<div class="nm">${f.name}</div><div class="cat">${cat.label}</div>`;
      card.append(s, meta);
      card.onclick = () => {
        if (fontTarget) { fontTarget.params.font = f.name; bakeText(fontTarget, () => { markDirty(); refreshObjectList(); refreshProps(); needsRender = true; }); commit(); }
        closeFontGallery();
      };
      grid.appendChild(card);
    }
  }
}
function openFontGallery(obj) {
  fontTarget = obj;
  // ensure all faces are fetched so glyph baking is instant after pick
  FONTS.forEach((f) => loadFont(f.name).catch(() => {}));
  // open on the category of the current font so the active pick is visible
  const cur = FONTS.find((f) => f.name === obj.params.font);
  fontCatFilter = cur ? cur.cat : "all";
  $("font-sample").value = obj.params.text && obj.params.text.trim() ? obj.params.text : "";
  $("font-modal").classList.remove("hidden");
  buildFontCats();
  buildFontGrid();
}
function closeFontGallery() { $("font-modal").classList.add("hidden"); }
$("font-close").onclick = closeFontGallery;
$("font-sample").oninput = buildFontGrid;
$("font-modal").addEventListener("click", (e) => { if (e.target.id === "font-modal") closeFontGallery(); });

// ----------------------------------------------------------------- toolbar
document.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
[["chk-show-image", "showImage"], ["chk-show-stitches", "showStitches"], ["chk-show-jumps", "showJumps"],
 ["chk-show-points", "showPoints"], ["chk-show-grid", "showGrid"], ["chk-show-hoop", "showHoop"]].forEach(([id, key]) => {
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
$("btn-theme").onclick = () => { state.theme = state.theme === "light" ? "dark" : "light"; document.body.dataset.theme = state.theme; needsRender = true; autosave(); };
$("btn-undo").onclick = undo;
$("btn-redo").onclick = redo;
$("btn-optimize").onclick = optimizeOrder;
$("btn-select-all").onclick = selectAllObjects;

$("btn-new").onclick = () => {
  commit();
  if (!confirm("Start a new design? Unsaved work will be lost.")) return;
  state.objects = []; state.guides = []; state.name = "My design"; syncProjectUI(); setSel([]); state.image = null;
  markDirty(); setMode("design"); refreshObjectList(); refreshProps(); updateEmptyHint();
  commit();
  toast("New design — Undo restores your previous work");
};
$("btn-reset").onclick = () => $("sample-dialog").showModal();
$("sample-close").onclick = () => $("sample-dialog").close();
$("sample-heart").onclick = () => {
  $("sample-dialog").close();
  if (state.objects.length && !confirm("Replace your current design with the sample heart + GoodSew design?")) return;
  state.objects = []; state.guides = []; setSel([]); state.image = null; state.fabricColor = null; syncProjectUI();
  seedDemo();
  markDirty(); setMode("design"); refreshObjectList(); refreshProps(); updateEmptyHint();
  commit(); needsRender = true;
  toast("Reset to the sample design");
};
$("sample-timi").onclick = () => { $("sample-dialog").close(); loadSample("timi", true); };
$("sample-timi-brush").onclick = () => { $("sample-dialog").close(); loadSample("timi-brush", true); };
$("sample-timi-line").onclick = () => { $("sample-dialog").close(); loadSample("timi-line", true); };
// Samples are plain lists of assistant commands, applied through the same
// validated path an AI assistant uses — a worked example of driving the app.
async function loadSample(name, ask) {
  try {
    if (ask && state.objects.length && !confirm("Replace your current design with this sample? Undo restores your work.")) return;
    const sample = name === "timi-brush" ? await import("./samples/timi-brush.js") : name === "timi-line" ? await import("./samples/timi-line.js") : await import("./samples/timi.js");
    setMode("design");
    let design = await designCommand("get_design");
    const operations = [...design.objects.map(o => ({ op: "remove", id: o.id })), ...sample.operations];
    for (let i = 0; i < operations.length; i += 100) design = await designCommand("apply_edit", { expectedRevision: design.revision, requestId: crypto.randomUUID(), operations: operations.slice(i, i + 100) });
    state.name = sample.NAME; state.fabricColor = sample.FABRIC === '#ffffff' ? null : sample.FABRIC; state.guides = []; syncProjectUI();
    commit(); refreshObjectList(); refreshProps(); updateEmptyHint(); needsRender = true;
    await renderStitches();
    toast(sample.NAME + " loaded: " + sample.operations.length + " objects. Open 3D View to see the thread.");
  } catch (err) { toast("Could not load the sample: " + err.message, true); }
}
$("draw-finish").onclick = () => finishDrawing();
$("draw-cancel").onclick = () => { cancelDrawing(); setTool("select"); };
$("file-svg").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  importLogoFile(f);
  e.target.value = "";
};

$("btn-save-json").onclick = () => { download(serialize(), fileStem(state.name) + ".gsew", "application/json"); toast("Project saved"); };
$("btn-load-json").onclick = () => $("file-json").click();
$("file-json").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      commit();
      deserialize(reader.result);
      syncProjectUI();
      document.body.dataset.theme = state.theme;
      state.objects.forEach((o) => { if (o.type === "text") bakeText(o); else rebuildShape(o); });
      setMode("design");
      refreshObjectList(); refreshProps(); updateEmptyHint();
      cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight, RULER, view.showHoop ? 17 : 2);
      commit();
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
  // every product has adjustable real-world dimensions
  const prod = getProduct(previewProduct);
  const cu = state.units;
  $("lbl-custom-w").textContent = prod.dims.wLabel || "Width";
  $("lbl-custom-h").textContent = prod.dims.hLabel || "Height";
  $("custom-w").value = +toUnit(prod.dims.w, cu).toFixed(1);
  $("custom-h").value = +toUnit(prod.dims.h, cu).toFixed(1);
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
  const dims = { ...product.dims,
    w: fromUnit(parseFloat($("custom-w").value) || 1, cu),
    h: fromUnit(parseFloat($("custom-h").value) || 1, cu) };
  renderPreview(pctx, compiled, product, { dims, customW: dims.w, customH: dims.h });
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

// ----------------------------------------------------------------- 3D view
// three.js loads lazily on first open, so the main app stays light.
let viewerRequest = 0, pesFileRequest = 0;
async function showThreadViewer(plan, title) {
  const ticket=++viewerRequest,modal=$("view3d-modal");
  $("view3d-title").textContent=title || "3D embroidery preview";
  const stitches=plan.plan.filter(s=>s.cmd==="stitch").length;
  const fits=plan.bounds.w<=100&&plan.bounds.h<=100&&stitches<=100000;
  $("view3d-summary").textContent=`${plan.bounds.w.toFixed(1)} × ${plan.bounds.h.toFixed(1)} mm · ${stitches.toLocaleString()} stitches · ${plan.colors.length} thread blocks · ${fits ? "Within SE700 limits" : "Exceeds SE700 limits"}`;
  $("view3d-file-notes").textContent=[...(plan.metadata?.warnings || []),...analyzeQuality(plan).warnings.map(w=>w.msg),"Geometry follows the stitch plan. Thread surface and fabric response are estimates."].join(" ");
  modal.classList.remove("hidden");if(!modal.open)modal.showModal();
  $("view3d-stage").textContent="Building thread surfaces…";
  try {
    const mod=await import("./view3d.js");if(ticket!==viewerRequest)return;
    mod.open3DView(plan,getHoop(state.hoopId),{
      container:$("view3d-stage"),play:$("view3d-play"),scrub:$("view3d-scrub"),speed:$("view3d-speed"),counter:$("view3d-counter"),views:$("view3d-views"),
      controls:$("view3d-controls"),threads:$("view3d-threads"),reset:$("view3d-reset-material"),snapshot:$("view3d-snapshot"),fabric:state.fabricColor
    });window.__gs3d=true;
  } catch(err) {
    if(ticket!==viewerRequest)return;
    $("view3d-stage").textContent="3D preview could not start. " + err.message + " This viewer requires WebGL 2; try a browser with hardware acceleration enabled.";
    toast("3D preview could not start: " + err.message,true);
  }
}
$("btn-3d").onclick=()=>{ensureCompiled();if(!compiled.plan.length){toast("Generate stitches first.",true);return;}showThreadViewer(compiled,state.name);};
function closeThreadViewer(){
  ++viewerRequest;++pesFileRequest;$("view3d-modal").close();$("view3d-modal").classList.add("hidden");
  import("./view3d.js").then(mod=>{if(!$("view3d-modal").open)mod.close3DView();}).catch(()=>{});
}
$("view3d-close").onclick=closeThreadViewer;
$("view3d-modal").addEventListener("cancel",e=>{e.preventDefault();closeThreadViewer();});
$("btn-preview-pes").onclick=()=>$("file-pes").click();
$("view3d-load").onclick=()=>$("file-pes").click();
$("file-pes").onchange=async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;const request=++pesFileRequest;
  try {
    if(file.size>16*1024*1024)throw new Error("Choose a PES file smaller than 16 MB.");
    const {parsePES}=await import("./import/pes.js");const plan=parsePES(await file.arrayBuffer(),file.name);
    if(request===pesFileRequest)await showThreadViewer(plan,file.name);
  } catch(err){toast("Could not open embroidery file: " + err.message,true);}
};
$("preview-close").onclick = () => $("preview-modal").classList.add("hidden");
$("preview-modal").addEventListener("click", (e) => { if (e.target.id === "preview-modal") e.currentTarget.classList.add("hidden"); });
$("custom-w").oninput = drawPreview;
$("custom-h").oninput = drawPreview;

function exportDesign(format) {
  try {
    ensureCompiled();
    const bytes = format === "pes" ? exportPES(compiled, fileStem(state.name)) : exportDST(compiled);
    download(bytes, `${fileStem(state.name)}.${format}`, "application/octet-stream");
    toast(format === "pes" ? "PES downloaded. Use the sewing sheet for spool order and transfer steps." : "DST downloaded. DST does not store thread colors; keep the sewing sheet.");
  } catch (err) { toast(err.message, true); refreshQuality(); }
}
$("btn-export-pes").onclick = () => exportDesign("pes");
$("btn-export-dst").onclick = () => exportDesign("dst");

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
  const drawToolActive = tool === "satin" || tool === "run" || tool === "poly";
  $("empty-hint").style.display = (state.mode === "design" && state.objects.length === 0 && !drawToolActive) ? "block" : "none";
}
function updateSimColor(s) {
  const host = $("sim-color");
  if (!compiled || s.index === 0) { host.textContent = ""; host.style.background = "transparent"; return; }
  const entry = compiled.plan[Math.min(s.index - 1, compiled.plan.length - 1)];
  const c = compiled.colors[entry.color];
  if (c) { host.style.background = c.color; host.textContent = threadLabel(c.color); }
}

// ----------------------------------------------------------------- main loop
function frame() {
  if (state.mode === "stitch" && state.planDirty) needsRender = true;
  if (needsRender) {
    if (state.mode === "stitch") {
      try { ensureCompiled(); } catch (err) { state.mode="design";document.body.dataset.mode="design";toast(err.message,true); }
    }
    render(ctx, state, compiled, sim, { cam, view, cursor, hoverGuide, snapGuides, drawing, unit: UNITS[state.units] });
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- boot
// Register @font-face for every catalog font (generated from FONTS), so the
// live DOM previews in the gallery and properties panel use the real faces.
function injectFontFaces() {
  let el = document.getElementById("gs-font-faces");
  if (!el) { el = document.createElement("style"); el.id = "gs-font-faces"; document.head.appendChild(el); }
  el.textContent = fontFaceCSS();
}

function boot() {
  console.log(`GoodSew v${APP_VERSION} — JS bundle active`);
  const badge = $("version-badge"); if (badge) badge.textContent = `GoodSew v${APP_VERSION}`;
  injectFontFaces();
  const restored = restoreAutosaved();
  document.body.dataset.theme = state.theme;
  document.body.dataset.mode = state.mode;
  buildThreadPicker();
  buildUnitToggle();
  buildShapeGrid();
  updateHoopDims();
  setTool("select");
  resize();
  if (!restored) seedDemo();
  syncProjectUI();
  refreshObjectList();
  refreshProps();
  updateEmptyHint();
  resetHistory();
  frame();

  window.__gs = {
    state, sim, fitToHoop, addBasting, applyFabric, setTool, setMode, renderStitches, undo, redo, reorder,
    setActiveColor: (hex) => { state.activeColor = hex; updateActiveSwatch(); },
    addText, addShape, bakeText, importSVG, importRasterData, importRasterImage, optimizeOrder, moveLayer, selectAllObjects,
    quality: () => { ensureCompiled(); return analyzeQuality(compiled, getHoop(state.hoopId)); },
    // test helper: screen-space handle positions for the given object
    handlesScreen: (id) => { const o = state.objects.find((x) => x.id === id); if (!o) return null; setSel([o.id]); return selectionHandlesScreen(o); },
    setSel, selectedObjects, copySelection, pasteClipboard, duplicateSelection, groupSelection, ungroupSelection, alignSelected, distributeSelected,
    nudgeSelected, centerSelected, groupBounds, cam, openFontGallery,
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
  setSel([text.id]);
  bakeText(text, () => { markDirty(); refreshObjectList(); needsRender = true; });
  markDirty();
}

// ---------------------------------------------------------- sewing workspace
function syncProjectUI() {
  $("project-name").value = state.name;
  $("fabric-select").value = state.fabric;
  $("fabric-note").textContent = FABRICS[state.fabric].note;
  $("fabric-color").value = state.fabricColor || "#ffffff";
}
function refreshSewing() {
  const badge = $("design-status"); if (!badge) return;
  const visible = state.objects.filter(o => o.visible);
  if (!visible.length) badge.textContent = "Your hoop is ready";
  else if (state.planDirty || !compiled) badge.textContent = `${visible.length} objects · Generate to check stitches`;
  else {
    const st = computeStats(compiled), qa = analyzeQuality(compiled);
    badge.textContent = `${st.stitches.toLocaleString()} stitches · ${st.width.toFixed(1)} × ${st.height.toFixed(1)} mm · ${qa.valid ? "Checks passed" : "Needs attention"}`;
  }
  badge.classList.toggle("attention", !!compiled && !state.planDirty && !analyzeQuality(compiled).valid);
  const host = $("thread-sequence"); host.replaceChildren();
  if (!compiled || state.planDirty) { host.textContent = "Generate stitches to see the spool order."; return; }
  compiled.colors.forEach((color, i) => {
    const button = document.createElement("button"); button.className = "sequence-step";
    const dot = document.createElement("span"); dot.className = "sequence-dot"; dot.style.background = color.color;
    const label = document.createElement("span"); label.textContent = `${i+1}. ${threadLabel(color.color)}`;
    button.append(dot,label); button.title = "Preview this thread block in the simulator";
    button.onclick = () => { sim.playing && sim.toggle(); const idx=compiled.plan.findIndex(s => s.color === i && s.cmd === "stitch"); sim.seek(Math.max(0,idx+1)); needsRender=true; };
    host.append(button);
  });
}
function applyFabric() {
  const f = FABRICS[state.fabric];
  const objects = selectedObjects().length ? selectedObjects() : state.objects;
  for (const o of objects) {
    if (o.type === "running") continue;
    Object.assign(o.params, { spacing:f.spacing, density:f.spacing, stitchLength:f.stitchLength, pull:f.pull, underlay:true });
  }
  markDirty(); if(state.mode === "stitch") recompile(); commit(); refreshProps(); refreshSewing(); needsRender=true;
  toast(`${f.label} starting settings applied to ${objects.filter(o=>o.type!=='running').length} objects. Test on scrap.`);
}
async function fitToHoop() {
  try {
    await Promise.all(state.objects.filter(o=>o.type==='text').map(async o=>{await loadFont(o.params.font);bakeText(o);}));
    markDirty(); ensureCompiled();
    if (!compiled.plan.length) { toast("Add artwork first.",true); return; }
    // Recalculate stitches after each scaling pass, including non-scaling pull
    // compensation, so fitting is based on the actual needle envelope.
    for(let pass=0;pass<4;pass++) {
      const b=compiled.bounds, cx=(b.minX+b.maxX)/2, cy=(b.minY+b.maxY)/2;
      const factor=Math.min(1,95.8/Math.max(b.w,0.01),95.8/Math.max(b.h,0.01));
      const map=p=>({x:50+(p.x-cx)*factor,y:50+(p.y-cy)*factor});
      for(const o of state.objects.filter(o=>o.visible)) {
        o.points=o.points.map(map);
        if(o.box) { const q=map(o.box); o.box={x:q.x,y:q.y,w:o.box.w*factor,h:o.box.h*factor}; }
        if(o.type==='text') {o.params.size*=factor;o.params.letterSpacing=(o.params.letterSpacing||0)*factor;bakeText(o);}
        else if(o.box) rebuildShape(o);
        else if(o.contours) o.contours=o.contours.map(c=>c.map(map));
        if(o.type==='satin'&&o.kind!=='satin-rails') o.params.width*=factor;
      }
      markDirty(); recompile();
      if(compiled.bounds.w<=96 && compiled.bounds.h<=96) break;
    }
    commit(); refreshProps(); refreshObjectList(); needsRender=true;
    toast("Centered and fitted with a 2 mm hoop margin. Stitches regenerated.");
  } catch(err) {toast("Could not fit design: " + err.message,true);}
}
function addBasting() {
  ensureCompiled();
  if(!compiled.plan.length) {toast("Add artwork first.",true);return;}
  if(state.objects.some(o=>o.name==='Basting frame')) {toast("A basting frame is already present.");return;}
  const b=compiled.bounds, x=b.minX-2,y=b.minY-2,r=b.maxX+2,d=b.maxY+2;
  if(x<1||y<1||r>99||d>99) {toast("Leave room for basting: reduce and center the design before adding a frame.",true);return;}
  const o=makeObject('running',[{x,y},{x:r,y},{x:r,y:d},{x,y:d},{x,y}],state.objects.find(o=>o.visible)?.color||state.activeColor);
  o.name='Basting frame'; o.params.stitchLength=4; state.objects.unshift(o);setSel([o.id]);markDirty();
  if(state.mode==='stitch')recompile();commit();refreshObjectList();refreshProps();needsRender=true;
  toast("Basting frame added as the first layer. Remove its thread after sewing.");
}
$("project-name").oninput = e => {state.name=e.target.value.slice(0,80);commitSoon();};
$("fabric-select").onchange = e => {state.fabric=e.target.value;syncProjectUI();commit();};
$("btn-fabric").onclick=applyFabric;
$("fabric-color").oninput = e => {state.fabricColor=e.target.value.toLowerCase()==="#ffffff"?null:e.target.value;needsRender=true;commitSoon();};
$("btn-fit-hoop").onclick=fitToHoop;
$("btn-baste").onclick=addBasting;
$("btn-sew-sheet").onclick=()=>{ensureCompiled();if(!compiled.plan.length){toast("Generate stitches first.",true);return;}download(buildSewSheet(compiled,state.name,state.fabric),fileStem(state.name)+'-sewing-sheet.html','text/html');};
$("btn-fit-view").onclick=()=>{cam.fit(getHoop(state.hoopId),canvas.clientWidth,canvas.clientHeight,RULER,view.showHoop?17:2);needsRender=true;};
$("btn-zoom-in").onclick=()=>{cam.zoomAt(canvas.clientWidth/2,canvas.clientHeight/2,1.2);needsRender=true;};
$("btn-zoom-out").onclick=()=>{cam.zoomAt(canvas.clientWidth/2,canvas.clientHeight/2,1/1.2);needsRender=true;};
$("btn-help").onclick=()=>$("help-dialog").showModal();
$("help-close").onclick=()=>$("help-dialog").close();

boot();

// Both MCP and visible browser commands use this authority. No arbitrary code.
async function prepareCommandObjects(objects){
 await Promise.all(objects.filter(o=>o.type==='text').map(o=>loadFont(o.params.font)));
 for(const o of objects){if(o.type==='text')bakeText(o);else rebuildShape(o);}
}
async function commandCompile(){
 await prepareCommandObjects(state.objects);markDirty();recompile();
 return {stats:computeStats(compiled),warnings:analyzeQuality(compiled),bounds:compiled.bounds,colors:compiled.colors};
}
function commandFabric(args){
 if(args.fabric===undefined)return;
 if(!/^#[0-9a-f]{6}$/i.test(args.fabric))throw Error('fabric must be a #rrggbb color.');
 state.fabricColor=args.fabric.toLowerCase()==='#ffffff'?null:args.fabric.toLowerCase();syncProjectUI();needsRender=true;commit();
}
const designCommand=createDesignController({
 fingerprint:historySnapshot,objects:()=>state.objects,nextId,
 read:()=>({name:state.name,machine:SE700,selectedIds:[...state.selectedIds],objects:state.objects.map(o=>({id:o.id,type:o.type,kind:o.kind,name:o.name,color:o.color,box:o.box,points:o.points,rails:o._rails,rotation:o.rotation,params:{...o.params},visible:o.visible,groupId:o.groupId}))}),
 prepare:async objects=>{await prepareCommandObjects(objects);compile(objects);},
 apply:objects=>{commit();state.objects=objects;setSel(state.selectedIds.filter(id=>objects.some(o=>o.id===id)));markDirty();commit();refreshObjectList();refreshProps();updateEmptyHint();if(state.mode==='stitch')recompile();needsRender=true;},
 undo,
 generate_stitches:commandCompile,
 preview_pes:async(args)=>{
  const {decodePESCommand}=await import('./import/pes-command.js');
  const plan=decodePESCommand(args),warnings=analyzeQuality(plan);
  await showThreadViewer(plan,args.filename);
  const {capture3DView}=await import('./view3d.js');
  return {filename:args.filename,stats:computeStats(plan),warnings,bounds:plan.bounds,colors:plan.colors,image:capture3DView(args.focus,args.view).split(',')[1],previewAssumptions:{diameterMM:.24,loft:.55,finish:'polyester',fabric:'woven',physicalSimulation:false},editableProjectChanged:false};
 },
 preview_2d:async(args)=>{
  if(args.focus&&(![args.focus.x,args.focus.y,args.focus.w,args.focus.h].every(Number.isFinite)||args.focus.w<=0||args.focus.h<=0||args.focus.w>200||args.focus.h>200))throw Error('Preview region must have positive dimensions up to 200 mm.');
  commandFabric(args);const result=await commandCompile();const {renderStitchPreview}=await import('./preview2d.js');
  return {...result,image:renderStitchPreview(compiled,{focus:args.focus,fabric:state.fabricColor||'#e4dfd1',width:Math.max(300,Math.min(2400,args.width||1100))}).split(',')[1],previewAssumptions:{threadWidthMM:.36,light:'upper left',fabric:state.fabricColor||'#e4dfd1',physicalSimulation:false}};
 },
 preview_3d:async(args)=>{commandFabric(args);if(args.focus&&(![args.focus.x,args.focus.y,args.focus.w,args.focus.h].every(Number.isFinite)||args.focus.w<=0||args.focus.h<=0||args.focus.w>200||args.focus.h>200))throw Error('Preview region must have positive dimensions up to 200 mm.');const result=await commandCompile();await showThreadViewer(compiled,state.name);const {capture3DView}=await import('./view3d.js');return {...result,image:capture3DView(args.focus,args.view).split(',')[1],previewAssumptions:{diameterMM:.24,loft:.55,finish:'polyester',fabric:'woven',camera:args.focus?{focus:args.focus,view:args.view||'top'}:'initial fit',physicalSimulation:false}};},
 inspect_region:async({x,y,w,h})=>{
  if(w<=0||h<=0||w>200||h>200)throw Error('Use a positive inspection rectangle up to 200 mm.');
  await commandCompile();const {prepareThreadSegments}=await import('./thread-model.js');const spans=prepareThreadSegments(compiled).segments;
  const selected=spans.filter(s=>Math.max(s.a.x,s.b.x)>=x&&Math.min(s.a.x,s.b.x)<=x+w&&Math.max(s.a.y,s.b.y)>=y&&Math.min(s.a.y,s.b.y)<=y+h);
  let needles=0;for(const s of compiled.plan)if(s.cmd==='stitch'&&s.x>=x&&s.x<=x+w&&s.y>=y&&s.y<=y+h)needles++;
  return {region:{x,y,w,h},intersectingSegmentBounds:selected.length,needlePoints:needles,needlePointsPerSquareMM:needles/(w*h),note:'Bounding-box span intersection and needle density estimates; not a fabric coverage simulation.'};
 },
 export_pes:async()=>{
  const result=await commandCompile(),bytes=exportPES(compiled,fileStem(state.name)),{parsePES}=await import('./import/pes.js'),decoded=parsePES(bytes,'verification.pes');
  const a=compiled.plan.filter(s=>s.cmd==='stitch'),b=decoded.plan.filter(s=>s.cmd==='stitch');
  if(a.length!==b.length)throw Error('PES verification failed: stitch count mismatch.');
  const dx=b[0].x-a[0].x,dy=b[0].y-a[0].y;
  let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(b[i].x-a[i].x-dx),Math.abs(b[i].y-a[i].y-dy));
  if(error>.101)throw Error('PES verification failed: coordinate mismatch.');
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  return {...result,filename:fileStem(state.name)+'.pes',base64:btoa(binary),verification:{stitchCount:a.length,maxCoordinateErrorMM:error,reader:'Good Sew PEC reader; independent reader tests also shipped'}};
 }
});
mountAssistantPanel(designCommand);
{ const wanted = new URLSearchParams(globalThis.location?.search || '').get('sample'); if (wanted === 'timi' || wanted === 'timmy') loadSample('timi', false); else if (wanted === 'timi-line' || wanted === 'timi-brush') loadSample(wanted, false); }
// The same validated command authority for in-page agents (browser extensions,
// automation). It can do nothing the visible Assistant control panel cannot.
window.goodsew={call:designCommand,tools:DESIGN_TOOLS};
async function replaceWithSatinRound(obj){
 try{
  const before=await designCommand('get_design'),b=getObjBox(obj),text=obj.params.text;
  const height=Math.max(6,Math.min(20,b.h));
  const operations=[{op:'remove',id:obj.id},{op:'add_lettering',text,height,strokeWidth:Math.max(.8,Math.min(1.6,height*.12)),x:b.cx-b.w/2,y:b.cy-b.h/2,letterSpacing:1,color:obj.color}];
  const result=await designCommand('apply_edit',{expectedRevision:before.revision,requestId:crypto.randomUUID(),operations});
  setSel(state.objects.filter(o=>o.kind==='satin-rails').map(o=>o.id));refreshProps();refreshObjectList();
  toast('Converted to editable Satin Round columns.'+(result.notes.length?' '+result.notes.join(' '):'')+' Undo restores the original font.');
 }catch(err){toast(err.message,true);}
}
