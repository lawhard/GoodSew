import test from 'node:test';import assert from 'node:assert/strict';
import {railObject,bakeRails,generateRailColumn} from '../js/satin.js';
import {satinLettering,SATIN_REPERTOIRE} from '../js/satin-font.js';
import {createDesignController,prepareEdits} from '../js/design-commands.js';
import {state,serialize,deserialize} from '../js/state.js';
import {compile} from '../js/compiler.js';
import {exportPES} from '../js/export/pes.js';import {parsePES} from '../js/import/pes.js';
const rails=[[{x:10,y:10},{x:10,y:30}],[{x:13,y:10},{x:13,y:30}]];
test('paired satin preserves widths and uses alternating rail stitches',()=>{
 const o=railObject(rails,{params:{underlay:false}}),p=generateRailColumn(o)[0];assert.ok(p.length>90);
 for(let i=1;i<p.length;i++){assert.ok(Math.abs(p[i].x-p[i-1].x)>2.9);assert.ok(p[i].y>=p[i-1].y);}
});
test('curved o stitches follow the ring without sewing across its counter',()=>{
 const o=satinLettering({text:'o',height:10,x:0,y:0,strokeWidth:1}).objects[0],p=generateRailColumn(o)[0];
 for(let i=1;i<p.length;i++)for(let k=0;k<=10;k++){
  const x=p[i-1].x+(p[i].x-p[i-1].x)*k/10,y=p[i-1].y+(p[i].y-p[i-1].y)*k/10;
  assert.ok(((x-3)/1.5)**2+((y-6.5)/2)**2>.95,'counter core remains empty');
 }
});
test('authored alphabet compiles finite bounded satin, and unsupported text is explicit',()=>{
 for(const ch of SATIN_REPERTOIRE)for(const o of satinLettering({text:ch}).objects){const p=generateRailColumn(o)[0];assert.ok(p.length>3);for(const pt of p)assert.ok(Number.isFinite(pt.x)&&Number.isFinite(pt.y));}
 assert.throws(()=>satinLettering({text:'🧵'}),/does not support/);
});
test('satin rails survive save/open, transforms, and PES needle round trip',()=>{
 state.objects=satinLettering({text:'GoodSew',height:10,x:10,y:50,id:(()=>{let i=0;return()=>++i;})()}).objects;
 const original=serialize();deserialize(original);state.objects.forEach(bakeRails);const a=compile();
 const decoded=parsePES(exportPES(a)),ps=a.plan.filter(s=>s.cmd==='stitch'),qs=decoded.plan.filter(s=>s.cmd==='stitch');assert.equal(ps.length,qs.length);
 const dx=ps[0].x-qs[0].x,dy=ps[0].y-qs[0].y;ps.forEach((s,i)=>assert.ok(Math.max(Math.abs(s.x-qs[i].x-dx),Math.abs(s.y-qs[i].y-dy))<=.101));
 const o=state.objects[0],old=o.points[0].x;o.box.x+=3;bakeRails(o);assert.ok(Math.abs(o.points[0].x-old-3)<1e-7);
});
test('commands are atomic, revision checked, idempotent, and undoable',async()=>{
 let objects=[railObject(rails,{id:1})],history=[],n=10;const hooks={fingerprint:()=>JSON.stringify(objects),objects:()=>objects,nextId:()=>++n,read:()=>({objects}),prepare:async os=>os.forEach(generateRailColumn),apply:os=>{history.push(objects);objects=os;},undo:()=>{objects=history.pop()||objects;}};
 const run=createDesignController(hooks),before=await run('get_design');
 const args={expectedRevision:before.revision,requestId:'a',operations:[{op:'update',id:1,color:'#123456'}]};
 const result=await run('apply_edit',args);assert.equal(objects[0].color,'#123456');assert.deepEqual(await run('apply_edit',args),result);assert.equal(history.length,1);
 await assert.rejects(run('apply_edit',{...args,requestId:'b'}),/Revision conflict/);
 await assert.rejects(run('apply_edit',{...args,expectedRevision:result.revision,requestId:'c',operations:[{op:'remove',id:1},{op:'remove',id:999}]}),/not found/);assert.equal(objects.length,1);
 await run('undo_edit',{expectedRevision:result.revision,requestId:'d'});assert.equal(objects[0].color,'#0e1f7c');
});
test('invalid rails and overlong throws fail before edits apply',()=>{
 assert.throws(()=>railObject([rails[0],[rails[1][0]]]),/matching/);
 const wide=railObject([rails[0],rails[1].map(p=>({...p,x:25}))]);assert.throws(()=>generateRailColumn(wide),/10 mm/);
 assert.throws(()=>prepareEdits([railObject(rails,{id:1})],[{op:'reorder',ids:[1,1]}],()=>2),/every object/);
});
test('connector can add ordinary shapes, text and running lines with validation',()=>{
 let id=0;const result=prepareEdits([],[{op:'add_shape',kind:'heart',box:{x:10,y:10,w:20,h:20}},{op:'add_text',text:'Hello',font:'Anton',x:10,y:50,height:12},{op:'add_running',points:[{x:10,y:10},{x:20,y:20}]}],()=>++id);
 assert.deepEqual(result.objects.map(o=>o.type),['fill','text','running']);assert.equal(result.objects[1].params.text,'Hello');
 assert.throws(()=>prepareEdits([],[{op:'add_shape',kind:'unknown',box:{x:10,y:10,w:20,h:20}}],()=>1),/supported shape/);
});
test('closed lettering rail seams meet exactly and candidate compilation is isolated',()=>{
 const objects=satinLettering({text:'o',height:10}).objects,o=objects[0];
 for(const rail of o._rails)assert.ok(Math.hypot(rail[0].x-rail.at(-1).x,rail[0].y-rail.at(-1).y)<1e-8);
 const current=state.objects;const compiled=compile(objects);assert.ok(compiled.plan.length>100);assert.equal(state.objects,current);
});
