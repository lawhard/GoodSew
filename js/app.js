// GoodSew — SE700 embroidery digitizer. Main application controller.

import { state, makeObject, selectedObject, markDirty, serialize, deserialize } from "./state.js";
import { HOOPS, getHoop } from "./hoop.js";
import { BROTHER_PALETTE, rgbToHex } from "./threads.js";
import { compile } from "./compiler.js";
import { computeStats, formatTime } from "./stats.js";
import { exportPES } from "./export/pes.js";
import { Camera, render } from "./render.js";
import { Simulator } from "./simulator.js";
import { dist } from "./geometry.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const cam = new Camera();

const view = {
  showImage: true, showStitches: true, showJumps: true, showPoints: false, showGrid: true,
};

let compiled = null;
let tool = "select";
let draft = null;          // in-progress object being drawn
let drag = null;           // { mode:'object'|'node'|'pan', ... }
let needsRender = true;
let spaceDown = false;

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
  if (!cam._fitted) { cam.fit(getHoop(state.hoopId), r.width, r.height); cam._fitted = true; }
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
    st.width > 0 ? `${st.width.toFixed(1)} × ${st.height.toFixed(1)} mm` : "—";
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
  };
  document.getElementById("hud-hint").textContent = hints[t] || "";
  canvas.style.cursor = t === "select" ? "default" : "crosshair";
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
  if (e.button === 1 || spaceDown) { // middle button / space-drag pan
    drag = { mode: "pan", startX: e.clientX, startY: e.clientY, panX: cam.panX, panY: cam.panY };
    return;
  }
  if (tool === "select") {
    // try node of selected
    const sel = selectedObject();
    if (sel) {
      for (let i = 0; i < sel.points.length; i++) {
        const sp = cam.toScreen(sel.points[i]);
        const mp = { x: e.offsetX, y: e.offsetY };
        if (dist(sp, mp) <= NODE_HIT_PX) {
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

canvas.addEventListener("mousemove", (e) => {
  const world = mouseWorld(e);
  document.getElementById("hud-coords").textContent =
    `${world.x.toFixed(1)}, ${world.y.toFixed(1)} mm`;
  if (!drag) {
    if (draft) needsRender = true; // show rubber-band
    return;
  }
  if (drag.mode === "pan") {
    cam.panX = drag.panX + (e.clientX - drag.startX);
    cam.panY = drag.panY + (e.clientY - drag.startY);
  } else if (drag.mode === "node") {
    drag.obj.points[drag.index] = world;
    markDirty();
  } else if (drag.mode === "object") {
    const dx = world.x - drag.start.x, dy = world.y - drag.start.y;
    drag.obj.points = drag.orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    markDirty();
  }
  needsRender = true;
});

window.addEventListener("mouseup", () => {
  if (drag && (drag.mode === "node" || drag.mode === "object")) { ensureCompiled(); }
  drag = null;
});

canvas.addEventListener("dblclick", () => finalizeDraft());

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

function hitTestObject(world) {
  // nearest object whose path passes within tolerance of the point
  const tolMm = NODE_HIT_PX / cam.pxPerMm;
  let best = null, bestD = Infinity;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    if (!obj.visible) continue;
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
    cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight);
    updateHoopDims();
    needsRender = true;
  });
  updateHoopDims();
}

function updateHoopDims() {
  const h = getHoop(state.hoopId);
  document.getElementById("hoop-dims").textContent =
    `${h.w} × ${h.h} mm field`;
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
  } else if (obj.type === "fill") {
    row("Row spacing (mm)", num(obj.params.spacing, 0.05, 0.25, (v) => obj.params.spacing = v));
    row("Stitch length (mm)", num(obj.params.stitchLength, 0.1, 1, (v) => obj.params.stitchLength = v));
    row("Angle (°)", num(obj.params.angle, 5, -180, (v) => obj.params.angle = v));
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
      cam.fit(getHoop(state.hoopId), canvas.clientWidth, canvas.clientHeight);
      toast("Project loaded");
    } catch (err) { toast("Could not load file: " + err.message, true); }
  };
  reader.readAsText(f);
};

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
    // draft rubber band: include cursor handled by overlay automatically
    render(ctx, state, compiled, sim, { cam, view });
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- boot
function boot() {
  buildThreadPicker();
  buildHoopPicker();
  setTool("select");
  resize();
  recompile();
  refreshObjectList();
  refreshObjectProps();
  seedDemo();
  frame();
}

// A tiny starter design so the canvas isn't empty on first load.
function seedDemo() {
  if (state.objects.length) return;
  const cx = getHoop(state.hoopId).w / 2, cy = 40;
  const heart = [];
  for (let a = 0; a <= 360; a += 12) {
    const t = (a * Math.PI) / 180;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heart.push({ x: cx + x, y: cy + y });
  }
  const fill = makeObject("fill", heart, rgbToHex([237, 23, 31]));
  fill.name = "Heart fill";
  const outline = makeObject("running", heart, rgbToHex([0, 0, 0]));
  outline.name = "Heart outline";
  outline.params.stitchLength = 2;
  state.objects.push(fill, outline);
  markDirty(); recompile(); refreshObjectList();
}

window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

boot();
