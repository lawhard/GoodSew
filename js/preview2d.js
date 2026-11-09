// Fast top-down stitch picture for assistants and for browsers without WebGL.
// Every sewn segment is drawn as a lit thread: a dark edge, a body whose
// brightness follows its angle to the light, and a highlight along the middle
// of long throws. That is what makes satin read as satin: neighbouring areas
// with different stitch directions take the light differently.
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const css=(c,k,lift=0)=>`rgb(${c.map(v=>Math.round(Math.max(0,Math.min(255,v*k+lift)))).join(',')})`;
export function renderStitchPreview(compiled,{focus,fabric='#e4dfd1',width=1100,lightAngle=-Math.PI/3.4}={}){
 const b=compiled.bounds,f=focus||{x:b.minX-4,y:b.minY-4,w:Math.max(8,b.w+8),h:Math.max(8,b.h+8)};
 const scale=Math.min(60,width/f.w),W=Math.round(f.w*scale),H=Math.round(f.h*scale);
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const g=canvas.getContext('2d'),F=rgb(fabric);
 g.fillStyle=fabric;g.fillRect(0,0,W,H);
 // plain weave so scale and coverage gaps are visible
 const weave=Math.max(2,scale*.35);g.globalAlpha=.07;g.fillStyle=(F[0]+F[1]+F[2])/3>128?'#000':'#fff';
 for(let y=0;y<H;y+=weave*2)g.fillRect(0,y,W,weave*.5);
 for(let x=0;x<W;x+=weave*2)g.fillRect(x,0,weave*.5,H);
 g.globalAlpha=1;g.lineCap='round';
 const bodyW=Math.max(1,scale*.4),X=p=>(p.x-f.x)*scale,Y=p=>(p.y-f.y)*scale;
 let last=null,down=false;
 for(const s of compiled.plan){
  if(s.cmd==='stitch'){
   if(down&&last){
    const c=rgb(compiled.colors[s.color]?.color||'#333333'),dx=s.x-last.x,dy=s.y-last.y,len=Math.hypot(dx,dy);
    if(len>.02){
     const align=Math.abs(Math.cos(Math.atan2(dy,dx)-lightAngle)),lit=.74+.34*align*align;
     const seg=(t0,t1)=>{g.beginPath();g.moveTo(X(last)+dx*scale*t0,Y(last)+dy*scale*t0);g.lineTo(X(last)+dx*scale*t1,Y(last)+dy*scale*t1);g.stroke();};
     g.strokeStyle=css(c,.62);g.lineWidth=bodyW;seg(0,1);
     g.strokeStyle=css(c,lit,8);g.lineWidth=bodyW*.66;seg(0,1);
     if(len>1.2){g.globalAlpha=Math.min(.75,.18+len*.07+align*.25);g.strokeStyle=css(c,1.05,58);g.lineWidth=bodyW*.26;seg(.2,.8);g.globalAlpha=1;}
    }
   }
   last=s;down=true;
  }else{if(s.cmd==='jump')last=s;down=false;}
 }
 return canvas.toDataURL('image/png');
}
