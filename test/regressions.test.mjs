import test from 'node:test';
import assert from 'node:assert/strict';
import {state,makeObject,serialize,deserialize} from '../js/state.js';
import {compile} from '../js/compiler.js';
import {exportPES} from '../js/export/pes.js';
import {exportDST} from '../js/export/dst.js';
import {analyzeQuality} from '../js/qa.js';
import {generateRunning} from '../js/stitches.js';
import {computeStats,formatTime} from '../js/stats.js';
import {optimizeObjects} from '../js/order.js';
import {buildSewSheet,fileStem} from '../js/sewing.js';
import {traceRaster} from '../js/import/raster.js';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
test('Save/Open preserves running, satin, holes and grouping',()=>{
 state.name='Test';state.fabric='knit';
 const a=makeObject('running',[{x:10,y:10},{x:20,y:20}]);a.groupId=21;
 const b=makeObject('satin',[{x:30,y:10},{x:40,y:20}]);b.groupId=21;
 const c=makeObject('fill',rect(10,30,30,30));c.contours=[c.points,rect(20,40,10,10)];
 state.objects=[a,b,c];const before=compile();deserialize(serialize());const after=compile();
 assert.deepEqual(state.objects.map(o=>o.type),['running','satin','fill']);
 assert.equal(state.objects[0].groupId,state.objects[1].groupId);assert.equal(state.objects[2].contours.length,2);
 assert.deepEqual(after.plan,before.plan);assert.equal(state.fabric,'knit');assert.equal(state.name,'Test');
});
test('Malformed Open preserves the complete current document',()=>{
 const old=serialize();
 for(const data of [null,{}, {objects:[{type:'running',points:[{x:null,y:5}]}]}, {objects:[{type:'fill',params:{spacing:-1}}]}, {version:50,objects:[]}, {objects:[],guides:[{axis:'q',pos:1}]}]) {
   assert.throws(()=>deserialize(data));assert.equal(serialize(),old);
 }
});
test('An empty saved document stays empty',()=>{state.objects=[];deserialize(serialize());assert.equal(state.objects.length,0);});
test('Both exporters block oversized files without an export-anyway escape',()=>{
 state.objects=[makeObject('running',[{x:0,y:10},{x:100.1,y:10}])];let c=compile();
 assert.equal(analyzeQuality(c).valid,false);assert.throws(()=>exportPES(c),/100/);assert.throws(()=>exportDST(c),/100/);
 state.objects=[makeObject('running',[{x:-20,y:10},{x:80,y:10}])];c=compile();assert.equal(analyzeQuality(c).valid,true);assert.ok(exportPES(c).length>512);
});
test('Invalid coordinates, 100001 stitches and 257 blocks block exports',()=>{
 state.objects=[makeObject('running',[{x:20,y:20},{x:30,y:20}])];const c=compile();
 assert.throws(()=>exportPES({...c,plan:[{cmd:'stitch',x:NaN,y:0,color:0}]}),/Invalid/);
 assert.throws(()=>exportPES({...c,plan:Array.from({length:100001},()=>({cmd:'stitch',x:20,y:20,color:0}))}),/100,000/);
 assert.throws(()=>exportPES({...c,colors:Array(257).fill(c.colors[0])}),/256/);
});
test('Order optimization preserves every overlapping pair',()=>{
 const objects=['#ff0000','#0000ff','#ff0000','#0000ff'].map((color,i)=>({id:i,color,visible:true}));
 const boxes=[{minX:0,minY:0,maxX:20,maxY:20},{minX:10,minY:10,maxX:30,maxY:30},{minX:40,minY:40,maxX:50,maxY:50},{minX:80,minY:80,maxX:90,maxY:90}];
 const result=optimizeObjects(objects,o=>boxes[o.id]);assert.ok(result.indexOf(objects[0])<result.indexOf(objects[1]));assert.equal(new Set(result).size,4);
});
test('Bean stitch reinforces each segment before advancing',()=>{
 const p=generateRunning([{x:0,y:0},{x:6,y:0}],{stitchLength:2,repeats:3});
 assert.deepEqual(p.slice(0,7).map(p=>p.x),[0,2,0,2,4,2,4]);
});
test('Timing uses embroidery speed and normalizes minute rounding',()=>{
 const c={bounds:{w:10,h:10},plan:Array.from({length:400},()=>({cmd:'stitch'}))};
 assert.ok(computeStats(c).seconds>=60);assert.equal(formatTime(119.8),'2m 00s');
});
test('Sew sheet escapes text and includes spool order and transfer information',()=>{
 state.objects=[makeObject('running',[{x:20,y:20},{x:30,y:20}])];const html=buildSewSheet(compile(),'<script>alert(1)</script>','knit');
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('Spool order'));assert.ok(html.includes('USB'));assert.ok(html.includes('cut-away'));assert.ok(!html.includes('undefined'));
 assert.equal(fileStem('My floral / patch'),'My_floral_patch');
});
test('Keeping a raster background is a real tracing option',()=>{
 const width=32,height=32,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=10;y<22;y++)for(let x=10;x<22;x++){const i=(y*width+x)*4;data[i]=220;data[i+1]=20;data[i+2]=30;}
 const normal=traceRaster({width,height,data},{w:100,h:100});const kept=traceRaster({width,height,data},{w:100,h:100},{removeBackground:false});
 assert.ok(kept.items.length>normal.items.length);
});

test('A new color travels to its own object before any needle penetration',()=>{
 state.objects=[makeObject('running',[{x:10,y:10},{x:20,y:10}],'#ff0000'),makeObject('running',[{x:80,y:80},{x:90,y:80}],'#0000ff')];
 const c=compile(),i=c.plan.findIndex(s=>s.cmd==='color');
 assert.equal(c.plan[i+1].cmd,'jump');assert.equal(c.plan[i+1].x,80);
 assert.ok(c.plan.filter(s=>s.color===1&&s.cmd==='stitch').every(s=>s.x>=80&&s.y===80));
});
