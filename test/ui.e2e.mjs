// Drives the real app in Chrome to verify interactive features:
// rulers, draggable guides, shape drawing, text, and PES export.
import puppeteer from "puppeteer-core";

const CHR = "/home/user/GoodSew/chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell";
const URL = "http://localhost:8137/index.html";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };

const browser = await puppeteer.launch({
  executablePath: CHR,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500)); // let fonts load + seed compile

// helper to read app state via a debug hook
const getState = () => page.evaluate(() => ({
  objects: window.__gs.state.objects.length,
  guides: window.__gs.state.guides.length,
  stitches: window.__gs.compiledStats().stitches,
  colors: window.__gs.compiledStats().threadColors,
}));

console.log("Boot:");
ok(errors.length === 0, `no page errors (${errors.join("; ")})`);
const hasHook = await page.evaluate(() => !!window.__gs);
ok(hasHook, "debug hook present");
let s = await getState();
ok(s.objects === 3, `seed has 3 objects (got ${s.objects})`);
ok(s.stitches > 500, `seed compiles ${s.stitches} stitches`);

// --- Draggable guide: drag from the top ruler down into the canvas ---
console.log("Guides:");
const canvas = await page.$("#canvas");
const box = await canvas.boundingBox();
await page.mouse.move(box.x + 300, box.y + 8);   // top ruler
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); // drag into canvas
await page.mouse.up();
s = await getState();
ok(s.guides === 1, `dragging from top ruler created 1 vertical guide (got ${s.guides})`);

// drag from the left ruler to make a horizontal guide
await page.mouse.move(box.x + 8, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 250, box.y + 300, { steps: 8 });
await page.mouse.up();
s = await getState();
ok(s.guides === 2, `dragging from left ruler created horizontal guide (total ${s.guides})`);

// --- Shape tool: select shape, drag a rectangle on the canvas ---
console.log("Shape tool:");
await page.evaluate(() => window.__gs.setTool("shape"));
const beforeShape = (await getState()).objects;
await page.mouse.move(box.x + 400, box.y + 400);
await page.mouse.down();
await page.mouse.move(box.x + 470, box.y + 460, { steps: 6 });
await page.mouse.up();
s = await getState();
ok(s.objects === beforeShape + 1, `shape drag added an object (now ${s.objects})`);

// --- Text tool: place lettering ---
console.log("Text tool:");
await page.evaluate(() => window.__gs.setTool("text"));
await page.mouse.click(box.x + 150, box.y + 700);
await new Promise((r) => setTimeout(r, 800)); // font/glyph build
s = await getState();
ok(s.objects === beforeShape + 2, `text placement added an object (now ${s.objects})`);

// --- PES export produces a valid buffer ---
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
