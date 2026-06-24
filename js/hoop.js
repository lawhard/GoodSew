// Hoop / embroidery field definitions. Dimensions in mm.
// The Brother SE700 ships with a 5"x7" frame (130 x 180 mm field).

export const HOOPS = [
  { id: "se700-5x7", name: 'SE700 5"×7" (130×180 mm)', w: 130, h: 180 },
  { id: "se700-4x4", name: 'SE700 4"×4" (100×100 mm)', w: 100, h: 100 },
  { id: "se700-1x2.5", name: 'Small 1"×2.5" (24×64 mm)', w: 24, h: 64 },
];

export function getHoop(id) {
  return HOOPS.find((h) => h.id === id) || HOOPS[0];
}
