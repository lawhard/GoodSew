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
  let prev = null; // last penetration point {x,y}

  const push = (x, y, cmd, color) => {
    plan.push({ x, y, cmd, color });
    if (cmd === "stitch" || cmd === "jump") prev = { x, y };
  };

  blocks.forEach((block, ci) => {
    if (ci > 0) {
      // Thread change between blocks: trim the running thread, then signal a
      // color change. The color command carries the *new* block index.
      if (prev) push(prev.x, prev.y, "trim", ci - 1);
      push(prev ? prev.x : 0, prev ? prev.y : 0, "color", ci);
    }

    for (const obj of block.objects) {
      const subpaths = generateForObject(obj).filter((sp) => sp && sp.length >= 2);
      for (const pts of subpaths) {
        // Move the needle to this sub-path's start.
        if (prev === null) {
          // very first stitch of the design — position with a jump
          push(pts[0].x, pts[0].y, "jump", ci);
          push(pts[0].x, pts[0].y, "stitch", ci);
        } else {
          const gap = dist(prev, pts[0]);
          if (gap > TRIM_GAP_MM) {
            // Disjoint sub-path: trim then jump across.
            push(prev.x, prev.y, "trim", ci);
            for (const p of splitMove(prev, pts[0], MAX_MOVE_MM)) push(p.x, p.y, "jump", ci);
            push(pts[0].x, pts[0].y, "stitch", ci);
          } else {
            // Close enough to walk there with stitches.
            for (const p of splitMove(prev, pts[0], MAX_STITCH_MM)) push(p.x, p.y, "stitch", ci);
          }
        }

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
    push(prev.x, prev.y, "trim", Math.max(0, colors.length - 1));
    push(prev.x, prev.y, "end", Math.max(0, colors.length - 1));
  }

  const stitchPts = plan.filter((s) => s.cmd === "stitch");
  const bounds = stitchPts.length ? bbox(stitchPts) : { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };

  return { plan, colors, bounds };
}
