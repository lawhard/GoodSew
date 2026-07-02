// Autosave + Reset: design survives a page reload via localStorage; the Reset
// button restores the sample heart + GoodSew design.
import puppeteer from 'puppeteer-core';

const CHROME = 'chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = 'http://127.0.0.1:8137/index.html';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

// 1. build a distinctive design and let autosave flush
await page.evaluate(async () => {
  const gs = window.__gs;
  gs.state.objects = [];
  const o = gs.addShape('star5', { x: 12, y: 12, w: 25, h: 25 });
  o.color = '#e8a900'; o.name = 'MyStar';
  const t = gs.addText({ x: 15, y: 60 });
  t.params.text = 'Persist!'; t.color = '#0a55a3';
  gs.bakeText(t);
  await new Promise(r => setTimeout(r, 800));
});
// force a commit + flush via a nudge, then wait past the debounce
await page.evaluate(() => { window.__gs.setSel([window.__gs.state.objects[0].id]); window.__gs.nudgeSelected(0.5, 0); });
await new Promise(r => setTimeout(r, 1200));
const saved = await page.evaluate(() => {
  const s = localStorage.getItem('goodsew.design.v1');
  return s ? JSON.parse(s).objects.length : -1;
});
if (saved !== 2) fail(`autosave: expected 2 objects in storage, got ${saved}`);
else console.log('ok: design autosaved to localStorage');

// 2. reload — design must come back
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);
const after = await page.evaluate(() => ({
  count: window.__gs.state.objects.length,
  names: window.__gs.state.objects.map(o => o.name),
  texts: window.__gs.state.objects.filter(o => o.type === 'text').map(o => o.params.text),
}));
if (after.count !== 2) fail(`restore: expected 2 objects after reload, got ${after.count}`);
else console.log('ok: design restored after reload', JSON.stringify(after.names));
if (!after.texts.includes('Persist!')) fail(`restore: text content lost (${after.texts})`);
else console.log('ok: text content survived');

// 3. Reset button -> the sample heart + GoodSew design
await page.click('#btn-reset');
await new Promise(r => setTimeout(r, 900));
const demo = await page.evaluate(() => ({
  count: window.__gs.state.objects.length,
  kinds: window.__gs.state.objects.map(o => o.kind || o.type),
  texts: window.__gs.state.objects.filter(o => o.type === 'text').map(o => o.params.text),
}));
if (demo.count !== 2 || !demo.kinds.includes('heart') || !demo.texts.includes('GoodSew')) {
  fail(`reset: expected heart + GoodSew text, got ${JSON.stringify(demo)}`);
} else console.log('ok: Reset restores heart + GoodSew demo');

// 4. reset state survives reload too (autosave keeps up)
await new Promise(r => setTimeout(r, 900));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);
const demo2 = await page.evaluate(() => window.__gs.state.objects.filter(o => o.type === 'text').map(o => o.params.text));
if (!demo2.includes('GoodSew')) fail(`reset+reload: demo not persisted (${demo2})`);
else console.log('ok: reset design persisted across reload');

if (errors.length) fail('page errors:\n' + errors.join('\n'));
else console.log('ok: no page errors');

await browser.close();
console.log(process.exitCode ? 'AUTOSAVE: FAILED' : 'AUTOSAVE: PASSED');
