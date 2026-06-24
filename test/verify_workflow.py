#!/usr/bin/env python3
"""Verify the workflow's exported PES reads back correctly in pyembroidery
(independent machine-format reader) and fits the SE700 field."""
import json, sys
import pyembroidery as pe

fails = 0
def ok(c, m):
    global fails
    print(("  OK  " if c else "  XX  ") + m)
    if not c: fails += 1

meta = json.load(open("/tmp/gs_workflow_meta.json"))
pat = pe.read("/tmp/gs_workflow.pes")
st = pat.stitches

counts = {}
for x, y, c in st:
    counts[c] = counts.get(c, 0) + 1
name = {pe.STITCH: "STITCH", pe.JUMP: "JUMP", pe.TRIM: "TRIM",
        pe.COLOR_CHANGE: "COLOR_CHANGE", pe.STOP: "STOP", pe.END: "END"}
print("Decoded:", {name.get(k, k): v for k, v in counts.items()})

stitch_pts = [(x, y) for x, y, c in st if c == pe.STITCH]
ok(len(stitch_pts) == meta["stitchCount"],
   f"stitch count {len(stitch_pts)} == app-reported {meta['stitchCount']} (no phantom stitches)")
ok(len(pat.threadlist) == meta["colorBlocks"],
   f"threads {len(pat.threadlist)} == app-reported {meta['colorBlocks']}")
ok(counts.get(pe.COLOR_CHANGE, 0) == meta["colorBlocks"] - 1,
   f"color changes {counts.get(pe.COLOR_CHANGE,0)} == colors-1")
ok(counts.get(pe.END, 0) == 1, "file ends with exactly one END")

xs = [p[0] for p in stitch_pts]; ys = [p[1] for p in stitch_pts]
w = (max(xs) - min(xs)) / 10.0; h = (max(ys) - min(ys)) / 10.0
ok(abs(w - meta["widthMm"]) < 1 and abs(h - meta["heightMm"]) < 1,
   f"decoded size {w:.1f}x{h:.1f}mm == app {meta['widthMm']:.1f}x{meta['heightMm']:.1f}mm")
ok(w <= 100.5 and h <= 100.5, f"fits SE700 100mm field ({w:.1f}x{h:.1f}mm)")
ok(all(t.get_red() is not None for t in pat.threadlist), "all threads carry RGB")

print("\nWORKFLOW PES: ALL PASS" if fails == 0 else f"\nWORKFLOW PES: {fails} FAILURE(S)")
sys.exit(1 if fails else 0)
