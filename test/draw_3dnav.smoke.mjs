// Smoke test: manual-digitizing finish affordances (real mouse events — the
// bar buttons, double-click, right-click, click-on-last-point, tool switch,
// Enter, Esc) and the damped 3D navigation (presets, drag orbit, wheel zoom,
// dblclick recenter). Drives the real app in headless Chrome.
import puppeteer from 'puppeteer-core';

const CHROME = 'chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = 'http://127.0.0.1:8137/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.setViewport({ width: 1400, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const objCount = () => page.evaluate(() => window.__gs.state.objects.length);
const objTypes = () => page.evaluate(() => window.__gs.state.objects.map((o) => o.type));

await page.evaluate(() => { window.__gs.state.objects = []; window.__gs.setSel([]); });
const cb = await (await page.$('#canvas')).boundingBox();
const X = (f) => cb.x + cb.width * f, Y = (f) => cb.y + cb.height * f;
const clickAt = async (fx, fy, opts) => { await page.mouse.click(X(fx), Y(fy), opts); await sleep(60); };
// A real double-click sequence (down/up detail 1, then down/up detail 2 —
// puppeteer's click({clickCount:2}) doesn't set e.detail in this shell).
const dblAt = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  await sleep(80);
};

console.log('Draw bar appears with the tool, before any clicks');
await page.click('.tool[data-tool="run"]');
await sleep(100);
ok(await page.evaluate(() => !document.getElementById('draw-bar').classList.contains('hidden')), 'draw bar visible on tool pick');
ok(await page.evaluate(() => document.getElementById('draw-finish').disabled), 'Finish disabled with 0 points');

console.log('Finish via the ✓ button');
await clickAt(0.30, 0.30);
await clickAt(0.45, 0.35);
await clickAt(0.60, 0.30);
ok(await page.evaluate(() => !document.getElementById('draw-finish').disabled), 'Finish enabled after enough points');
ok(await page.evaluate(() => document.getElementById('draw-bar-msg').textContent.includes('3')), 'bar shows the point count');
await page.click('#draw-finish');
await sleep(120);
ok(await objCount() === 1, 'run line created by ✓ Finish');
ok((await objTypes())[0] === 'running', 'created object is a running stitch');
ok(await page.evaluate(() => document.getElementById('draw-bar').classList.contains('hidden')), 'bar hides after finish (tool back to select)');

console.log('Finish via real double-click');
await page.click('.tool[data-tool="satin"]');
await clickAt(0.30, 0.50);
await clickAt(0.45, 0.55);
await dblAt(X(0.60), Y(0.50));
await sleep(120);
ok(await objCount() === 2, 'satin line created by double-click');

console.log('Finish via right-click');
await page.click('.tool[data-tool="run"]');
await clickAt(0.30, 0.65);
await clickAt(0.50, 0.68);
await page.mouse.click(X(0.50), Y(0.68), { button: 'right' });
await sleep(120);
ok(await objCount() === 3, 'run line created by right-click');

console.log('Finish by clicking the last point again');
await page.click('.tool[data-tool="run"]');
await clickAt(0.30, 0.75);
await clickAt(0.50, 0.78);
await clickAt(0.65, 0.75);
await sleep(400); // stay outside the double-click window
await clickAt(0.65, 0.75); // click the highlighted last point
ok(await objCount() === 4, 'run line created by clicking its last point');

console.log('Poly closes by clicking the first corner');
await page.click('.tool[data-tool="poly"]');
await clickAt(0.70, 0.30);
await clickAt(0.80, 0.30);
await clickAt(0.80, 0.42);
await sleep(400);
await clickAt(0.70, 0.30); // back to the first corner
ok(await objCount() === 5, 'region created by clicking the first corner');
ok((await objTypes())[4] === 'fill', 'closed region is a fill object');

console.log('Switching tools commits instead of discarding');
await page.click('.tool[data-tool="run"]');
await clickAt(0.20, 0.20);
await clickAt(0.25, 0.25);
await page.click('.tool[data-tool="select"]');
await sleep(120);
ok(await objCount() === 6, 'in-progress line committed on tool switch');

console.log('Enter finishes, Esc cancels');
await page.click('.tool[data-tool="run"]');
await clickAt(0.20, 0.40);
await clickAt(0.25, 0.45);
await page.keyboard.press('Enter');
await sleep(120);
ok(await objCount() === 7, 'Enter finished the line');
await page.click('.tool[data-tool="run"]');
await clickAt(0.20, 0.55);
await clickAt(0.25, 0.60);
await page.keyboard.press('Escape');
await sleep(120);
ok(await objCount() === 7, 'Esc discarded the in-progress line');
ok(await page.evaluate(() => {
  const d = window.__gs.state; return d.objects.every((o) => o.points.length >= 2 || o.type !== 'running');
}), 'all committed lines have their points');

// ---------------------------------------------------------------- 3D nav
console.log('3D viewer navigation');
await page.click('#btn-render');
await sleep(1200);
await page.click('#btn-3d');
await page.waitForFunction(() => window.__gs3d === true, { timeout: 20000 });
await sleep(600);
const stage = await (await page.$('#view3d-stage canvas')).boundingBox();
const SX = stage.x + stage.width / 2, SY = stage.y + stage.height / 2;

ok(await page.evaluate(() => document.querySelectorAll('#view3d-views [data-view]').length === 4), 'four preset view buttons present');

// drag to orbit: camera should move smoothly (damped) and keep rendering
const shot0 = await page.screenshot({ clip: stage });
await page.mouse.move(SX, SY);
await page.mouse.down();
await page.mouse.move(SX + 180, SY - 60, { steps: 12 });
await page.mouse.up();
await sleep(700); // let damping settle
const shot1 = await page.screenshot({ clip: stage });
ok(!shot0.equals(shot1), 'drag orbits the camera (view changed)');

// wheel zoom in — view should change again
await page.mouse.move(SX, SY);
await page.mouse.wheel({ deltaY: -600 });
await sleep(700);
const shot2 = await page.screenshot({ clip: stage });
ok(!shot1.equals(shot2), 'wheel zooms (view changed)');

// preset buttons steer the camera
await page.click('#view3d-views [data-view="top"]');
await sleep(900);
const shot3 = await page.screenshot({ clip: stage });
ok(!shot2.equals(shot3), 'Top preset moved the camera');
await page.click('#view3d-views [data-view="hoop"]');
await sleep(900);
const shot4 = await page.screenshot({ clip: stage });
ok(!shot3.equals(shot4), 'Hoop preset zoomed out to the hoop');
await page.click('#view3d-views [data-view="home"]');
await sleep(900);

// dblclick recenters + zooms toward the point
await dblAt(SX - 80, SY - 40);
await sleep(900);
const shot5 = await page.screenshot({ clip: stage });
ok(!shot4.equals(shot5), 'double-click recentred the camera');

await page.click('#view3d-close');
await sleep(200);

ok(errors.length === 0, `no console errors (${errors.join('; ')})`);
await browser.close();
console.log(fails === 0 ? '\nDRAW+3DNAV: ALL PASS ✓' : `\nDRAW+3DNAV: ${fails} FAILURE(S) ✗`);
process.exit(fails ? 1 : 0);
