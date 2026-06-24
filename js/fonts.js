// Embroidery lettering: font catalog + text → glyph-contour conversion.
// Uses opentype.js (loaded globally via <script> in index.html as window.opentype).

import { flattenCubic, flattenQuad, bbox } from "./geometry.js";

// Curated, embroidery-friendly open-license fonts (heavy/bold styles stitch best).
export const FONTS = [
  { name: "Anton",        file: "Anton.ttf",        category: "Sans (heavy)" },
  { name: "Archivo Black",file: "ArchivoBlack.ttf", category: "Sans (heavy)" },
  { name: "Fjalla One",   file: "FjallaOne.ttf",    category: "Sans" },
  { name: "Righteous",    file: "Righteous.ttf",    category: "Sans (round)" },
  { name: "Alfa Slab One",file: "AlfaSlabOne.ttf",  category: "Slab" },
  { name: "Arvo",         file: "Arvo.ttf",         category: "Slab serif" },
  { name: "Crimson Text", file: "CrimsonText.ttf",  category: "Serif" },
  { name: "Lobster",      file: "Lobster.ttf",      category: "Script" },
  { name: "Pacifico",     file: "Pacifico.ttf",     category: "Script (casual)" },
  { name: "Great Vibes",  file: "GreatVibes.ttf",   category: "Script (formal)" },
  { name: "Bangers",      file: "Bangers.ttf",      category: "Display" },
];

const _cache = new Map();   // name -> opentype.Font
const _loading = new Map();  // name -> Promise

export function fontByName(name) {
  return FONTS.find((f) => f.name === name) || FONTS[0];
}

export function isLoaded(name) {
  return _cache.has(name);
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
// Returns { glyphs: [ [contour, ...], ... ], width, height } with the baseline
// at y=0 and the text starting at x=0 (ascenders have negative y, i.e. up).
export function textToGlyphs(font, text, fontSizeMm, opts = {}) {
  const curveSteps = Math.max(3, Math.round((opts.quality || 1) * 6));
  const letterSpacing = opts.letterSpacing || 0;  // mm added between glyphs
  const glyphs = [];
  let penX = 0;
  const scale = fontSizeMm / font.unitsPerEm;

  const otGlyphs = font.stringToGlyphs(text);
  for (let gi = 0; gi < otGlyphs.length; gi++) {
    const g = otGlyphs[gi];
    const path = g.getPath(penX, 0, fontSizeMm); // y-down output, baseline at 0
    const contours = pathToContours(path, curveSteps);
    if (contours.length) glyphs.push(contours);
    penX += (g.advanceWidth || 0) * scale + letterSpacing;
  }

  const all = glyphs.flat().flat();
  const bb = all.length ? bbox(all) : { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { glyphs, width: penX, height: bb.h, bbox: bb };
}

// Turn an opentype Path's commands into closed polygon contours.
function pathToContours(path, steps) {
  const contours = [];
  let cur = null;
  let start = null;
  for (const c of path.commands) {
    if (c.type === "M") {
      if (cur && cur.length >= 3) contours.push(cur);
      cur = [{ x: c.x, y: c.y }];
      start = { x: c.x, y: c.y };
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
