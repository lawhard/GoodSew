// End-to-end raster + SVG logo import: draw a realistic anti-aliased logo on a
// canvas, vectorize it through the real import path, render stitches, export.
import puppeteer from 'puppeteer-core';

const CHROME = 'chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = 'http://127.0.0.1:8137/index.html';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__gs && window.__gs.state);

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

// ---- raster logo: white card, navy roundel with white counter, red bolt, text-ish bar
const r1 = await page.evaluate(() => {
  const gs = window.__gs;
  gs.state.objects = [];
  const cv = document.createElement('canvas');
  cv.width = 420; cv.height = 320;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 420, 320);          // white card
  g.fillStyle = '#12306e';                                       // navy ring
  g.beginPath(); g.arc(160, 150, 105, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(160, 150, 58, 0, Math.PI * 2); g.fill();  // counter
  g.fillStyle = '#d21f2c';                                       // red wedge
  g.beginPath(); g.moveTo(285, 70); g.lineTo(395, 120); g.lineTo(300, 170); g.closePath(); g.fill();
  g.fillStyle = '#1a7a3c';                                       // green bar
  g.fillRect(285, 200, 110, 42);
  const data = g.getImageData(0, 0, 420, 320);
  gs.importRasterData(data);
  const objs = gs.state.objects;
  return {
    count: objs.length,
    colors: objs.map(o => o.color),
    grouped: objs.every(o => o.groupId != null && o.groupId === objs[0].groupId),
    hasHole: objs.some(o => (o.contours || []).length >= 2),
    allSelected: gs.state.selectedIds.length === objs.length,
  };
});
if (r1.count !== 3) fail(`raster: expected 3 parts (navy/red/green), got ${r1.count}: ${r1.colors.join(',')}`);
else console.log('ok: raster -> 3 parts', r1.colors.join(', '));
if (!r1.grouped) fail('raster: parts not grouped');
else console.log('ok: parts grouped');
if (!r1.hasHole) fail('raster: roundel counter (hole) missing');
else console.log('ok: roundel hole preserved');
if (!r1.allSelected) fail('raster: parts not selected after import');
else console.log('ok: all parts selected');

// white must not be imported
if (r1.colors.some(c => { const v = parseInt(c.slice(1), 16); const r = v >> 16, g2 = (v >> 8) & 255, b = v & 255; return r > 230 && g2 > 230 && b > 230; })) {
  fail('raster: white background imported as a part');
} else console.log('ok: white background dropped');

// ---- render stitches on the imported logo
const r2 = await page.evaluate(async () => {
  const gs = window.__gs;
  gs.renderStitches();
  await new Promise(r => setTimeout(r, 600));
  const st = gs.compiledStats();
  return st;
});
if (!(r2.stitches > 500)) fail(`render: too few stitches (${r2.stitches})`);
else console.log('ok: rendered', r2.stitches, 'stitches,', r2.seconds.toFixed(0) + 's est');

await page.screenshot({ path: 'scratch-logo.png', clip: { x: 150, y: 80, width: 1050, height: 800 } });

// ---- high-res JPEG round-trip: quality must survive compression + downscale
const rq = await page.evaluate(async () => {
  const gs = window.__gs;
  gs.state.objects = [];
  // 1600×1200 "photo-grade" logo: big navy circle + red diamond, JPEG q0.85
  const cv = document.createElement('canvas');
  cv.width = 1600; cv.height = 1200;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1600, 1200);
  g.fillStyle = '#12306e';
  g.beginPath(); g.arc(600, 600, 420, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d21f2c';
  g.beginPath(); g.moveTo(1300, 300); g.lineTo(1500, 600); g.lineTo(1300, 900); g.lineTo(1100, 600); g.closePath(); g.fill();
  const url = cv.toDataURL('image/jpeg', 0.85);
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.src = url; });
  gs.importRasterImage(img);
  const objs = gs.state.objects;
  // measure circle roundness: the biggest part's outer loop vs a perfect circle
  const big = objs.map(o => ({ o, n: (o.contours && o.contours[0] || []).length }))
    .sort((a, b) => b.n - a.n)[0].o;
  const loop = big.contours[0];
  let cx = 0, cy = 0;
  for (const p of loop) { cx += p.x; cy += p.y; }
  cx /= loop.length; cy /= loop.length;
  const rs = loop.map(p => Math.hypot(p.x - cx, p.y - cy));
  const rMean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const rMaxDev = Math.max(...rs.map(r => Math.abs(r - rMean)));
  return { count: objs.length, colors: objs.map(o => o.color), pts: loop.length, rMean, rMaxDev };
});
if (rq.count !== 2) fail(`jpeg: expected 2 parts, got ${rq.count}: ${rq.colors.join(',')}`);
else console.log('ok: hi-res JPEG -> 2 parts', rq.colors.join(', '));
const devPct = (rq.rMaxDev / rq.rMean) * 100;
if (devPct > 3.0) fail(`jpeg: circle rough — max radius deviation ${devPct.toFixed(1)}% (want ≤3%)`);
else console.log(`ok: circle traced smooth (max radius deviation ${devPct.toFixed(1)}%, ${rq.pts} pts)`);

// ---- SVG with inherited fill via <g> + CSS class + gradient + white bg rect
const r3 = await page.evaluate(() => {
  const gs = window.__gs;
  gs.state.objects = [];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
    <style>.brand{fill:#0a7d4b}</style>
    <defs><linearGradient id="gr"><stop offset="0" stop-color="#c02040"/><stop offset="1" stop-color="#ffb020"/></linearGradient></defs>
    <rect x="0" y="0" width="200" height="100" fill="#ffffff"/>
    <g fill="#123a8c">
      <rect x="12" y="16" width="52" height="68"/>
    </g>
    <circle class="brand" cx="106" cy="50" r="30"/>
    <rect x="150" y="20" width="38" height="60" fill="url(#gr)"/>
  </svg>`;
  gs.importSVG(svg);
  return { count: gs.state.objects.length, colors: gs.state.objects.map(o => o.color) };
});
const cols = r3.colors.map(c => c.toLowerCase());
if (r3.count !== 3) fail(`svg: expected 3 parts (bg dropped), got ${r3.count}: ${cols.join(',')}`);
else console.log('ok: svg -> 3 parts, white bg dropped');
if (!cols.includes('#123a8c')) fail(`svg: inherited <g> fill missing (${cols.join(',')})`);
else console.log('ok: inherited <g> fill resolved');
if (!cols.includes('#0a7d4b')) fail(`svg: CSS class fill missing (${cols.join(',')})`);
else console.log('ok: CSS class fill resolved');
if (!cols.includes('#c02040')) fail(`svg: gradient fallback missing (${cols.join(',')})`);
else console.log('ok: gradient approximated by first stop');

if (errors.length) fail('console errors:\n' + errors.join('\n'));
else console.log('ok: no console errors');

await browser.close();
console.log(process.exitCode ? 'LOGO: FAILED' : 'LOGO: PASSED');
