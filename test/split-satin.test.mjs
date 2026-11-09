import test from 'node:test';import assert from 'node:assert/strict';
import {railObject,generateRailColumn,smoothRails} from '../js/satin.js';
import {prepareEdits} from '../js/design-commands.js';
import {compile} from '../js/compiler.js';
import {analyzeQuality} from '../js/qa.js';
import {exportPES} from '../js/export/pes.js';import {parsePES} from '../js/import/pes.js';
import {operations} from '../js/samples/timi.js';
import {operations as lineOps} from '../js/samples/timi-line.js';
import {operations as brushOps} from '../js/samples/timi-brush.js';
import {operations as threeOps} from '../js/samples/timi-three.js';
import {generateForObject} from '../js/stitches.js';
const len=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const wide=[[{x:10,y:10},{x:40,y:10}],[{x:10,y:40},{x:40,y:40}]];
test('split satin sews a wide area with bounded, staggered stitches',()=>{
 assert.throws(()=>generateRailColumn(railObject(wide,{params:{underlay:false}})),/10 mm/);
 const p=generateRailColumn(railObject(wide,{params:{underlay:false,split:7}}))[0];
 for(let i=1;i<p.length;i++)assert.ok(len(p[i-1],p[i])<=7.001,'no stitch longer than the split length');
 // every row still runs rail to rail (direction preserved, so it reads as satin)
 for(let i=1;i<p.length;i++)assert.ok(Math.abs(p[i].y-p[i-1].y)>Math.abs(p[i].x-p[i-1].x));
 // split penetrations are dispersed, not lined up in a seam
 const inner=p.filter(q=>q.y>10.5&&q.y<39.5).map(q=>Math.round(q.y*2)/2);
 assert.ok(new Set(inner).size>12,'staggered split points');
 assert.deepEqual(generateRailColumn(railObject(wide,{params:{underlay:false,split:7}}))[0],p,'deterministic');
});
test('feathered rails stay inside the authored column and underlay stays hidden',()=>{
 const p=generateRailColumn(railObject(wide,{params:{underlay:true,split:7,featherB:3}}))[0];
 for(const q of p){assert.ok(q.y>=9.99&&q.y<=40.01);assert.ok(q.x>=9.99&&q.x<=40.01);}
 const ends=p.filter(q=>q.y>36.9).map(q=>q.y);assert.ok(Math.max(...ends)-Math.min(...ends)>1.5,'irregular fur edge');
});
test('a converging fan does not pile needle points on its short rail',()=>{
 const fan=smoothRails([[{x:30,y:30},{x:31,y:30.5},{x:32,y:30}],[{x:10,y:10},{x:31,y:2},{x:52,y:10}]]);
 const p=generateRailColumn(railObject(fan,{params:{underlay:false,split:7}}))[0];
 const root=p.filter(q=>q.y>29.6).length,all=p.length;assert.ok(root<all/6,'most stitches stop short of the apex');
});
test('assistant can add freeform regions and spine-width satin',()=>{
 let id=0;const r=prepareEdits([],[
  {op:'add_region',name:'Leaf',points:[{x:10,y:10},{x:30,y:14},{x:26,y:32},{x:12,y:28}],smooth:true,params:{angle:30}},
  {op:'add_satin',spine:[{x:40,y:10},{x:50,y:20},{x:60,y:12}],width:[1,3,1],smooth:true},
  {op:'add_satin',rails:wide,params:{split:6,featherA:1}}],()=>++id);
 assert.deepEqual(r.objects.map(o=>o.type),['fill','satin','satin']);
 assert.ok(r.objects[0].contours[0].length>12);assert.ok(r.objects[1]._rails[0].length>6);
 assert.ok(compile(r.objects).plan.length>500);
 assert.throws(()=>prepareEdits([],[{op:'add_satin',spine:[{x:0,y:0},{x:5,y:5}]}],()=>1),/spine plus width/);
});
test('Timi sample compiles within SE700 limits and survives a PES round trip',()=>{
 let id=0;const {objects}=prepareEdits([],operations,()=>++id),compiled=compile(objects),qa=analyzeQuality(compiled);
 const stitches=compiled.plan.filter(s=>s.cmd==='stitch');
 assert.ok(qa.valid,qa.warnings.filter(w=>w.sev==='error').map(w=>w.msg).join(' '));
 assert.ok(stitches.length>6000&&stitches.length<15000);assert.ok(compiled.bounds.w<=96&&compiled.bounds.h<=96);
 assert.ok(qa.maxLen<=7.5,'no long loose floats: '+qa.maxLen);assert.ok(qa.peakNeedlesPer2mmCell<=60,'no overdense cell');
 assert.equal(compiled.colors.length,8);assert.ok(compiled.plan.filter(s=>s.cmd==='trim').length<40);
 const decoded=parsePES(exportPES(compiled,'Timi'),'timi.pes').plan.filter(s=>s.cmd==='stitch');
 assert.equal(decoded.length,stitches.length);
});
test('Timi line portrait is one thread of sewable satin with open catchlights',()=>{
 let id=0;const {objects}=prepareEdits([],lineOps,()=>++id),compiled=compile(objects),qa=analyzeQuality(compiled);
 assert.ok(qa.valid);assert.equal(compiled.colors.length,1);assert.ok(objects.every(o=>o.kind==='satin-rails'),'every line is a satin column');
 assert.ok(compiled.bounds.w<=96&&compiled.bounds.h<=96);assert.ok(qa.maxLen<=8,'longest stitch '+qa.maxLen);assert.ok(qa.peakNeedlesPer2mmCell<=60);
 assert.ok(compiled.plan.filter(s=>s.cmd==='trim').length<=34,'chained strokes keep jumps down');
 // the catchlights must stay unstitched: no needle point and no thread crosses them
 const st=compiled.plan.filter(s=>s.cmd==='stitch');
 for(const h of [{x0:34,x1:35.6,y0:45,y1:46},{x0:54.6,x1:56.5,y0:47.4,y1:48.4}])assert.ok(!st.some(s=>s.x>h.x0&&s.x<h.x1&&s.y>h.y0&&s.y<h.y1),'catchlight is bare cloth');
});
test('auto-traced brush portrait compiles: satin strokes plus solid eyes and nose',()=>{
 let id=0;const {objects}=prepareEdits([],brushOps,()=>++id),compiled=compile(objects),qa=analyzeQuality(compiled);
 assert.ok(qa.valid);assert.equal(compiled.colors.length,1);
 assert.ok(objects.filter(o=>o.kind==='satin-rails').length>80);assert.equal(objects.filter(o=>o.type==='fill').length,3);
 assert.ok(compiled.bounds.w<=96&&compiled.bounds.h<=96);assert.ok(qa.maxLen<=9,'longest stitch '+qa.maxLen);assert.ok(qa.peakNeedlesPer2mmCell<=60);
});
test('three-colour traced portrait: three thread stops, fills sewn without internal trims',()=>{
 let id=0;const {objects}=prepareEdits([],threeOps,()=>++id),compiled=compile(objects),qa=analyzeQuality(compiled);
 assert.ok(qa.valid);assert.equal(compiled.colors.length,3);assert.ok(compiled.bounds.w<=96&&compiled.bounds.h<=96);
 assert.ok(qa.maxLen<=9,'longest stitch '+qa.maxLen);
 const fills=objects.filter(o=>o.type==='fill');assert.ok(fills.length>=8);
 // hidden travel links every section of a tufted fill: one tie-in, no trims inside
 for(const o of fills)assert.ok(compile([o]).plan.filter(s=>s.cmd==='trim').length<=2,o.name+' sews as one run');
 assert.ok(compiled.plan.filter(s=>s.cmd==='trim').length<90);
});
test('hidden travel stays inside the shape and out of its holes',()=>{
 const outer=[{x:0,y:0},{x:40,y:0},{x:40,y:8},{x:8,y:8},{x:8,y:30},{x:40,y:30},{x:40,y:38},{x:0,y:38}]; // a "C": two arms joined by a spine
 const subs=generateForObject({type:'fill',points:outer,contours:[outer],params:{spacing:.45,angle:0,stitchLength:3,underlay:true}});
 const inside=p=>p.x>=-.01&&p.x<=40.01&&p.y>=-.01&&p.y<=38.01&&!(p.x>8.2&&p.y>8.2&&p.y<29.8);
 for(const s of subs)for(const p of s)assert.ok(inside(p),'point in the C notch: '+JSON.stringify(p));
 for(let i=1;i<subs.length;i++){const a=subs[i-1].at(-1),b=subs[i][0];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=3.01&&!subs[i]._trimBefore,'sections are linked');}
});
