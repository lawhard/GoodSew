# GoodSew — Brother SE700 Embroidery Digitizer

A fully in-browser embroidery digitizing studio built **exclusively for the
Brother SE700**. Draw shapes and lettering, turn them into real machine stitches,
watch the design sew out in a simulator, and export a `.pes` file the machine can
read — all client-side, with no build step and no server.

The whole app is tied to the SE700's real capabilities: a **4" × 4"
(100 × 100 mm)** embroidery field and a **710 spm** maximum speed (used in the
run-time estimate). Designs that exceed the field are flagged before export.

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
  brick-offset stitch phase for a natural tatami texture. Handles **holes**
  (multi-contour even-odd) so letters and rings fill correctly.
- **Shapes** — rectangle, rounded rectangle, ellipse/circle, triangle, diamond,
  pentagon, hexagon, 5/6-point stars, heart and line. Drag to draw; each becomes
  an editable filled or outlined object.
- **Lettering** — a suite of 11 embroidery-friendly fonts (sans, slab, serif,
  script, display) rendered to true glyph outlines (via opentype.js) and filled
  as tatami, with adjustable height, letter spacing, fill angle and an optional
  outline pass. Each glyph is trimmed/jumped independently.
- **Product preview** — see the design composited at *true physical scale* onto
  a medium t-shirt (left chest), shoe, towel, bath mat, or a custom rectangle
  whose dimensions you type in, so you can judge real size and placement before
  stitching.
- **Background image tracing** — import any image and trace over it.
- **Rulers, cursor coordinates & guides** — mm rulers on both axes that track
  zoom/pan, a live cursor position marker, and draggable guide lines: pull a
  vertical guide from the top ruler or a horizontal guide from the left ruler;
  drag a guide back onto a ruler (or double-click it) to remove it.
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

### Embroidery field
- 4" × 4" (100 × 100 mm) — the Brother SE700's single embroidery hoop and
  maximum machine area. The canvas, export bounds check and rulers are all keyed
  to this field.

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
  stitches.js          running / satin / tatami-fill (multi-contour) generators
  shapes.js            shape preset outline polygons
  fonts.js             font catalog + text → glyph-contour conversion
  compiler.js          objects → ordered stitch plan (order, jumps, trims, colors)
  stats.js             stitch/jump/trim counts + run-time estimate (710 spm)
  threads.js           Brother 64-colour palette + nearest-colour matching
  hoop.js              SE700 capabilities (100×100 mm field, 710 spm)
  render.js            Canvas: rulers, guides, hoop, grid, stitches, needle head
  simulator.js         stitch-out playback engine
  export/pes.js        byte-accurate PES v1 + PEC writer
vendor/opentype.min.js     opentype.js (MIT) — glyph outline parsing
fonts/*.ttf                bundled OFL fonts (see fonts/NOTICE.md)
docs/pes-format-notes.md   the format spec the writer follows
test/*.test.mjs, test/ui.e2e.mjs   automated tests
```

## Tests

```bash
node test/pipeline.test.mjs   # compile → stats → PES, decode PEC round-trip
node test/text.test.mjs       # font → glyph contours (with holes) → fill stitches
node test/ui.e2e.mjs          # real-browser: rulers, guides, shapes, text, export
node test/gen_pes.mjs && python3 test/verify_pes.py   # machine-format check
```

- **pipeline** — compiles a multi-colour design, checks the stitch plan and
  statistics, exports a PES file, and decodes the PEC stitch stream back to
  confirm the bounding box round-trips (validates the delta encoder).
- **text** — loads a font, converts text to glyph contours (verifying letter
  counters become holes), and fills it to stitches.
- **e2e** — drives the app in headless Chrome to verify draggable ruler guides,
  shape drawing, text placement and PES export with no console errors. Requires
  a local static server on :8137 and `puppeteer-core` (`npm i puppeteer-core`).
- **verify_pes** — the most important check: reads an exported PES back with
  **pyembroidery** (an independent library that mirrors how the machine parses
  the file) and confirms every stitch position, the bounding box, the colors and
  the command structure (stitch / jump / trim / color-change / end) match the
  source plan exactly. Requires `pip install pyembroidery`.

## Disclaimer
Always preview a new design on stabilizer/scrap before stitching on your final
material. Run-time figures are estimates.
