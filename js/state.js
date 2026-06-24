// Central application state + design data model.
//
// A Design is a list of vector "objects". Each object owns its geometry (in mm,
// design space) and stitch parameters, plus a thread color. Objects are compiled
// on demand into a flat stitch plan (see compiler.js).

import { nearestBrother } from "./threads.js";

let _id = 1;
export const nextId = () => _id++;

export function defaultParams(type) {
  switch (type) {
    case "running":
      return { stitchLength: 2.5, repeats: 1 };
    case "satin":
      return { width: 4, density: 0.4, pull: 0 }; // density = mm between zig-zag points
    case "fill":
      return { spacing: 0.45, angle: 0, stitchLength: 3.0, underlay: true };
    case "text":
      return {
        text: "Text", font: "Anton", size: 16, letterSpacing: 0,
        spacing: 0.4, stitchLength: 2.5, angle: 0,
        outline: false, outlineLen: 2.0,
      };
    default:
      return {};
  }
}

// Create a new embroidery object.
export function makeObject(type, points, color = "#1f3f7c") {
  return {
    id: nextId(),
    type,                  // 'running' | 'satin' | 'fill'
    name: `${type[0].toUpperCase()}${type.slice(1)} ${_id}`,
    color,                 // hex; mapped to nearest Brother index on export
    points: points || [],  // array of {x,y} mm
    params: defaultParams(type),
    visible: true,
  };
}

export const state = {
  hoopId: "se700",
  units: "in",           // 'in' (default) | 'mm' — display only; model is mm
  objects: [],
  guides: [],            // [{ id, axis:'x'|'y', pos }]  x=vertical line, y=horizontal
  selectedId: null,
  activeColor: "#1f3f7c",
  // background tracing image
  image: null,           // HTMLImageElement
  imageTransform: { x: 0, y: 0, scale: 1, opacity: 0.5 }, // placement in mm
  // view
  view: { panX: 0, panY: 0, zoom: 1 }, // zoom px-per-mm multiplier baseline set on resize
  // compiled plan cache
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
    // text validity depends on its cached glyphs, not its anchor point count
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
    version: 2,
    hoopId: "se700",
    units: state.units,
    guides: state.guides,
    objects: state.objects.map((o) => ({
      type: o.type, name: o.name, color: o.color,
      points: o.points, params: o.params, visible: o.visible,
    })),
  }, null, 2);
}

export function deserialize(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  state.hoopId = "se700"; // this build targets the SE700 only
  state.units = data.units === "mm" ? "mm" : "in";
  state.guides = data.guides || [];
  state.objects = (data.objects || []).map((o) => ({
    id: nextId(),
    type: o.type,
    name: o.name || `${o.type} ${_id}`,
    color: o.color || "#1f3f7c",
    points: o.points || [],
    params: { ...defaultParams(o.type), ...(o.params || {}) },
    visible: o.visible !== false,
  }));
  state.selectedId = null;
  markDirty();
}
