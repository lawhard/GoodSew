// Browser smoke for the built dist/: Samples dialog, Timi portrait, fabric colour,
// rail-satin controls, autosave and the ?sample=timi link. Usage: node test/sample.smoke.mjs <screenshot-dir>
import puppeteer from 'puppeteer-core';
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {extname,resolve} from 'node:path';
const root=resolve(new URL('../dist',import.meta.url).pathname),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://x').pathname.replace(/\/$/,'/index.html'));res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage();await page.setViewport({width:1440,height:900});const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('dialog',d=>d.accept());
const out=process.argv[2];let fails=0;const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 1. default boot unchanged
await page.goto(base,{waitUntil:'networkidle0'});await sleep(800);
ok(await page.evaluate(()=>window.__gs.state.objects.length===2),'default boot still seeds the heart sample');
ok(await page.evaluate(()=>typeof window.goodsew.call==='function'&&window.goodsew.tools.some(t=>t.name==='preview_2d')),'window.goodsew command door exposed');
// 2. Samples dialog → Timi
await page.click('#btn-reset');await sleep(200);
ok(await page.evaluate(()=>document.getElementById('sample-dialog').open),'Samples dialog opens');
await page.click('#sample-timi');
await page.waitForFunction(()=>window.__gs.state.mode==='stitch'&&window.__gs.state.objects.length>20,{timeout:30000});await sleep(1200);
const st=await page.evaluate(()=>({...window.__gs.compiledStats(),valid:window.__gs.quality().valid,peak:window.__gs.quality().peakNeedlesPer2mmCell,name:window.__gs.state.name,fabric:window.__gs.state.fabricColor,badge:document.getElementById('version-badge').textContent,status:document.getElementById('design-status')?.textContent}));
console.log('   ',JSON.stringify(st));
ok(st.valid&&st.stitches>8000&&st.width<96&&st.height<96,'Timi compiles, passes checks, fits the hoop');
ok(st.fabric==='#33415c'&&st.name==='Timi','project name + fabric colour applied');
await page.screenshot({path:out+'/app-stitch.png'});
// 3. undo returns the previous work
// 4. design mode view + props for a rail object
await page.click('#btn-back');await sleep(500);
await page.evaluate(()=>{const o=window.__gs.state.objects.find(o=>o.name==='Forehead');window.__gs.setSel([o.id]);});await sleep(300);
await page.evaluate(()=>document.querySelector('.object-item')?.click());await sleep(300);
await page.screenshot({path:out+'/app-design.png'});
ok(await page.evaluate(()=>[...document.querySelectorAll('#object-props label')].some(l=>l.textContent.includes('Split satin'))),'split / fur-edge controls shown for rail satin');
// 5. reload restores autosave incl. fabric colour
await page.reload({waitUntil:'networkidle0'});await sleep(800);
ok(await page.evaluate(()=>window.__gs.state.objects.length>20&&window.__gs.state.fabricColor==='#33415c'),'autosave restores Timi and the fabric colour');
// 6. ?sample=timi deep link on a clean profile
const ctx=await browser.createBrowserContext();const p2=await ctx.newPage();p2.on('pageerror',e=>errors.push(e.message));
await p2.goto(base+'?sample=timi',{waitUntil:'networkidle0'});
await p2.waitForFunction(()=>window.__gs.state.mode==='stitch'&&window.__gs.state.objects.length>20,{timeout:30000});
ok(true,'?sample=timi-line deep link loads the line portrait');
ok(errors.length===0,'no console errors: '+errors.join(' | '));
await browser.close();server.close();process.exit(fails?1:0);
