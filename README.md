# GoodSew — Brother SE700 Embroidery Digitizer

A fully in-browser embroidery designer built **exclusively for the Brother
SE700**. It works in two simple phases: **① Design** — lay out text and shapes
as solid, WYSIWYG artwork and arrange them like you would in Word or an image
markup tool; then **② Render** — one button turns your layout into real machine
stitches that you can fine-tune, watch sew out in a simulator, and export as a
`.pes` file the machine reads. All client-side, no build step, no server.

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

### ① Design phase — lay it out
Objects are shown as **solid vector art** (not stitches), so you can see exactly
what you're making. Select / move with the mouse, drag the **8 resize handles**
to scale (hold **Shift** for even/locked aspect), and use the **rotate knob** to
spin. Everything is meant to feel like Word or an image markup tool.

- **Text** — click to drop, then just type. **Double-click** any text to edit it
  in place. A prominent **Font Library** shows all 11 embroidery-friendly fonts
  rendered live with your own words so you can pick visually. Make text **bold /
  italic / underlined**, bend it into an **arc or full circle**, set its size and
  rotation, and recolor it — all from a clean properties panel.
- **Shapes** — a visual picker (not a dropdown): rectangle, rounded rectangle,
  ellipse/circle, triangle, diamond, pentagon, hexagon, 5/6-point stars and
  heart. Pick one, drag to place (Shift for an even shape), then resize/rotate
  like anything else. Filled or outline-only.
- **Background image tracing** — import any image and lay artwork over it.

### ② Render phase — stitch it
Hit **⚡ Render Stitches** and the layout compiles into a real stitch plan with a
sensible, good-looking **default tatami fill** — no tuning required. From there
you can fine-tune each object's **density, stitch length, fill angle, underlay**
and an optional **outline pass**, then simulate and export.

- **Smart tatami fill** — a connected-component serpentine: spans are
  linked across rows so the fill is sewn as one continuous path whose
  travel stays **inside** the shape, so concave regions (a heart's notch,
  etc.) fill cleanly with no jump across the fold. It is fully
  **hole-aware** — stitches never travel across letter counters (the
  insides of **O, U, e, a, B, 8**…); the edge underlay traces only outer
  contours, never counters. A small **pull-compensation inset** keeps
  thread inside the outline so it doesn't bleed over edges or pinch thin
  apertures shut. Lettering gets a lighter underlay so small text stays
  crisp.

### More
- **Light & dark themes** — light is the default; toggle any time (◐ in the top bar).
- **Product preview** — see the design composited at *true physical scale* onto
  a medium t-shirt (left chest), sneaker, bath towel, bath mat, or a custom
  rectangle whose dimensions you type in. Each mockup is drawn to real-world
  proportions, so the same design correctly reads tiny on a towel and prominent
  on a small swatch — a faithful sense of size and placement before stitching.
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
  stitches.js          hole-aware tatami-fill (+ underlay) & text generators
  shapes.js            shape preset outline polygons
  fonts.js             font catalog + text → glyph contours (bold/italic/arc)
  compiler.js          objects → ordered stitch plan (order, jumps, trims, colors)
  stats.js             stitch/jump/trim counts + run-time estimate (710 spm)
  threads.js           Brother 64-colour palette + nearest-colour matching
  hoop.js              SE700 capabilities (100×100 mm field, 710 spm)
  render.js            Canvas: light/dark themes, design solids + handles, stitches
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
node test/fill.test.mjs       # hole-aware fill: zero stitches cross letter counters
node test/ui.e2e.mjs          # real-browser: design tools, handles, render, export
node test/workflow.e2e.mjs    # real-browser: full design→render→simulate→export
node test/gen_pes.mjs && python3 test/verify_pes.py   # machine-format check
```

- **pipeline** — compiles a multi-colour design, checks the stitch plan and
  statistics, exports a PES file, and decodes the PEC stitch stream back to
  confirm the bounding box round-trips (validates the delta encoder).
- **text** — loads a font, converts text to glyph contours (verifying letter
  counters become holes), and fills it to stitches.
- **fill** — generates fills for holed glyphs (O, U, e, a, B, 8, "good") across
  fonts and asserts that **zero** stitch segments ever cross a counter — the
  regression guard for the hole-aware fill.
- **e2e / workflow** — drive the app in headless Chrome through the two-phase UI:
  design tools, select/move/resize/rotate handles, the font library, the Render
  step, the simulator, preview and PES export — all with no console errors.
  Require a local static server on :8137 and `puppeteer-core`
  (`npm i puppeteer-core`).
- **verify_pes** — the most important check: reads an exported PES back with
  **pyembroidery** (an independent library that mirrors how the machine parses
  the file) and confirms every stitch position, the bounding box, the colors and
  the command structure (stitch / jump / trim / color-change / end) match the
  source plan exactly. Requires `pip install pyembroidery`.

## Disclaimer
Always preview a new design on stabilizer/scrap before stitching on your final
material. Run-time figures are estimates.
