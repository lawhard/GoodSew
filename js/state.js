import {validateRails} from './satin.js';
// Central application state + design data model.
//
// A Design is a list of vector "objects". Each object owns a simple editing
// transform (center, size, rotation) plus type-specific content, and a thread
// color. The app keeps two phases:
//   - "design"  : objects are shown as solid vector art for easy layout/editing.
//   - "stitch"  : objects are compiled into a flat stitch plan (see compiler.js)
//                 and simulated/exported.
//
// For compatibility with the stitch pipeline, every object also exposes BAKED
// geometry that the compiler reads directly:
//   - shapes (type "fill"): obj.points  = final (rotated) polygon, in mm
//   - text   (type "text"): obj.points  = [anchor], obj._glyphs = baked contours
// The bake step lives in app.js (rebuildShape / buildTextGlyphs).

import { nearestBrother } from "./threads.js";

let _id = 1;
export const nextId = () => _id++;

export function defaultParams(type) {
  switch (type) {
    case "running":
      return { stitchLength: 2.5, repeats: 1 };
    case "satin":
      return { width: 4, density: 0.4, pull: 0.2, underlay: true };
    case "fill":
      // outline = add a tidy running edge pass on top of the fill
      // satinMaxWidth = regions narrower than this auto-stitch as satin
      // borderWidth = satin band width when fillMode === "outline"
      return { spacing: 0.45, angle: 0, stitchLength: 3.0, underlay: true, outline: false,
               satinMaxWidth: 6, borderWidth: 2, fillMode: "fill", stitchType: "auto", crosshatch: false };
    case "text":
      return {
        text: "Text", font: "Anton", size: 16, letterSpacing: 0,
        spacing: 0.4, stitchLength: 2.5, angle: 0, underlay: true, satinMaxWidth: 6, stitchType: "auto", crosshatch: false,
        bold: false, italic: false, underline: false, curve: 0,
        outline: false, outlineLen: 2.0,
      };
    default:
      return {};
  }
}

// Create a new embroidery object. `type` is the COMPILE type ("fill" | "text").
export function makeObject(type, points, color = "#1f3f7c") {
  return {
    id: nextId(),
    type,
    name: `${type[0].toUpperCase()}${type.slice(1)} ${_id}`,
    color,
    points: points || [],   // baked geometry (see header)
    rotation: 0,            // degrees, clockwise
    params: defaultParams(type),
    visible: true,
  };
}

export const state = {
  name: "My design",
  fabric: "woven",
  fabricColor: null,   // preview ground colour (null = default white field)
  hoopId: "se700",
  units: "in",           // 'in' (default) | 'mm' — display only; model is mm
  theme: "light",        // 'light' (default) | 'dark'
  mode: "design",        // 'design' (layout) | 'stitch' (rendered pattern)
  objects: [],
  guides: [],            // [{ id, axis:'x'|'y', pos }]
  selectedId: null,      // primary selection (last clicked)
  selectedIds: [],       // full multi-selection
  activeColor: "#0e1f7c",
  image: null,           // HTMLImageElement (tracing background)
  imageTransform: { x: 0, y: 0, scale: 1, opacity: 0.5 },
  view: { panX: 0, panY: 0, zoom: 1 },
  plan: null,
  planDirty: true,
};

export function selectedObject() {
  return state.objects.find((o) => o.id === state.selectedId) || null;
}

export function markDirty() {
  state.planDirty = true;
}

// Distinct ordered thread color list as used by the design (object order).
// Consecutive objects of the same color share a color block (no thread change).
export function colorBlocks(objects = state.objects) {
  const blocks = [];
  for (const obj of objects) {
    if (!obj.visible) continue;
    if (obj.type === "text") {
      if (!obj._glyphs || obj._glyphs.length === 0) continue;
    } else if (obj.points.length < 2) {
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.color === obj.color) {
      last.objects.push(obj);
    } else {
      blocks.push({ color: obj.color, brother: nearestBrother(hexToArr(obj.color)), objects: [obj] });
    }
  }
  return blocks;
}

function hexToArr(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function serialize() {
  return JSON.stringify({
    version: 4,
    name: state.name, fabric: state.fabric, fabricColor: state.fabricColor || undefined,
    hoopId: "se700",
    units: state.units,
    theme: state.theme,
    guides: state.guides,
    objects: state.objects.map((o) => ({
      type: o.type, name: o.name, color: o.color,
      points: o.points, contours: o.contours, rotation: o.rotation || 0,
      kind: o.kind, box: o.box, groupId: o.groupId, base: o._base,
      params: o.params, visible: o.visible,
    })),
  }, null, 2);
}

export function deserialize(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  validateProject(data);
  // Validate everything before changing the current document.
  state.name = typeof data.name === "string" ? data.name.slice(0, 80) : "My design";
  state.fabric = ["woven", "knit", "towel"].includes(data.fabric) ? data.fabric : "woven";
  state.fabricColor = typeof data.fabricColor === "string" && /^#[0-9a-f]{6}$/i.test(data.fabricColor) ? data.fabricColor.toLowerCase() : null;
  state.hoopId = "se700";
  state.units = data.units === "mm" ? "mm" : "in";
  if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
  state.guides = data.guides || [];
  state.objects = (data.objects || []).map((o) => ({
    id: nextId(),
    type: o.type,
    name: o.name || `${o.type} ${_id}`,
    color: o.color || "#1f3f7c",
    points: o.points || [],
    contours: o.contours,
    rotation: o.rotation || 0,
    kind: o.kind,
    box: o.box,
    groupId: o.groupId == null ? undefined : `loaded-${o.groupId}`,
    _base: o.base,
    params: { ...defaultParams(o.type), ...(o.params || {}) },
    visible: o.visible !== false,
  }));
  state.selectedId = null;
  state.selectedIds = [];
  state.mode = "design";
  markDirty();
}

// Imported projects are data, never executable instructions. Bound complexity
// and reject malformed geometry atomically so a failed Open preserves work.
export function validateProject(data) {
  if (!data || !Array.isArray(data.objects)) throw new Error("Expected a Good Sew project with an objects list.");
  if (data.objects.length > 1000) throw new Error("Project exceeds 1,000 objects.");
  if (data.version != null && (!Number.isInteger(data.version) || data.version > 4 || data.version < 1)) throw new Error("Unsupported project version.");
  let points = 0;
  const checkPoints = (ps) => {
    if (!Array.isArray(ps)) throw new Error("Invalid point list.");
    points += ps.length;
    if (points > 200000) throw new Error("Project geometry is too complex.");
    for (const pt of ps) if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || Math.abs(pt.x) > 10000 || Math.abs(pt.y) > 10000) throw new Error("Invalid coordinates.");
  };
  for (const o of data.objects) {
    if (!o || !["fill", "text", "running", "satin"].includes(o.type)) throw new Error("Unknown object type.");
    checkPoints(o.points || []);
    for (const cs of [o.base, o.contours]) if (cs != null) { if (!Array.isArray(cs)) throw new Error("Invalid contours."); cs.forEach(checkPoints); }
    if(o.kind === "satin-rails") { validateRails(o.base || o._base, 0.000001); if(!o.box)throw Error("Satin rails need a box."); }
    if (o.box) for (const k of ["x", "y", "w", "h"]) if (!Number.isFinite(o.box[k]) || Math.abs(o.box[k]) > 10000 || ((k === "w" || k === "h") && o.box[k] < 0)) throw new Error("Invalid object size.");
    if (o.rotation != null && !Number.isFinite(o.rotation)) throw new Error("Invalid rotation.");
    if (o.color != null && !/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error("Invalid thread color.");
    if (o.params != null && (typeof o.params !== "object" || Array.isArray(o.params))) throw new Error("Invalid stitch settings.");
    for (const [k,v] of Object.entries(o.params || {})) {
      if (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) > 10000)) throw new Error("Invalid stitch setting: " + k);
      if (["spacing", "density", "stitchLength", "size", "width", "borderWidth"].includes(k) && (!Number.isFinite(v) || v <= 0)) throw new Error("Stitch sizes must be positive.");
      if (k === "repeats" && (!Number.isInteger(v) || v < 1 || v > 9)) throw new Error("Use 1–9 running-stitch passes.");
      if (k === "returnPass" && typeof v !== "boolean") throw new Error("Return pass must be on or off.");
      if (k === "underlayStyle" && !['full','edge'].includes(v)) throw new Error("Choose full or edge-only fill underlay.");
      if (k === "curveTolerance" && (!Number.isFinite(v) || (v !== 0 && (v < .05 || v > .5)))) throw new Error("Curve tolerance must be 0 (legacy) or 0.05–0.5 mm.");
      if (k === "text" && (typeof v !== "string" || v.length > 500)) throw new Error("Text is limited to 500 characters.");
    }
  }
  if (data.guides != null && (!Array.isArray(data.guides) || data.guides.length > 500 || data.guides.some(g => !g || !["x","y"].includes(g.axis) || !Number.isFinite(g.pos)))) throw new Error("Invalid guides.");
}
