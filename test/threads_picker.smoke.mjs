// Smoke test for the New brothread thread picker: palette loads, popover opens
// with grouped swatches, search + "40-kit only" filters work, and choosing a
// swatch recolors the selected object — all with no console errors.
import puppeteer from 'puppeteer-core';

const CHROME = 'chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = 'http://127.0.0.1:8137/index.html';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewport({ width: 1400, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

// add a shape so there's a selection to recolor
const id = await page.evaluate(() => {
  const gs = window.__gs;
  gs.state.objects = [];
  const o = gs.addShape('rect', { x: 30, y: 30, w: 30, h: 25 });
  gs.setSel([o.id]);
  return o.id;
});

// open the picker
await page.click('#thread-button');
await page.waitForSelector('#color-popover:not(.hidden)');
const counts = await page.evaluate(() => ({
  groups: document.querySelectorAll('.color-group-label').length,
  swatches: document.querySelectorAll('.swatch-cell').length,
}));
if (counts.groups !== 3) fail(`expected 3 groups, got ${counts.groups}`);
else console.log('ok: 3 assortment groups');
if (counts.swatches !== 151) fail(`expected 151 swatches, got ${counts.swatches}`);
else console.log('ok: 151 swatches');

// search "N233" narrows to one
await page.type('#color-search', 'N233');
await new Promise(r => setTimeout(r, 100));
const searched = await page.evaluate(() => document.querySelectorAll('.swatch-cell').length);
if (searched !== 1) fail(`search N233 expected 1, got ${searched}`);
else console.log('ok: search narrows to 1 (N233)');

// clear search, toggle "only 40-kit" -> 40 swatches
await page.evaluate(() => { document.getElementById('color-search').value = ''; document.getElementById('color-search').dispatchEvent(new Event('input')); });
await page.click('#color-own-only');
await new Promise(r => setTimeout(r, 100));
const own = await page.evaluate(() => document.querySelectorAll('.swatch-cell').length);
if (own !== 40) fail(`40-kit filter expected 40, got ${own}`);
else console.log('ok: 40-kit filter -> 40 swatches');

// pick the first swatch; object recolors and popover closes
const picked = await page.evaluate((id) => {
  const cell = document.querySelector('.swatch-cell');
  const bg = cell.style.background;
  cell.click();
  const o = window.__gs.state.objects.find(x => x.id === id);
  return { closed: document.getElementById('color-popover').classList.contains('hidden'), color: o.color, bg };
}, id);
if (!picked.closed) fail('popover did not close after pick');
else console.log('ok: popover closes on pick');
if (!/^#[0-9a-f]{6}$/i.test(picked.color)) fail(`object color not a hex: ${picked.color}`);
else console.log('ok: object recolored to', picked.color);

// active label reflects a New brothread code · name
const label = await page.evaluate(() => document.getElementById('active-thread-label').textContent);
if (!/·/.test(label)) fail(`active label not a NB code·name: "${label}"`);
else console.log('ok: active label', JSON.stringify(label));

if (errors.length) fail('console errors:\n' + errors.join('\n'));
else console.log('ok: no console errors');

await browser.close();
console.log(process.exitCode ? 'PICKER: FAILED' : 'PICKER: PASSED');
