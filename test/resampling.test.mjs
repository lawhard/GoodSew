import test from 'node:test';import assert from 'node:assert/strict';
import {resample} from '../js/geometry.js';import {satinLettering} from '../js/satin-font.js';import {generateRailColumn} from '../js/satin.js';
test('finely segmented paths retain samples at the requested arc distance',()=>{
 const points=Array.from({length:101},(_,i)=>({x:i*.1,y:0}));
 const out=resample(points,2);assert.deepEqual(out.map(p=>Number(p.x.toFixed(6))),[0,2,4,6,8,10]);
});
test('curved underlay does not collapse into an endpoint chord',()=>{
 const circle=Array.from({length:361},(_,i)=>({x:10*Math.cos(i*Math.PI/180),y:10*Math.sin(i*Math.PI/180)}));
 const out=resample(circle,2);assert.ok(out.length>30);
 for(let i=1;i<out.length;i++)assert.ok(Math.hypot(out[i].x-out[i-1].x,out[i].y-out[i-1].y)<=2.01);
 const s=satinLettering({text:'S',height:14,x:0,y:0,strokeWidth:1.6}).objects[0];
 const withUnder=generateRailColumn(s)[0];s.params.underlay=false;const top=generateRailColumn(s)[0];
 const under=withUnder.slice(0,withUnder.length-top.length);assert.ok(under.length>25);
 for(let i=1;i<under.length;i++)assert.ok(Math.hypot(under[i].x-under[i-1].x,under[i].y-under[i-1].y)<2.01);
});
