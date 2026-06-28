// Embroidery lettering: font catalog + text → glyph-contour conversion.
// Uses opentype.js (loaded globally via <script> in index.html as window.opentype).

import { flattenCubic, flattenQuad, bbox } from "./geometry.js";

// Font categories. Each has a short, human-readable label and a "rep" font —
// the family used to render the category's own heading in the gallery, so the
// label looks like the fonts it contains. `blurb` is a one-line description.
export const FONT_CATEGORIES = [
  { id: "block",  label: "Block",       rep: "Anton",           blurb: "Bold & high-impact" },
  { id: "sans",   label: "Sans-serif",  rep: "Bebas Neue",      blurb: "Clean & modern" },
  { id: "serif",  label: "Serif",       rep: "Cardo",           blurb: "Classic, Times-like" },
  { id: "slab",   label: "Slab serif",  rep: "Alfa Slab One",   blurb: "Chunky slab serifs" },
  { id: "script", label: "Cursive",     rep: "Great Vibes",     blurb: "Flowing & connected" },
  { id: "hand",   label: "Handwritten", rep: "Permanent Marker",blurb: "Casual & marker styles" },
  { id: "display",label: "Display",     rep: "Bangers",         blurb: "Fun & decorative" },
];

// Curated, embroidery-friendly open-license fonts, grouped by category. Heavy /
// bold styles stitch best; cursive & thin display faces are included for variety.
export const FONTS = [
  // ---- Block: heavy, bold, poster-weight ----
  { name: "Anton",          file: "Anton.ttf",          cat: "block" },
  { name: "Archivo Black",  file: "ArchivoBlack.ttf",   cat: "block" },
  { name: "Titan One",      file: "TitanOne.ttf",       cat: "block" },
  { name: "Passion One",    file: "PassionOne.ttf",     cat: "block" },
  { name: "Bowlby One",     file: "BowlbyOne.ttf",      cat: "block" },
  { name: "Luckiest Guy",   file: "LuckiestGuy.ttf",    cat: "block" },
  { name: "Righteous",      file: "Righteous.ttf",      cat: "block" },

  // ---- Sans-serif: clean, modern ----
  { name: "Bebas Neue",     file: "BebasNeue.ttf",      cat: "sans" },
  { name: "Fjalla One",     file: "FjallaOne.ttf",      cat: "sans" },
  { name: "Staatliches",    file: "Staatliches.ttf",    cat: "sans" },
  { name: "Pathway Gothic", file: "PathwayGothicOne.ttf",cat: "sans" },
  { name: "Poppins",        file: "Poppins.ttf",        cat: "sans" },

  // ---- Serif: classic, Times-like ----
  { name: "Crimson Text",   file: "CrimsonText.ttf",    cat: "serif" },
  { name: "PT Serif",       file: "PTSerif.ttf",        cat: "serif" },
  { name: "Cardo",          file: "Cardo.ttf",          cat: "serif" },

  // ---- Slab serif: chunky ----
  { name: "Alfa Slab One",  file: "AlfaSlabOne.ttf",    cat: "slab" },
  { name: "Arvo",           file: "Arvo.ttf",           cat: "slab" },
  { name: "Bevan",          file: "Bevan.ttf",          cat: "slab" },
  { name: "Patua One",      file: "PatuaOne.ttf",       cat: "slab" },

  // ---- Cursive / script: flowing, connected ----
  { name: "Great Vibes",    file: "GreatVibes.ttf",     cat: "script" },
  { name: "Lobster",        file: "Lobster.ttf",        cat: "script" },
  { name: "Pacifico",       file: "Pacifico.ttf",       cat: "script" },
  { name: "Allura",         file: "Allura.ttf",         cat: "script" },
  { name: "Sacramento",     file: "Sacramento.ttf",     cat: "script" },
  { name: "Kaushan Script", file: "KaushanScript.ttf",  cat: "script" },
  { name: "Satisfy",        file: "Satisfy.ttf",        cat: "script" },
  { name: "Yellowtail",     file: "Yellowtail.ttf",     cat: "script" },
  { name: "Courgette",      file: "Courgette.ttf",      cat: "script" },

  // ---- Handwritten: casual, marker ----
  { name: "Permanent Marker",file: "PermanentMarker.ttf",cat: "hand" },
  { name: "Patrick Hand",   file: "PatrickHand.ttf",    cat: "hand" },
  { name: "Gloria Hallelujah",file: "GloriaHallelujah.ttf",cat: "hand" },

  // ---- Display: fun, decorative ----
  { name: "Bangers",        file: "Bangers.ttf",        cat: "display" },
  { name: "Bungee",         file: "Bungee.ttf",         cat: "display" },
  { name: "Creepster",      file: "Creepster.ttf",      cat: "display" },
  { name: "Monoton",        file: "Monoton.ttf",        cat: "display" },
  { name: "Press Start 2P", file: "PressStart2P.ttf",   cat: "display" },
];

// Fonts belonging to a category id, in catalog order.
export function fontsInCategory(catId) {
  return FONTS.filter((f) => f.cat === catId);
}

// Build the @font-face CSS for every catalog font (so the live DOM previews
// match what gets stitched). Keeping this generated from FONTS means adding a
// font is a one-line change here — no parallel edit in the stylesheet.
export function fontFaceCSS() {
  return FONTS.map((f) => `@font-face{font-family:"${cssFamily(f.name)}";src:url("fonts/${f.file}");font-display:swap;}`).join("\n");
}

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
