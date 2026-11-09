# Good Sew Studio 0.13.0

A browser-based embroidery design workspace for the **Brother SE700**. This revision repairs GoodSew 0.8.1 while preserving its local-first, static-site architecture, font library, digitizing tools, simulation, product previews, and 3D view.

The request mentioned “SC700.” The supplied app already targets SE700, and Brother's official SE700 manual confirms the profile used here. The physical model has not been confirmed by the owner. Do not assume compatibility with another model.

## New in 0.13.0: satin that shines, and a worked AI example

- **Split satin** (`params.split`): paired-rail satin can now cover areas of any width. Long throws are broken into staggered stitches, so thread direction and lustre are preserved without loose floats.
- **Fur edges** (`params.featherA` / `featherB`), converging-fan short stitches, and edge + lattice underlay for wide columns.
- **Assistant commands**: `add_region` (freeform fills), `add_satin` from a spine and width, `smooth` control nodes, `preview_2d` (fast lit stitch picture), density `hotspots`, and a project **fabric colour** used by the workspace and both previews. In-page agents can call `window.goodsew.call(name, args)`.
- **Samples → Timi the Yorkie**: a satin portrait built entirely from assistant commands (`js/samples/timi.js`). Open the app with `?sample=timi`, or replay it headlessly with `node scripts/assistant-run.mjs js/samples/timi.js out --3d --export`.

## Flat-colour art to stitches (0.16.0)

`tools/trace_lineart.py art.png trace.json --colors 3` separates a flat illustration into thread colours: broad shapes become fills, strokes become satin, hairlines become double running stitch, sewn light to dark. Fills now link their sections with hidden travel routed inside the shape (`js/travel.js`), so a tufted shape sews as one run instead of trimming between every tuft. **Timi in three colours** was made this way from `docs/art/timi-three-colour-art.png`.

## Line art to satin (0.15.0)

`tools/trace_lineart.py art.png trace.json` turns black-on-white line art into assistant commands: every stroke becomes a satin column (skeleton centre line, measured width, tapered tips), solid shapes become fills that keep their highlights, and strokes are ordered nearest-neighbour to keep jumps short. `node scripts/import-trace.mjs trace.json js/samples/name.js` checks each command against the stitch compiler and writes a sample module. Needs Python with numpy, scipy, scikit-image and Pillow. The **Timi, brush portrait** sample was made this way from `docs/art/timi-brush-art.png`, which an image model drew from her photo with a prompt asking for bold, well-separated, even-weight strokes.

## Use the app

1. Give your project a name. Add text, shapes, running or satin lines, or import a clean logo.
2. Choose a fabric. **Apply starting settings** updates selected objects, or all objects when none are selected. These are starting values for a test sew, not a guarantee of fabric performance.
3. **Fit to hoop** regenerates actual stitches and centers the design with a 2 mm margin. **Add basting** adds a removable running-stitch frame first when there is room.
4. **Generate stitches**. Inspect holes and travel moves, play the sewing sequence, and review the quality messages. Click a spool-order entry to move the simulator to that thread block.
5. Download **PES** and the **sewing sheet**. Save a `.gsew` project backup to retain editable objects.

Projects autosave in the current browser and origin. Private deployment, localhost, and an older goodsew.win installation have separate browser storage: download a project from the old origin and Open it on the new one. Browser storage is not a cloud backup.

## Precise control and paired-rail satin

**Assistant control** opens a visible command panel and can enable the local MCP connection for this tab. Both use the same validated design commands. Changes use object IDs and a project revision, are compiled before application, and enter normal Undo history. Duplicate edit requests are recognized by request ID. The app rejects crossed rails and overlong satin throws before committing connector edits.

Start with `npm run dev` (Node.js). In Codex, register the local stdio adapter once:

```sh
codex mcp add good-sew -- node /absolute/path/to/good-sew/mcp/server.mjs
```

Then open **Assistant control → Enable local MCP** in the intended tab. Disconnect revokes the connection; reloading requires enabling it again. The server binds to 127.0.0.1, checks origin/host and credentials, and serves only public app files. Its generated `.local/connector.json` stays private and is excluded from Git, packages and static hosting. See [design-automation.md](docs/design-automation.md) for commands and examples. The connector is local; a static hosted copy still has browser commands but has no remote MCP backend.

Select existing text and choose **Use Satin Round lettering** to replace the outline-font approximation with original, authored stroke lettering. The result is editable paired-rail satin columns with shared direction nodes, curved stitch direction, short-stitch handling, center underlay, and full-cycle density. Sharp joins are split to prevent rail inversion. Undo restores the original font. Move, resize and rotate columns normally; edit their exact world-coordinate rails through Assistant control.

Satin Round currently has all capitals and digits, plus exact lowercase `o c d e s w l i n u`, hyphen and period. Other ASCII lowercase letters use capital forms and report the substitution; unsupported characters are rejected. This is an early geometric alphabet, not a professionally test-sewn font library. Overlapping joins and small sizes need inspection and a physical stitch-out. Generic outline-font automatic digitization remains heuristic.

## Legacy smooth satin lettering

Select a text or fill object, Generate stitches, then choose **Smooth satin lettering** in Stitch Settings. This opt-in preset replaces ladder edge steps with continuous alternating rail stitches, retains horizontal satin sections at connected terminals, and resamples the center underlay at 2 mm. Existing projects retain their previous construction until the option is enabled. Undo restores the previous settings.

The preset uses automatic satin/fill selection, 0.4 mm full-cycle spacing (two crossing stitches per cycle), center underlay, and 0.1 mm boundary inset. It does not alter the preview's thread thickness. Decreasing spacing increases coverage and stitch count; wide regions still use tatami. The separate manually drawn Satin line tool retains its original per-leg spacing semantics.

This is an incremental improvement, not full automatic satin digitization: scanline-derived rails still need better corner direction, variable-width editing, and pre-digitized lettering for consistently polished results. See [the integration design](docs/design-automation.md) for the implemented precise editing and verification interface.

## Thread Lab: PES in 3D

Click **Preview PES** to open a `.pes` or `.pec` file directly, or **Generate stitches → 3D View** for your current design. Imported stitch files do not replace your editable project.

- Actual needle coordinates and sewing order drive the model; jumps remain separate from sewn thread.
- Curved strands have procedural ply and microfiber texture, adjustable diameter in millimeters and loft, plus polyester, rayon, and cotton appearance presets.
- Woven fabric, directional lighting, exposure, estimated overlap height, macro detail, needle points, and travel paths are adjustable.
- Orbit by dragging, pan with Shift-drag, zoom with the wheel or pinch. Arrow keys orbit, +/− zoom, Home resets. Click a strand to inspect its stitch length.
- Play the sewing sequence, scrub by stitch, or jump to a thread block. Preview colors are editable without changing the source file. **Save image** prepares a PNG through browser downloads.

The reader supports standard PES/PEC stitch streams and common PES v5–v10 custom thread metadata; unsupported metadata falls back to the PEC palette with a warning. It rejects malformed or oversized inputs (16 MB, 200,000 stitches, 600,000 commands, or 2,000 mm dimensions). Large files and macro detail require more GPU memory. It does not recover editable shapes from stitches.

This is a detailed visual estimate, not a calibrated physical simulation. PES supplies needle positions and color information, not actual thread diameter, tension, fabric stretch, or compression. Diameter defaults to an assumed 0.24 mm; material finishes and overlap height are approximations. A physical test sew remains necessary.

## Machine profile and transfer

The [Brother SE700 operation manual](https://download.brother.com/welcome/doch102582/888p10_om01en.pdf), specifications on printed page 96, gives:

- Maximum embroidery field: 100 × 100 mm.
- Maximum embroidery speed: 400 stitches/minute. The 710 figure is sewing speed.
- Maximum 100,000 stitches per embroidery pattern.
- PES and DST are among the supported embroidery formats.

Good Sew exports centered PES v1/PEC files, or DST. Both exporters block empty/invalid data, excessive stitch counts, and designs exceeding the actual 100 mm field after 0.1 mm rounding, including travel. A 256-block limit is the PEC encoding limit, not a claimed machine specification.

Copy PES to a compatible USB flash drive and recall the pattern on the machine. Wireless transfer uses Brother Design Database Transfer on a compatible Windows PC; the browser does not send files directly to the machine. PES maps colors to Brother's palette. The sewing sheet lists nearest New brothread spools in sewing order; spool matches are approximate. DST carries no thread colors.

The time estimate assumes 350 effective stitches/minute and one minute per spool change. Thread cuts and handling add time. Trim commands may not produce automatic jump-thread cuts on the SE700. Inspect and manually cut travel threads as needed.

## Repairs and additions

- Corrected the shared arc-length resampling routine: fine curve segments now accumulate into regular needle points, rather than dropping intermediate points and sewing an endpoint chord. This repairs curved underlay and running paths throughout the digitizer.

- Running and satin objects retain their types through Save/Open and autosave; holes and grouping survive round trips.
- An empty saved document stays empty. Undo preserves grouping, captures pending edits, and restores the document after New/Open.
- Malformed projects are rejected before changing the current document; finite geometry, supported types, and bounded data are validated.
- Color changes travel to the new object before any new-color penetration. Tie stitches cannot overshoot their reference segment; short-stitch cleanup preserves reversals.
- Bean stitch reinforces each segment instead of simply retracing the entire outline.
- Order optimization preserves all potentially overlapping pairs and never increases color changes.
- SVG subpaths are split explicitly, including relative movetos, keeping nearby holes separate. Definitions are excluded. Imported SVG is sanitized before attachment and its CSS isolated from the app. Open strokes remain open running paths.
- SVGs containing text, reusable references, embedded images, masks, clips, or filters are rejected with guidance to flatten them or import a PNG, rather than silently losing artwork. Gradients are approximated as solid thread colors; full SVG rendering fidelity is not claimed.
- Raster import exposes a color-count limit and optional background removal; small-image corner sampling is corrected.
- Stitch settings show the correct controls for running and satin objects. Font load failures no longer silently produce incomplete exports.
- Named projects, visible browser-save status, fabric starting settings, stitch-aware hoop fitting, basting, spool-order navigation, printable sewing sheets, explicit zoom/fit controls, keyboard focus indicators, a quick guide, and a responsive workspace.
- Automated checks flag short stitches, crowded areas, edge proximity, and jump-thread handling. They are heuristics, not a physical sew-out certification.

## Development

Node.js 22+ is used for the app and local connector. Python 3 is optional for independent machine-file verification. The deployed app has no backend or runtime npm dependencies.

```sh
npm ci
npm test
npm run test:connector
npm run build
npm run dev
```

Open `http://127.0.0.1:8137/`. Production static assets are in `dist/`; build output excludes source tests and development dependencies. The GitHub Pages workflow tests and builds before publishing only `dist/`.

`npm test` runs the existing geometry suites, new persistence/export/ordering regressions, SVG DOM tests using an independent geometry library, and a DOM control smoke test. The DOM harness stubs canvas drawing: it verifies control/state behavior, not browser rendering. Older browser `.smoke.mjs` and `.e2e.mjs` scripts from 0.8.1 remain as legacy references and contain environment-specific paths; they are not part of `npm test`.

Independent machine-file decoding:

```sh
python3 -m venv .venv
.venv/bin/pip install pyembroidery==1.5.1
node test/gen_pes.mjs
node test/gen_dst.mjs
.venv/bin/python test/verify_pes.py
.venv/bin/python test/verify_dst.py
```

## Verification and limits

See [validation.md](docs/validation.md) for the recorded checks. No physical SE700 was connected. Thread Lab was exercised in the real in-app browser with generated stitches and independent PES fixtures, including custom colors, playback, macro detail, diameter, and lighting. The SVG tests use an independent geometry implementation in a DOM harness, so native SVG transformation behavior still needs browser verification. Product previews and physical fabric/thread behavior remain approximations.

This is a substantially repaired browser digitizer, not a replacement for a mature professional digitizing suite. Fonts are converted from outlines rather than pre-digitized embroidery alphabets. Tiny lettering, difficult fabrics, layered textures, gradient/photos, and intricate satin corners need inspection and a physical test on matching scrap before use on a finished garment.

Original font notices remain in `fonts/NOTICE.md`.
