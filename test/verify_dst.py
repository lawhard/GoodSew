#!/usr/bin/env python3
"""Read GoodSew's DST with pyembroidery and confirm it decodes to a valid,
correctly-dimensioned design — an independent check the DST writer is faithful."""
import json
import sys
import pyembroidery as pe

fails = 0
def ok(cond, msg):
    global fails
    print(("  OK  " if cond else "  XX  ") + msg)
    if not cond:
        fails += 1

with open("/tmp/gs_dst_expected.json") as f:
    exp = json.load(f)

pattern = pe.read("/tmp/gs_sample.dst")
stitches = pattern.stitches

counts = {}
for x, y, cmd in stitches:
    counts[cmd] = counts.get(cmd, 0) + 1
name = {pe.STITCH: "STITCH", pe.JUMP: "JUMP", pe.TRIM: "TRIM",
        pe.COLOR_CHANGE: "COLOR_CHANGE", pe.STOP: "STOP", pe.END: "END"}
print("Decoded:", {name.get(k, k): v for k, v in counts.items()})

stitch_pts = [(x, y) for x, y, c in stitches if c == pe.STITCH]
color_changes = counts.get(pe.COLOR_CHANGE, 0)

print("DST read-back:")
ok(len(stitch_pts) == exp["stitchCount"],
   f"stitch count {len(stitch_pts)} == expected {exp['stitchCount']}")
ok(color_changes == exp["colorBlocks"] - 1,
   f"color-change commands {color_changes} == blocks-1 ({exp['colorBlocks'] - 1})")

xs = [p[0] for p in stitch_pts]; ys = [p[1] for p in stitch_pts]
w = max(xs) - min(xs); h = max(ys) - min(ys)
ok(abs(w - exp["width"]) <= 2, f"width {w} == expected {exp['width']} (0.1mm)")
ok(abs(h - exp["height"]) <= 2, f"height {h} == expected {exp['height']} (0.1mm)")

ok(counts.get(pe.END, 0) >= 1, "file carries an END")
# largest single move must respect DST's per-record limit
mx = 0
last = None
for x, y, c in stitches:
    if last is not None:
        mx = max(mx, abs(x - last[0]), abs(y - last[1]))
    last = (x, y)
ok(mx <= 121, f"no single move exceeds DST's 121-unit limit (max {mx})")

print("\nDST: ALL PASS" if fails == 0 else f"\nDST: {fails} FAILURE(S)")
sys.exit(1 if fails else 0)
