import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {parsePES} from '../js/import/pes.js';import {state,makeObject} from '../js/state.js';import {compile} from '../js/compiler.js';import {exportPES} from '../js/export/pes.js';
import {prepareThreadSegments,threadTubeData,estimateLayers,visibleSegmentCount} from '../js/thread-model.js';
const fixture=v=>readFileSync(new URL(`fixtures/independent-v${v}.pes`,import.meta.url));
test('Independent PES v1/v6 decode exact needle moves and thread metadata',()=>{
 for(const v of [1,6]){const p=parsePES(fixture(v));assert.equal(p.metadata.stitches,13);assert.equal(p.colors.length,3);assert.equal(p.bounds.w,50);assert.equal(p.bounds.h,40);assert.equal(p.plan.at(-1).cmd,'end');
  assert.deepEqual(p.plan.filter(s=>s.cmd==='stitch').slice(0,5).map(s=>[s.x,s.y]),[[25,30],[35,40],[45,30],[55,40],[65,30]]);
 }
 const p=parsePES(fixture(6));assert.deepEqual(p.colors.map(c=>c.color),['#183a62','#b95731','#358675']);assert.equal(p.colors[0].name,'Ocean navy');assert.equal(p.colors[0].brand,'Reference threads');
});
test('Good Sew export/read preserves every stitch within format precision',()=>{
 state.objects=[makeObject('running',[{x:10,y:10},{x:30,y:30},{x:20,y:40}],'#ff0000'),makeObject('satin',[{x:40,y:20},{x:80,y:20}],'#008777')];
 const c=compile(),p=parsePES(exportPES(c));const actual=p.plan.filter(s=>s.cmd==='stitch'),expected=c.plan.filter(s=>s.cmd==='stitch');assert.equal(actual.length,expected.length);
 const a=actual[0],b=expected[0];for(let i=0;i<actual.length;i++){assert.ok(Math.abs((actual[i].x-a.x)-(expected[i].x-b.x))<=.101);assert.ok(Math.abs((actual[i].y-a.y)-(expected[i].y-b.y))<=.101);}
});
test('Standalone PEC loads from the same stitch block',()=>{
 const data=fixture(1),pointer=data.readUInt32LE(8);const raw=Buffer.concat([Buffer.from('#PEC0001'),data.subarray(pointer)]);assert.equal(parsePES(raw).metadata.stitches,13);
});
test('Corrupt offsets, truncated blocks and missing END are rejected',()=>{
 assert.throws(()=>parsePES(Buffer.from('not embroidery')),/valid/);
 const bad=Buffer.from(fixture(1));bad.writeUInt32LE(0xffffffff,8);assert.throws(()=>parsePES(bad),/invalid/);
 const truncated=fixture(1).subarray(0,100);assert.throws(()=>parsePES(truncated));
 const noEnd=Buffer.from(fixture(1)),block=noEnd.readUInt32LE(8)+512,len=noEnd.readUIntLE(block+2,3);noEnd[block+len-1]=0;assert.throws(()=>parsePES(noEnd),/end|middle/);
});
test('Thread model draws actual sewn moves, never jump/color bridges',()=>{
 const p={plan:[{cmd:'jump',x:0,y:0,color:0},{cmd:'stitch',x:2,y:0,color:0},{cmd:'color',x:2,y:0,color:1},{cmd:'jump',x:80,y:80,color:1},{cmd:'stitch',x:80,y:80,color:1},{cmd:'stitch',x:85,y:80,color:1}]};
 const m=prepareThreadSegments(p);assert.equal(m.totalStitches,3);assert.deepEqual(m.segments.map(s=>s.length),[2,5]);assert.equal(m.jumps.length,1);assert.equal(visibleSegmentCount(m.segments,2),1);assert.equal(visibleSegmentCount(m.segments,3),2);
});
test('Thread tubes end at needle coordinates and respond to loft',()=>{
 const a=threadTubeData(6,8,0),b=threadTubeData(6,8,1);const xs=a.positions.filter((_,i)=>i%3===0);assert.equal(Math.min(...xs),0);assert.equal(Math.max(...xs),1);assert.ok(a.positions.every(Number.isFinite));assert.ok(Math.max(...b.positions.filter((_,i)=>i%3===2))>Math.max(...a.positions.filter((_,i)=>i%3===2)));
});
test('Later crossing threads sit above earlier ones; shared endpoints do not accumulate height',()=>{
 const seg=(a,b)=>({a,b,length:Math.hypot(b.x-a.x,b.y-a.y),layer:0});
 const s=[seg({x:0,y:0},{x:10,y:10}),seg({x:0,y:10},{x:10,y:0}),seg({x:10,y:0},{x:15,y:0})];estimateLayers(s,.24);assert.equal(s[0].layer,0);assert.ok(s[1].layer>0);assert.equal(s[2].layer,0);
});
