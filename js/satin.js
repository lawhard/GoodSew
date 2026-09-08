// Authored paired rails. Matching node pairs are direction guides, in mm.
import {dist,rotatePoint} from './geometry.js';
import {sampleRunningPath} from './running.js';
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export function validateRails(rails,minWidth=.05){
 if(!Array.isArray(rails)||rails.length!==2||rails[0].length<2||rails[0].length!==rails[1].length||rails[0].length>2000)throw Error('Use two rails with 2–2,000 matching direction nodes.');
 for(const rail of rails)for(const p of rail)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>10000||Math.abs(p.y)>10000)throw Error('Invalid satin rail coordinate.');
 for(let i=0;i<rails[0].length;i++)if(dist(rails[0][i],rails[1][i])<minWidth)throw Error('Satin rails must stay apart.');
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10;
 for(let i=0;i<rails[0].length-1;i++){
  const [a,b,c,d]=[rails[0][i],rails[0][i+1],rails[1][i],rails[1][i+1]];
  if(intersects(a,c,b,d)||intersects(a,b,c,d))throw Error('Satin rails cross between direction nodes. Reverse one rail or split the column.');
 }

}
export function railsFromSpine(points,width){
 const left=[],right=[];
 const closed=points.length>3&&dist(points[0],points.at(-1))<1e-7;
 for(let i=0;i<points.length;i++){
  const a=points[closed&&(i===0||i===points.length-1)?points.length-2:Math.max(0,i-1)],b=points[closed&&(i===0||i===points.length-1)?1:Math.min(points.length-1,i+1)];
  const d=Math.hypot(b.x-a.x,b.y-a.y)||1,n={x:-(b.y-a.y)/d,y:(b.x-a.x)/d};
  left.push({x:points[i].x+n.x*width/2,y:points[i].y+n.y*width/2});
  right.push({x:points[i].x-n.x*width/2,y:points[i].y-n.y*width/2});
 }
 return [left,right];
}
export function bakeRails(obj){
 if(obj.kind!=='satin-rails')return;
 const b=obj.box,c={x:b.x+b.w/2,y:b.y+b.h/2},angle=(obj.rotation||0)*Math.PI/180;
 obj._rails=obj._base.map(r=>r.map(p=>rotatePoint({x:b.x+p.x*b.w,y:b.y+p.y*b.h},c,angle)));
 obj.points=obj._rails[0].map((p,i)=>mix(p,obj._rails[1][i],.5));
 obj.contours=[[...obj._rails[0],...obj._rails[1].slice().reverse()]];
}
export function railObject(rails,{id,name='Satin column',color='#0e1f7c',params={},groupId}={}){
 validateRails(rails);
 const all=rails.flat(),xs=all.map(p=>p.x),ys=all.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
 const box={x,y,w:Math.max(.01,Math.max(...xs)-x),h:Math.max(.01,Math.max(...ys)-y)};
 const obj={id,type:'satin',kind:'satin-rails',name,color,visible:true,rotation:0,box,groupId,
 _base:rails.map(r=>r.map(p=>({x:(p.x-x)/box.w,y:(p.y-y)/box.h}))),
 params:{density:.4,pull:0,underlay:true,shortStitch:.18,...params}};
 bakeRails(obj);return obj;
}
export function generateRailColumn(obj){
 const rails=obj._rails;validateRails(rails);
 const pitch=Math.max(.25,Math.min(1.2,obj.params.density||.4));
 const maxThrow=10;
 const stations=[];
 // Carry distance across direction nodes. Rounding each interval up independently
 // makes identical rails denser simply because their artwork has more nodes.
 const intervals=[];let total=0;
 for(let i=0;i<rails[0].length-1;i++){
  const length=Math.max(dist(rails[0][i],rails[0][i+1]),dist(rails[1][i],rails[1][i+1]));
  if(length>1e-12){intervals.push({i,start:total,length});total+=length;}
  if(dist(rails[0][i],rails[1][i])>maxThrow)throw Error('Satin throw exceeds 10 mm. Split the column or use fill.');
 }
 if(dist(rails[0].at(-1),rails[1].at(-1))>maxThrow)throw Error('Satin throw exceeds 10 mm. Split the column or use fill.');
 if(!intervals.length)throw Error('Satin rails need a nonzero length.');
 // Evenly distribute the final residual instead of adding a tiny terminal row.
 const steps=Math.max(1,Math.ceil(total/(pitch/2)-1e-9));
 if(steps+1>100000)throw Error('Satin column is too dense or too long.');
 let interval=0;
 for(let k=0;k<=steps;k++){
  const s=total*k/steps;
  while(interval<intervals.length-1&&s>intervals[interval].start+intervals[interval].length)interval++;
  const {i,start,length}=intervals[interval],t=Math.max(0,Math.min(1,(s-start)/length));
  stations.push([mix(rails[0][i],rails[0][i+1],t),mix(rails[1][i],rails[1][i+1],t)]);
 }
 let side=0;const top=[],lastRail=[null,null];
 for(const pair of stations){
  const w=dist(...pair);
  if(w>maxThrow)throw Error('Satin throw exceeds 10 mm. Split the column or use fill.');
  const pull=Math.max(0,Math.min(.5,obj.params.pull||0));
  let p=mix(pair[side],pair[1-side],-pull/w);
  // On an inside bend, alternate shortened stitches to spread punctures.
  if(lastRail[side]&&dist(lastRail[side],p)<(obj.params.shortStitch||.18))p=mix(pair[side],pair[1-side],.25);
  if(top.length&&dist(top.at(-1),p)>maxThrow+.05)throw Error('Abrupt satin direction change. Add direction nodes or split the column.');
  top.push(p);lastRail[side]=p;side=1-side;
 }
 const path=[];
 if(obj.params.underlay){
  const mids=stations.map(p=>mix(...p,.5));
  // Keep support under the band instead of shortcutting through tight curves.
  const walk=sampleRunningPath(mids,2,.15);
  path.push(...walk,...walk.slice(0,-1).reverse());
 }
 path.push(...top);path._trimBefore=true;
 return [path];
}
