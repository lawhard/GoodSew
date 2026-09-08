import {dist,lerp,resample} from './geometry.js';

// Bound deviation from the drawn path as well as stitch length. Work in final
// millimeters. This is opt-in so older saved projects retain their needle path.
export function sampleRunningPath(points,stitchLength,tolerance=0){
 if(!tolerance||points.length<3)return resample(points,stitchLength);
 const tol=Math.max(.05,Math.min(.5,tolerance)),arc=[0];
 for(let i=1;i<points.length;i++)arc.push(arc[i-1]+dist(points[i-1],points[i]));
 const total=arc.at(-1);if(total<1e-10)return [points[0]];
 const count=Math.ceil(total/stitchLength);if(count>100000)throw Error('Running line is too long.');
 const out=[points[0]];let index=1;
 const simplify=ps=>{
  const keep=new Set([0,ps.length-1]),stack=[[0,ps.length-1]];
  while(stack.length){
   const [a,b]=stack.pop(),A=ps[a],B=ps[b],dx=B.x-A.x,dy=B.y-A.y,l2=dx*dx+dy*dy;
   let worst=tol,split=-1;
   for(let i=a+1;i<b;i++){
    const t=l2?Math.max(0,Math.min(1,((ps[i].x-A.x)*dx+(ps[i].y-A.y)*dy)/l2)):0;
    const d=dist(ps[i],lerp(A,B,t));if(d>worst){worst=d;split=i;}
   }
   if(split>=0){keep.add(split);stack.push([a,split],[split,b]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>ps[i]);
 };
 for(let k=1;k<=count;k++){
  const end=total*k/count,window=[out.at(-1)];
  while(index<points.length&&arc[index]<end-1e-9){window.push(points[index]);index++;}
  const j=Math.min(index,points.length-1),span=arc[j]-arc[j-1];
  window.push(lerp(points[j-1],points[j],span?Math.max(0,Math.min(1,(end-arc[j-1])/span)):1));
  out.push(...simplify(window).slice(1));
 }
 return out;
}
