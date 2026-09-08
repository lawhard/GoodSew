// Statistics over a compiled plan: counts, dimensions, run-time estimate.

// SE700 embroidery maximum is 400 spm (710 is sewing only). Estimates
// use 350 effective spm and allow a minute to change a single-needle spool.
const EFFECTIVE_SPM = 350;
const COLOR_CHANGE_SECONDS = 60;
const TRIM_SECONDS = 3; // planning allowance; jump threads may need manual cutting

export function computeStats(compiled) {
  const { plan, bounds } = compiled;
  let stitches = 0, jumps = 0, trims = 0, colors = 0;
  for (const s of plan) {
    if (s.cmd === "stitch") stitches++;
    else if (s.cmd === "jump") jumps++;
    else if (s.cmd === "trim") trims++;
    else if (s.cmd === "color") colors++;
  }
  // Number of thread colors = color-change count + 1 (if any stitching at all).
  const threadColors = stitches > 0 ? colors + 1 : 0;

  const seconds =
    (stitches / EFFECTIVE_SPM) * 60 +
    colors * COLOR_CHANGE_SECONDS +
    trims * TRIM_SECONDS;

  return {
    stitches,
    jumps,
    trims,
    colorChanges: colors,
    threadColors,
    width: bounds.w,
    height: bounds.h,
    seconds,
  };
}

export function formatTime(seconds) {
  if (!seconds || seconds < 1) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}
