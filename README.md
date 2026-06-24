# GoodSew — Brother SE700 Embroidery Digitizer

A fully in-browser embroidery digitizing studio for the **Brother SE700**. Draw
vector shapes, turn them into real machine stitches, watch the design sew out in
a simulator, and export a `.pes` file the machine can read — all client-side,
with no build step and no server.

![tool: vanilla JS + Canvas](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Canvas-blue)

## Quick start

It's a static site — no install, no build. Serve the folder and open it:

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly also works in most browsers, though a server is
recommended so ES modules load cleanly.)

## Features

### Digitizing tools
- **Running stitch** — evenly spaced stitches along a path, with adjustable
  stitch length and repeat passes (bean stitch).
- **Satin column** — zig-zag column drawn along a centre spine, with adjustable
  width and density.
- **Tatami fill** — parallel-row fill of a closed region with adjustable row
  spacing, stitch length and angle, using a boustrophedon traversal and a
  brick-offset stitch phase for a natural tatami texture.
- **Background image tracing** — import any image and trace over it.
- Select / move / reshape objects, per-object visibility, and a layer list that
  defines stitch order.

### Machine-accurate simulation
The design compiles to an ordered **stitch plan** that models exactly what the
machine does. The simulator plays it back so you can verify before you stitch:
- **Stitch order** — watch every penetration in sequence; scrub anywhere.
- **Thread changes** — colour blocks are detected from object order; the readout
  names the active Brother thread.
- **Jump stitches** — long travel moves rendered as dashed blue lines.
- **Trims** — thread cuts between disjoint sub-paths and colour changes, marked
  in red.
- **Needle path** — the live needle head with crosshair tracks the current move.
- **Estimated stitch count & run time** — live statistics including dimensions,
  jump/trim counts, and a run-time estimate that accounts for sewing speed,
  colour-change pauses and trim cycles.

### PES export
Exports a **Brother PES v1** file with an embedded **PEC** block — the format the
SE700 reads off USB. The writer is byte-accurate to the pyembroidery
specification:
- 0.1 mm units, Y-down coordinate space, design auto-centred.
- Correct short/long-form delta encoding (long form is big-endian), with jump and
  trim flag bits.
- `FE B0` colour-change markers and Brother 64-colour palette matching
  (compuphase nearest-colour).
- 48×38 1-bpp PEC thumbnails (composite + per colour).
- Long moves split to respect the ±2047-unit limit.

Colours snap to the nearest of the 64 standard Brother embroidery threads, and the
export warns if the design exceeds the selected hoop field.

### Hoops
- 5"×7" (130×180 mm) — the SE700's large frame
- 4"×4" (100×100 mm)
- 1"×2.5" (24×64 mm) small frame

## Project files (`.gsew`)
Save/Open stores your editable vector design as JSON so you can keep refining it.
The PES file is the final, flattened machine output.

## Architecture

```
index.html            UI shell
css/styles.css         studio theme
js/
  app.js               controller: tools, interaction, panels, export wiring
  state.js             design data model + serialization
  geometry.js          vector math (resample, scanline, rotate, hit-test)
  stitches.js          running / satin / tatami-fill generators
  compiler.js          objects → ordered stitch plan (order, jumps, trims, colors)
  stats.js             stitch/jump/trim counts + run-time estimate
  threads.js           Brother 64-colour palette + nearest-colour matching
  hoop.js              SE700 hoop definitions
  render.js            Canvas: hoop, grid, image, stitches, jumps, needle head
  simulator.js         stitch-out playback engine
  export/pes.js        byte-accurate PES v1 + PEC writer
docs/pes-format-notes.md   the format spec the writer follows
test/pipeline.test.mjs     headless compile → stats → PES round-trip test
```

## Tests

```bash
node test/pipeline.test.mjs
```

Compiles a multi-colour design, checks the stitch plan and statistics, exports a
PES file, and decodes the PEC stitch stream back to confirm the bounding box
round-trips (validates the delta encoder).

## Disclaimer
Always preview a new design on stabilizer/scrap before stitching on your final
material. Run-time figures are estimates.
