import test from 'node:test';import assert from 'node:assert/strict';
import {railObject,generateRailColumn,smoothRails} from '../js/satin.js';
import {prepareEdits} from '../js/design-commands.js';
import {compile} from '../js/compiler.js';
import {analyzeQuality} from '../js/qa.js';
import {exportPES} from '../js/export/pes.js';import {parsePES} from '../js/import/pes.js';
import {operations} from '../js/samples/timmy.js';
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
test('Timmy sample compiles within SE700 limits and survives a PES round trip',()=>{
 let id=0;const {objects}=prepareEdits([],operations,()=>++id),compiled=compile(objects),qa=analyzeQuality(compiled);
 const stitches=compiled.plan.filter(s=>s.cmd==='stitch');
 assert.ok(qa.valid,qa.warnings.filter(w=>w.sev==='error').map(w=>w.msg).join(' '));
 assert.ok(stitches.length>6000&&stitches.length<15000);assert.ok(compiled.bounds.w<=96&&compiled.bounds.h<=96);
 assert.ok(qa.maxLen<=7.5,'no long loose floats: '+qa.maxLen);assert.ok(qa.peakNeedlesPer2mmCell<=60,'no overdense cell');
 assert.equal(compiled.colors.length,8);assert.ok(compiled.plan.filter(s=>s.cmd==='trim').length<40);
 const decoded=parsePES(exportPES(compiled,'Timmy'),'timmy.pes').plan.filter(s=>s.cmd==='stitch');
 assert.equal(decoded.length,stitches.length);
});
