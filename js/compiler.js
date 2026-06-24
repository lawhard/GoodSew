// Compile design objects into a flat, ordered stitch plan.
//
// The plan is the single source of truth for simulation, statistics and export.
// It models real machine behaviour: stitch order, thread (color) changes, jump
// stitches, trims, and the needle path between penetrations.
//
// Each plan entry: { x, y, cmd, color }
//   cmd:   'stitch' | 'jump' | 'trim' | 'color' | 'end'
//   color: index into plan.colors (the thread block this entry belongs to)

import { colorBlocks } from "./state.js";
import { generateForObject } from "./stitches.js";
import { dist, sub, norm, add, scale, bbox } from "./geometry.js";

const MAX_STITCH_MM = 12.1;   // anything longer becomes a jump sequence
const MAX_MOVE_MM = 204.0;    // PEC hard limit (2047 units * 0.1mm)
const TRIM_GAP_MM = 3.0;      // gap between sub-paths that warrants a trim

// Split a long move from a->b into intermediate points no longer than maxLen.
function splitMove(a, b, maxLen) {
  const d = dist(a, b);
  if (d <= maxLen) return [b];
  const n = Math.ceil(d / maxLen);
  const dir = sub(b, a);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(add(a, scale(dir, i / n)));
  return out;
}

export function compile() {
  const blocks = colorBlocks();
  const plan = [];
  const colors = blocks.map((b) => ({ color: b.color, brother: b.brother }));
  let prev = null;  // last penetration point {x,y}
  let prev2 = null; // the penetration before prev (for tie-off direction)

  const push = (x, y, cmd, color) => {
    plan.push({ x, y, cmd, color });
    if (cmd === "stitch" || cmd === "jump") { prev2 = prev; prev = { x, y }; }
  };

  // Tie stitch: a tiny out-and-back at `pt` toward `toward`, so the thread is
  // secured at the start of a fresh run and before a trim/cut (otherwise the
  // stitching can unravel on a real machine).
  const LOCK_MM = 0.6;
  const lockAt = (pt, toward, color) => {
    if (!pt || !toward) return;
    const dx = toward.x - pt.x, dy = toward.y - pt.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) return;
    const q = { x: pt.x + (dx / l) * LOCK_MM, y: pt.y + (dy / l) * LOCK_MM };
    push(q.x, q.y, "stitch", color);
    push(pt.x, pt.y, "stitch", color);
  };

  blocks.forEach((block, ci) => {
    if (ci > 0) {
      // Thread change between blocks: tie off, trim, then signal the color
      // change. The color command carries the *new* block index.
      if (prev) { lockAt(prev, prev2, ci - 1); push(prev.x, prev.y, "trim", ci - 1); }
      push(prev ? prev.x : 0, prev ? prev.y : 0, "color", ci);
    }

    for (const obj of block.objects) {
      const subpaths = generateForObject(obj).filter((sp) => sp && sp.length >= 2);
      for (const pts of subpaths) {
        let fresh = false; // true = thread was just started/re-started here
        if (prev === null) {
          // very first stitch of the design — position with a jump
          push(pts[0].x, pts[0].y, "jump", ci);
          push(pts[0].x, pts[0].y, "stitch", ci);
          fresh = true;
        } else {
          const gap = dist(prev, pts[0]);
          if (gap > TRIM_GAP_MM) {
            // Disjoint sub-path: tie off, trim, jump across, restart.
            lockAt(prev, prev2, ci);
            push(prev.x, prev.y, "trim", ci);
            for (const p of splitMove(prev, pts[0], MAX_MOVE_MM)) push(p.x, p.y, "jump", ci);
            push(pts[0].x, pts[0].y, "stitch", ci);
            fresh = true;
          } else {
            // Close enough to walk there with stitches (thread stays unbroken).
            for (const p of splitMove(prev, pts[0], MAX_STITCH_MM)) push(p.x, p.y, "stitch", ci);
          }
        }

        // Tie in at the start of a fresh run.
        if (fresh) lockAt(pts[0], pts[1], ci);

        // Emit the body of the sub-path, splitting any over-long segments.
        for (let i = 1; i < pts.length; i++) {
          for (const p of splitMove(pts[i - 1], pts[i], MAX_STITCH_MM)) {
            push(p.x, p.y, "stitch", ci);
          }
        }
      }
    }
  });

  if (prev) {
    lockAt(prev, prev2, Math.max(0, colors.length - 1)); // final tie-off
    push(prev.x, prev.y, "trim", Math.max(0, colors.length - 1));
    push(prev.x, prev.y, "end", Math.max(0, colors.length - 1));
  }

  const stitchPts = plan.filter((s) => s.cmd === "stitch");
  const bounds = stitchPts.length ? bbox(stitchPts) : { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };

  return { plan, colors, bounds };
}
