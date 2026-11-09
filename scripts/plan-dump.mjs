// Compile a design module in Node and print its sewn segments as JSON (for
// overlaying on reference artwork). Usage: node scripts/plan-dump.mjs <module>
import {resolve} from 'node:path';
import {prepareEdits} from '../js/design-commands.js';import {compile} from '../js/compiler.js';import {computeStats} from '../js/stats.js';
const d=await import(resolve(process.argv[2]));let id=0;
const c=compile(prepareEdits([],d.operations,()=>++id).objects),segs=[];let last=null,down=false;
for(const s of c.plan){if(s.cmd==='stitch'){if(down&&last)segs.push([last.x,last.y,s.x,s.y]);last=s;down=true;}else{if(s.cmd==='jump')last=s;down=false;}}
console.log(JSON.stringify({stats:computeStats(c),segs}));
