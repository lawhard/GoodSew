// Overlap knockout: fill hidden under objects stacked above is removed
// (stacked designs sew flat), travel avoids knocked-out zones, and distinct
// objects never get a stitched bridge between them.
import { state, makeObject } from "../js/state.js";
import { compile } from "../js/compiler.js";
import { generateForObject } from "../js/stitches.js";
import { pointInContours } from "../js/geometry.js";
import { buildShape } from "../js/shapes.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

// ===== 1. generator-level: fill removed under an occluder =====
console.log("=== knockout: fill removed under occluder ===");
{
  const lower = rect(10, 10, 40, 30);
  const upper = [rect(30, 15, 30, 20)]; // overlaps right half of lower
  const obj = { type: "fill", points: lower, contours: [lower], params: { spacing: 0.45, stitchLength: 3.0, underlay: true } };
  const subs = generateForObject(obj, [upper]);
  // inner core of the occluder (inset > UNDERLAP 0.4 + tolerance)
  const core = [rect(31, 16, 28, 18)];
  let inCore = 0, total = 0;
  for (const s of subs) for (const p of s) { total++; if (pointInContours(p, core)) inCore++; }
  ok(total > 200, `stitches generated (${total})`);
  ok(inCore === 0, `zero stitch points inside the occluded core (${inCore}/${total})`);

  // travel never crosses the occluded core either
  let crossing = 0;
  for (const s of subs) for (let i = 1; i < s.length; i++) {
    const mid = { x: (s[i - 1].x + s[i].x) / 2, y: (s[i - 1].y + s[i].y) / 2 };
    if (pointInContours(mid, core)) crossing++;
  }
  ok(crossing === 0, `no segment midpoint inside the occluded core (${crossing})`);

  // without occluders the same object fills the whole rect
  const subsFull = generateForObject(obj, []);
  let inCoreFull = 0;
  for (const s of subsFull) for (const p of s) if (pointInContours(p, core)) inCoreFull++;
  ok(inCoreFull > 50, `without knockout the area IS filled (${inCoreFull} pts)`);
}

// ===== 2. underlap: lower fill tucks slightly under the upper edge =====
console.log("=== knockout: underlap margin ===");
{
  const lower = rect(10, 10, 40, 30);
  const upper = [rect(30, 15, 30, 20)];
  const obj = { type: "fill", points: lower, contours: [lower], params: { spacing: 0.45, stitchLength: 3.0, underlay: false } };
  const subs = generateForObject(obj, [upper]);
  // a strip just inside the occluder edge (past x=30, up to the 0.4 underlap
  // line at 30.4) should still have stitches
  let tucked = 0;
  for (const s of subs) for (const p of s) if (p.x > 30.05 && p.x < 30.45 && p.y > 16 && p.y < 34) tucked++;
  ok(tucked > 5, `fill tucks under the upper edge (${tucked} pts in underlap strip)`);
}

// ===== 3. compile-level: stacked objects + no stitched bridge between objects =====
console.log("=== compile: knockout + object-boundary trims ===");
{
  state.objects = [];
  const lower = makeObject("fill", rect(20, 20, 40, 30), "#ed171f");
  lower.kind = "rect"; lower.box = { x: 20, y: 20, w: 40, h: 30 };
  const upper = makeObject("fill", rect(35, 25, 30, 20), "#ed171f"); // same color → same block
  upper.kind = "rect"; upper.box = { x: 35, y: 25, w: 30, h: 20 };
  state.objects.push(lower, upper);

  const compiled = compile();
  const core = [rect(35.9, 25.9, 28.2, 18.2)];
  // count LOWER-object stitches inside the core: identify by scanning plan
  // segments — any stitch-to-stitch segment whose midpoint is in the core must
  // belong to the upper object's own fill, which is fine; instead check that
  // total density in the core is single-layer: core area / (spacing*stitchLen)
  const stitches = compiled.plan.filter((s) => s.cmd === "stitch");
  let inCore = 0;
  for (const s of stitches) if (pointInContours(s, core)) inCore++;
  // single-layer fill of 28.2×18.2mm at 0.45 spacing / 3.0 len ≈ area/(0.45*~1.9avg)
  const singleLayerEstimate = (28.2 * 18.2) / (0.45 * 1.9);
  ok(inCore < singleLayerEstimate * 1.35, `core is single-layer (${inCore} vs ~${Math.round(singleLayerEstimate)})`);

  // trims exist between the two objects (no stitched bridge): find the last
  // stitch of the lower object... simpler: assert at least one trim between
  // first and last stitch (objects same color, adjacent — old code stitched a
  // bridge when the gap was ≤3mm; the objects overlap so gap is small)
  const cmds = compiled.plan.map((s) => s.cmd);
  const firstStitch = cmds.indexOf("stitch"), lastStitch = cmds.lastIndexOf("stitch");
  ok(cmds.slice(firstStitch, lastStitch).includes("trim"), "tie-off + trim between the two objects");
}

// ===== 4. text does NOT knock out (letters stitch on top of fill) =====
console.log("=== knockout: text exempt ===");
{
  state.objects = [];
  const bg = makeObject("fill", rect(20, 20, 50, 30), "#0a55a3");
  bg.kind = "rect"; bg.box = { x: 20, y: 20, w: 50, h: 30 };
  const heartPts = buildShape("heart", { x: 30, y: 25, w: 12, h: 10 }); // small detail < 25mm²... actually 12×10=120mm² bbox
  state.objects.push(bg);
  // emulate a text object above (no _glyphs needed — occludersFor skips text)
  const t = makeObject("text", [{ x: 30, y: 40 }], "#ffffff");
  t._glyphs = [[heartPts]]; // pretend glyph
  state.objects.push(t);
  const compiled = compile();
  const stitches = compiled.plan.filter((s) => s.cmd === "stitch");
  const inner = [rect(31, 26, 9, 7)];
  let underText = 0;
  for (const s of stitches) if (s.color === 0 && pointInContours(s, inner)) underText++;
  ok(underText > 10, `background still fills under text (${underText} pts)`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
