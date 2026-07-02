// Shape presets. Each builds an outline polygon (array of {x,y} mm) to fit a
// bounding box {x, y, w, h}. Shapes become ordinary editable polygon objects.

export const SHAPES = [
  // Basics
  { kind: "rect",      label: "Rectangle",     cat: "Basics" },
  { kind: "roundrect", label: "Rounded Rect",  cat: "Basics" },
  { kind: "ellipse",   label: "Ellipse",       cat: "Basics" },
  { kind: "triangle",  label: "Triangle",      cat: "Basics" },
  { kind: "diamond",   label: "Diamond",       cat: "Basics" },
  { kind: "semicircle",label: "Semicircle",    cat: "Basics" },
  { kind: "pentagon",  label: "Pentagon",      cat: "Basics" },
  { kind: "hexagon",   label: "Hexagon",       cat: "Basics" },
  { kind: "octagon",   label: "Octagon",       cat: "Basics" },
  // Stars & symbols
  { kind: "star4",     label: "Sparkle",       cat: "Stars & Symbols" },
  { kind: "star5",     label: "5-Point Star",  cat: "Stars & Symbols" },
  { kind: "star6",     label: "6-Point Star",  cat: "Stars & Symbols" },
  { kind: "heart",     label: "Heart",         cat: "Stars & Symbols" },
  { kind: "plus",      label: "Plus / Cross",  cat: "Stars & Symbols" },
  { kind: "arrow",     label: "Arrow",         cat: "Stars & Symbols" },
  { kind: "bolt",      label: "Lightning",     cat: "Stars & Symbols" },
  { kind: "shield",    label: "Shield",        cat: "Stars & Symbols" },
  // Fun
  { kind: "crescent",  label: "Crescent Moon", cat: "Fun" },
  { kind: "drop",      label: "Raindrop",      cat: "Fun" },
  { kind: "cloud",     label: "Cloud",         cat: "Fun" },
  { kind: "flower",    label: "Flower",        cat: "Fun" },
  { kind: "gear",      label: "Gear",          cat: "Fun" },
  { kind: "bubble",    label: "Speech Bubble", cat: "Fun" },
  { kind: "line",      label: "Line",          cat: "Basics" },
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

    case "star4":
      return star(cx, cy, rx, ry, 4, 0.3);

    case "star5":
      return star(cx, cy, rx, ry, 5, 0.42);

    case "star6":
      return star(cx, cy, rx, ry, 6, 0.5);

    case "heart":
      return heart(cx, cy, rx, ry);

    case "octagon":
      return polygonFromAngles(cx, cy, rx, ry, 8, -Math.PI / 8);

    case "semicircle": {
      const out = [];
      for (let i = 0; i <= 32; i++) {
        const a = Math.PI - (i / 32) * Math.PI;
        out.push({ x: cx + Math.cos(a) * rx, y: y + h - Math.sin(a) * h });
      }
      return out;
    }

    case "plus": {
      const t = 0.32; // arm thickness (fraction)
      const ax = w * t / 2, ay = h * t / 2;
      return [
        { x: cx - ax, y }, { x: cx + ax, y }, { x: cx + ax, y: cy - ay },
        { x: x + w, y: cy - ay }, { x: x + w, y: cy + ay }, { x: cx + ax, y: cy + ay },
        { x: cx + ax, y: y + h }, { x: cx - ax, y: y + h }, { x: cx - ax, y: cy + ay },
        { x, y: cy + ay }, { x, y: cy - ay }, { x: cx - ax, y: cy - ay },
      ];
    }

    case "arrow": {
      const head = w * 0.45, shaft = h * 0.4;
      return [
        { x, y: cy - shaft / 2 }, { x: x + w - head, y: cy - shaft / 2 },
        { x: x + w - head, y }, { x: x + w, y: cy },
        { x: x + w - head, y: y + h }, { x: x + w - head, y: cy + shaft / 2 },
        { x, y: cy + shaft / 2 },
      ];
    }

    case "bolt":
      return [
        { x: x + w * 0.58, y }, { x: x + w * 0.18, y: y + h * 0.56 },
        { x: x + w * 0.46, y: y + h * 0.56 }, { x: x + w * 0.36, y: y + h },
        { x: x + w * 0.84, y: y + h * 0.38 }, { x: x + w * 0.54, y: y + h * 0.38 },
        { x: x + w * 0.78, y },
      ];

    case "shield": {
      const out = [{ x, y: y + h * 0.12 }, { x: cx, y }, { x: x + w, y: y + h * 0.12 }];
      for (let i = 0; i <= 24; i++) {
        const t2 = i / 24;
        // taper the sides into the bottom point
        const yy = y + h * (0.12 + 0.88 * t2);
        const half = rx * (1 - Math.pow(t2, 1.7));
        out.push({ x: cx + half, y: yy });
      }
      for (let i = 24; i >= 0; i--) {
        const t2 = i / 24;
        const yy = y + h * (0.12 + 0.88 * t2);
        const half = rx * (1 - Math.pow(t2, 1.7));
        out.push({ x: cx - half, y: yy });
      }
      return out;
    }

    case "crescent": {
      const out = [];
      for (let i = 0; i <= 40; i++) { // outer arc: bottom → left → top
        const a = ((90 + (i / 40) * 180) * Math.PI) / 180;
        out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      for (let i = 40; i >= 0; i--) { // inner bite, shifted toward the right
        const a = ((90 + (i / 40) * 180) * Math.PI) / 180;
        out.push({ x: cx + rx * 0.45 + Math.cos(a) * rx * 0.75, y: cy + Math.sin(a) * ry * 0.75 });
      }
      return out;
    }

    case "drop": {
      // point at the top, round belly at the bottom
      const out = [{ x: cx, y }];
      const ccy = y + h * 0.63, bry = h * 0.37;
      for (let i = 0; i <= 36; i++) {
        const deg = 200 - (i / 36) * 220; // 200° → -20°, sweeping through the bottom
        const a = (deg * Math.PI) / 180;
        out.push({ x: cx + Math.cos(a) * rx, y: ccy + Math.sin(a) * bry });
      }
      return out;
    }

    case "cloud": {
      // three overlapping bumps on a flat-ish base
      const out = [];
      const bumps = [
        { bx: 0.26, by: 0.62, r: 0.26, a0: Math.PI * 0.95, a1: Math.PI * 1.85 },
        { bx: 0.52, by: 0.42, r: 0.32, a0: Math.PI * 1.05, a1: Math.PI * 1.95 },
        { bx: 0.78, by: 0.62, r: 0.24, a0: Math.PI * 1.15, a1: Math.PI * 2.05 },
      ];
      for (const b of bumps) {
        for (let i = 0; i <= 14; i++) {
          const a = b.a0 + (b.a1 - b.a0) * (i / 14);
          out.push({ x: x + w * b.bx + Math.cos(a) * w * b.r, y: y + h * b.by + Math.sin(a) * h * b.r });
        }
      }
      out.push({ x: x + w * 0.94, y: y + h * 0.86 }, { x: x + w * 0.08, y: y + h * 0.86 });
      return out;
    }

    case "flower": {
      const petals = 6, out = [];
      for (let i = 0; i < petals * 2; i++) {
        const a = -Math.PI / 2 + (i / (petals * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : 0.45;
        // rounded petals: add midpoints bulging outward
        if (i % 2 === 0) {
          const aPrev = a - Math.PI / petals / 2, aNext = a + Math.PI / petals / 2;
          out.push({ x: cx + Math.cos(aPrev) * rx * 0.8, y: cy + Math.sin(aPrev) * ry * 0.8 });
          out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
          out.push({ x: cx + Math.cos(aNext) * rx * 0.8, y: cy + Math.sin(aNext) * ry * 0.8 });
        } else {
          out.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
        }
      }
      return out;
    }

    case "gear": {
      const teeth = 8, out = [];
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2 - Math.PI / 2;
        const step = Math.PI * 2 / teeth;
        const pts = [
          [a0 + step * 0.05, 0.72], [a0 + step * 0.15, 1], [a0 + step * 0.42, 1],
          [a0 + step * 0.52, 0.72], [a0 + step * 0.95, 0.72],
        ];
        for (const [a, r] of pts) out.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
      }
      return out;
    }

    case "bubble": {
      const bodyH = h * 0.78;
      const base = roundedRect(x, y, w, bodyH, Math.min(w, bodyH) * 0.24);
      // splice in a tail on the bottom edge
      const out = [];
      for (const p of base) out.push(p);
      // find insertion: rebuild with tail — simplest: append tail polygon points
      // by cutting the bottom edge between 30% and 45% of width
      const tail = [
        { x: x + w * 0.42, y: y + bodyH - 0.01 },
        { x: x + w * 0.30, y: y + h },
        { x: x + w * 0.28, y: y + bodyH - 0.01 },
      ];
      // insert tail after the bottom-right corner arc (points ordered cw from top-right)
      const bottomY = y + bodyH;
      let idx = out.findIndex((p, i) => i > 0 && Math.abs(p.y - bottomY) < 0.02 && out[i - 1].y < p.y);
      if (idx < 0) idx = out.length;
      out.splice(idx, 0, ...tail.reverse());
      return out;
    }

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
