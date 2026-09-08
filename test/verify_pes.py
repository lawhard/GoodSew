#!/usr/bin/env python3
"""Read GoodSew's PES with pyembroidery and confirm it matches the expected
stitch stream. This is an independent check that the file is machine-faithful."""
import json
import sys
import pyembroidery as pe

fails = 0
def ok(cond, msg):
    global fails
    print(("  OK  " if cond else "  XX  ") + msg)
    if not cond:
        fails += 1

with open("/tmp/gs_expected.json") as f:
    exp = json.load(f)

pattern = pe.read("/tmp/gs_sample.pes")
stitches = pattern.stitches  # [x, y, command] in 0.1mm, +Y down

# Tally commands
counts = {}
for x, y, cmd in stitches:
    counts[cmd] = counts.get(cmd, 0) + 1
name = {pe.STITCH: "STITCH", pe.JUMP: "JUMP", pe.TRIM: "TRIM",
        pe.COLOR_CHANGE: "COLOR_CHANGE", pe.STOP: "STOP", pe.END: "END",
        pe.SEQUIN_MODE: "SEQUIN", pe.SEQUIN_EJECT: "SEQUIN_EJECT"}
print("Decoded commands:", {name.get(k, k): v for k, v in counts.items()})

stitch_pts = [(x, y) for x, y, c in stitches if c == pe.STITCH]
color_changes = counts.get(pe.COLOR_CHANGE, 0)

print("PES read-back:")
ok(len(stitch_pts) == exp["stitchCount"],
   f"stitch count {len(stitch_pts)} == expected {exp['stitchCount']}")
# pyembroidery threadlist length == number of color blocks
ok(len(pattern.threadlist) == exp["colorBlocks"],
   f"thread count {len(pattern.threadlist)} == expected {exp['colorBlocks']}")
ok(color_changes == exp["colorBlocks"] - 1,
   f"color-change commands {color_changes} == blocks-1 ({exp['colorBlocks']-1})")

# Compare stitch positions up to a single constant translation: the exporter's
# origin convention may differ from the plan's (v0.12 writes full PES header
# sections that pyembroidery reads corner-origin, the plan is center-origin),
# but every stitch must sit at the same place relative to every other stitch.
exp_pts = exp["stitches"]
mismatch = 0
n = min(len(exp_pts), len(stitch_pts))
dx = stitch_pts[0][0] - exp_pts[0][0] if n else 0
dy = stitch_pts[0][1] - exp_pts[0][1] if n else 0
print(f"origin offset: ({dx},{dy})")
for i in range(n):
    ex, ey = exp_pts[i]
    ax, ay = stitch_pts[i]
    if abs(ax - dx - ex) > 1 or abs(ay - dy - ey) > 1:
        mismatch += 1
        if mismatch <= 5:
            print(f"    pos[{i}] got ({ax},{ay}) expected ({ex+dx},{ey+dy})")
ok(mismatch == 0, f"all {n} stitch positions match within 1 unit ({mismatch} mismatched)")

# Bounding boxes must agree in SIZE (origin may differ by the same translation)
def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)
eb = bbox(exp_pts); ab = bbox(stitch_pts)
ok(abs((ab[2]-ab[0]) - (eb[2]-eb[0])) <= 1 and abs((ab[3]-ab[1]) - (eb[3]-eb[1])) <= 1,
   f"bbox size match: pes {ab} vs expected {eb}")

# Each thread maps to a real Brother color (has RGB)
ok(all(t.get_red() is not None for t in pattern.threadlist),
   "all threads carry an RGB color")

print("\nALL PASS" if fails == 0 else f"\n{fails} FAILURE(S)")
sys.exit(1 if fails else 0)
