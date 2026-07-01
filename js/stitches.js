// Stitch generators. Each takes an object's geometry + params and returns an
// array of needle penetration points {x,y} in mm — the raw stitch path for that
// object, before jumps/trims/color-changes are woven in by the compiler.

import {
  resample, pathLength, sub, add, scale, norm, perp, dist, bbox,
  rotatePoint, sampleAt, contoursScanline, contoursBBox,
  segmentInContours, classifyHoles, offsetContourInward, offsetContourSigned,
  pointInContours,
} from "./geometry.js";

// --- Running stitch: evenly spaced stitches along the polyline. ---
export function generateRunning(points, params) {
  if (points.length < 2) return [];
  const sl = Math.max(0.5, params.stitchLength || 2.5);
  let out = resample(points, sl);
  const repeats = Math.max(1, params.repeats || 1);
  if (repeats > 1) {
    const full = [];
    for (let r = 0; r < repeats; r++) {
      const seq = r % 2 === 0 ? out : out.slice().reverse();
      full.push(...(r === 0 ? seq : seq.slice(1)));
    }
    return full;
  }
  return out;
}

// --- Satin column: zig-zag between two rails offset from a center spine. ---
// The spine is the drawn polyline; width is the column width (mm).
export function generateSatin(points, params) {
  if (points.length < 2) return [];
  const width = Math.max(0.5, params.width || 4);
  const spacing = Math.max(0.2, params.density || 0.4);
  // Pull compensation: satin draws fabric inward as it sews, narrowing the
  // column. Widen each rail by `pull` mm to counteract it.
  const half = width / 2 + Math.max(0, params.pull || 0);
  const total = pathLength(points);
  const steps = Math.max(2, Math.round(total / spacing));
  const out = [];
  let side = 1;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * total;
    const { point, tangent } = sampleAt(points, s);
    const n = perp(tangent);
    out.push(add(point, scale(n, half * side)));
    side = -side;
  }
  return out;
}

// --- Tatami / fill: parallel rows of running stitch clipped to a region. ---
// Accepts one polygon (points) — wrapper around the multi-contour version.
export function generateFill(points, params) {
  if (points.length < 3) return [];
  return fillContours([points], params);
}

// Multi-contour tatami fill (even-odd rule, so inner contours become holes).
//
// Returns an ARRAY OF SUBPATHS (each an array of {x,y} points). The fill walks
// a CONNECTED-COMPONENT serpentine: scan rows are cut into spans (even-odd),
// vertically-adjacent spans that overlap in x are linked into connected
// components, and each component is traversed as ONE continuous subpath. Travel
// between consecutive spans therefore stays INSIDE the region (overlapping spans
// guarantee an interior connector), so concave folds (a heart's notch) are sewn
// without a jump across the fold. A NEW subpath (→ trim+jump by the compiler) is
// started only between genuinely DISCONNECTED components (separate islands, or
// across a counter/hole). Hole-aware via the even-odd scanline.
//
// Pull compensation: each span is inset inward from the region boundary by
// `params.inset` mm (default ~0.2mm) at both ends so rendered thread (~0.4mm
// wide) does not bleed over the outline or pinch shut thin apertures. Spans that
// become too short to stitch after the inset are dropped (the inset is skipped
// for a span only implicitly — short features just lose that row, never the
// whole feature).
export function fillContours(contours, params) {
  contours = contours.filter((c) => c.length >= 3);
  if (contours.length === 0) return [];
  const spacing = Math.max(0.25, params.spacing ?? 0.4);
  const stitchLen = Math.max(1, params.stitchLength ?? 3.0);
  const angle = ((params.angle || 0) * Math.PI) / 180;
  const inset = Math.max(0, params.inset ?? 0.2);
  // A span must keep at least this much length after the inset to be worth
  // stitching; below it, drop the span (preserves thin apertures rather than
  // bridging them, and avoids zero/negative-length spans).
  const minSpan = Math.max(0.3, inset);

  // Rotate region so fill rows are horizontal, scan, then rotate stitches back.
  const bb = contoursBBox(contours);
  const center = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const rot = contours.map((poly) => poly.map((p) => rotatePoint(p, center, -angle)));
  const rb = contoursBBox(rot);

  // rows[i] = array of spans; spans[k] = { x0, x1 } (x0 < x1, already inset).
  // rowYs[i] = scan y of rows[i]; rowIdxs[i] = its index in the full scan order
  // (used to detect non-adjacent rows so a row fully removed by inset breaks
  // vertical connectivity — the desired behavior at a pinch/thin aperture).
  const rows = [];
  const rowYs = [];
  let rowIndex = 0;
  const rowIdxs = [];
  for (let y = rb.minY + spacing / 2; y < rb.maxY; y += spacing) {
    const xs = contoursScanline(rot, y);
    const spans = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let x0 = xs[k], x1 = xs[k + 1];
      if (x1 - x0 <= 1e-6) continue;
      // Inset both ends; drop spans that collapse below the stitchable minimum.
      const ix0 = x0 + inset, ix1 = x1 - inset;
      if (ix1 - ix0 >= minSpan) spans.push({ x0: ix0, x1: ix1 });
    }
    if (spans.length) { rows.push(spans); rowYs.push(y); rowIdxs.push(rowIndex); }
    rowIndex++;
  }
  if (rows.length === 0) return [];

  const span = (ri, si) => rows[ri][si];
  const id = (ri, si) => `${ri}:${si}`;

  // Build the stitch points for one span (rotated space) with a brick-offset
  // phase so penetrations on adjacent rows don't line up into a visible ridge.
  // `dir` > 0 = left→right.
  const spanPoints = (x0, x1, y, rIdx, dir) => {
    const segLen = Math.abs(x1 - x0);
    const n = Math.max(1, Math.round(segLen / stitchLen));
    const phase = (rIdx % 2) * (stitchLen / 2); // brick offset
    const pts = [];
    const lo = dir > 0 ? x0 : x1, hiSign = dir > 0 ? 1 : -1;
    pts.push({ x: lo, y });
    for (let k = 1; k <= n; k++) {
      const t = (k * stitchLen + phase) / segLen;
      if (t >= 1) break;
      pts.push({ x: lo + hiSign * segLen * t, y });
    }
    pts.push({ x: dir > 0 ? x1 : x0, y });
    return pts;
  };

  // --- Adjacency: vertically-overlapping spans linked by an interior connector.
  // Used to walk the fill as a continuous serpentine. A naive row-by-row snake
  // would, for a two-lobe row (a heart above its notch), connect the left lobe's
  // span to the right lobe's across the NOTCH — an exiting jump. Instead we walk
  // the adjacency GRAPH: descend a vertical chain, then continue to whatever
  // unvisited neighbor is reachable by an interior connector. Each lobe is sewn
  // down-and-up before crossing, so the connector never leaves the region.
  const adj = new Map(); // id -> [{ ri, si }]
  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (let ri = 0; ri + 1 < rows.length; ri++) {
    if (rowIdxs[ri + 1] - rowIdxs[ri] !== 1) continue;
    for (let si = 0; si < rows[ri].length; si++) {
      const A = span(ri, si);
      for (let sj = 0; sj < rows[ri + 1].length; sj++) {
        const B = span(ri + 1, sj);
        const ov = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        if (ov <= 1e-6) continue;
        const sx = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
        if (segmentInContours({ x: sx, y: rowYs[ri] }, { x: sx, y: rowYs[ri + 1] }, rot)) {
          addAdj(id(ri, si), { ri: ri + 1, si: sj });
          addAdj(id(ri + 1, sj), { ri, si });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION DECOMPOSITION (branch analysis) — the digitizer's core trick.
  //
  // The old traversal decided satin-vs-tatami for a whole connected COMPONENT
  // (an entire letter) and always laid satin rungs along the scan rows. That
  // produced spaghetti on rings/arcs, fill-like stripes on horizontal strokes,
  // and stitched travel straight across finished fill.
  //
  // Instead, spans are grouped into SECTIONS: maximal vertical chains where each
  // row has exactly one span linked 1-to-1 to the next row's span. A section is
  // a simple ribbon (a letter stem, a bar, an arc slice, a blob). Chains break
  // wherever spans split or merge (branch rows), so every section has a single
  // coherent local direction — and each section independently gets the stitch
  // style that suits it:
  //   ladder  — narrow ribbon (median width ≤ satinMax): classic satin, rungs
  //             across the ribbon, optional center-run underlay.
  //   columns — thin FLAT ribbon (short in y, wide in x — a horizontal stroke):
  //             satin again, but rungs VERTICAL so they cross the stroke.
  //   zigzag  — forced satin on something wide both ways: true diagonal zig-zag
  //             (visibly satin, unlike the old flat split rows).
  //   tatami  — everything else: serpentine fill with brick offset.
  // Sections are then sewn in nearest-first order; travel between them runs
  // along the region BOUNDARY (hidden at the edge) when possible, or trims —
  // never stitched straight across a finished fill.
  const satinMax = params.satinMaxWidth ?? 6;
  const satinMin = 0.6;
  const wantUnderlay = params.underlay !== false;
  const forced = params.stitchType;
  const maxSatinThrow = 7;

  const upOf = (ri, si) => (adj.get(id(ri, si)) || []).filter((n) => n.ri === ri - 1);
  const downOf = (ri, si) => (adj.get(id(ri, si)) || []).filter((n) => n.ri === ri + 1);

  // --- build sections (rows are iterated top-down, so chain heads come first)
  const secOf = new Map();
  const sections = [];
  for (let ri = 0; ri < rows.length; ri++) {
    for (let si = 0; si < rows[ri].length; si++) {
      if (secOf.has(id(ri, si))) continue;
      const sec = { idx: sections.length, spans: [] };
      let cur = { ri, si };
      for (;;) {
        sec.spans.push(cur);
        secOf.set(id(cur.ri, cur.si), sec.idx);
        const dn = downOf(cur.ri, cur.si);
        if (dn.length !== 1) break;                       // split / dead end
        const nxt = dn[0];
        if (upOf(nxt.ri, nxt.si).length !== 1) break;      // merge below
        if (secOf.has(id(nxt.ri, nxt.si))) break;
        cur = nxt;
      }
      sections.push(sec);
    }
  }

  // --- per-section metrics & style
  for (const sec of sections) {
    const ws = sec.spans.map(({ ri, si }) => { const S = span(ri, si); return S.x1 - S.x0; })
      .sort((a, b) => a - b);
    sec.wMed = ws[Math.floor(ws.length / 2)];
    sec.h = (sec.spans[sec.spans.length - 1].ri - sec.spans[0].ri + 1) * spacing;
    let minX = Infinity, maxX = -Infinity, minXY = 0, maxXY = 0;
    for (const { ri, si } of sec.spans) {
      const S = span(ri, si);
      if (S.x0 < minX) { minX = S.x0; minXY = rowYs[ri]; }
      if (S.x1 > maxX) { maxX = S.x1; maxXY = rowYs[ri]; }
    }
    sec.minX = minX; sec.maxX = maxX;

    if (forced === "fill") sec.style = "tatami";
    else if (sec.wMed <= satinMax && sec.wMed >= satinMin) sec.style = "ladder";
    else if (sec.h <= satinMax && sec.h >= satinMin && sec.wMed >= 2.5 * sec.h) sec.style = "columns";
    else if (forced === "satin") sec.style = "zigzag";
    else sec.style = "tatami";

    // entry points (for travel cost + direction): row styles enter at the
    // top/bottom row midpoints; column style enters at the left/right extremes.
    const first = sec.spans[0], last = sec.spans[sec.spans.length - 1];
    const FS = span(first.ri, first.si), LS = span(last.ri, last.si);
    if (sec.style === "columns") {
      sec.entries = [
        { p: { x: minX, y: minXY }, end: "A" },
        { p: { x: maxX, y: maxXY }, end: "B" },
      ];
    } else {
      sec.entries = [
        { p: { x: (FS.x0 + FS.x1) / 2, y: rowYs[first.ri] }, end: "A" },
        { p: { x: (LS.x0 + LS.x1) / 2, y: rowYs[last.ri] }, end: "B" },
      ];
    }
  }

  // --- section adjacency (for nearest-first ordering preference)
  const secAdj = new Map(); // idx -> Set(idx)
  for (const [key, ns] of adj) {
    const a = secOf.get(key);
    for (const n of ns) {
      const b = secOf.get(id(n.ri, n.si));
      if (a === b) continue;
      if (!secAdj.has(a)) secAdj.set(a, new Set());
      secAdj.get(a).add(b);
    }
  }

  // --- chain/subpath assembly with boundary-aware travel
  const subs = [];
  let chain = null, curPt = null;
  const endChain = () => { if (chain && chain.length >= 2) subs.push(chain); chain = null; };
  const startChain = (p) => { endChain(); chain = [p]; curPt = p; };
  const stitchTo = (p) => { chain.push(p); curPt = p; };

  // Resampled region outlines for boundary travel (built lazily). Pulled
  // slightly INSIDE the boundary so short chords between walk points can't
  // cut outside the region at a concave corner (e.g. across a heart's notch).
  let _outlines = null;
  const outlines = () => {
    if (!_outlines) {
      _outlines = rot.map((c) => offsetContourInward(resample([...c, c[0]], 1.2), 0.3, rot));
    }
    return _outlines;
  };
  const nearestOnBoundary = (p) => {
    let best = null;
    outlines().forEach((pts, ci) => pts.forEach((q, qi) => {
      const d = dist(p, q);
      if (!best || d < best.d) best = { d, ci, qi };
    }));
    return best;
  };
  // Travel from a to b along the boundary of the SAME contour (≤12mm), so the
  // run hugs the edge instead of crossing finished fill. Returns points or null.
  const boundaryTravel = (a, b) => {
    const A = nearestOnBoundary(a), B = nearestOnBoundary(b);
    if (!A || !B || A.ci !== B.ci || A.d > 3 || B.d > 3) return null;
    const pts = outlines()[A.ci], n = pts.length;
    const fwd = (B.qi - A.qi + n) % n, bwd = (A.qi - B.qi + n) % n;
    const count = Math.min(fwd, bwd);
    if (count * 1.2 > 12) return null;
    const step = fwd <= bwd ? 1 : -1;
    const walk = [];
    for (let k = 0; k <= count; k++) walk.push(pts[(A.qi + step * k + n) % n]);
    return walk; // keep the fine 1.2mm steps — inset+short chords stay inside
  };
  // Get the needle to `target`: plain stitch when close; short interior running
  // when the straight line stays inside; boundary walk when near the same
  // outline; otherwise a fresh subpath (compiler tie-off + trim + jump).
  const connectTo = (target) => {
    if (!curPt || !chain) { startChain(target); return; }
    const d = dist(curPt, target);
    if (d <= 1e-9) return;
    // Direct interior travel only for SHORT hops (a long stitched connector
    // lies visibly on top of the finished fill); anything longer goes along
    // the boundary or gets a trim.
    if (d <= 2.5 && segmentInContours(curPt, target, rot)) {
      if (d <= 1.0) { stitchTo(target); return; }
      const pts = resample([curPt, target], stitchLen);
      for (let i = 1; i < pts.length; i++) stitchTo(pts[i]);
      return;
    }
    const walk = boundaryTravel(curPt, target);
    // The entry/exit chords (needle → walk start, walk end → target) must be
    // verified too: at a pinch (a notch tip) the nearest outline point can lie
    // on the far flank, and the chord would cut straight across the vee.
    if (walk && walk.length &&
        segmentInContours(curPt, walk[0], rot) &&
        segmentInContours(walk[walk.length - 1], target, rot)) {
      for (const p of walk) stitchTo(p);   // fine steps: chords stay inside
      if (dist(curPt, target) > 1e-9) stitchTo(target);
      return;
    }
    startChain(target);
  };

  // Split-stitch straight toward `b`, keeping each stitch ≤ maxSatinThrow.
  const throwTo = (b) => {
    const d = dist(curPt, b);
    const n = Math.max(1, Math.ceil(d / maxSatinThrow));
    const a = curPt;
    for (let k = 1; k <= n; k++) {
      stitchTo({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  };

  // --- emitters (all work on a section, entered from end 'A' (top/left) or 'B')
  const emitLadder = (sec, end) => {
    const list = end === "A" ? sec.spans : sec.spans.slice().reverse();
    const mids = list.map(({ ri, si }) => {
      const S = span(ri, si); return { x: (S.x0 + S.x1) / 2, y: rowYs[ri] };
    });
    connectTo(mids[0]);
    if (wantUnderlay && mids.length >= 2) {
      // center-run underlay: down the ribbon and back (standard double run)
      for (let i = 1; i < mids.length; i++) stitchTo(mids[i]);
      for (let i = mids.length - 2; i >= 0; i--) stitchTo(mids[i]);
    }
    let lead = 0;
    for (let i = 0; i < list.length; i++) {
      const S = span(list[i].ri, list[i].si);
      const y = rowYs[list[i].ri];
      const a = { x: lead === 0 ? S.x0 : S.x1, y };
      // rail step: adjacent rows are interior-linked, but on a fast-drifting
      // edge the step can get long — verify, and reroute if it would exit.
      if (dist(curPt, a) > 0.8 && !segmentInContours(curPt, a, rot)) connectTo(a);
      else stitchTo(a);
      throwTo({ x: lead === 0 ? S.x1 : S.x0, y });
      lead ^= 1;
    }
  };

  const emitColumns = (sec, end) => {
    // vertical satin rungs across a thin flat ribbon (a horizontal stroke)
    const cols = [];
    for (let x = sec.minX + spacing / 2; x < sec.maxX; x += spacing) {
      // covering rows are contiguous for a 1-1 chain; use the first block
      let y0 = Infinity, y1 = -Infinity, prevRi = null, blocked = false;
      for (const { ri, si } of sec.spans) {
        const S = span(ri, si);
        if (x < S.x0 - 1e-9 || x > S.x1 + 1e-9) { if (y0 !== Infinity) blocked = true; continue; }
        if (blocked) break; // only the first contiguous block
        if (prevRi !== null && ri !== prevRi + 1 && y0 !== Infinity) break;
        y0 = Math.min(y0, rowYs[ri]); y1 = Math.max(y1, rowYs[ri]); prevRi = ri;
      }
      if (y0 === Infinity) continue;
      cols.push({ x, y0, y1 });
    }
    if (!cols.length) return;
    if (end === "B") cols.reverse();
    const mids = cols.map((c) => ({ x: c.x, y: (c.y0 + c.y1) / 2 }));
    connectTo(mids[0]);
    if (wantUnderlay && mids.length >= 2) {
      for (let i = 1; i < mids.length; i++) stitchTo(mids[i]);
      for (let i = mids.length - 2; i >= 0; i--) stitchTo(mids[i]);
    }
    let lead = 0;
    for (const c of cols) {
      const a = { x: c.x, y: lead === 0 ? c.y0 : c.y1 };
      if (dist(curPt, a) > 0.8 && !segmentInContours(curPt, a, rot)) connectTo(a);
      else stitchTo(a);
      throwTo({ x: c.x, y: lead === 0 ? c.y1 : c.y0 });
      lead ^= 1;
    }
  };

  const emitZigzag = (sec, end) => {
    // forced satin on a wide section: true diagonal zig-zag — one penetration
    // per row, alternating rails, legs split to ≤ maxSatinThrow. Reads
    // unmistakably as satin (glossy diagonals), unlike flat split rows.
    const list = end === "A" ? sec.spans : sec.spans.slice().reverse();
    let lead = 0;
    for (let i = 0; i < list.length; i++) {
      const S = span(list[i].ri, list[i].si);
      const p = { x: lead === 0 ? S.x0 : S.x1, y: rowYs[list[i].ri] };
      if (i === 0) connectTo(p);
      else throwTo(p);
      lead ^= 1;
    }
    // a second pass back fills the opposite diagonals so coverage is dense
    // (phase depends on row-count parity so the return pass hits the rail the
    // first pass skipped at each row, not the same one)
    let lead2 = list.length % 2;
    for (let i = list.length - 1; i >= 0; i--) {
      const S = span(list[i].ri, list[i].si);
      const p = { x: lead2 === 0 ? S.x0 : S.x1, y: rowYs[list[i].ri] };
      throwTo(p);
      lead2 ^= 1;
    }
  };

  const emitTatamiSec = (sec, end) => {
    const list = end === "A" ? sec.spans : sec.spans.slice().reverse();
    let dir = 1;
    {
      // start at whichever span end is nearer to the needle
      const S = span(list[0].ri, list[0].si);
      if (curPt && Math.abs(curPt.x - S.x1) < Math.abs(curPt.x - S.x0)) dir = -1;
    }
    for (let i = 0; i < list.length; i++) {
      const { ri, si } = list[i];
      const S = span(ri, si);
      const pts = spanPoints(S.x0, S.x1, rowYs[ri], rowIdxs[ri], dir);
      if (i === 0) connectTo(pts[0]);
      else if (dist(curPt, pts[0]) > 0.8 && !segmentInContours(curPt, pts[0], rot)) connectTo(pts[0]);
      else stitchTo(pts[0]);
      for (let k = 1; k < pts.length; k++) stitchTo(pts[k]);
      dir = -dir;
    }
  };

  // --- sew sections nearest-first, preferring neighbors of what's already sewn
  const remaining = new Set(sections.map((s) => s.idx));
  const sewn = new Set();
  while (remaining.size) {
    let pick = null, pickEntry = null, bestCost = Infinity;
    // prefer sections adjacent to already-sewn ones (keeps travel short)
    let cands = [];
    for (const sIdx of sewn) {
      for (const n of (secAdj.get(sIdx) || [])) if (remaining.has(n)) cands.push(n);
    }
    if (!cands.length) cands = [...remaining];
    for (const idx2 of cands) {
      const sec = sections[idx2];
      for (const e of sec.entries) {
        const c = curPt ? dist(curPt, e.p) : e.p.y * 1000 + e.p.x; // first: topmost
        if (c < bestCost) { bestCost = c; pick = sec; pickEntry = e.end; }
      }
    }
    if (!pick) break;
    if (pick.style === "ladder") emitLadder(pick, pickEntry);
    else if (pick.style === "columns") emitColumns(pick, pickEntry);
    else if (pick.style === "zigzag") emitZigzag(pick, pickEntry);
    else emitTatamiSec(pick, pickEntry);
    remaining.delete(pick.idx);
    sewn.add(pick.idx);
  }
  endChain();

  // Rotate every subpath back into design space.
  return subs.map((s) => s.map((p) => rotatePoint(p, center, angle)));
}

// Optional zig-zag underlay for fills/satin: a sparse running outline pass that
// stabilizes fabric before the top stitching.
export function generateUnderlay(points, inset = 1.0) {
  if (points.length < 2) return [];
  return resample(points, 3.5);
}

// Walk a CLOSED contour with running stitches, preserving every original vertex
// so the path never chords across a corner. Resampling a closed loop as one
// polyline (the old approach) cuts corners; for a hole/counter boundary that
// chord can dip INTO the hole. Resampling edge-by-edge keeps the walk exactly on
// the outline, which is inherently hole-safe.
//
// `inset` (mm) pulls the walk just INSIDE the boundary (pull compensation) so the
// rendered thread doesn't bleed over the edge and so every walked point lies
// strictly inside the region. `region` (contours for an even-odd test) keeps the
// inset from spiking outside at a sharp concave corner (e.g. a heart's notch).
function edgeWalk(contour, spacing, inset = 0, region = null) {
  if (contour.length < 2) return [];
  const base = inset > 0 ? offsetContourInward(contour, inset, region) : contour;
  const out = [base[0]];
  const closed = [...base, base[0]];
  for (let i = 1; i < closed.length; i++) {
    const seg = resample([closed[i - 1], closed[i]], spacing);
    // resample includes the start point; skip it to avoid duplicates.
    for (let k = 1; k < seg.length; k++) out.push(seg[k]);
  }
  return out;
}

// Satin BORDER along a set of contours (OUTLINE mode): instead of filling the
// interior, lay a band of width `borderWidth` mm centered on each contour
// outline. Two rails are built by offsetting the contour inward and outward by
// half the width; a zig-zag alternates between them, spaced `spacing` mm along
// the outline. The interior is never filled and counters are never satined
// across (each contour is bordered independently). If a rail offset degenerates
// (a contour too small / spiky to give two clean rails) we fall back to a clean
// corner-preserving running stitch (edgeWalk) along that contour.
//
// Returns an array of subpaths (one per contour, plus possible splits).
function generateBorder(contours, params) {
  const valid = contours.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const width = Math.max(0.5, params.borderWidth ?? 2);
  const half = width / 2;
  const spacing = Math.max(0.3, params.spacing ?? 0.4);
  const subs = [];

  for (const contour of valid) {
    // Resample the outline so rail samples are evenly spaced and corners kept.
    // `resample` of a closed loop repeats the seam vertex (start == end), which
    // gives a zero-length edge and a degenerate miter there — drop the trailing
    // duplicate so the offset treats the loop cleanly.
    const closed = [...contour, contour[0]];
    let outline = resample(closed, spacing);
    if (outline.length > 1) {
      const a = outline[0], b = outline[outline.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) outline = outline.slice(0, -1);
    }
    if (outline.length < 3) { subs.push(edgeWalk(contour, spacing)); continue; }

    const inner = offsetContourSigned(outline, half, valid, false);
    const outer = offsetContourSigned(outline, half, valid, true);

    // Sanity: both rails must be finite and the same length as the outline.
    let bad = inner.length !== outline.length || outer.length !== outline.length;
    if (!bad) {
      for (let i = 0; i < outline.length && !bad; i++) {
        if (!Number.isFinite(inner[i].x) || !Number.isFinite(inner[i].y) ||
            !Number.isFinite(outer[i].x) || !Number.isFinite(outer[i].y)) bad = true;
      }
    }
    if (bad) { subs.push(edgeWalk(contour, spacing)); continue; }

    // Zig-zag between the rails: outer, inner, outer, ... so each stitch crosses
    // the band. Both points sit within ~half mm of the outline by construction.
    const rail = [];
    for (let i = 0; i < outline.length; i++) {
      if (i % 2 === 0) { rail.push(outer[i], inner[i]); }
      else { rail.push(inner[i], outer[i]); }
    }
    if (rail.length >= 2) subs.push(rail);
  }
  return subs;
}

// Generate stitches for a text object from its cached glyph contours
// (obj._glyphs: array of glyphs; each glyph is an array of contours in mm).
// Returns an array of sub-paths so the compiler can trim/jump between glyphs.
export function generateText(obj) {
  const glyphs = obj._glyphs || [];
  const ax = (obj.points && obj.points[0]) ? obj.points[0].x : 0;
  const ay = (obj.points && obj.points[0]) ? obj.points[0].y : 0;
  const shift = (c) => c.map((p) => ({ x: p.x + ax, y: p.y + ay }));
  const subs = [];
  for (const contours of glyphs) {
    const moved = contours.map(shift);
    // Fill each glyph with hole-aware tatami + a LIGHT underlay (outer edge run
    // only; no perpendicular tatami) so small lettering stays crisp and counters
    // stay open. The OUTLINE pass (params.outline) is handled inside
    // fillWithUnderlay now — hole-aware (counters not ringed) and inset just
    // inside the edge — so it is shared by text, shapes, and SVG fills.
    for (const f of fillWithUnderlay(moved, obj.params, { light: true })) {
      if (f.length) subs.push(f);
    }
  }
  return subs;
}

// Returns an array of sub-paths (each an array of penetration points). Multiple
// sub-paths within one object are connected by jumps/trims by the compiler.
export function generateForObject(obj) {
  switch (obj.type) {
    case "running": return [generateRunning(obj.points, obj.params)];
    case "satin": {
      const subs = [];
      // Underlay: a center run down the spine stabilizes before the satin.
      if (obj.params.underlay) subs.push(resample(obj.points, 2.5));
      subs.push(generateSatin(obj.points, obj.params));
      return subs;
    }
    case "fill": {
      const contours = (obj.contours && obj.contours.length) ? obj.contours : [obj.points];
      // OUTLINE mode: stitch a satin band along the contour outline, never fill
      // the interior. Hole-aware — each contour (counter included) is bordered
      // independently, so an outline 'O' gets two rings and an open center.
      if (obj.params.fillMode === "outline") return generateBorder(contours, obj.params);
      return fillWithUnderlay(contours, obj.params);
    }
    case "text":    return generateText(obj);
    default:        return [];
  }
}

// Fill plus optional underlay, tuned so a freshly-rendered object looks good
// with no manual tuning. Underlay (before the top fill):
//   (a) an edge walk around each OUTER contour (~2.5mm running stitch). The walk
//       runs ONLY on outer contours — never on holes/counters — so a letter's
//       counter (the inside of an O/e/a/B/8) stays fully open instead of being
//       ringed shut. Holes are classified by even-odd nesting.
//   (b) for SHAPES, a low-density fill pass roughly perpendicular to the top
//       fill (spacing ~1.8mm) to stabilize the fabric. Skipped for TEXT (the
//       `light` option), where the perpendicular tatami muddies small lettering;
//       the outer edge run alone is enough to keep letters crisp.
// Then the top tatami fill (default spacing ~0.4mm, stitch length ~3.0mm, with
// a brick offset between rows). All passes are hole-aware via fillContours.
//
// `opts.light` (default false) → light underlay: outer edge walk only, no
// perpendicular tatami. generateText passes light:true; shape fills do not.
function fillWithUnderlay(contours, params, opts = {}) {
  const valid = contours.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  const topAngle = params.angle ?? 0;
  const topSpacing = Math.max(0.25, params.spacing ?? 0.4);
  const light = !!opts.light;
  const subs = [];

  const inset = Math.max(0, params.inset ?? 0.2);
  if (params.underlay) {
    const isHole = classifyHoles(valid);
    // (a) Edge walk around each OUTER contour outline (corner-preserving), pulled
    //     just inside by the pull-comp inset so the run stays under the top fill
    //     and never bleeds over the edge. Never walk holes/counters, or the
    //     counter gets ringed shut.
    for (let i = 0; i < valid.length; i++) {
      if (!isHole[i]) subs.push(edgeWalk(valid[i], 2.5, inset, valid));
    }
    // (b) Perpendicular low-density stabilizing fill (hole-aware) — shapes only.
    if (!light) {
      for (const f of fillContours(valid, {
        ...params,
        underlay: false, // this pass IS underlay — no nested satin center-run
        spacing: Math.max(1.8, topSpacing * 4),
        stitchLength: Math.max(2.5, params.stitchLength ?? 3.0),
        angle: topAngle + 90,
      })) {
        if (f.length) subs.push(f);
      }
    }
  }

  // Top fill. Cross-hatch = two perpendicular tatami passes forming a grid;
  // otherwise a single tatami (or satin, decided per-component in fillContours).
  const len = Math.max(1, params.stitchLength ?? 3.0);
  if (params.crosshatch) {
    const gap = topSpacing * 1.7; // each pass sparser; the two together look right
    for (const ang of [topAngle, topAngle + 90]) {
      for (const f of fillContours(valid, { ...params, stitchType: "fill", crosshatch: false, spacing: gap, stitchLength: len, angle: ang })) {
        if (f.length) subs.push(f);
      }
    }
  } else {
    for (const f of fillContours(valid, { ...params, spacing: topSpacing, stitchLength: len, angle: topAngle })) {
      if (f.length) subs.push(f);
    }
  }

  // Optional OUTLINE pass (params.outline): a crisp corner-preserving running
  // stitch traced AROUND THE OUTER CONTOURS, on top of the fill — the same effect
  // generateText gives lettering. Hole-aware via classifyHoles so counters are
  // never ringed shut (an 'O'/SVG counter stays open). Pulled just inside by the
  // pull-comp inset so the outline sits on the edge, not over it.
  if (params.outline) {
    const isHole = classifyHoles(valid);
    const olen = params.outlineLen || 2.0;
    for (let i = 0; i < valid.length; i++) {
      if (isHole[i]) continue;
      const o = edgeWalk(valid[i], olen, inset, valid);
      if (o.length) subs.push(o);
    }
  }
  return subs;
}
