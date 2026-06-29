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

// ---------------------------------------------------------------------------
// New brothread polyester embroidery thread — the physical thread the shop owns.
// This is the 150-color "Mega Kit" PLUS the one 40-spool color not in it
// (620 Magenta), so every spool on hand is selectable. Codes without an "N"
// prefix are New brothread's Brother-compatible assortment; "N…" codes are the
// Janome-compatible assortment; "V-…" are variegated (multi-color) spools.
//
// On-screen RGB are the most accurate available for this exact product:
//   • Ink/Stitch "New Brothread 40" & "80" palettes (sampled from the maker's
//     own color cards) for the colors they cover,
//   • Brother thread values for the remaining Brother-assortment colors,
//   • sampled from the maker's printed color card for the few specialty /
//     variegated colors not in those palettes.
// Printed & on-screen color is for reference only — always test on scrap.
//   grp: "brother" | "janome" | "vari"   set40: also in the 40-spool kit
export const NEWBROTHREAD = [
  // ---- Brother-compatible assortment ----
  { code: "001",  name: "White",          rgb: [240, 240, 240], grp: "brother", set40: true },
  { code: "005",  name: "Silver",         rgb: [168, 168, 168], grp: "brother", set40: true },
  { code: "007",  name: "Prussian Blue",  rgb: [14, 31, 124],   grp: "brother", set40: true },
  { code: "010",  name: "Cream Brown",    rgb: [255, 255, 179], grp: "brother", set40: true },
  { code: "017",  name: "Light Blue",     rgb: [168, 222, 235], grp: "brother", set40: true },
  { code: "019",  name: "Sky Blue",       rgb: [37, 132, 187],  grp: "brother", set40: true },
  { code: "027",  name: "Fresh Green",    rgb: [227, 243, 91],  grp: "brother", set40: true },
  { code: "030",  name: "Vermillion",     rgb: [254, 55, 15],   grp: "brother", set40: true },
  { code: "058",  name: "Dark Brown",     rgb: [42, 19, 1],     grp: "brother", set40: true },
  { code: "070",  name: "Cornflower Blue",rgb: [75, 107, 175],  grp: "brother", set40: true },
  { code: "079",  name: "Salmon Pink",    rgb: [252, 187, 196], grp: "brother", set40: true },
  { code: "085",  name: "Pink",           rgb: [249, 147, 188], grp: "brother", set40: true },
  { code: "086",  name: "Deep Rose",      rgb: [246, 74, 138],  grp: "brother", set40: true },
  { code: "107",  name: "Dark Fuchsia",   rgb: [199, 1, 86],    grp: "brother", set40: true },
  { code: "124",  name: "Flesh Pink",     rgb: [253, 217, 222], grp: "brother", set40: true },
  { code: "126",  name: "Pumpkin",        rgb: [254, 179, 67],  grp: "brother" },
  { code: "202",  name: "Lemon Yellow",   rgb: [240, 249, 112], grp: "brother" },
  { code: "205",  name: "Yellow",         rgb: [255, 255, 0],   grp: "brother", set40: true },
  { code: "206",  name: "Harvest Gold",   rgb: [255, 217, 17],  grp: "brother" },
  { code: "208",  name: "Orange",         rgb: [254, 186, 53],  grp: "brother", set40: true },
  { code: "209",  name: "Tangerine",      rgb: [254, 158, 50],  grp: "brother", set40: true },
  { code: "214",  name: "Deep Gold",      rgb: [232, 169, 0],   grp: "brother", set40: true },
  { code: "307",  name: "Linen",          rgb: [254, 227, 197], grp: "brother", set40: true },
  { code: "323",  name: "Light Brown",    rgb: [178, 118, 36],  grp: "brother", set40: true },
  { code: "328",  name: "Brass",          rgb: [186, 152, 0],   grp: "brother", set40: true },
  { code: "333",  name: "Amber Red",      rgb: [181, 75, 100],  grp: "brother" },
  { code: "337",  name: "Reddish Brown",  rgb: [209, 92, 0],    grp: "brother" },
  { code: "339",  name: "Clay Brown",     rgb: [209, 84, 0],    grp: "brother", set40: true },
  { code: "348",  name: "Khaki",          rgb: [208, 166, 96],  grp: "brother" },
  { code: "399",  name: "Warm Gray",      rgb: [216, 204, 198], grp: "brother" },
  { code: "405",  name: "Blue",           rgb: [10, 85, 163],   grp: "brother", set40: true },
  { code: "406",  name: "Ultra Marine",   rgb: [11, 61, 145],   grp: "brother" },
  { code: "415",  name: "Peacock Blue",   rgb: [19, 74, 70],    grp: "brother" },
  { code: "420",  name: "Electric Blue",  rgb: [9, 91, 166],    grp: "brother", set40: true },
  { code: "502",  name: "Mint Green",     rgb: [158, 214, 125], grp: "brother", set40: true },
  { code: "507",  name: "Emerald Green",  rgb: [0, 103, 62],    grp: "brother", set40: true },
  { code: "509",  name: "Leaf Green",     rgb: [102, 186, 73],  grp: "brother" },
  { code: "513",  name: "Lime Green",     rgb: [112, 188, 31],  grp: "brother", set40: true },
  { code: "515",  name: "Moss Green",     rgb: [47, 126, 32],   grp: "brother", set40: true },
  { code: "517",  name: "Dark Olive",     rgb: [67, 86, 7],     grp: "brother" },
  { code: "519",  name: "Olive Green",    rgb: [19, 43, 26],    grp: "brother" },
  { code: "534",  name: "Teal Green",     rgb: [0, 135, 119],   grp: "brother", set40: true },
  { code: "542",  name: "Seacrest",       rgb: [168, 221, 196], grp: "brother" },
  { code: "612",  name: "Lilac",          rgb: [145, 95, 172],  grp: "brother", set40: true },
  { code: "613",  name: "Violet",         rgb: [106, 28, 138],  grp: "brother" },
  { code: "614",  name: "Purple",         rgb: [78, 41, 144],   grp: "brother", set40: true },
  { code: "620",  name: "Magenta",        rgb: [145, 54, 151],  grp: "brother", set40: true }, // 40-kit only
  { code: "704",  name: "Pewter",         rgb: [79, 85, 86],    grp: "brother", set40: true },
  { code: "707",  name: "Dark Gray",      rgb: [41, 49, 51],    grp: "brother", set40: true },
  { code: "800",  name: "Red",            rgb: [237, 23, 31],   grp: "brother", set40: true },
  { code: "804",  name: "Lavender",       rgb: [178, 175, 212], grp: "brother" },
  { code: "807",  name: "Carmine",        rgb: [247, 56, 102],  grp: "brother" },
  { code: "808",  name: "Deep Green",     rgb: [0, 56, 34],     grp: "brother" },
  { code: "810",  name: "Light Lilac",    rgb: [228, 154, 203], grp: "brother", set40: true },
  { code: "812",  name: "Cream Yellow",   rgb: [255, 243, 107], grp: "brother" },
  { code: "817",  name: "Gray",           rgb: [135, 135, 135], grp: "brother" },
  { code: "843",  name: "Beige",          rgb: [239, 227, 185], grp: "brother", set40: true },
  { code: "869",  name: "Royal Purple",   rgb: [119, 1, 118],   grp: "brother" },
  { code: "900",  name: "Black",          rgb: [0, 0, 0],       grp: "brother", set40: true },
  { code: "901",  name: "Flesh",          rgb: [243, 201, 168], grp: "brother" },
  { code: "902",  name: "Ivory",          rgb: [245, 238, 214], grp: "brother" },
  { code: "1161", name: "Kelly",          rgb: [28, 148, 70],   grp: "brother" },
  { code: "1171", name: "Marigold",       rgb: [240, 176, 38],  grp: "brother" },
  { code: "1172", name: "Orange",         rgb: [239, 124, 32],  grp: "brother" },
  { code: "1176", name: "Light Royal Blue",rgb: [44, 96, 184],  grp: "brother" },
  { code: "1236", name: "Grape Juice",    rgb: [112, 32, 84],   grp: "brother" },
  { code: "1247", name: "Persimmon",      rgb: [227, 86, 46],   grp: "brother" },
  { code: "1253", name: "Teal",           rgb: [0, 124, 134],   grp: "brother" },
  { code: "1618", name: "Snow White",     rgb: [240, 240, 236], grp: "brother", set40: true },
  { code: "1637", name: "Christmas Pink", rgb: [222, 46, 120],  grp: "brother" },
  { code: "1656", name: "Christmas Red",  rgb: [205, 26, 36],   grp: "brother" },
  { code: "1668", name: "Flesh",          rgb: [245, 212, 202], grp: "brother" },
  { code: "1754", name: "Christmas Green",rgb: [0, 104, 56],    grp: "brother" },
  { code: "1821", name: "Christmas Blue", rgb: [30, 64, 150],   grp: "brother" },
  { code: "1950", name: "Christmas Gold", rgb: [205, 170, 76],  grp: "brother" },
  { code: "1963", name: "Christmas Silver",rgb: [201, 201, 205],grp: "brother" },
  { code: "2324", name: "Neon Green",     rgb: [150, 222, 42],  grp: "brother" },
  { code: "2340", name: "Neon Rose",      rgb: [245, 42, 124],  grp: "brother" },
  { code: "2480", name: "Neon Dark Orange",rgb: [250, 95, 26],  grp: "brother" },

  // ---- Variegated (multi-color) — swatch shows a representative blend ----
  { code: "V-006", name: "Variegated 006", rgb: [92, 160, 168], grp: "vari", vari: true },
  { code: "V-017", name: "Variegated 017", rgb: [170, 150, 200],grp: "vari", vari: true },
  { code: "V-032", name: "Variegated 032", rgb: [120, 170, 210],grp: "vari", vari: true },
  { code: "V-033", name: "Variegated 033", rgb: [90, 150, 150], grp: "vari", vari: true },
  { code: "V-048", name: "Variegated 048", rgb: [160, 120, 110],grp: "vari", vari: true },

  // ---- Janome-compatible assortment (N) ----
  { code: "N0026",name: "Pastel Blue",    rgb: [180, 208, 230], grp: "janome" },
  { code: "N0034",name: "Fresh Green",    rgb: [150, 200, 95],  grp: "janome" },
  { code: "N0104",name: "Light Sky Blue", rgb: [172, 212, 235], grp: "janome" },
  { code: "N0206",name: "Lavender Pink",  rgb: [222, 182, 205], grp: "janome" },
  { code: "N0218",name: "Light Mauve",    rgb: [205, 175, 195], grp: "janome" },
  { code: "N0220",name: "Amethyst",       rgb: [140, 90, 160],  grp: "janome" },
  { code: "N0225",name: "Sky Blue",       rgb: [110, 178, 220], grp: "janome" },
  { code: "N003", name: "Gold",           rgb: [197, 166, 88],  grp: "janome" },
  { code: "N201", name: "Pink",           rgb: [202, 68, 121],  grp: "janome" },
  { code: "N202", name: "Vermilion",      rgb: [191, 60, 40],   grp: "janome" },
  { code: "N203", name: "Orange",         rgb: [207, 97, 38],   grp: "janome" },
  { code: "N204", name: "Yellow",         rgb: [225, 223, 39],  grp: "janome" },
  { code: "N205", name: "Dark Brown",     rgb: [53, 23, 8],     grp: "janome" },
  { code: "N207", name: "Blue",           rgb: [19, 39, 105],   grp: "janome" },
  { code: "N208", name: "Purple",         rgb: [140, 73, 134],  grp: "janome" },
  { code: "N209", name: "Pale Violet",    rgb: [158, 125, 179], grp: "janome" },
  { code: "N211", name: "Pale Pink",      rgb: [226, 157, 168], grp: "janome" },
  { code: "N212", name: "Peach",          rgb: [208, 155, 115], grp: "janome" },
  { code: "N213", name: "Beige",          rgb: [154, 143, 104], grp: "janome" },
  { code: "N214", name: "Brown",          rgb: [119, 76, 52],   grp: "janome" },
  { code: "N215", name: "Wine Red",       rgb: [100, 17, 37],   grp: "janome" },
  { code: "N217", name: "Sky",            rgb: [82, 185, 192],  grp: "janome" },
  { code: "N218", name: "Yellow Green",   rgb: [64, 183, 64],   grp: "janome" },
  { code: "N220", name: "Silver Gray",    rgb: [207, 212, 215], grp: "janome" },
  { code: "N221", name: "Gray",           rgb: [90, 102, 102],  grp: "janome" },
  { code: "N222", name: "Ocean Blue",     rgb: [44, 71, 124],   grp: "janome" },
  { code: "N223", name: "Beige Gray",     rgb: [176, 148, 134], grp: "janome" },
  { code: "N224", name: "Bamboo",         rgb: [188, 150, 92],  grp: "janome" },
  { code: "N225", name: "Red",            rgb: [199, 42, 29],   grp: "janome" },
  { code: "N226", name: "Green",          rgb: [43, 85, 43],    grp: "janome" },
  { code: "N227", name: "Pale Aqua",      rgb: [125, 185, 162], grp: "janome" },
  { code: "N228", name: "Baby Blue",      rgb: [155, 198, 206], grp: "janome" },
  { code: "N230", name: "Bright Blue",    rgb: [80, 114, 146],  grp: "janome" },
  { code: "N231", name: "Slate Blue",     rgb: [40, 76, 84],    grp: "janome" },
  { code: "N232", name: "Navy Blue",      rgb: [8, 16, 62],     grp: "janome" },
  { code: "N233", name: "Salmon Pink",    rgb: [210, 143, 137], grp: "janome" },
  { code: "N234", name: "Coral",          rgb: [229, 96, 81],   grp: "janome" },
  { code: "N235", name: "Burnt Orange",   rgb: [185, 60, 42],   grp: "janome" },
  { code: "N236", name: "Cinnamon",       rgb: [196, 150, 114], grp: "janome" },
  { code: "N237", name: "Umber",          rgb: [108, 105, 68],  grp: "janome" },
  { code: "N238", name: "Blond",          rgb: [209, 197, 121], grp: "janome" },
  { code: "N241", name: "Peony Purple",   rgb: [157, 30, 109],  grp: "janome" },
  { code: "N243", name: "Royal Purple",   rgb: [73, 9, 87],     grp: "janome" },
  { code: "N244", name: "Cardinal Red",   rgb: [117, 21, 34],   grp: "janome" },
  { code: "N245", name: "Opal Green",     rgb: [132, 175, 130], grp: "janome" },
  { code: "N246", name: "Moss Green",     rgb: [92, 104, 58],   grp: "janome" },
  { code: "N247", name: "Meadow Green",   rgb: [81, 113, 37],   grp: "janome" },
  { code: "N248", name: "Dark Green",     rgb: [17, 52, 26],    grp: "janome" },
  { code: "N249", name: "Aquamarine",     rgb: [75, 149, 128],  grp: "janome" },
  { code: "N250", name: "Emerald Green",  rgb: [25, 136, 116],  grp: "janome" },
  { code: "N251", name: "Peacock Green",  rgb: [25, 116, 93],   grp: "janome" },
  { code: "N252", name: "Dark Gray",      rgb: [78, 81, 85],    grp: "janome" },
  { code: "N253", name: "Ivory White",    rgb: [213, 212, 193], grp: "janome" },
  { code: "N254", name: "Hazel",          rgb: [145, 81, 37],   grp: "janome" },
  { code: "N255", name: "Toast",          rgb: [157, 109, 36],  grp: "janome" },
  { code: "N256", name: "Salmon",         rgb: [133, 91, 105],  grp: "janome" },
  { code: "N258", name: "Sienna",         rgb: [64, 48, 25],    grp: "janome" },
  { code: "N259", name: "Sepia",          rgb: [47, 32, 9],     grp: "janome" },
  { code: "N261", name: "Violet Blue",    rgb: [78, 39, 130],   grp: "janome" },
  { code: "N263", name: "Sola Blue",      rgb: [16, 94, 160],   grp: "janome" },
  { code: "N264", name: "Green Dust",     rgb: [135, 201, 67],  grp: "janome" },
  { code: "N265", name: "Crimson",        rgb: [182, 47, 97],   grp: "janome" },
  { code: "N266", name: "Floral Pink",    rgb: [175, 65, 122],  grp: "janome" },
  { code: "N271", name: "Yellow Ocher",   rgb: [171, 125, 48],  grp: "janome" },
  { code: "N272", name: "Old Gold",       rgb: [152, 121, 39],  grp: "janome" },
  { code: "N274", name: "Tangerine",      rgb: [213, 160, 89],  grp: "janome" },
  { code: "N275", name: "Canary Yellow",  rgb: [198, 179, 51],  grp: "janome" },
];

// Display order + labels for the three assortment groups in the color picker.
export const NB_GROUPS = [
  { id: "brother", label: "Brother assortment" },
  { id: "janome",  label: "Janome (N) assortment" },
  { id: "vari",    label: "Variegated" },
];

export function nbHex(entry) { return rgbToHex(entry.rgb); }

// Nearest New brothread color to an arbitrary rgb (for labelling legacy colors).
export function nearestNewBrothread(rgb) {
  let best = NEWBROTHREAD[0], bestD = Infinity;
  for (const e of NEWBROTHREAD) {
    const d = colorDistance(rgb, e.rgb);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

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
