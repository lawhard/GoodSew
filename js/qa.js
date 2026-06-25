// Quality analysis of a compiled plan: flags issues that cause thread breaks,
// needle damage, or a messy stitch-out, so the user can fix them before sewing.

import { computeStats } from "./stats.js";

// Returns { warnings: [{sev, msg}], short, long, maxLen }.
//   sev: "error" | "warn" | "info"
export function analyzeQuality(compiled, hoop) {
  const plan = compiled.plan || [];
  let short = 0, long = 0, maxLen = 0;
  let prev = null, penDown = false;
  for (const s of plan) {
    if (s.cmd === "stitch") {
      if (penDown && prev) {
        const d = Math.hypot(s.x - prev.x, s.y - prev.y);
        if (d > maxLen) maxLen = d;
        if (d > 0.05 && d < 0.3) short++;       // too-short = thread breaks
        if (d > 12.15) long++;                  // exceeds the 12.1mm machine cap
      }
      prev = s; penDown = true;
    } else {
      penDown = false;                          // jump/trim/color breaks the run
      prev = null;
    }
  }

  const st = computeStats(compiled);
  const warnings = [];
  if (st.stitches === 0) return { warnings, short, long, maxLen };

  if (st.width > hoop.w + 0.5 || st.height > hoop.h + 0.5) {
    warnings.push({ sev: "error", msg: `Design ${st.width.toFixed(0)}×${st.height.toFixed(0)} mm exceeds the ${hoop.w}×${hoop.h} mm field` });
  }
  if (short > 0) {
    warnings.push({ sev: short > 40 ? "warn" : "info", msg: `${short} very short stitches (<0.3 mm) — can break thread; try a longer stitch length` });
  }
  if (long > 0) {
    warnings.push({ sev: "warn", msg: `${long} over-long stitches (>12 mm)` });
  }
  if (st.jumps > 30) {
    warnings.push({ sev: "info", msg: `${st.jumps} jumps / ${st.trims} trims — “Optimize order” may reduce travel` });
  }
  return { warnings, short, long, maxLen };
}
