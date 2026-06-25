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
               satinMaxWidth: 6, borderWidth: 2, fillMode: "fill" };
    case "text":
      return {
        text: "Text", font: "Anton", size: 16, letterSpacing: 0,
        spacing: 0.4, stitchLength: 2.5, angle: 0, underlay: true, satinMaxWidth: 6,
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
export function colorBlocks() {
  const blocks = [];
  for (const obj of state.objects) {
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
    version: 3,
    hoopId: "se700",
    units: state.units,
    theme: state.theme,
    guides: state.guides,
    objects: state.objects.map((o) => ({
      type: o.type, name: o.name, color: o.color,
      points: o.points, rotation: o.rotation || 0,
      kind: o.kind, box: o.box, groupId: o.groupId,
      params: o.params, visible: o.visible,
    })),
  }, null, 2);
}

export function deserialize(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  state.hoopId = "se700"; // this build targets the SE700 only
  state.units = data.units === "mm" ? "mm" : "in";
  if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
  state.guides = data.guides || [];
  state.objects = (data.objects || []).map((o) => ({
    id: nextId(),
    type: o.type === "text" ? "text" : "fill",
    name: o.name || `${o.type} ${_id}`,
    color: o.color || "#1f3f7c",
    points: o.points || [],
    rotation: o.rotation || 0,
    kind: o.kind,
    box: o.box,
    groupId: o.groupId,
    params: { ...defaultParams(o.type === "text" ? "text" : "fill"), ...(o.params || {}) },
    visible: o.visible !== false,
  }));
  state.selectedId = null;
  state.selectedIds = [];
  state.mode = "design";
  markDirty();
}
