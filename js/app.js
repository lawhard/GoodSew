// GoodSew — SE700 embroidery digitizer. Main application controller.

import { state, makeObject, selectedObject, markDirty, serialize, deserialize, nextId } from "./state.js";
import { HOOPS, getHoop, SE700 } from "./hoop.js";
import { BROTHER_PALETTE, rgbToHex } from "./threads.js";
import { compile } from "./compiler.js";
import { computeStats, formatTime } from "./stats.js";
import { exportPES } from "./export/pes.js";
import { Camera, render, RULER } from "./render.js";
import { Simulator } from "./simulator.js";
import { dist, bbox } from "./geometry.js";
import { SHAPES, buildShape } from "./shapes.js";
import { FONTS, loadFont, textToGlyphs } from "./fonts.js";
import { UNITS, fmt, toUnit, fromUnit } from "./units.js";
import { PRODUCTS, getProduct, renderPreview } from "./preview.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const cam = new Camera();

const view = {
  showImage: true, showStitches: true, showJumps: true, showPoints: false, showGrid: true,
};

let compiled = null;
let tool = "select";
let draft = null;          // in-progress object being drawn
let drag = null;           // { mode:'object'|'node'|'pan'|'guide'|'shape', ... }
let needsRender = true;
let spaceDown = false;
let cursor = null;         // { sx, sy } screen px of pointer
let hoverGuide = null;     // guide under pointer (for highlight)
let shapeKind = "rect";
let shapeStyle = "fill";

const sim = new Simulator((s) => {
  document.getElementById("sim-scrub").value = s.index;
  document.getElementById("sim-stitch-idx").textContent =
    `${s.index} / ${s.total}`;
  document.getElementById("sim-play").textContent = s.playing ? "⏸" : "▶";
  updateSimColor(s);
  needsRender = true;
});

// ---------------------------------------------------------------- canvas size
function resize() {
  const wrap = document.getElementById("canvas-wrap");
  const r = wrap.getBoundingClientRect();
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  if (!cam._fitted) { cam.fit(getHoop(state.hoopId), r.width, r.height, RULER); cam._fitted = true; }
  needsRender = true;
}
window.addEventListener("resize", resize);

// ----------------------------------------------------------------- recompile
function recompile() {
  compiled = compile();
  state.plan = compiled;
  state.planDirty = false;
  sim.setPlan(compiled.plan);
  document.getElementById("sim-scrub").max = compiled.plan.length;
  refreshStats();
  needsRender = true;
}

function ensureCompiled() {
  if (state.planDirty || !compiled) recompile();
}

function refreshStats() {
  const st = computeStats(compiled);
  document.getElementById("stat-stitches").textContent = st.stitches.toLocaleString();
  document.getElementById("stat-colors").textContent = st.colorChanges;
  document.getElementById("stat-jumps").textContent = st.jumps;
  document.getElementById("stat-trims").textContent = st.trims;
  document.getElementById("stat-dims").textContent =
    st.width > 0 ? `${fmt(st.width, state.units)} × ${fmt(st.height, state.units)}` : "—";
  document.getElementById("stat-time").textContent = formatTime(st.seconds);
}

// ------------------------------------------------------------- coordinate map
function mouseWorld(e) {
  const r = canvas.getBoundingClientRect();
  return cam.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
}

// ----------------------------------------------------------------- tools
function setTool(t) {
  if (draft) finalizeDraft();
  tool = t;
  document.querySelectorAll(".tool").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === t));
  const hints = {
    select: "Click to select. Drag to move. Drag nodes to reshape. Del to remove.",
    running: "Click to add points. Double-click or Enter to finish the path.",
    satin: "Click along the column centre. Double-click/Enter to finish.",
    fill: "Click to outline the region. Double-click/Enter to close & fill.",
    shape: "Drag to draw the shape. Pick a kind & style on the left.",
    text: "Click to place lettering, then edit the text & font on the right.",
  };
  document.getElementById("hud-hint").textContent = hints[t] || "";
  canvas.style.cursor = t === "select" ? "default" : "crosshair";
  const so = document.getElementById("shape-options");
  if (so) so.hidden = t !== "shape";
}

// Place a new text object at world point and build its glyph outlines.
function placeText(world) {
  const obj = makeObject("text", [world], state.activeColor);
  obj.name = "Text";
  state.objects.push(obj);
  state.selectedId = obj.id;
  buildTextGlyphs(obj);
  setTool("select");
  refreshObjectList(); refreshObjectProps();
}

// (Re)build cached glyph contours for a text object, then recompile.
async function buildTextGlyphs(obj) {
  try {
    const font = await loadFont(obj.params.font);
    const r = textToGlyphs(font, obj.params.text || "", obj.params.size, {
      letterSpacing: obj.params.letterSpacing || 0,
    });
    obj._glyphs = r.glyphs;
    obj._textW = r.width;
    markDirty(); recompile(); refreshObjectList(); needsRender = true;
  } catch (err) {
    toast("Font load failed: " + err.message, true);
  }
}

function startOrExtendDraft(world) {
  if (!draft) {
    draft = makeObject(tool, [world], state.activeColor);
    state.objects.push(draft);
    state.selectedId = draft.id;
  } else {
    draft.points.push(world);
  }
  markDirty();
  refreshObjectList();
  refreshObjectProps();
}

function finalizeDraft() {
  if (!draft) return;
  const minPts = draft.type === "fill" ? 3 : 2;
  if (draft.points.length < minPts) {
    state.objects = state.objects.filter((o) => o !== draft);
  }
  draft = null;
  markDirty();
  ensureCompiled();
  refreshObjectList();
}

// --------------------------------------------------------- mouse interaction
const NODE_HIT_PX = 8;

canvas.addEventListener("mousedown", (e) => {
  const world = mouseWorld(e);
  const mx = e.offsetX, my = e.offsetY;

  if (e.button === 1 || spaceDown) { // middle button / space-drag pan
    drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY };
    return;
  }

  // Pull a new guide out of a ruler strip.
  if (my < RULER && mx >= RULER) {
    const g = { id: nextId(), axis: "x", pos: world.x };
    state.guides.push(g);
    drag = { mode: "guide", guide: g, isNew: true };
    return;
  }
  if (mx < RULER && my >= RULER) {
    const g = { id: nextId(), axis: "y", pos: world.y };
    state.guides.push(g);
    drag = { mode: "guide", guide: g, isNew: true };
    return;
  }
  if (mx < RULER || my < RULER) return; // corner / dead zone

  // Grab an existing guide to move it.
  const gh = guideAt(mx, my);
  if (gh) { drag = { mode: "guide", guide: gh, isNew: false }; return; }

  if (tool === "shape") {
    const obj = makeObject(shapeStyle, [world, world], state.activeColor);
    obj.name = SHAPES.find((s) => s.kind === shapeKind)?.label || "Shape";
    obj.points = buildShape(shapeKind, { x: world.x, y: world.y, w: 0.1, h: 0.1 });
    state.objects.push(obj);
    state.selectedId = obj.id;
    drag = { mode: "shape", obj, start: world, kind: shapeKind };
    return;
  }

  if (tool === "text") {
    placeText(world);
    return;
  }

  if (tool === "select") {
    const sel = selectedObject();
    if (sel) {
      for (let i = 0; i < sel.points.length; i++) {
        const sp = cam.toScreen(sel.points[i]);
        if (dist(sp, { x: mx, y: my }) <= NODE_HIT_PX) {
          drag = { mode: "node", obj: sel, index: i };
          return;
        }
      }
    }
    const hit = hitTestObject(world);
    if (hit) {
      state.selectedId = hit.id;
      drag = { mode: "object", obj: hit, start: world, orig: hit.points.map((p) => ({ ...p })) };
      refreshObjectProps(); refreshObjectList(); needsRender = true;
    } else {
      state.selectedId = null;
      refreshObjectProps(); refreshObjectList(); needsRender = true;
    }
  } else {
    startOrExtendDraft(world);
  }
});

// Find an existing guide line near screen point (mx,my), within tolerance.
function guideAt(mx, my) {
  const tol = 5;
  for (const g of state.guides) {
    if (g.axis === "x") {
      if (my < RULER) continue;
      if (Math.abs(cam.toScreen({ x: g.pos, y: 0 }).x - mx) <= tol) return g;
    } else {
      if (mx < RULER) continue;
      if (Math.abs(cam.toScreen({ x: 0, y: g.pos }).y - my) <= tol) return g;
    }
  }
  return null;
}

canvas.addEventListener("mousemove", (e) => {
  const world = mouseWorld(e);
  cursor = { sx: e.offsetX, sy: e.offsetY };
  document.getElementById("hud-coords").textContent =
    `${fmt(world.x, state.units)}, ${fmt(world.y, state.units)}`;

  if (!drag) {
    const gh = guideAt(e.offsetX, e.offsetY);
    if (gh !== hoverGuide) { hoverGuide = gh; }
    canvas.style.cursor = gh ? (gh.axis === "x" ? "ew-resize" : "ns-resize")
      : (tool === "select" ? "default" : "crosshair");
    needsRender = true; // keep ruler cursor markers live
    return;
  }
  if (drag.mode === "pan") {
    cam.panX = drag.panX + (e.clientX - drag.startX);
    cam.panY = drag.panY + (e.clientY - drag.startY);
  } else if (drag.mode === "guide") {
    drag.guide.pos = drag.guide.axis === "x" ? world.x : world.y;
  } else if (drag.mode === "node") {
    drag.obj.points[drag.index] = world;
    markDirty();
  } else if (drag.mode === "object") {
    const dx = world.x - drag.start.x, dy = world.y - drag.start.y;
    drag.obj.points = drag.orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    markDirty();
  } else if (drag.mode === "shape") {
    const s = drag.start;
    const box = { x: Math.min(s.x, world.x), y: Math.min(s.y, world.y),
      w: Math.abs(world.x - s.x) || 0.1, h: Math.abs(world.y - s.y) || 0.1 };
    drag.obj.points = buildShape(drag.kind, box);
    markDirty();
  }
  needsRender = true;
});

window.addEventListener("mouseup", () => {
  if (drag) {
    const inRuler = cursor && (cursor.sx < RULER || cursor.sy < RULER);
    if (drag.mode === "guide" && inRuler) {
      // dropping a guide back onto a ruler removes it
      state.guides = state.guides.filter((g) => g.id !== drag.guide.id);
    } else if (drag.mode === "shape") {
      const bb = bbox(drag.obj.points);
      if (bb.w < 1 && bb.h < 1) {
        state.objects = state.objects.filter((o) => o !== drag.obj);
        state.selectedId = null;
      }
      ensureCompiled(); refreshObjectList(); refreshObjectProps();
    } else if (drag.mode === "node" || drag.mode === "object") {
      ensureCompiled();
    }
  }
  drag = null;
  needsRender = true;
});

canvas.addEventListener("dblclick", (e) => {
  const gh = guideAt(e.offsetX, e.offsetY);
  if (gh) { state.guides = state.guides.filter((g) => g.id !== gh.id); hoverGuide = null; needsRender = true; return; }
  finalizeDraft();
});

canvas.addEventListener("mouseleave", () => { cursor = null; needsRender = true; });

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (draft) finalizeDraft();
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  cam.zoomAt(e.offsetX, e.offsetY, factor);
  document.getElementById("hud-zoom").textContent =
    Math.round(cam.pxPerMm / baseScale() * 100) + "%";
  needsRender = true;
}, { passive: false });

function baseScale() {
  const r = canvas.getBoundingClientRect();
  const hoop = getHoop(state.hoopId);
  return Math.min((r.width - 80) / hoop.w, (r.height - 80) / hoop.h);
}

function textBBox(obj) {
  if (!obj._glyphs) return null;
  const ax = obj.points[0] ? obj.points[0].x : 0;
  const ay = obj.points[0] ? obj.points[0].y : 0;
  const pts = obj._glyphs.flat().flat();
  if (!pts.length) return null;
  const bb = bbox(pts);
  return { minX: bb.minX + ax, minY: bb.minY + ay, maxX: bb.maxX + ax, maxY: bb.maxY + ay };
}

function hitTestObject(world) {
  // nearest object whose path passes within tolerance of the point
  const tolMm = NODE_HIT_PX / cam.pxPerMm;
  let best = null, bestD = Infinity;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    if (!obj.visible) continue;
    if (obj.type === "text") {
      const bb = textBBox(obj);
      if (bb && world.x >= bb.minX - tolMm && world.x <= bb.maxX + tolMm &&
          world.y >= bb.minY - tolMm && world.y <= bb.maxY + tolMm) {
        return obj;
      }
      continue;
    }
    for (let k = 0; k < obj.points.length; k++) {
      const d = dist(world, obj.points[k]);
      if (d < bestD) { bestD = d; best = obj; }
      if (k > 0) {
        const dd = pointSegDist(world, obj.points[k - 1], obj.points[k]);
        if (dd < bestD) { bestD = dd; best = obj; }
      }
    }
  }
  return bestD <= tolMm * 1.5 ? best : null;
}

function pointSegDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(p, a);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(p, b);
  const t = c1 / c2;
  return dist(p, { x: a.x + t * vx, y: a.y + t * vy });
}

// --------------------------------------------------------------- keyboard
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === " ") { spaceDown = true; }
  switch (e.key.toLowerCase()) {
    case "v": setTool("select"); break;
    case "r": setTool("running"); break;
    case "s": setTool("satin"); break;
    case "f": setTool("fill"); break;
    case "h": setTool("shape"); break;
    case "t": setTool("text"); break;
    case "enter": finalizeDraft(); break;
    case "escape": if (draft) { finalizeDraft(); } break;
    case "delete": case "backspace":
      if (state.selectedId) { deleteSelected(); e.preventDefault(); }
      break;
  }
});

function deleteSelected() {
  state.objects = state.objects.filter((o) => o.id !== state.selectedId);
  state.selectedId = null;
  markDirty(); ensureCompiled();
  refreshObjectList(); refreshObjectProps();
}

// ----------------------------------------------------------------- UI build
function buildThreadPicker() {
  const sel = document.getElementById("thread-picker");
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
    if (s) { s.color = sel.value; markDirty(); ensureCompiled(); refreshObjectList(); }
  });
  updateActiveSwatch();
}

function updateActiveSwatch() {
  document.getElementById("active-thread-swatch").style.background = state.activeColor;
}

function buildHoopPicker() {
  const sel = document.getElementById("hoop-picker");
  for (const h of HOOPS) {
    const opt = document.createElement("option");
    opt.value = h.id; opt.textContent = h.name;
    sel.appendChild(opt);
  }
  sel.value = state.hoopId;
  sel.addEventListener("change", () => {
    state.hoopId = sel.value;
    cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight, RULER);
    updateHoopDims();
    needsRender = true;
  });
  updateHoopDims();
}

function updateHoopDims() {
  const h = getHoop(state.hoopId);
  // Show the field in both units — Brother labels it "4 inch" but the true
  // stitchable area is exactly 100 mm (≈ 3.94"), so be transparent.
  document.getElementById("hoop-dims").textContent =
    `${SE700.model} • field ${fmt(h.w, "in")} × ${fmt(h.h, "in")} (${h.w} × ${h.h} mm) • max ${SE700.maxSpeedSpm} spm`;
}

function buildUnitToggle() {
  const wrap = document.getElementById("unit-toggle");
  const sync = () => wrap.querySelectorAll(".unit-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.unit === state.units));
  wrap.querySelectorAll(".unit-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.units = b.dataset.unit;
      sync(); updateHoopDims(); refreshStats(); refreshObjectProps(); needsRender = true;
    }));
  sync();
}

function buildShapePicker() {
  const kind = document.getElementById("shape-kind");
  for (const s of SHAPES) {
    const opt = document.createElement("option");
    opt.value = s.kind; opt.textContent = s.label;
    kind.appendChild(opt);
  }
  kind.value = shapeKind;
  kind.onchange = () => { shapeKind = kind.value; };
  const style = document.getElementById("shape-style");
  style.value = shapeStyle;
  style.onchange = () => { shapeStyle = style.value; };
}

function refreshObjectList() {
  const ul = document.getElementById("object-list");
  ul.innerHTML = "";
  document.getElementById("object-count").textContent = `(${state.objects.length})`;
  state.objects.forEach((obj) => {
    const li = document.createElement("li");
    li.className = "object-item" + (obj.id === state.selectedId ? " selected" : "");
    const sw = document.createElement("span");
    sw.className = "obj-sw"; sw.style.background = obj.color;
    const label = document.createElement("span");
    label.className = "obj-label"; label.textContent = obj.name;
    const vis = document.createElement("button");
    vis.className = "obj-vis"; vis.textContent = obj.visible ? "👁" : "—";
    vis.title = "Toggle visibility";
    vis.onclick = (e) => { e.stopPropagation(); obj.visible = !obj.visible; markDirty(); ensureCompiled(); refreshObjectList(); };
    li.append(sw, label, vis);
    li.onclick = () => { state.selectedId = obj.id; refreshObjectProps(); refreshObjectList(); needsRender = true; };
    ul.appendChild(li);
  });
}

function refreshObjectProps() {
  const host = document.getElementById("object-props");
  const obj = selectedObject();
  if (!obj) { host.className = "props-empty"; host.textContent = "No object selected."; return; }
  host.className = "";
  host.innerHTML = "";

  const row = (label, input) => {
    const d = document.createElement("div"); d.className = "prop-row";
    const l = document.createElement("label"); l.textContent = label;
    d.append(l, input); host.appendChild(d);
  };
  const num = (val, step, min, onInput) => {
    const i = document.createElement("input");
    i.type = "number"; i.value = val; i.step = step; if (min != null) i.min = min;
    i.oninput = () => { onInput(parseFloat(i.value)); markDirty(); ensureCompiled(); };
    return i;
  };
  // number input that delegates entirely to its callback (no auto recompile)
  const numCb = (val, step, min, onInput) => {
    const i = document.createElement("input");
    i.type = "number"; i.value = val; i.step = step; if (min != null) i.min = min;
    i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) onInput(v); };
    return i;
  };
  const chk = (checked, onChange) => {
    const i = document.createElement("input");
    i.type = "checkbox"; i.checked = !!checked;
    i.onchange = () => { onChange(i.checked); markDirty(); ensureCompiled(); };
    return i;
  };

  const nameI = document.createElement("input");
  nameI.type = "text"; nameI.value = obj.name;
  nameI.oninput = () => { obj.name = nameI.value; refreshObjectList(); };
  row("Name", nameI);

  const typeLabel = document.createElement("span");
  typeLabel.className = "type-badge"; typeLabel.textContent = obj.type;
  row("Type", typeLabel);

  if (obj.type === "running") {
    row("Stitch length (mm)", num(obj.params.stitchLength, 0.1, 0.5, (v) => obj.params.stitchLength = v));
    row("Repeats", num(obj.params.repeats, 1, 1, (v) => obj.params.repeats = Math.max(1, Math.round(v))));
  } else if (obj.type === "satin") {
    row("Width (mm)", num(obj.params.width, 0.5, 0.5, (v) => obj.params.width = v));
    row("Density (mm)", num(obj.params.density, 0.05, 0.2, (v) => obj.params.density = v));
    row("Pull comp. (mm)", num(obj.params.pull, 0.05, 0, (v) => obj.params.pull = v));
    row("Underlay", chk(obj.params.underlay, (v) => obj.params.underlay = v));
  } else if (obj.type === "fill") {
    row("Row spacing (mm)", num(obj.params.spacing, 0.05, 0.25, (v) => obj.params.spacing = v));
    row("Stitch length (mm)", num(obj.params.stitchLength, 0.1, 1, (v) => obj.params.stitchLength = v));
    row("Angle (°)", num(obj.params.angle, 5, -180, (v) => obj.params.angle = v));
    row("Underlay", chk(obj.params.underlay, (v) => obj.params.underlay = v));
  } else if (obj.type === "text") {
    const textI = document.createElement("input");
    textI.type = "text"; textI.value = obj.params.text;
    textI.oninput = () => { obj.params.text = textI.value; buildTextGlyphs(obj); };
    row("Text", textI);

    const fontSel = document.createElement("select");
    fontSel.className = "select";
    for (const f of FONTS) {
      const opt = document.createElement("option");
      opt.value = f.name; opt.textContent = `${f.name} — ${f.category}`;
      fontSel.appendChild(opt);
    }
    fontSel.value = obj.params.font;
    fontSel.onchange = () => { obj.params.font = fontSel.value; buildTextGlyphs(obj); };
    row("Font", fontSel);

    const rebuild = (v, set) => { set(v); buildTextGlyphs(obj); };
    const u = state.units;
    const heightStep = u === "in" ? 0.05 : 1;
    row(`Height (${u})`, numCb(toUnit(obj.params.size, u), heightStep, 0.05,
      (v) => rebuild(v, () => obj.params.size = fromUnit(v, u))));
    row(`Letter spacing (${u})`, numCb(toUnit(obj.params.letterSpacing, u), u === "in" ? 0.02 : 0.2, null,
      (v) => rebuild(v, () => obj.params.letterSpacing = fromUnit(v, u))));
    row("Row spacing (mm)", num(obj.params.spacing, 0.05, 0.25, (v) => obj.params.spacing = v));
    row("Fill angle (°)", num(obj.params.angle, 5, -180, (v) => obj.params.angle = v));

    const outI = document.createElement("input");
    outI.type = "checkbox"; outI.checked = !!obj.params.outline;
    outI.onchange = () => { obj.params.outline = outI.checked; markDirty(); ensureCompiled(); };
    row("Outline pass", outI);
  }

  const del = document.createElement("button");
  del.className = "btn btn-danger"; del.textContent = "Delete object";
  del.onclick = deleteSelected;
  host.appendChild(del);
}

function updateSimColor(s) {
  const host = document.getElementById("sim-color");
  if (!compiled || s.index === 0) { host.textContent = ""; host.style.background = "transparent"; return; }
  const entry = compiled.plan[Math.min(s.index - 1, compiled.plan.length - 1)];
  const c = compiled.colors[entry.color];
  if (c) {
    host.style.background = c.color;
    host.textContent = `#${c.brother.i} ${c.brother.name}`;
  }
}

// ----------------------------------------------------------------- toolbar
document.querySelectorAll(".tool").forEach((b) =>
  b.addEventListener("click", () => setTool(b.dataset.tool)));

[["chk-show-image", "showImage"], ["chk-show-stitches", "showStitches"],
 ["chk-show-jumps", "showJumps"], ["chk-show-points", "showPoints"],
 ["chk-show-grid", "showGrid"]].forEach(([id, key]) => {
  document.getElementById(id).addEventListener("change", (e) => {
    view[key] = e.target.checked; needsRender = true;
  });
});

// ----------------------------------------------------------------- sim bar
document.getElementById("sim-play").onclick = () => sim.toggle();
document.getElementById("sim-start").onclick = () => sim.toStart();
document.getElementById("sim-end").onclick = () => sim.toEnd();
document.getElementById("sim-scrub").oninput = (e) => sim.seek(parseInt(e.target.value, 10));
document.getElementById("sim-speed").oninput = (e) => { sim.speed = parseInt(e.target.value, 10); };

// ----------------------------------------------------------------- top bar
document.getElementById("btn-new").onclick = () => {
  if (!confirm("Start a new design? Unsaved work will be lost.")) return;
  state.objects = []; state.selectedId = null; state.image = null;
  markDirty(); ensureCompiled(); refreshObjectList(); refreshObjectProps();
  toast("New design");
};

document.getElementById("btn-import-image").onclick = () =>
  document.getElementById("file-image").click();
document.getElementById("file-image").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    state.image = img;
    // place so the image roughly fits the hoop width
    const hoop = getHoop(state.hoopId);
    const sc = (hoop.w * 0.8) / img.width;
    state.imageTransform = { x: hoop.w * 0.1, y: hoop.h * 0.1, scale: sc, opacity: 0.5 };
    needsRender = true; toast("Image imported — trace over it with the tools");
  };
  img.src = URL.createObjectURL(f);
};

document.getElementById("btn-save-json").onclick = () => {
  download(serialize(), "design.gsew", "application/json");
  toast("Project saved");
};
document.getElementById("btn-load-json").onclick = () =>
  document.getElementById("file-json").click();
document.getElementById("file-json").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      deserialize(reader.result);
      buildHoopPicker(); ensureCompiled(); refreshObjectList(); refreshObjectProps();
      cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight, RULER);
      toast("Project loaded");
    } catch (err) { toast("Could not load file: " + err.message, true); }
  };
  reader.readAsText(f);
};

// ----------------------------------------------------------------- preview
let previewProduct = "tshirt";
function buildPreviewProducts() {
  const host = document.getElementById("preview-products");
  host.innerHTML = "";
  for (const p of PRODUCTS) {
    const b = document.createElement("button");
    b.className = "pp-btn" + (p.id === previewProduct ? " active" : "");
    b.textContent = p.label;
    b.onclick = () => { previewProduct = p.id; buildPreviewProducts(); drawPreview(); };
    host.appendChild(b);
  }
  document.getElementById("preview-custom").classList.toggle("hidden", getProduct(previewProduct).custom !== true);
}

function drawPreview() {
  ensureCompiled();
  const canvas = document.getElementById("preview-canvas");
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  const ctx = canvas.getContext("2d");
  const product = getProduct(previewProduct);
  const cu = state.units;
  const customW = fromUnit(parseFloat(document.getElementById("custom-w").value) || 6, cu);
  const customH = fromUnit(parseFloat(document.getElementById("custom-h").value) || 4, cu);
  renderPreview(ctx, compiled, product, { customW, customH });

  const st = computeStats(compiled);
  document.getElementById("preview-scale").textContent =
    st.width > 0 ? `— design ${fmt(st.width, cu)} × ${fmt(st.height, cu)}` : "";
  document.getElementById("custom-unit").textContent = cu;
}

function openPreview() {
  ensureCompiled();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing to preview — draw something first.", true); return; }
  document.getElementById("preview-modal").classList.remove("hidden");
  buildPreviewProducts();
  requestAnimationFrame(drawPreview); // after layout
}

document.getElementById("btn-preview").onclick = openPreview;
document.getElementById("preview-close").onclick = () =>
  document.getElementById("preview-modal").classList.add("hidden");
document.getElementById("preview-modal").addEventListener("click", (e) => {
  if (e.target.id === "preview-modal") e.currentTarget.classList.add("hidden");
});
document.getElementById("custom-w").oninput = drawPreview;
document.getElementById("custom-h").oninput = drawPreview;

document.getElementById("btn-export-pes").onclick = () => {
  ensureCompiled();
  const st = computeStats(compiled);
  if (st.stitches === 0) { toast("Nothing to export — draw something first.", true); return; }
  const hoop = getHoop(state.hoopId);
  if (st.width > hoop.w + 0.5 || st.height > hoop.h + 0.5) {
    if (!confirm(`Design (${st.width.toFixed(0)}×${st.height.toFixed(0)} mm) exceeds the ${hoop.name} field. Export anyway?`)) return;
  }
  const bytes = exportPES(compiled, "GoodSew");
  download(bytes, "design.pes", "application/octet-stream");
  toast(`Exported design.pes — ${st.stitches.toLocaleString()} stitches, ${st.threadColors} colors`);
};

// ----------------------------------------------------------------- helpers
function download(data, filename, mime) {
  const blob = data instanceof Uint8Array
    ? new Blob([data], { type: mime })
    : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = null;
function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.toggle("error", !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

// ----------------------------------------------------------------- main loop
function frame() {
  if (needsRender) {
    ensureCompiled();
    render(ctx, state, compiled, sim, { cam, view, cursor, hoverGuide, unit: UNITS[state.units] });
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- boot
function boot() {
  buildThreadPicker();
  buildHoopPicker();
  buildUnitToggle();
  buildShapePicker();
  setTool("select");
  resize();
  recompile();
  refreshObjectList();
  refreshObjectProps();
  seedDemo();
  frame();

  // Lightweight debug hook used by the e2e test harness.
  window.__gs = {
    state,
    sim,
    setTool,
    setActiveColor: (hex) => { state.activeColor = hex; updateActiveSwatch(); },
    compiledStats: () => { ensureCompiled(); return computeStats(compiled); },
    exportBytes: () => { ensureCompiled(); return Array.from(exportPES(compiled, "GoodSew")); },
  };
}

// A starter design so the canvas isn't empty on first load — also showcases
// shapes, fills and lettering within the SE700's 100×100 mm field.
function seedDemo() {
  if (state.objects.length) return;
  const cx = getHoop(state.hoopId).w / 2;

  // gold star
  const star = makeObject("fill", buildShape("star5", { x: cx - 22, y: 16, w: 44, h: 44 }), rgbToHex([254, 186, 53]));
  star.name = "Star";
  star.params.angle = 30;
  const starOutline = makeObject("running", buildShape("star5", { x: cx - 22, y: 16, w: 44, h: 44 }), rgbToHex([209, 92, 0]));
  starOutline.name = "Star outline";

  // lettering
  const text = makeObject("text", [{ x: cx - 26, y: 82 }], rgbToHex([14, 31, 124]));
  text.name = "SE700";
  text.params.text = "SE700";
  text.params.font = "Anton";
  text.params.size = 15;

  state.objects.push(star, starOutline, text);
  markDirty(); recompile(); refreshObjectList();
  buildTextGlyphs(text);
}

window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

boot();
