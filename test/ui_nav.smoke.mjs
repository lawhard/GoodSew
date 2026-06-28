// Smoke test: center-snap on drag, arrow-key nudge, centerSelected, and a
// gentle/proportional wheel zoom. Drives the real app in headless Chrome.
import puppeteer from 'puppeteer-core';

const CHROME = 'chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = 'http://127.0.0.1:8137/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewport({ width: 1400, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// --- 1. add a shape object off-center ------------------------------------
const id = await page.evaluate(() => {
  const gs = window.__gs;
  gs.state.objects = [];
  const o = gs.addShape('rect', { x: 10, y: 12, w: 24, h: 18 });
  return o.id;
});

// --- 2. centerSelected centers the group on the 100x100 hoop -------------
const centered = await page.evaluate((id) => {
  const gs = window.__gs;
  gs.setSel([id]);
  gs.centerSelected('both');
  return gs.groupBounds(gs.selectedObjects());
}, id);
if (!near(centered.cx, 50) || !near(centered.cy, 50)) fail(`center off: ${centered.cx},${centered.cy}`);
else console.log('ok: centerSelected -> center', centered.cx.toFixed(2), centered.cy.toFixed(2));

// --- 3. arrow-key nudge moves the selection by 0.5 mm -------------------
const nudged = await page.evaluate(() => {
  const gs = window.__gs;
  const before = gs.groupBounds(gs.selectedObjects());
  gs.nudgeSelected(0.5, 0);   // simulate one ArrowRight
  gs.nudgeSelected(0, -0.5);  // one ArrowUp
  const after = gs.groupBounds(gs.selectedObjects());
  return { dx: after.cx - before.cx, dy: after.cy - before.cy };
});
if (!near(nudged.dx, 0.5) || !near(nudged.dy, -0.5)) fail(`nudge wrong: ${nudged.dx},${nudged.dy}`);
else console.log('ok: arrow nudge dx/dy', nudged.dx.toFixed(2), nudged.dy.toFixed(2));

// --- 4. real pointer drag near center snaps onto the centerline ---------
// Place object near (but not exactly at) center, then drag its center toward
// the hoop center and confirm it snaps to exactly 50 on the snapped axis.
const snap = await page.evaluate(async (id) => {
  const gs = window.__gs;
  // move object so its center sits a few px shy of hoop center-x
  gs.setSel([id]);
  const gb = gs.groupBounds(gs.selectedObjects());
  gs.nudgeSelected(50 - gb.cx, 50 - gb.cy); // exactly centered first
  return true;
}, id);

// drag: mousedown on object center, move ~3px off, release — should snap back.
const canvas = await page.$('#canvas');
const box = await canvas.boundingBox();
const cam = await page.evaluate(() => ({ pxPerMm: window.__gs.cam.pxPerMm, panX: window.__gs.cam.panX, panY: window.__gs.cam.panY }));
const sx = box.x + 50 * cam.pxPerMm + cam.panX;
const sy = box.y + 50 * cam.pxPerMm + cam.panY;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 4, sy + 4, { steps: 3 }); // tiny move within snap tol
await page.mouse.up();
const afterDrag = await page.evaluate(() => window.__gs.groupBounds(window.__gs.selectedObjects()));
if (!near(afterDrag.cx, 50, 0.3) || !near(afterDrag.cy, 50, 0.3)) fail(`drag snap failed: ${afterDrag.cx},${afterDrag.cy}`);
else console.log('ok: drag snapped to center', afterDrag.cx.toFixed(2), afterDrag.cy.toFixed(2));

// --- 5. wheel zoom is gentle (one notch < ~13% change) ------------------
const zoom = await page.evaluate(async () => {
  const gs = window.__gs;
  const before = gs.cam.pxPerMm;
  const cv = document.getElementById('canvas');
  cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: 700, clientY: 450, bubbles: true, cancelable: true }));
  const after = gs.cam.pxPerMm;
  return { before, after, ratio: after / before };
});
if (!(zoom.ratio > 1 && zoom.ratio < 1.13)) fail(`zoom not gentle: ratio ${zoom.ratio}`);
else console.log('ok: gentle zoom ratio', zoom.ratio.toFixed(3));

if (errors.length) fail('console errors:\n' + errors.join('\n'));
else console.log('ok: no console errors');

await browser.close();
console.log(process.exitCode ? 'SMOKE: FAILED' : 'SMOKE: PASSED');
