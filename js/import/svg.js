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

    // Resolve an element's paint the way the browser actually renders it:
    // computed style covers inheritance from ancestor <g>s, <style> blocks and
    // presentation attributes. Gradients resolve to their first stop's color
    // (a solid approximation a single thread can stitch).
    const resolvePaint = (el, prop) => {
      const cs = getComputedStyle(el);
      let v = (cs[prop] || "").trim();
      if (!v && el.getAttribute) v = (el.getAttribute(prop) || "").trim();
      if (v.startsWith("url(")) {
        const m = v.match(/url\(["']?#([^"')]+)/);
        const grad = m && svg.querySelector(`[id="${m[1]}"]`);
        const stop = grad && grad.querySelector("stop");
        if (stop) {
          const sc = getComputedStyle(stop).stopColor || stop.getAttribute("stop-color");
          return { kind: "color", value: parseColor(sc) || "#888888" };
        }
        return { kind: "color", value: "#888888" };
      }
      if (v === "none" || v === "transparent") return { kind: "none" };
      const col = parseColor(v);
      return col ? { kind: "color", value: col } : { kind: "none" };
    };
    const isHidden = (el) => {
      const cs = getComputedStyle(el);
      return cs.display === "none" || cs.visibility === "hidden" ||
        parseFloat(cs.opacity || "1") < 0.05;
    };

    const raw = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      if (isHidden(el)) continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch { continue; }
      if (!len || !isFinite(len)) continue;
      const step = Math.max(0.4, len / 800);
      const breakDist = step * 6; // a jump this big = a new sub-path/hole
      // getPointAtLength returns the element's LOCAL coords and ignores ancestor
      // <g transform> / the element's own transform — which is why transformed
      // logos came in flipped/scattered. Map every sample through the element's
      // CTM (to the <svg> viewport) so positions/orientation are correct.
      const ctm = (typeof el.getCTM === "function") ? el.getCTM() : null;
      const contours = [];
      let cur = [], prev = null;
      for (let s = 0; s <= len; s += step) {
        let pt = el.getPointAtLength(s);
        if (ctm && pt.matrixTransform) pt = pt.matrixTransform(ctm);
        const p = { x: pt.x, y: pt.y };
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > breakDist) {
          if (cur.length >= 3) contours.push(cur);
          cur = [];
        }
        cur.push(p); prev = p;
      }
      if (cur.length >= 3) contours.push(cur);
      if (!contours.length) continue;

      const fill = resolvePaint(el, "fill");
      const stroke = resolvePaint(el, "stroke");
      // nothing to stitch: no fill AND no stroke (e.g. clip helpers)
      if (fill.kind === "none" && stroke.kind === "none") continue;
      const outline = fill.kind === "none";
      const color = outline ? stroke.value : fill.value;

      let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
      for (const c of contours) for (const p of c) {
        if (p.x < eMinX) eMinX = p.x; if (p.y < eMinY) eMinY = p.y;
        if (p.x > eMaxX) eMaxX = p.x; if (p.y > eMaxY) eMaxY = p.y;
      }
      raw.push({ contours, color, outline, bbox: { x0: eMinX, y0: eMinY, x1: eMaxX, y1: eMaxY } });
      if (eMinX < minX) minX = eMinX; if (eMinY < minY) minY = eMinY;
      if (eMaxX > maxX) maxX = eMaxX; if (eMaxY > maxY) maxY = eMaxY;
    }
    if (!raw.length) throw new Error("no drawable paths");

    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;

    // Drop the classic white/near-white background card: a filled element
    // covering essentially the whole drawing. Nobody wants a giant white
    // stitched rectangle under their logo.
    const isLight = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.92;
    };
    let filtered = raw.filter((it, i) => {
      if (it.outline || i > 1) return true; // backgrounds sit at the bottom of the stack
      const cov = ((it.bbox.x1 - it.bbox.x0) * (it.bbox.y1 - it.bbox.y0)) / (bw * bh);
      return !(cov > 0.94 && isLight(it.color));
    });
    if (!filtered.length) filtered = raw;

    const target = Math.min(hoop.w, hoop.h) * 0.8;
    const sc = target / Math.max(bw, bh);
    // Skip specks that would stitch smaller than ~0.8mm in both directions.
    filtered = filtered.filter((it) => {
      const wmm = (it.bbox.x1 - it.bbox.x0) * sc, hmm = (it.bbox.y1 - it.bbox.y0) * sc;
      return Math.max(wmm, hmm) >= 0.8;
    });
    if (!filtered.length) throw new Error("no stitchable shapes at this size");

    const tw = bw * sc, th = bh * sc;
    const box = { x: (hoop.w - tw) / 2, y: (hoop.h - th) / 2, w: tw, h: th };

    const items = filtered.map((it) => ({
      base: it.contours.map((c) => c.map((p) => ({ x: (p.x - minX) / bw, y: (p.y - minY) / bh }))),
      color: it.color, outline: it.outline,
    }));
    return { items, box };
  } finally {
    holder.remove();
  }
}
