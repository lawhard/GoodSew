// Pure, testable geometry preparation. Units stay in millimeters throughout.
export const VIEWER_DEFAULTS={diameter:0.24,loft:0.55,finish:'polyester',fabric:'#e4dfd1',weave:0.55,lightAngle:315,lightHeight:50,exposure:1.05,quality:'balanced',showJumps:false,showHoop:true,showHoles:false,layering:true};
export function prepareThreadSegments(compiled) {
  const segments=[],jumps=[],penetrations=[];let cursor=compiled.initialPosition||null,connected=!!cursor,stitchIndex=0;
  for(let i=0;i<compiled.plan.length;i++) {
    const s=compiled.plan[i];
    if(!Number.isFinite(s.x)||!Number.isFinite(s.y))throw new Error('Invalid stitch coordinates.');
    if(s.cmd==='stitch') {
      stitchIndex++;penetrations.push({...s,stitchIndex,planIndex:i});
      if(connected&&cursor) {
        const length=Math.hypot(s.x-cursor.x,s.y-cursor.y);
        if(length>0.001)segments.push({a:{x:cursor.x,y:cursor.y},b:{x:s.x,y:s.y},length,color:s.color,stitchIndex,planIndex:i,layer:0});
      }
      cursor=s;connected=true;
    } else if(s.cmd==='jump') {
      if(cursor)jumps.push({a:cursor,b:s,stitchIndex:stitchIndex+1,planIndex:i});
      cursor=s;connected=true; // next sewn movement starts at this destination
    } else {connected=false;}
  }
  return {segments,jumps,penetrations,totalStitches:stitchIndex};
}
// Estimate crossing order using real segment intersections. Shared penetration
// endpoints do not stack. This is geometric layering, not a fabric/tension solver.
export function estimateLayers(segments,diameter) {
  const cell=2,grid=new Map();
  const keys=s=>{
    const keys=new Set(),steps=Math.min(500,Math.max(1,Math.ceil(s.length/cell*2)));
    for(let k=0;k<=steps;k++){const t=k/steps;keys.add(`${Math.floor((s.a.x+(s.b.x-s.a.x)*t)/cell)},${Math.floor((s.a.y+(s.b.y-s.a.y)*t)/cell)}`);}
    return keys;
  };
  for(let i=0;i<segments.length;i++) {
    const s=segments[i],buckets=keys(s),candidates=new Set();
    for(const key of buckets)for(const j of grid.get(key)||[])candidates.add(j);
    let top=0;
    for(const j of candidates) {
      const q=segments[j];
      if(Math.hypot(s.a.x-q.b.x,s.a.y-q.b.y)<diameter||Math.hypot(s.b.x-q.a.x,s.b.y-q.a.y)<diameter)continue;
      const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,ex=q.b.x-q.a.x,ey=q.b.y-q.a.y;
      const den=dx*ey-dy*ex;if(Math.abs(den)<1e-7)continue;
      const rx=q.a.x-s.a.x,ry=q.a.y-s.a.y,t=(rx*ey-ry*ex)/den,u=(rx*dy-ry*dx)/den;
      if(t>0.02&&t<0.98&&u>0.02&&u<0.98)top=Math.max(top,q.layer+diameter*0.55);
    }
    s.layer=Math.min(1.5,top);
    for(const key of buckets){const a=grid.get(key)||[];a.push(i);if(a.length>48)a.shift();grid.set(key,a);}
  }
}
// One open thread tube spanning exactly x=0..1. Ends dip into the cloth;
// the middle sits above it. An instance scales length and diameter separately.
export function threadTubeData(longitudinal=6,radial=8,loft=.55) {
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=longitudinal;i++) {
    const t=i/longitudinal,arch=Math.sin(Math.PI*t),radius=.5*(.55+.45*arch),z=-.36+arch*(.5+loft*.55);
    for(let j=0;j<=radial;j++) {
      const a=j/radial*Math.PI*2;positions.push(t,Math.cos(a)*radius,z+Math.sin(a)*radius*.7);uvs.push(t,j/radial);
    }
  }
  for(let i=0;i<longitudinal;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;indices.push(a,b,a+1,b,b+1,a+1);}
  return {positions,uvs,indices};
}
export function visibleSegmentCount(segments,stitches) {
  let lo=0,hi=segments.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(segments[mid].stitchIndex<=stitches)lo=mid+1;else hi=mid;}
  return lo;
}
