// Embroidery lettering: font catalog + text → glyph-contour conversion.
// Uses opentype.js (loaded globally via <script> in index.html as window.opentype).

import { flattenCubic, flattenQuad, bbox } from "./geometry.js";

// Curated, embroidery-friendly open-license fonts (heavy/bold styles stitch best).
export const FONTS = [
  { name: "Anton",        file: "Anton.ttf",        category: "Sans · heavy" },
  { name: "Archivo Black",file: "ArchivoBlack.ttf", category: "Sans · heavy" },
  { name: "Fjalla One",   file: "FjallaOne.ttf",    category: "Sans" },
  { name: "Righteous",    file: "Righteous.ttf",    category: "Sans · round" },
  { name: "Alfa Slab One",file: "AlfaSlabOne.ttf",  category: "Slab" },
  { name: "Arvo",         file: "Arvo.ttf",         category: "Slab serif" },
  { name: "Crimson Text", file: "CrimsonText.ttf",  category: "Serif" },
  { name: "Lobster",      file: "Lobster.ttf",      category: "Script" },
  { name: "Pacifico",     file: "Pacifico.ttf",     category: "Script · casual" },
  { name: "Great Vibes",  file: "GreatVibes.ttf",   category: "Script · formal" },
  { name: "Bangers",      file: "Bangers.ttf",      category: "Display" },
];

// CSS family name for live (DOM) previews — must match the @font-face rules.
export function cssFamily(name) {
  return "GS-" + name.replace(/[^A-Za-z0-9]/g, "");
}

const _cache = new Map();   // name -> opentype.Font
const _loading = new Map();  // name -> Promise

export function fontByName(name) {
  return FONTS.find((f) => f.name === name) || FONTS[0];
}

export function isLoaded(name) {
  return _cache.has(fontByName(name).name);
}

// Synchronously return an already-loaded opentype.Font, or null. Used for live
// (drag-time) re-baking once a font has been fetched at least once.
export function loadedFont(name) {
  return _cache.get(fontByName(name).name) || null;
}

// Load (and cache) a font. Returns a Promise<opentype.Font>.
export function loadFont(name) {
  if (_cache.has(name)) return Promise.resolve(_cache.get(name));
  if (_loading.has(name)) return _loading.get(name);
  const meta = fontByName(name);
  const p = new Promise((resolve, reject) => {
    if (!window.opentype) { reject(new Error("opentype.js not loaded")); return; }
    window.opentype.load(`fonts/${meta.file}`, (err, font) => {
      if (err) { reject(err); return; }
      _cache.set(meta.name, font);
      _loading.delete(meta.name);
      resolve(font);
    });
  });
  _loading.set(name, p);
  return p;
}

// Convert text to glyph contours in mm. fontSize is the em size in mm.
// opts: { letterSpacing, bold, italic, underline, curve }
//   bold      : synthetic emboldening (contour offset)
//   italic    : synthetic slant (shear)
//   underline : add a filled bar under the baseline
//   curve     : -1..1, bends the baseline into an arc (text-on-a-circle)
// Returns { glyphs:[ [contour,...], ... ], width, height, bbox } with the
// baseline at y=0 and text starting at x=0 (ascenders have negative y).
export function textToGlyphs(font, text, fontSizeMm, opts = {}) {
  const curveSteps = Math.max(4, Math.round((opts.quality || 1) * 7));
  const letterSpacing = opts.letterSpacing || 0;  // mm added between glyphs
  const slant = opts.italic ? 0.22 : 0;           // tan of the lean angle
  const boldAmt = opts.bold ? fontSizeMm * 0.045 : 0;
  const glyphs = [];
  let penX = 0;
  const scale = fontSizeMm / font.unitsPerEm;

  const otGlyphs = font.stringToGlyphs(text);
  for (let gi = 0; gi < otGlyphs.length; gi++) {
    const g = otGlyphs[gi];
    const path = g.getPath(penX, 0, fontSizeMm); // y-down, baseline at 0
    let contours = pathToContours(path, curveSteps);
    if (boldAmt > 0) contours = emboldenContours(contours, boldAmt);
    if (contours.length) glyphs.push(contours);
    penX += (g.advanceWidth || 0) * scale + letterSpacing;
  }

  const width = penX;

  // Underline: a solid bar spanning the text, just below the baseline.
  if (opts.underline && width > 0) {
    const y0 = fontSizeMm * 0.12, y1 = y0 + fontSizeMm * 0.07;
    glyphs.push([[
      { x: 0, y: y0 }, { x: width, y: y0 }, { x: width, y: y1 }, { x: 0, y: y1 },
    ]]);
  }

  // Apply slant then arc to every contour point.
  const curve = Math.max(-1, Math.min(1, opts.curve || 0));
  if (slant || curve) {
    for (const contours of glyphs) {
      for (const c of contours) {
        for (const p of c) {
          if (slant) p.x -= p.y * slant;            // lean right for ascenders
        }
      }
    }
    if (curve) arcBend(glyphs, width, curve, fontSizeMm);
  }

  const all = glyphs.flat().flat();
  const bb = all.length ? bbox(all) : { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { glyphs, width, height: bb.h, bbox: bb };
}

// Bend a straight baseline into a circular arc. curve>0 arcs upward (smile),
// curve<0 arcs downward (frown). Larger |curve| = tighter circle.
function arcBend(glyphs, width, curve, em) {
  if (width <= 0) return;
  // Radius: at |curve|=1 the text wraps ~150° of a circle.
  const sweep = Math.abs(curve) * (Math.PI * 0.83);
  const R = width / sweep;
  const sign = curve > 0 ? -1 : 1; // screen y is down; up = negative
  const cx = width / 2;
  for (const contours of glyphs) {
    for (const c of contours) {
      for (const p of c) {
        const theta = ((p.x - cx) / R);          // angle along the arc
        const r = R + sign * p.y;                 // offset from baseline
        p.x = cx + r * Math.sin(theta);
        p.y = sign * (R - r * Math.cos(theta));
      }
    }
  }
}

// Turn an opentype Path's commands into closed polygon contours.
function pathToContours(path, steps) {
  const contours = [];
  let cur = null;
  for (const c of path.commands) {
    if (c.type === "M") {
      if (cur && cur.length >= 3) contours.push(cur);
      cur = [{ x: c.x, y: c.y }];
    } else if (c.type === "L") {
      cur.push({ x: c.x, y: c.y });
    } else if (c.type === "C") {
      const p0 = cur[cur.length - 1];
      cur.push(...flattenCubic(p0, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, steps));
    } else if (c.type === "Q") {
      const p0 = cur[cur.length - 1];
      cur.push(...flattenQuad(p0, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }, steps));
    } else if (c.type === "Z") {
      if (cur && cur.length >= 3) contours.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length >= 3) contours.push(cur);
  return contours;
}

// Synthetic bold: push each contour's vertices outward (ink grows). Outer
// contours expand; interior counters shrink — detected by point-in-contour
// nesting parity so holes stay open.
function emboldenContours(contours, delta) {
  return contours.map((c, ci) => {
    const inner = isHole(c, contours, ci);
    const grow = inner ? -delta : delta;          // holes shrink their ink
    const area = signedArea(c);
    const dirSign = area > 0 ? 1 : -1;            // outward = left of winding
    return offsetPolygon(c, grow * dirSign);
  });
}

function isHole(contour, all, ci) {
  const pt = contour[0];
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    if (i === ci) continue;
    if (pointInPoly(pt, all[i])) count++;
  }
  return count % 2 === 1;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Offset a closed polygon by `d` along the outward (left-hand) normal of each
// vertex. Approximate but adequate for small bold deltas.
function offsetPolygon(poly, d) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const e1 = unit(cur.x - prev.x, cur.y - prev.y);
    const e2 = unit(next.x - cur.x, next.y - cur.y);
    // left-hand normals of the two edges
    let nx = -e1.y - e2.y, ny = e1.x + e2.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    out.push({ x: cur.x + nx * d, y: cur.y + ny * d });
  }
  return out;
}

function unit(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
