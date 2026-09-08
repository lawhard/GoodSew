import test from 'node:test';
import assert from 'node:assert/strict';
import { satinRailPath, fillContours } from '../js/stitches.js';
import {segmentInContours} from '../js/geometry.js';
test('smooth satin has two crossing legs per cycle and no same-rail steps',()=>{
 const left=Array.from({length:26},(_,i)=>({x:0,y:i*.4}));
 const right=left.map(p=>({...p,x:3}));
 const pts=satinRailPath(left,right);
 assert.equal(pts.length,51);
 for(let i=1;i<pts.length;i++){
  assert.equal(Math.abs(pts[i].x-pts[i-1].x),3);
  assert.ok(Math.abs(pts[i].y-pts[i-1].y-.2)<1e-8);
 }
});
test('smooth lettering preserves counter geometry and finite bounds',()=>{
 const contours=[[{x:0,y:0},{x:10,y:0},{x:10,y:15},{x:0,y:15}],
 [{x:3,y:3},{x:7,y:3},{x:7,y:12},{x:3,y:12}]];
 const subs=fillContours(contours,{spacing:.4,satinZigzag:true,underlay:true,stitchType:'auto',inset:.1});
 assert.ok(subs.flat().length>100);
 for(const sub of subs)for(let i=1;i<sub.length;i++){
  assert.ok(Number.isFinite(sub[i].x)&&Number.isFinite(sub[i].y));
  assert.ok(segmentInContours(sub[i-1],sub[i],contours),'sewn segment must not cross counter');
 }
});
