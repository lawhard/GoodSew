// Turn a tools/trace_lineart.py JSON into a sample module, checking every
// command against the real stitch compiler first.
// usage: node scripts/import-trace.mjs trace.json js/samples/name.js
import {readFile,writeFile} from 'node:fs/promises';
import {prepareEdits} from '../js/design-commands.js';import {compile} from '../js/compiler.js';
const [,,src,out]=process.argv,t=JSON.parse(await readFile(src,'utf8')),good=[],bad=[];
const works=op=>{let id=0;const c=compile(prepareEdits([],[op],()=>++id).objects);if(!c.plan.some(s=>s.cmd==='stitch'))throw Error('no stitches');};
for(const op of t.operations){
 // a tight curl can cross its own rails: retry unsmoothed, then slimmer
 const tries=[op,{...op,smooth:false},...(op.width?[{...op,smooth:false,width:op.width.map(w=>Math.max(.4,w*.65))}]:[])];let error;
 for(const candidate of tries){try{works(candidate);good.push(candidate);error=null;break;}catch(err){error=err;}}
 if(error)bad.push(op.name+': '+error.message);
}
const compact=JSON.stringify(good).replace(/\},\{"op"/g,'},\n {"op"');
await writeFile(out,`// ${t.name} — traced automatically from black-on-white line art by\n// tools/trace_lineart.py: each stroke is a satin column (skeleton centre line,\n// measured width), solid shapes are fills that keep their white highlights.\nexport const NAME=${JSON.stringify(t.name)};\nexport const FABRIC='#ffffff';\nexport const operations=[\n ${compact.slice(1,-1)}\n];\n`);
console.log(`${good.length} commands written, ${bad.length} rejected`);for(const b of bad)console.log('  rejected',b);
