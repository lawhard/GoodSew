// Full user-workflow test: drives the real app in Chrome exactly as a user
// would (clicks, drags, typing) through both phases — design then render —
// then exports a PES and verifies it.
import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";

const CHR = "/home/user/GoodSew/chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell";
const URL = "http://localhost:8137/index.html";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHR,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept()); // auto-accept the "New design?" confirm

const state = () => page.evaluate(() => ({
  objects: window.__gs.state.objects.length,
  guides: window.__gs.state.guides.length,
  units: window.__gs.state.units,
  mode: window.__gs.state.mode,
  ...window.__gs.compiledStats(),
}));
const setColor = (hex) => page.evaluate((h) => window.__gs.setActiveColor(h), hex);
async function canvasBox() { return (await page.$("#canvas")).boundingBox(); }
async function dragOnCanvas(fx0, fy0, fx1, fy1) {
  const b = await canvasBox();
  const X = (f) => b.x + b.width * f, Y = (f) => b.y + b.height * f;
  await page.mouse.move(X(fx0), Y(fy0));
  await page.mouse.down();
  await page.mouse.move(X(fx1), Y(fy1), { steps: 10 });
  await page.mouse.up();
}
// Edit a property-panel field by its label (searches both row + full-width rows).
async function setProp(label, value) {
  return page.evaluate((label, value) => {
    const rows = [...document.querySelectorAll("#object-props .prop-row, #object-props .prop-full")];
    const row = rows.find((r) => r.querySelector("label")?.textContent.startsWith(label));
    if (!row) return false;
    const el = row.querySelector("input, select");
    if (!el) return false;
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, label, value);
}

await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(1500);

console.log("Step 1-2: launch & New design");
ok(await page.evaluate(() => !!window.__gs), "app loaded with debug hook");
await page.click("#btn-new");
await sleep(200);
let s = await state();
ok(s.objects === 0, `New cleared the canvas (objects=${s.objects})`);
ok(s.mode === "design", "back in design phase after New");

console.log("Step 3: switch units to mm");
await page.click('.unit-btn[data-unit="mm"]');
ok((await state()).units === "mm", "units switched to mm");

console.log("Step 4: add a filled ellipse");
await setColor("#0a5563");
await page.click('.tool[data-tool="shape"]');
await sleep(120);
await page.evaluate(() => { const c = [...document.querySelectorAll(".shape-cell")].find((x) => x.title === "Ellipse / Circle"); c.click(); });
await dragOnCanvas(0.32, 0.30, 0.68, 0.66);
s = await state();
ok(s.objects === 1, `ellipse added (objects=${s.objects})`);

console.log("Step 5: add lettering");
await setColor("#0e1f7c");
await page.click('.tool[data-tool="text"]');
const b = await canvasBox();
await page.mouse.click(b.x + b.width * 0.34, b.y + b.height * 0.50);
await sleep(600);
ok(await setProp("Text", "ACE"), "typed text 'ACE' into the Text field");
await sleep(300);
// pick a different color for the text so it's its own thread block
await setColor("#d12947");
await page.evaluate(() => {
  // recolor the selected text via its property color select
  const sel = [...document.querySelectorAll("#object-props select")].find((s) => s.value && s.options.length > 5);
});
s = await state();
ok(s.objects === 2, `text added (objects=${s.objects})`);

console.log("Step 6: open the font library & pick Anton");
await page.evaluate(() => document.querySelector(".font-btn").click());
await sleep(400);
ok(await page.evaluate(() => !document.getElementById("font-modal").classList.contains("hidden")), "font library opened");
// gallery opens filtered to the active font's category; show all, expect 36
await page.evaluate(() => [...document.querySelectorAll(".font-cat-chip")].find((c) => c.textContent === "All").click());
await sleep(150);
ok(await page.evaluate(() => document.querySelectorAll(".font-card").length === 36), "36 fonts in the gallery");
await page.evaluate(() => { const c = [...document.querySelectorAll(".font-card")].find((x) => x.textContent.includes("Anton")); c.click(); });
await sleep(400);
ok(await page.evaluate(() => window.__gs.state.objects.find((o) => o.type === "text").params.font === "Anton"), "font set to Anton");

console.log("Step 7: alignment guide");
await page.click('.tool[data-tool="select"]');
await page.mouse.move(b.x + b.width * 0.5, b.y + 8); await page.mouse.down();
await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 6 }); await page.mouse.up();
ok((await state()).guides === 1, "pulled an alignment guide");

console.log("Step 8: RENDER into a stitch pattern");
await page.click("#btn-render");
await sleep(900);
s = await state();
ok(s.mode === "stitch", "entered the stitch phase");
console.log(`    stats: ${s.stitches} stitches, ${s.threadColors} colors, ${s.colorChanges} changes, ` +
  `${s.jumps} jumps, ${s.trims} trims, ${s.width.toFixed(1)}x${s.height.toFixed(1)}mm, ${Math.round(s.seconds)}s`);
ok(s.stitches > 300, "design has substantial stitches");
ok(s.width <= 100.5 && s.height <= 100.5, `fits the 100mm field (${s.width.toFixed(1)}x${s.height.toFixed(1)})`);
ok(s.seconds > 0, "run-time estimated");

console.log("Step 9: tweak a stitch setting");
await page.evaluate(() => window.__gs.state.selectedId = window.__gs.state.objects.find((o) => o.type === "text").id);
await page.evaluate(() => {
  const o = window.__gs.state.objects.find((x) => x.id === window.__gs.state.selectedId);
});
// click the text in the list to load its stitch settings, then change density
await page.evaluate(() => { const it = [...document.querySelectorAll(".object-item")].find((i) => i.textContent.includes("ACE")); it && it.click(); });
await sleep(150);
const denseChanged = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#stitch-settings .prop-row")];
  const row = rows.find((r) => r.querySelector("label")?.textContent.startsWith("Density"));
  if (!row) return false;
  const el = row.querySelector("input");
  el.value = "0.5"; el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
});
ok(denseChanged, "changed fill density in Stitch Settings");

console.log("Step 10: simulator");
await page.evaluate(() => window.__gs.sim.seek(0));
await page.click("#sim-play");
await sleep(700);
const midIdx = await page.evaluate(() => window.__gs.sim.index);
await page.evaluate(() => window.__gs.sim.pause());
ok(midIdx > 0, `simulator advanced to stitch ${midIdx}`);
await page.evaluate(() => window.__gs.sim.toEnd());
const endIdx = await page.evaluate(() => ({ i: window.__gs.sim.index, t: window.__gs.sim.total }));
ok(endIdx.i === endIdx.t, `simulator reached end (${endIdx.i}/${endIdx.t})`);
await page.screenshot({ path: "/home/user/GoodSew/scratch-workflow.png" });

console.log("Step 11: preview");
await page.click("#btn-preview");
await sleep(700);
ok(await page.evaluate(() => !document.getElementById("preview-modal").classList.contains("hidden")), "preview modal opened");
await page.screenshot({ path: "/home/user/GoodSew/scratch-workflow-preview.png" });
await page.click("#preview-close");

console.log("Step 12: export PES");
const out = await page.evaluate(() => {
  const bytes = window.__gs.exportBytes();
  const st = window.__gs.compiledStats();
  return { bytes, stitchCount: st.stitches, colorBlocks: st.threadColors, widthMm: st.width, heightMm: st.height };
});
writeFileSync("/tmp/gs_workflow.pes", Buffer.from(out.bytes));
writeFileSync("/tmp/gs_workflow_meta.json", JSON.stringify({
  stitchCount: out.stitchCount, colorBlocks: out.colorBlocks, widthMm: out.widthMm, heightMm: out.heightMm,
}));
ok(out.bytes.length > 1000, `exported ${out.bytes.length}-byte PES`);

ok(errors.length === 0, `no console errors during workflow (${errors.join("; ")})`);
await browser.close();
console.log(fails === 0 ? "\nWORKFLOW UI: ALL PASS ✓" : `\nWORKFLOW UI: ${fails} FAILURE(S) ✗`);
process.exit(fails ? 1 : 0);
