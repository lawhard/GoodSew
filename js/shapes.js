// Shape presets. Each builds an outline polygon (array of {x,y} mm) to fit a
// bounding box {x, y, w, h}. Shapes become ordinary editable polygon objects.

export const SHAPES = [
  { kind: "rect",     label: "Rectangle" },
  { kind: "roundrect",label: "Rounded Rect" },
  { kind: "ellipse",  label: "Ellipse / Circle" },
  { kind: "triangle", label: "Triangle" },
  { kind: "diamond",  label: "Diamond" },
  { kind: "pentagon", label: "Pentagon" },
  { kind: "hexagon",  label: "Hexagon" },
  { kind: "star5",    label: "5-Point Star" },
  { kind: "star6",    label: "6-Point Star" },
  { kind: "heart",    label: "Heart" },
  { kind: "line",     label: "Line" },
];

export function buildShape(kind, box) {
  const { x, y, w, h } = box;
  const cx = x + w / 2, cy = y + h / 2;
  const rx = w / 2, ry = h / 2;

  switch (kind) {
    case "rect":
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

    case "roundrect": {
      const r = Math.min(w, h) * 0.2;
      return roundedRect(x, y, w, h, r);
    }

    case "ellipse":
      return polygonFromAngles(cx, cy, rx, ry, 64, -Math.PI / 2);

    case "triangle":
      return [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }];

    case "diamond":
      return [{ x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy }];

    case "pentagon":
      return regularPolygon(cx, cy, rx, ry, 5);

    case "hexagon":
      return regularPolygon(cx, cy, rx, ry, 6);

    case "star5":
      return star(cx, cy, rx, ry, 5, 0.42);

    case "star6":
      return star(cx, cy, rx, ry, 6, 0.5);

    case "heart":
      return heart(cx, cy, rx, ry);

    case "line":
      return [{ x, y: cy }, { x: x + w, y: cy }];

    default:
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
}

function polygonFromAngles(cx, cy, rx, ry, n, startAngle = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

function regularPolygon(cx, cy, rx, ry, n) {
  return polygonFromAngles(cx, cy, rx, ry, n, -Math.PI / 2);
}

function star(cx, cy, rx, ry, points, innerRatio) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : innerRatio;
    out.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
  }
  return out;
}

function heart(cx, cy, rx, ry) {
  const out = [];
  for (let a = 0; a <= 360; a += 6) {
    const t = (a * Math.PI) / 180;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    out.push({ x: cx + (x / 17) * rx, y: cy + (y / 17) * ry });
  }
  return out;
}

function roundedRect(x, y, w, h, r) {
  const pts = [];
  const seg = 6;
  const corners = [
    { cx: x + w - r, cy: y + r, a0: -Math.PI / 2, a1: 0 },
    { cx: x + w - r, cy: y + h - r, a0: 0, a1: Math.PI / 2 },
    { cx: x + r, cy: y + h - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: x + r, cy: y + r, a0: Math.PI, a1: (3 * Math.PI) / 2 },
  ];
  for (const c of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = c.a0 + (c.a1 - c.a0) * (i / seg);
      pts.push({ x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r });
    }
  }
  return pts;
}
