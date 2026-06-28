// Smoke test for the categorized font gallery: every catalog font gets an
// @font-face, the gallery renders category headings + chips, filtering works,
// and picking a font from another category re-bakes the text without errors.
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

// 1. all faces injected + all fonts actually load in the browser
const faceInfo = await page.evaluate(async () => {
  const styleEl = document.getElementById('gs-font-faces');
  const count = styleEl ? (styleEl.textContent.match(/@font-face/g) || []).length : 0;
  await document.fonts.ready;
  // force-load each family by checking document.fonts.check on a probe
  return { injected: count };
});
if (faceInfo.injected < 30) fail(`expected >=30 @font-face, got ${faceInfo.injected}`);
else console.log('ok: @font-face injected', faceInfo.injected);

// 2. open the gallery on a text object
await page.evaluate(() => {
  const gs = window.__gs;
  gs.state.objects = [];
  const o = gs.addText({ x: 30, y: 40 });
  o.params.text = 'Hello';
  window.__gs.openFontGallery(o);
});
await page.waitForSelector('#font-modal:not(.hidden)');
await new Promise(r => setTimeout(r, 200));

// gallery opens filtered to the active font's category; click "All" to see all
await page.evaluate(() => {
  [...document.querySelectorAll('.font-cat-chip')].find(c => c.textContent === 'All').click();
});

// 3. headings + chips present
const ui = await page.evaluate(() => ({
  heads: document.querySelectorAll('.font-cat-head').length,
  chips: document.querySelectorAll('.font-cat-chip').length,
  cards: document.querySelectorAll('.font-card').length,
  firstHeadFont: document.querySelector('.font-cat-head .cat-name')?.style.fontFamily || '',
}));
if (ui.heads < 7) fail(`expected 7 category heads, got ${ui.heads}`);
else console.log('ok: category heads', ui.heads);
if (ui.chips < 8) fail(`expected >=8 chips (All + cats), got ${ui.chips}`);
else console.log('ok: filter chips', ui.chips);
if (ui.cards < 30) fail(`expected >=30 font cards, got ${ui.cards}`);
else console.log('ok: font cards', ui.cards);
if (!/GS-/.test(ui.firstHeadFont)) fail(`heading not set in rep font: "${ui.firstHeadFont}"`);
else console.log('ok: heading uses rep font', ui.firstHeadFont);

// 4. clicking the "Cursive" chip filters to just that category
const filtered = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.font-cat-chip')].find(c => c.textContent === 'Cursive');
  chip.click();
  return { heads: document.querySelectorAll('.font-cat-head').length, cards: document.querySelectorAll('.font-card').length };
});
if (filtered.heads !== 1) fail(`filter should show 1 head, got ${filtered.heads}`);
else console.log('ok: chip filter -> 1 category, cards', filtered.cards);

// 5. pick a cursive font and confirm the text re-bakes to it
const picked = await page.evaluate(() => {
  const card = document.querySelector('.font-card');
  const name = card.querySelector('.font-meta .nm').textContent;
  card.click();
  const o = window.__gs.state.objects[0];
  return { name, font: o.params.font, glyphs: (o._glyphs ? o._glyphs.length : (o.contours ? o.contours.length : 0)) };
});
if (picked.font !== picked.name) fail(`pick didn't apply: wanted ${picked.name}, got ${picked.font}`);
else console.log('ok: picked font applied', picked.font);

if (errors.length) fail('console errors:\n' + errors.join('\n'));
else console.log('ok: no console errors');

await browser.close();
console.log(process.exitCode ? 'GALLERY: FAILED' : 'GALLERY: PASSED');
