import {dist} from './geometry.js';
import {sampleRunningPath} from './running.js';

// Design advice, not a physical simulation or an export gate. A local needle
// count alone cannot distinguish a good satin band from a poorly retraced line.
export function reviewDigitizing(objects){
 const warnings=[],lines=[];
 for(const o of objects){
  if(o.visible===false)continue;
  const add=(code,msg)=>warnings.push({sev:'warn',code,objectId:o.id,objectName:o.name,msg:`${o.name||'Unnamed object'}: ${msg}`});
  if(o.type==='running'&&o.points?.length>1){
   const p=o.params||{},path=sampleRunningPath(o.points,Math.max(.5,p.stitchLength||2.5),p.curveTolerance||0);
   const lengths=path.slice(1).map((q,i)=>dist(path[i],q)).filter(d=>d>.05).sort((a,b)=>a-b);
   const median=lengths.length?lengths[Math.floor(lengths.length/2)]:0;
   const short=lengths.filter(d=>d<.8).length;
   lines.push({objectId:o.id,name:o.name,medianBaseStitchMM:median,baseStitches:lengths.length,underPoint8MM:short,style:p.returnPass?'double run':p.repeats>=3?'bean':'single run'});
   if(!p.returnPass&&p.repeats>=3&&lengths.length>=8&&(median<1.5||short/lengths.length>.2))add('short-bean','short, repeatedly retraced stitches can look beaded on textured fabric. Simplify tiny fur turns; consider a double run or a smooth satin band. Increasing passes can make this worse.');
   if(lengths.length>=8&&short/lengths.length>.3)add('fine-turns','many line segments are below 0.8 mm. Inspect at actual sewing size; simplify detail instead of only shortening stitches.');
  }
  if(o.kind==='satin-rails'&&o._rails){
   const widths=o._rails[0].map((p,i)=>dist(p,o._rails[1][i]));
   if(widths.filter(w=>w<.8).length>widths.length*.2)add('narrow-satin','much of this satin is below 0.8 mm wide. Fine thread or a running line may resolve it better; test the actual material.');
  }
 }
 return {basis:'Geometric screening; not a prediction of tension, puckering or fabric coverage.',warnings,lines};
}
