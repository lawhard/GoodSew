// Brother SE700 capabilities. This software targets the SE700 exclusively.
//
// Confirmed embroidery field: 4" x 4" = 100 x 100 mm (Brother SE700 ships with a
// single 4"x4" embroidery hoop; the machine's maximum embroidery area is 100mm).
// Source: Brother SE700 Operation Manual, specifications, p.96.
// https://download.brother.com/welcome/doch102582/888p10_om01en.pdf

export const SE700 = {
  model: "Brother SE700",
  field: { w: 100, h: 100 },   // mm — the hard machine limit
  maxSpeedSpm: 400,
  maxStitches: 100000,
  maxColorBlocks: 256, // PEC one-byte color count, not a machine specification
  safeMargin: 2,
  hoopName: '4"×4" (100×100 mm)',
};

// Kept as a list for the (single-entry) selector and forward compatibility.
export const HOOPS = [
  { id: "se700", name: `SE700 ${SE700.hoopName}`, w: SE700.field.w, h: SE700.field.h },
];

export function getHoop(id) {
  return HOOPS.find((h) => h.id === id) || HOOPS[0];
}
