// Original geometric stroke alphabet. Curved spines give satin a continuous
// stitch direction. This is designed lettering, not outline-font conversion.
import {railsFromSpine,railObject} from './satin.js';
const line=(...pts)=>pts.map(([x,y])=>({x,y}));
const arc=(cx,cy,rx,ry,a=0,b=360)=>Array.from({length:Math.max(12,Math.ceil(Math.abs(b-a)/8))+1},(_,i)=>{const t=(a+(b-a)*i/Math.max(12,Math.ceil(Math.abs(b-a)/8)))*Math.PI/180;return{x:cx+rx*Math.cos(t),y:cy+ry*Math.sin(t)};});
const join=(...paths)=>paths.flatMap((p,i)=>i?p.slice(1):p);
const oval=()=>arc(3,5,2.4,4.3,-90,270);
const C=()=>arc(3,5,2.4,4.3,35,325);
const glyphs={
 A:[line([.5,9.3],[3,.7],[5.5,9.3]),line([1.4,6.3],[4.6,6.3])], B:[line([.7,9.3],[.7,.7]),join(arc(2.5,2.8,2.2,2.1,-90,90),arc(2.5,7,2.2,2.3,-90,90))],
 C:[C()],D:[line([.7,9.3],[.7,.7]),join(line([.7,.7],[2.3,.7]),arc(2.3,5,3,4.3,-90,90),line([2.3,9.3],[.7,9.3]))],
 E:[line([5.3,.7],[.7,.7],[.7,9.3],[5.3,9.3]),line([.7,5],[4.6,5])], F:[line([.7,9.3],[.7,.7],[5.3,.7]),line([.7,5],[4.6,5])],
 G:[join(arc(3,5,2.4,4.3,35,325).reverse(),line([4.966,7.466],[5,5.3],[3.2,5.3]))],
 H:[line([.7,.7],[.7,9.3]),line([5.3,.7],[5.3,9.3]),line([.7,5],[5.3,5])], I:[line([3,.7],[3,9.3])],
 J:[join(line([5.2,.7],[5.2,7]),arc(3,7,2.2,2.3,0,180))],K:[line([.7,.7],[.7,9.3]),line([5.3,.7],[.7,5],[5.3,9.3])],
 L:[line([.7,.7],[.7,9.3],[5.3,9.3])], M:[line([.7,9.3],[.7,.7],[3,5.3],[5.3,.7],[5.3,9.3])],N:[line([.7,9.3],[.7,.7],[5.3,9.3],[5.3,.7])],O:[oval()],
 P:[line([.7,9.3],[.7,.7]),join(line([.7,.7],[2.8,.7]),arc(2.8,2.9,2.5,2.2,-90,90),line([2.8,5.1],[.7,5.1]))],
 Q:[oval(),line([3.6,7.7],[5.9,10])],R:[line([.7,9.3],[.7,.7]),join(line([.7,.7],[2.8,.7]),arc(2.8,2.9,2.5,2.2,-90,90),line([2.8,5.1],[.7,5.1])),line([2.8,5.1],[5.4,9.3])],
 S:[join(arc(3,2.8,2.4,2.1,-35,-270),arc(3,7,2.4,2.1,-90,145))], T:[line([.5,.7],[5.5,.7]),line([3,.7],[3,9.3])],U:[join(line([.7,.7],[.7,7]),arc(3,7,2.3,2.3,180,0),line([5.3,7],[5.3,.7]))],
 V:[line([.5,.7],[3,9.3],[5.5,.7])],W:[line([.4,.7],[1.5,9.3],[3,5.4],[4.5,9.3],[5.6,.7])],X:[line([.5,.7],[5.5,9.3]),line([5.5,.7],[.5,9.3])],Y:[line([.5,.7],[3,5],[5.5,.7]),line([3,5],[3,9.3])],Z:[line([.5,.7],[5.5,.7],[.5,9.3],[5.5,9.3])],
 o:[arc(3,6.5,2.2,2.8,-90,270)],c:[arc(3,6.5,2.2,2.8,35,325)],d:[arc(3,6.5,2.2,2.8,-90,270),line([5.2,.2],[5.2,9.3])],
 e:[join(line([.8,6.2],[5.2,6.2]),arc(3,6.5,2.2,2.8,-6,-325))],
 s:[join(arc(3,5,2.1,1.4,-30,-270),arc(3,7.9,2.1,1.5,-90,145))],
 w:[line([.3,3.7],[1.5,9.3],[3,6],[4.5,9.3],[5.7,3.7])],
 l:[line([2.5,.2],[2.5,9.3])],i:[line([3,4],[3,9.3]),line([3,1.4],[3,1.9])],
 n:[line([.8,9.3],[.8,3.7]),join(arc(3,5.7,2.2,2,180,360),line([5.2,5.7],[5.2,9.3]))],
 u:[join(line([.8,3.7],[.8,7.2]),arc(3,7.2,2.2,2.1,180,0)),line([5.2,3.7],[5.2,9.3])],
 '-':[line([1,5],[5,5])],'.':[line([3,9],[3,9.3])],
 '0':[oval()],'1':[line([1.5,2.2],[3,.7],[3,9.3])],'2':[arc(3,2.8,2.4,2.1,180,360),line([5.4,2.8],[.6,9.3],[5.4,9.3])],
 '3':[join(arc(3,2.8,2.3,2.1,-140,90),arc(3,7,2.3,2.2,-90,140))],'4':[line([4.7,9.3],[4.7,.7],[.5,6.7],[5.5,6.7])],
 '5':[join(line([5.2,.7],[1,.7],[1,4.8],[3,4.8]),arc(3,7,2.3,2.3,-90,140))],'6':[join(arc(3,5,2.4,4.3,270,90),arc(3,7,2.4,2.3,90,450))],
 '7':[line([.6,.7],[5.4,.7],[2,9.3])],'8':[arc(3,2.8,2.2,2.1,-90,270),arc(3,7,2.4,2.3,-90,270)],'9':[arc(3,3,2.4,2.3,0,360),arc(3,5,2.4,4.3,0,100)]
};
// Other lowercase characters deliberately use scaled capitals; expose supported
// exact-case repertoire so automation can make a typography choice knowingly.
// Split sharp joins into separately sewn columns. Interpolating a single pair
// of rails through a V or a returning crossbar can invert the ribbon.
function splitCorners(path){
 const pieces=[];let current=[path[0]];
 for(let i=1;i<path.length-1;i++){
  current.push(path[i]);const a=path[i-1],b=path[i],c=path[i+1];
  const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
  const cosine=(ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)||1);
  if(cosine<.5){pieces.push(current);current=[b];}
 }
 current.push(path.at(-1));pieces.push(current);return pieces;
}
export const SATIN_REPERTOIRE=Object.keys(glyphs).join('');
export function satinLettering({text='GoodSew',height=12,x=10,y=60,strokeWidth=1.5,letterSpacing=1,color='#0e1f7c',id=()=>undefined,groupId='satin-lettering'}={}){
 if(typeof text!=='string'||!text.trim()||text.length>80)throw Error('Satin lettering requires 1–80 characters.');
 if(!Number.isFinite(height)||height<6||height>40)throw Error('Use a satin lettering height from 6 to 40 mm.');
 if(!Number.isFinite(strokeWidth)||strokeWidth<.8||strokeWidth>height*.2)throw Error('Stroke width must be 0.8 mm to 20% of lettering height.');
 if(![x,y,letterSpacing].every(Number.isFinite)||letterSpacing<0||letterSpacing>20)throw Error('Invalid lettering placement or spacing.');
 const scale=height/10,objects=[],substitutions=[];let cursor=x;
 for(const ch of text){
  if(ch===' '){cursor+=height*.4;continue;}
  const paths=glyphs[ch]||glyphs[ch.toUpperCase()];
  if(!paths)throw Error('Satin Round does not support '+ch);
  if(!glyphs[ch])substitutions.push(ch);
  paths.flatMap(splitCorners).forEach((path,i)=>objects.push(railObject(railsFromSpine(path.map(p=>({x:cursor+p.x*scale,y:y+p.y*scale})),strokeWidth),{id:id(),name:`${ch} · satin ${i+1}`,color,groupId})));
  cursor+=height*.6+letterSpacing;
 }
 return {objects,width:cursor-x-letterSpacing,substitutions:[...new Set(substitutions)]};
}
