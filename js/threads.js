// Brother PEC thread palette (64 colors) + nearest-color matching.
// Index 0 is reserved/None in the PEC palette; these are palette positions 1..64.

export const BROTHER_PALETTE = [
  { i: 1,  name: "Prussian Blue",  rgb: [14, 31, 124] },
  { i: 2,  name: "Blue",           rgb: [10, 85, 163] },
  { i: 3,  name: "Teal Green",     rgb: [0, 135, 119] },
  { i: 4,  name: "Cornflower Blue",rgb: [75, 107, 175] },
  { i: 5,  name: "Red",            rgb: [237, 23, 31] },
  { i: 6,  name: "Reddish Brown",  rgb: [209, 92, 0] },
  { i: 7,  name: "Magenta",        rgb: [145, 54, 151] },
  { i: 8,  name: "Light Lilac",    rgb: [228, 154, 203] },
  { i: 9,  name: "Lilac",          rgb: [145, 95, 172] },
  { i: 10, name: "Mint Green",     rgb: [158, 214, 125] },
  { i: 11, name: "Deep Gold",      rgb: [232, 169, 0] },
  { i: 12, name: "Orange",         rgb: [254, 186, 53] },
  { i: 13, name: "Yellow",         rgb: [255, 255, 0] },
  { i: 14, name: "Lime Green",     rgb: [112, 188, 31] },
  { i: 15, name: "Brass",          rgb: [186, 152, 0] },
  { i: 16, name: "Silver",         rgb: [168, 168, 168] },
  { i: 17, name: "Russet Brown",   rgb: [125, 111, 0] },
  { i: 18, name: "Cream Brown",    rgb: [255, 255, 179] },
  { i: 19, name: "Pewter",         rgb: [79, 85, 86] },
  { i: 20, name: "Black",          rgb: [0, 0, 0] },
  { i: 21, name: "Ultramarine",    rgb: [11, 61, 145] },
  { i: 22, name: "Royal Purple",   rgb: [119, 1, 118] },
  { i: 23, name: "Dark Gray",      rgb: [41, 49, 51] },
  { i: 24, name: "Dark Brown",     rgb: [42, 19, 1] },
  { i: 25, name: "Deep Rose",      rgb: [246, 74, 138] },
  { i: 26, name: "Light Brown",    rgb: [178, 118, 36] },
  { i: 27, name: "Salmon Pink",    rgb: [252, 187, 197] },
  { i: 28, name: "Vermilion",      rgb: [254, 55, 15] },
  { i: 29, name: "White",          rgb: [240, 240, 240] },
  { i: 30, name: "Violet",         rgb: [106, 28, 138] },
  { i: 31, name: "Seacrest",       rgb: [168, 221, 196] },
  { i: 32, name: "Sky Blue",       rgb: [37, 132, 187] },
  { i: 33, name: "Pumpkin",        rgb: [254, 179, 67] },
  { i: 34, name: "Cream Yellow",   rgb: [255, 243, 107] },
  { i: 35, name: "Khaki",          rgb: [208, 166, 96] },
  { i: 36, name: "Clay Brown",     rgb: [209, 84, 0] },
  { i: 37, name: "Leaf Green",     rgb: [102, 186, 73] },
  { i: 38, name: "Peacock Blue",   rgb: [19, 74, 70] },
  { i: 39, name: "Gray",           rgb: [135, 135, 135] },
  { i: 40, name: "Warm Gray",      rgb: [216, 204, 198] },
  { i: 41, name: "Dark Olive",     rgb: [67, 86, 7] },
  { i: 42, name: "Flesh Pink",     rgb: [253, 217, 222] },
  { i: 43, name: "Pink",           rgb: [249, 147, 188] },
  { i: 44, name: "Deep Green",     rgb: [0, 56, 34] },
  { i: 45, name: "Lavender",       rgb: [178, 175, 212] },
  { i: 46, name: "Wisteria Violet",rgb: [104, 106, 176] },
  { i: 47, name: "Beige",          rgb: [239, 227, 185] },
  { i: 48, name: "Carmine",        rgb: [247, 56, 102] },
  { i: 49, name: "Amber Red",      rgb: [181, 75, 100] },
  { i: 50, name: "Olive Green",    rgb: [19, 43, 26] },
  { i: 51, name: "Dark Fuchsia",   rgb: [199, 1, 86] },
  { i: 52, name: "Tangerine",      rgb: [254, 158, 50] },
  { i: 53, name: "Light Blue",     rgb: [168, 222, 235] },
  { i: 54, name: "Emerald Green",  rgb: [0, 103, 62] },
  { i: 55, name: "Purple",         rgb: [78, 41, 144] },
  { i: 56, name: "Moss Green",     rgb: [47, 126, 32] },
  { i: 57, name: "Flesh Pink 2",   rgb: [255, 204, 204] },
  { i: 58, name: "Harvest Gold",   rgb: [255, 217, 17] },
  { i: 59, name: "Electric Blue",  rgb: [9, 91, 166] },
  { i: 60, name: "Lemon Yellow",   rgb: [240, 249, 112] },
  { i: 61, name: "Fresh Green",    rgb: [227, 243, 91] },
  { i: 62, name: "Orange 2",       rgb: [255, 153, 0] },
  { i: 63, name: "Cream Yellow 2", rgb: [255, 240, 141] },
  { i: 64, name: "Applique",       rgb: [255, 200, 200] },
];

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// compuphase weighted color distance (matches pyembroidery find_nearest_color_index).
export function colorDistance(a, b) {
  const rmean = (a[0] + b[0]) >> 1;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8);
}

// Return the BROTHER_PALETTE entry whose color is nearest to the given rgb.
export function nearestBrother(rgb) {
  let best = BROTHER_PALETTE[0], bestD = Infinity;
  for (const entry of BROTHER_PALETTE) {
    const d = colorDistance(rgb, entry.rgb);
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best;
}
