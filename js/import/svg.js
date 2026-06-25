// SVG import. Parses an SVG and converts its drawable geometry into GoodSew
// fill/outline objects. Uses the browser's SVG geometry API (getPointAtLength)
// to flatten arbitrary paths + shapes — no hand-written path parser — and
// detects sub-path breaks (and thus holes) from large jumps between samples.

const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  orange: "#ffa500", purple: "#800080", navy: "#000080", teal: "#008080",
};

function parseColor(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  if (str === "none" || str === "transparent") return null;
  if (str[0] === "#") {
    if (str.length === 4) return "#" + str.slice(1).split("").map((c) => c + c).join("");
    if (str.length === 7) return str;
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((v) => parseInt(v.trim(), 10));
    return "#" + [r, g, b].map((c) => (c & 0xff).toString(16).padStart(2, "0")).join("");
  }
  return NAMED[str] || null;
}

// Parse SVG text → { items: [{ base, color, outline }], box }.
//   base    = contours normalized to [0,1] within the combined bbox (y-down)
//   box     = target placement in mm, fitted ~80% into the hoop and centered
// `hoop` = { w, h } in mm.
export function parseSVG(text, hoop) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("invalid SVG");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("no <svg> element");

  // Attach offscreen so the geometry APIs are reliable across browsers.
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden";
  holder.appendChild(svg);
  document.body.appendChild(holder);
  try {
    const els = [];
    const walk = (n) => { for (const c of n.children || []) { if (typeof c.getTotalLength === "function" && typeof c.getPointAtLength === "function") els.push(c); walk(c); } };
    walk(svg);

    const raw = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      let len = 0;
      try { len = el.getTotalLength(); } catch { continue; }
      if (!len || !isFinite(len)) continue;
      const step = Math.max(0.4, len / 800);
      const breakDist = step * 6; // a jump this big = a new sub-path/hole
      const contours = [];
      let cur = [], prev = null;
      for (let s = 0; s <= len; s += step) {
        const pt = el.getPointAtLength(s);
        const p = { x: pt.x, y: pt.y };
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > breakDist) {
          if (cur.length >= 3) contours.push(cur);
          cur = [];
        }
        cur.push(p); prev = p;
      }
      if (cur.length >= 3) contours.push(cur);
      if (!contours.length) continue;

      const fillAttr = (el.getAttribute("fill") || el.style.fill || "").trim();
      const outline = fillAttr === "none";
      const color = outline
        ? (parseColor(el.getAttribute("stroke") || el.style.stroke) || "#333333")
        : (parseColor(fillAttr) || "#333333"); // SVG default fill is black-ish
      for (const c of contours) for (const p of c) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      raw.push({ contours, color, outline });
    }
    if (!raw.length) throw new Error("no drawable paths");

    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
    const target = Math.min(hoop.w, hoop.h) * 0.8;
    const sc = target / Math.max(bw, bh);
    const tw = bw * sc, th = bh * sc;
    const box = { x: (hoop.w - tw) / 2, y: (hoop.h - th) / 2, w: tw, h: th };

    const items = raw.map((it) => ({
      base: it.contours.map((c) => c.map((p) => ({ x: (p.x - minX) / bw, y: (p.y - minY) / bh }))),
      color: it.color, outline: it.outline,
    }));
    return { items, box };
  } finally {
    holder.remove();
  }
}
