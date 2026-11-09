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
// Deterministic texture helpers: the same project always sews the same path.
const frac=x=>x-Math.floor(x);
const hash=k=>frac(Math.sin(k*127.1+311.7)*43758.5453);
const noise=x=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return hash(i)*(1-u)+hash(i+1)*u;};
// Catmull-Rom subdivision. Returns per-interval samples so two rails smoothed
// with the same step counts keep matching direction nodes.
export function smoothPath(points,steps){
 const n=points.length,closed=n>3&&dist(points[0],points[n-1])<1e-7,out=[];
 const at=i=>closed?points[((i%(n-1))+(n-1))%(n-1)]:points[Math.max(0,Math.min(n-1,i))];
 for(let i=0;i<n-1;i++){
  const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2),m=typeof steps==='number'?steps:steps[i];
  for(let k=0;k<m;k++){
   const t=k/m,t2=t*t,t3=t2*t;
   out.push({x:.5*(2*p1.x+(p2.x-p0.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(3*p1.x-p0.x-3*p2.x+p3.x)*t3),
             y:.5*(2*p1.y+(p2.y-p0.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(3*p1.y-p0.y-3*p2.y+p3.y)*t3)});
  }
 }
 out.push({...points[n-1]});return out;
}
export function smoothRails(rails,target=1.5){
 const steps=[];
 for(let i=0;i<rails[0].length-1;i++)steps.push(Math.max(1,Math.min(16,Math.ceil(Math.max(dist(rails[0][i],rails[0][i+1]),dist(rails[1][i],rails[1][i+1]))/target))));
 if(steps.reduce((a,b)=>a+b,1)>2000)throw Error('Smoothed rails exceed 2,000 nodes. Use fewer or closer control nodes.');
 return rails.map(r=>smoothPath(r,steps));
}
// Rails from a centre line and a width (one number, or one width per node).
export function railsFromSpineWidths(points,width){
 const widths=Array.isArray(width)?width:points.map(()=>width);
 if(widths.length!==points.length)throw Error('Give one width, or exactly one width per spine node.');
 const left=[],right=[];
 for(let i=0;i<points.length;i++){
  const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.y-a.y)||1,n={x:-(b.y-a.y)/d,y:(b.x-a.x)/d},w=Math.max(.12,widths[i])/2;
  left.push({x:points[i].x+n.x*w,y:points[i].y+n.y*w});right.push({x:points[i].x-n.x*w,y:points[i].y-n.y*w});
 }
 return [left,right];
}
// Split one throw into staggered shorter stitches ("split satin" / long-and-short).
// The stagger is measured from rail 0 so neighbouring rows interleave instead of
// lining up into a visible seam, while every row keeps the same direction and sheen.
function splitThrow(a,b,k,maxLen,fromRail0){
 const L=dist(a,b);if(L<=maxLen)return [];
 const n=Math.ceil(L/(maxLen/1.25)),seg=L/n,shift=(frac(k*.61803398875)-.5)*.5*seg*(fromRail0?1:-1),out=[];
 for(let j=1;j<n;j++)out.push(mix(a,b,(j*seg+shift)/L));
 return out;
}
export function generateRailColumn(obj){
 const rails=obj._rails;validateRails(rails);
 const P=obj.params,pitch=Math.max(.25,Math.min(1.2,P.density||.4));
 // params.split (mm) turns on split satin: long throws are broken into staggered
 // stitches, so a wide area keeps satin direction and lustre without loose floats.
 const split=P.split?Math.max(2,Math.min(12,P.split)):0,maxThrow=split?120:10;
 const tooWide=split?'Split satin throw exceeds 120 mm.':'Satin throw exceeds 10 mm. Split the column, set params.split (for example 7) for split satin, or use fill.';
 const feather=[Math.max(0,Math.min(8,P.featherA||0)),Math.max(0,Math.min(8,P.featherB||0))];
 const stations=[];
 // Carry distance across direction nodes. Rounding each interval up independently
 // makes identical rails denser simply because their artwork has more nodes.
 const intervals=[];let total=0;
 for(let i=0;i<rails[0].length-1;i++){
  const length=Math.max(dist(rails[0][i],rails[0][i+1]),dist(rails[1][i],rails[1][i+1]));
  if(length>1e-12){intervals.push({i,start:total,length});total+=length;}
  if(dist(rails[0][i],rails[1][i])>maxThrow)throw Error(tooWide);
 }
 if(dist(rails[0].at(-1),rails[1].at(-1))>maxThrow)throw Error(tooWide);
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
 let side=0;const top=[],lastRail=[null,null],lastTrue=[null,null],credit=[1,1],shorts=[0,0];
 for(let k=0;k<stations.length;k++){
  const pair=stations[k],w=dist(...pair);
  if(w>maxThrow)throw Error(tooWide);
  const pull=Math.max(0,Math.min(.5,P.pull||0));
  let p=mix(pair[side],pair[1-side],-pull/Math.max(w,1e-6));
  if(split){
   // Fur-like edge: clumped, irregular stitch ends on a feathered rail.
   if(feather[side]){const r=.55*noise(k/7+side*31.7)+.45*hash(k*2+side);p=mix(pair[side],pair[1-side],Math.min(.45,feather[side]*r/Math.max(w,1e-6)));}
   // Where one rail is much shorter (a fan or bend), needle points would pile up
   // on it. Spend one full-width stitch per pitch of real rail travel and pull
   // the others back to staggered depths, as hand digitizers do.
   const travel=lastTrue[side]?dist(lastTrue[side],pair[side])/pitch:1;
   if(travel<.67){credit[side]+=travel*1.5;if(credit[side]>=1)credit[side]-=1;else p=mix(p,pair[1-side],.05+Math.min(.25,(1-travel)*.5)*frac(++shorts[side]*.61803398875));}
   else credit[side]=1;
  }else{
   // On an inside bend, alternate shortened stitches to spread punctures.
   if(lastRail[side]&&dist(lastRail[side],p)<(P.shortStitch||.18))p=mix(pair[side],pair[1-side],.25);
   if(top.length&&dist(top.at(-1),p)>maxThrow+.05)throw Error('Abrupt satin direction change. Add direction nodes or split the column.');
  }
  if(split&&top.length)top.push(...splitThrow(top.at(-1),p,k,split,side===1));
  top.push(p);lastRail[side]=p;lastTrue[side]=pair[side];side=1-side;
 }
 const path=[];
 if(P.underlay){
  const widths=stations.map(p=>dist(...p)),mean=widths.reduce((a,b)=>a+b,0)/widths.length;
  if(!split||mean<2.2){
   const mids=stations.map(p=>mix(...p,.5));
   // Keep support under the band instead of shortcutting through tight curves.
   const walk=sampleRunningPath(mids,2,.15);
   path.push(...walk,...walk.slice(0,-1).reverse());
  }else{
   // Wide split satin: an edge walk just inside rail 0, then an open zigzag
   // lattice back to the start. Both stay inside any feathering so nothing peeks out.
   const inset=(p,s)=>mix(p[s],p[1-s],Math.min(.4,(feather[s]*.85+.6)/Math.max(dist(...p),1e-6)));
   const edge=sampleRunningPath(stations.map(p=>inset(p,0)),2.4,.15);
   const zig=[],every=Math.max(2,Math.round(2.6/(pitch/2)));let flip=1;
   for(let k=stations.length-1;k>=0;k-=every){
    const q=inset(stations[k],flip),last=zig.at(-1)||edge.at(-1);
    zig.push(...splitThrow(last,q,k,4.5,flip===1),q);flip=1-flip;
   }
   path.push(...edge,...zig);
   // walk to the first top stitch in short steps, never one long float
   path.push(...splitThrow(path.at(-1),top[0],0,4.5,true));
  }
 }
 path.push(...top);
 return [path];
}
