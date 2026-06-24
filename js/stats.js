// Statistics over a compiled plan: counts, dimensions, run-time estimate.

// The SE700 stitches at roughly 400–650 spm. We model an effective average that
// accounts for accel/decel, plus fixed time penalties for color changes and
// trims (machine pauses / operator thread changes).
const EFFECTIVE_SPM = 550;          // stitches per minute, sustained
const COLOR_CHANGE_SECONDS = 18;    // pause + rethread allowance per change
const TRIM_SECONDS = 1.2;           // automatic trim cycle

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
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}
