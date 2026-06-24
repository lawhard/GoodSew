// Display units. The model is always millimetres internally (the machine works
// in 0.1 mm); these helpers convert for display. 1 inch = 25.4 mm exactly.

export const MM_PER_IN = 25.4;

export const UNITS = {
  in: { name: "in", mmPer: 25.4, suffix: "\"", dec: 2, steps: [0.0625, 0.125, 0.25, 0.5, 1, 2, 4], minorDiv: 4 },
  mm: { name: "mm", mmPer: 1, suffix: " mm", dec: 1, steps: [1, 2, 5, 10, 20, 50, 100], minorDiv: 5 },
};

// Format a length given in mm into the chosen unit, e.g. fmt(100,'in') => '3.94"'.
export function fmt(mm, unit) {
  const u = UNITS[unit] || UNITS.mm;
  const v = mm / u.mmPer;
  return trimNum(v, u.dec) + u.suffix;
}

// Number only (no suffix), trimmed of trailing zeros.
export function toUnit(mm, unit) {
  const u = UNITS[unit] || UNITS.mm;
  return mm / u.mmPer;
}

export function fromUnit(val, unit) {
  const u = UNITS[unit] || UNITS.mm;
  return val * u.mmPer;
}

function trimNum(v, dec) {
  return String(Number(v.toFixed(dec)));
}
