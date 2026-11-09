// Plays a design module (export const operations, FABRIC) into the real app in
// headless Chromium through window.goodsew.call — the same validated commands
// the Assistant panel and the MCP connector use — and saves previews + PES.
import puppeteer from 'puppeteer-core';
import {createServer} from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {extname,resolve} from 'node:path';
const [, , modulePath='js/samples/timmy.js',outDir='dist-design',...flags]=process.argv;
const root=resolve(new URL('..',import.meta.url).pathname),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.json':'application/json','.txt':'text/plain'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://x').pathname.replace(/\/$/,'/index.html')));if(!path.startsWith(root))throw 0;res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const design=await import(resolve(modulePath)+'?t='+Date.now());
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage();await page.setViewport({width:1500,height:1000});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'networkidle0'});
await page.waitForFunction(()=>window.goodsew);
await mkdir(outDir,{recursive:true});
const call=(name,args={})=>page.evaluate((name,args)=>window.goodsew.call(name,args),name,args);
let d=await call('get_design');
if(d.objects.length)d={revision:(await call('apply_edit',{expectedRevision:d.revision,requestId:'clear',operations:d.objects.map(o=>({op:'remove',id:o.id}))})).revision};
const ops=design.operations;
for(let i=0;i<ops.length;i+=50)d=await call('apply_edit',{expectedRevision:d.revision,requestId:'batch-'+i,operations:ops.slice(i,i+50)});
if(design.NAME)await page.evaluate(name=>{const el=document.getElementById('project-name');el.value=name;el.dispatchEvent(new Event('input',{bubbles:true}));},design.NAME);
const save=async(name,r)=>{await writeFile(`${outDir}/${name}.png`,Buffer.from(r.image,'base64'));};
const whole=await call('preview_2d',{fabric:design.FABRIC,width:1400});await save('preview',whole);
for(const [name,focus] of Object.entries(design.CLOSEUPS||{}))await save(name,await call('preview_2d',{focus,width:1400}));
console.log(JSON.stringify({stats:whole.stats,bounds:whole.bounds,colors:whole.colors.map(c=>c.color),peak:whole.warnings.peakNeedlesPer2mmCell,hotspots:whole.warnings.hotspots,warnings:whole.warnings.warnings.map(w=>w.msg)},null,1));
if(flags.includes('--3d')){for(const view of ['top','angled']){const r=await call('preview_3d',{view,focus:{x:whole.bounds.minX-3,y:whole.bounds.minY-3,w:whole.bounds.w+6,h:whole.bounds.h+6}});await save('preview3d-'+view,r);}}
if(flags.includes('--export')){
 const pes=await call('export_pes');await writeFile(`${outDir}/${pes.filename}`,Buffer.from(pes.base64,'base64'));console.log('PES',pes.filename,pes.verification);
 await writeFile(`${outDir}/project.gsew`,await page.evaluate(async()=>(await import('./js/state.js')).serialize()));
}
await browser.close();server.close();
