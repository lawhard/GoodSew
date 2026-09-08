import { computeStats } from "./stats.js";
import { SE700 } from "./hoop.js";

export function analyzeQuality(compiled, hoop = SE700.field) {
  const plan = compiled.plan || [], warnings = [];
  let short = 0, long = 0, maxLen = 0, prev = null, invalid = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const cells = new Map();
  for (const s of plan) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) { invalid++; continue; }
    if (s.cmd === "stitch" || s.cmd === "jump") {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    if (s.cmd === "stitch") {
      if (prev) {
        const d = Math.hypot(s.x - prev.x, s.y - prev.y);
        maxLen = Math.max(maxLen, d);
        if (d > 0.05 && d < 0.3) short++;
        if (d > 12.15) long++;
      }
      const key = `${Math.floor(s.x / 2)},${Math.floor(s.y / 2)}`;
      cells.set(key, (cells.get(key) || 0) + 1);
      prev = s;
    } else prev = null;
  }
  const st = computeStats(compiled);
  const add = (sev, msg) => warnings.push({ sev, msg });
  if (invalid) add("error", "Invalid stitch coordinates. Repair the design before exporting.");
  if (!st.stitches) add("error", "No stitches to export. Add visible artwork and generate stitches.");
  // Test the exact 0.1 mm centered coordinates written to PES/DST, including jumps.
  const cx = (compiled.bounds.minX + compiled.bounds.maxX) / 2;
  const cy = (compiled.bounds.minY + compiled.bounds.maxY) / 2;
  const width = (Math.round((maxX - cx) * 10) - Math.round((minX - cx) * 10)) / 10;
  const height = (Math.round((maxY - cy) * 10) - Math.round((minY - cy) * 10)) / 10;
  if (width > hoop.w || height > hoop.h) add("error", `Stitches need ${width.toFixed(1)} × ${height.toFixed(1)} mm. The SE700 field is ${hoop.w} × ${hoop.h} mm. Use Fit to hoop.`);
  else if (st.stitches && (width > hoop.w - 4 || height > hoop.h - 4)) add("warn", "Stitches are close to the hoop edge. Fit to hoop leaves a 2 mm margin.");
  if (st.stitches > SE700.maxStitches) add("error", `This pattern exceeds the SE700 limit of ${SE700.maxStitches.toLocaleString()} stitches. Reduce size or increase row spacing.`);
  if (compiled.colors.length > SE700.maxColorBlocks) add("error", "PES supports at most 256 thread blocks. Reduce thread changes.");
  if (short) add(short > 40 ? "warn" : "info", `${short} very short stitches (<0.3 mm). Inspect tiny details or enlarge the lettering.`);
  if (long) add("error", `${long} stitches exceed the 12.1 mm export limit.`);
  const dense = [...cells.values()].filter(n => n > 60).length;
  if (dense) add("warn", `${dense} crowded 2 mm areas. Check overlapping layers, tight corners, and small lettering; test on scrap.`);
  if (st.jumps > 1) add("info", `${st.jumps} travel moves. Jump threads may need manual cutting on the SE700; trim commands do not guarantee a cut.`);
  return { warnings, short, long, maxLen, valid: !warnings.some(w => w.sev === "error") };
}

export function assertExportable(compiled) {
  const errors = analyzeQuality(compiled).warnings.filter(w => w.sev === "error");
  if (errors.length) throw new Error(errors.map(w => w.msg).join(" "));
}
