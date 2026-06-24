// Drives the real app in Chrome to verify the two-phase designer:
// design tools (text/shape), select/move/resize/rotate handles, guides,
// the Render phase, theme toggle, and PES export.
import puppeteer from "puppeteer-core";

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
await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(1500);

const getState = () => page.evaluate(() => ({
  objects: window.__gs.state.objects.length,
  guides: window.__gs.state.guides.length,
  mode: window.__gs.state.mode,
  stitches: window.__gs.compiledStats().stitches,
  colors: window.__gs.compiledStats().threadColors,
}));
const canvas = await page.$("#canvas");
const box = await canvas.boundingBox();
const at = (x, y) => ({ x: box.x + x, y: box.y + y });

console.log("Boot:");
ok(errors.length === 0, `no page errors (${errors.join("; ")})`);
ok(await page.evaluate(() => !!window.__gs), "debug hook present");
let s = await getState();
ok(s.objects === 2, `seed has 2 objects (got ${s.objects})`);
ok(s.mode === "design", `starts in design phase`);

console.log("Guides:");
await page.mouse.move(box.x + 300, box.y + 8); await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); await page.mouse.up();
ok((await getState()).guides === 1, "vertical guide from top ruler");
await page.mouse.move(box.x + 8, box.y + 300); await page.mouse.down();
await page.mouse.move(box.x + 250, box.y + 300, { steps: 8 }); await page.mouse.up();
ok((await getState()).guides === 2, "horizontal guide from left ruler");

console.log("Text tool:");
await page.evaluate(() => window.__gs.setTool("text"));
await page.mouse.click(box.x + 200, box.y + 760);
await sleep(700);
ok((await getState()).objects === 3, "clicking with Text tool added an object");

console.log("Shape tool:");
await page.evaluate(() => window.__gs.setTool("shape"));
await sleep(150);
// pick the star (index 7 in the grid) then drag a shape on empty canvas
await page.evaluate(() => document.querySelectorAll(".shape-cell")[7].click());
await page.mouse.move(box.x + 520, box.y + 720); await page.mouse.down();
await page.mouse.move(box.x + 620, box.y + 820, { steps: 8 }); await page.mouse.up();
ok((await getState()).objects === 4, "shape drag added an object");

console.log("Select + move:");
const heartId = await page.evaluate(() => window.__gs.state.objects.find((o) => o.kind === "heart").id);
const beforePos = await page.evaluate((id) => { const o = window.__gs.state.objects.find((x) => x.id === id); return { x: o.box.x, y: o.box.y }; }, heartId);
await page.evaluate(() => window.__gs.setTool("select"));
// click the heart center then drag
const heartC = await page.evaluate((id) => { const o = window.__gs.state.objects.find((x) => x.id === id); return { x: o.box.x + o.box.w / 2, y: o.box.y + o.box.h / 2 }; }, heartId);
const sc = await page.evaluate((p) => { return window.__gs ? null : null; }, heartC); // noop
// move via dragging on its on-screen center
const hs = await page.evaluate((id) => window.__gs.handlesScreen(id), heartId);
await page.mouse.move(box.x + hs.n.x, box.y + (hs.n.y + hs.s.y) / 2); // roughly center
await page.mouse.down();
await page.mouse.move(box.x + hs.n.x + 40, box.y + (hs.n.y + hs.s.y) / 2 + 30, { steps: 8 });
await page.mouse.up();
const afterPos = await page.evaluate((id) => { const o = window.__gs.state.objects.find((x) => x.id === id); return { x: o.box.x, y: o.box.y }; }, heartId);
ok(Math.abs(afterPos.x - beforePos.x) > 1 || Math.abs(afterPos.y - beforePos.y) > 1, "dragging moved the object");

console.log("Resize handle:");
const textId = await page.evaluate(() => window.__gs.state.objects.find((o) => o.type === "text").id);
const szBefore = await page.evaluate((id) => window.__gs.state.objects.find((x) => x.id === id).params.size, textId);
const th = await page.evaluate((id) => window.__gs.handlesScreen(id), textId);
await page.mouse.move(box.x + th.se.x, box.y + th.se.y); await page.mouse.down();
await page.mouse.move(box.x + th.se.x + 60, box.y + th.se.y + 60, { steps: 10 }); await page.mouse.up();
const szAfter = await page.evaluate((id) => window.__gs.state.objects.find((x) => x.id === id).params.size, textId);
ok(szAfter > szBefore, `dragging SE handle grew text (${szBefore.toFixed(1)} → ${szAfter.toFixed(1)} mm)`);

console.log("Rotate handle:");
const th2 = await page.evaluate((id) => window.__gs.handlesScreen(id), textId);
await page.mouse.move(box.x + th2.rotate.x, box.y + th2.rotate.y); await page.mouse.down();
await page.mouse.move(box.x + th2.rotate.x + 50, box.y + th2.rotate.y + 20, { steps: 10 }); await page.mouse.up();
const rotAfter = await page.evaluate((id) => window.__gs.state.objects.find((x) => x.id === id).rotation, textId);
ok(Math.abs(rotAfter) > 1, `rotate handle changed angle (${rotAfter.toFixed(1)}°)`);

console.log("Render phase:");
await page.click("#btn-render");
await sleep(900);
s = await getState();
ok(s.mode === "stitch", "Render switched to stitch phase");
ok(s.stitches > 500, `rendered ${s.stitches} stitches`);

console.log("Theme:");
await page.click("#btn-back"); await sleep(150);
await page.click("#btn-theme"); await sleep(150);
ok(await page.evaluate(() => document.body.dataset.theme === "dark"), "theme toggles to dark");
await page.click("#btn-theme"); await sleep(150);
ok(await page.evaluate(() => document.body.dataset.theme === "light"), "theme toggles back to light");

console.log("PES export:");
const pes = await page.evaluate(() => {
  const bytes = window.__gs.exportBytes();
  return { len: bytes.length, magic: String.fromCharCode(...bytes.slice(0, 8)), ptr: bytes[8] };
});
ok(pes.magic === "#PES0001", `magic ${pes.magic}`);
ok(pes.ptr === 22, `PEC pointer ${pes.ptr}`);
ok(pes.len > 1000, `${pes.len} bytes`);

ok(errors.length === 0, `no errors after interactions (${errors.join("; ")})`);
await page.screenshot({ path: "/home/user/GoodSew/scratch-e2e.png" });
await browser.close();
console.log(fails === 0 ? "\nALL PASS ✓" : `\n${fails} FAILURE(S) ✗`);
process.exit(fails ? 1 : 0);
