# Good Sew design control — 0.13.0

Implemented: local MCP stdio server, paired browser bridge, and visible Assistant control panel. No AI API key or paid model backend is required. The connected assistant plans edits; the deterministic stitch compiler generates and validates the result.

## Start and connect

Run `npm run dev` from the app folder. In your MCP client, register `node /absolute/path/to/good-sew/mcp/server.mjs` as a stdio server. Codex can use `codex mcp add good-sew -- node /absolute/path/to/good-sew/mcp/server.mjs`. Reload the client's MCP connections or restart the client if newly registered tools do not appear.

Open the browser at http://127.0.0.1:8137/. Choose Assistant control → Enable local MCP. Only one tab can be paired; disconnect it before pairing another. Reloading or closing the tab ends its active polling session. A stale session expires after 15 seconds. Disconnect explicitly revokes it immediately. The browser command panel also works without pairing.

## Available tools

| Tool | Result |
|---|---|
| get_design | Current revision, stable object IDs, geometry, rails, parameters, selection and supported shapes/fonts |
| apply_edit | Atomic, precompiled batch: add satin, lettering, shapes, outline text or running lines; update, remove or reorder objects |
| preview_2d | Fast top-down PNG of the actual stitches with directional thread lighting; optional focus, width and fabric colour |
| generate_stitches | Actual compiler statistics, dimensions, thread order and quality warnings |
| inspect_region | Bounding-box span intersections and needle-density estimate in a millimeter rectangle |
| preview_3d | Actual Thread Lab image, optional millimeter focus rectangle and top/angled view, plus material/camera assumptions |
| export_pes | Validated PES bytes in base64, decoded stitch count and coordinate comparison |
| undo_edit | One ordinary undo step, with revision check |

Read get_design before editing. Supply its revision as expectedRevision and a fresh requestId. Reuse exactly the same requestId and arguments only to retry that same logical edit. A changed revision rejects the edit; it does not overwrite concurrent changes. IDs survive edits and Undo but a saved-project reload assigns fresh IDs, so always read again after reload.

Example apply_edit arguments (replace REVISION with the returned revision):

```json
{
  "expectedRevision": "REVISION",
  "requestId": "add-curved-column-1",
  "operations": [{
    "op": "add_satin", "name": "Curved satin", "color": "#0e1f7c",
    "rails": [[{"x":30,"y":30},{"x":32,"y":40},{"x":38,"y":48}],
              [{"x":33,"y":29},{"x":35,"y":39},{"x":40,"y":46}]],
    "params": {"density":0.4,"pull":0.1,"underlay":true}
  }]
}
```

### Wide, lustrous areas (0.13.0)

Thread lies rail to rail. `params.split` (mm) turns a paired-rail column into split satin, which may be any width; `featherA`/`featherB` (mm) roughen rail 0 / rail 1 for fur. `smooth:true` rounds sparse control nodes. `add_satin` also accepts `spine` plus `width` (a number, or one per node) for tapered strokes. `add_region` fills a freeform outline (`points`, optional `holes`, `smooth`). Same-colour objects whose end and next start are within 1 mm stay connected without a trim.

```json
{"op":"add_satin","name":"Ear fringe","color":"#c99258","smooth":true,
 "rails":[[{"x":33,"y":33},{"x":25,"y":42},{"x":23,"y":51.5}],
          [{"x":33,"y":29.5},{"x":10,"y":14.5},{"x":20,"y":56}]],
 "params":{"density":0.42,"split":6.5,"featherB":3.2,"underlay":true}}
```

`generate_stitches` returns `warnings.hotspots`: the five densest 2 × 2 mm cells with coordinates. `js/samples/timi.js` is a complete portrait written with these commands; `node scripts/assistant-run.mjs js/samples/timi.js out --3d --export` replays any such module into the real app in headless Chromium and writes previews, the PES and the project. In a browser, `window.goodsew.call(name, args)` reaches the same commands.

Rail lists must have matching direction-node counts and the same traversal direction. Coordinates are world millimeters. Interpolation is bounded by the longer rail. density is full-cycle spacing: two crossing stitches per cycle. Column geometry defines width; pull adds a bounded rail extension. Crossed rails and throws over 10 mm are rejected; split these shapes instead. This is a conservative implementation limit, not a Brother machine specification.

For add_lettering, use text, height, x, y, strokeWidth, letterSpacing and color. Read the exact character repertoire first: unsupported lowercase forms become capitals with a note. add_shape requires kind and box; add_running requires points; add_text uses text, font, x, y and height. The tool schemas enumerate fields.

The visible command panel supplies the current revision and a fresh request ID when those are omitted. This convenience is for interactive browser control; MCP clients must supply both for mutations.

## Verification loop and limits

Inspect → edit → compile → read warnings and inspect a fixed preview → revise → export and decode → physical test sew. The renderer cannot measure thread tension, compression or fabric deformation. Model-generated designs still require explicit geometry and checks. Generic outline fonts are not automatically converted into professional satin lettering.

The connector has no shell, arbitrary script, network-upload or machine-transfer command. Runtime credentials are generated locally with private file permissions, excluded from Git and static builds, and are not sent to external servers. The browser's active document is the authority; edits use normal autosave and Undo. Preview images and project data are returned to the MCP client when requested.

Tests: npm test; npm run test:connector. The latter starts a temporary loopback server for authentication, origin, pairing, delivery and revocation checks. The recorded live browser test additionally exercises actual project reads, generation, exact edits, duplicate-request handling, preview image return and PES round trip.

References: [Ink/Stitch satin columns](https://inkstitch.org/docs/stitches/satin-column/), [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Codex MCP configuration](https://developers.openai.com/codex/mcp).
