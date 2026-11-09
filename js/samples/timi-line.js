// Timi, line portrait — one black thread, every line a real satin column.
// Traced over her photo on a millimetre grid: each stroke follows an edge or a
// lock of fur that is actually there. Eyes and nose keep small unstitched
// slivers so the cloth itself becomes the shine.
const P=(...a)=>{const o=[];for(let i=0;i<a.length;i+=2)o.push({x:a[i],y:a[i+1]});return o;};
export const NAME='Timi line portrait';
export const FABRIC='#ffffff';
export const CLOSEUPS={face:{x:24,y:38,w:40,h:40}};
const INK='#0b0b0b',params={density:.4,pull:.1,underlay:true};
// A brush-like satin stroke: full width through the middle, slimmer at the ends.
const stroke=(name,pts,w=1.3,ends=[.6,.6])=>({op:'add_satin',name,color:INK,smooth:true,spine:pts,width:pts.map((_,i)=>w*(i===0?ends[0]:i===pts.length-1?ends[1]:1)),params});
const solid=(name,rails)=>({op:'add_satin',name,color:INK,rails,params:{...params,pull:0,density:.38}});
// Round eye sewn top-to-bottom, with a catchlight left as bare cloth and a thin
// satin cap closing it in from above.
function eye(name,cx,cy,r,h){
 const top=[],bot=[],n=30,half=x=>Math.sqrt(Math.max(0,r*r-(x-cx)**2));
 for(let i=0;i<=n;i++){const x=cx-r*.985+2*r*.985*i/n,inH=x>=h.x0&&x<=h.x1;top.push({x,y:inH?Math.max(cy-half(x),h.y1):cy-half(x)});bot.push({x,y:cy+half(x)});}
 const ct=[],cb=[];for(let i=0;i<=8;i++){const x=h.x0-.15+(h.x1-h.x0+.3)*i/8,t=cy-half(x);ct.push({x,y:t});cb.push({x,y:Math.max(t+.45,h.y0)});}
 return [solid(name,[top,bot]),solid(name+' lid',[ct,cb])];
}
// Half of the nose, sewn in horizontal rows from its outer edge to the centre
// line; rows inside the slit stop short, leaving a highlight.
function lobe(name,outer,cx,slit,reverse){
 const at=y=>{for(let i=1;i<outer.length;i++)if(y<=outer[i].y){const a=outer[i-1],b=outer[i],t=(y-a.y)/(b.y-a.y||1);return a.x+(b.x-a.x)*t;}return outer.at(-1).x;};
 const ys=[...new Set([...outer.map(p=>p.y),slit.y0-.04,slit.y0,slit.y1,slit.y1+.04])].sort((a,b)=>a-b);
 let r0=ys.map(y=>({x:at(y),y})),r1=ys.map(y=>({x:y>=slit.y0&&y<=slit.y1?slit.x:cx,y}));
 if(reverse){r0.reverse();r1.reverse();}
 return solid(name,[r0,r1]);
}

// Wispy coat edge: a run of shallow arcs between cusps, bowed toward the body so
// the cusps stand out as lock ends. Each arc starts exactly where the last ended.
const fur=(name,cusps,toward,bow=.9,w=1.35)=>cusps.slice(1).map((b,i)=>{const a=cusps[i],m={x:(a.x+b.x)/2,y:(a.y+b.y)/2},d=Math.hypot(toward.x-m.x,toward.y-m.y)||1,k=bow*(i%2?.7:1.2);
 return stroke(`${name} ${i+1}`,[a,{x:m.x+(toward.x-m.x)/d*k,y:m.y+(toward.y-m.y)/d*k},b],w,[.6,.6]);});

export const operations=[
 // ── silhouette, one unbroken run clockwise from the left cheek ──
 ...fur('Left ear fringe',P(20.5,56.5, 16.4,55, 12.6,51.2, 9.6,47.4, 7.9,42.5),{x:22,y:40},.9),
 stroke('Left ear edge',P(7.9,42.5, 7.8,32, 8,21, 8.6,14.4),1.4,[.6,.75]),
 stroke('Left ear top',P(8.6,14.4, 12,15.5, 16,18, 20,21, 24,25, 27.5,28.2, 32,30.5),1.4,[.75,.75]),
 stroke('Crown left',P(32,30.5, 35,29.3, 38,28.3, 41,27.4),1.3,[.75,.75]),
 stroke('Tuft 1 up',P(41,27.4, 40.3,25.2, 39.9,23.2),1,[.85,.5]),
 stroke('Tuft 1 down',P(40.3,23.5, 41.5,25.4, 43,26.8),1,[.5,.85]),
 stroke('Tuft 2 up',P(43,26.8, 44.5,23.6, 45.6,21.2),1.05,[.85,.5]),
 stroke('Tuft 2 down',P(46,21.6, 46.7,24.2, 48,26.2),1.05,[.5,.85]),
 stroke('Tuft 3 up',P(48,26.2, 49.4,24, 50.4,22.2),1,[.85,.5]),
 stroke('Tuft 3 down',P(50.6,22.7, 51,25.4, 52.8,28.2),1,[.5,.85]),
 stroke('Crown right',P(52.8,28.2, 55.5,29.6, 58.5,31.2, 61,32.4, 63,33.2),1.3,[.75,.75]),
 stroke('Right ear top',P(63,33.2, 66,31, 70,29, 75,27.2, 80,25.8, 85,25, 89,25.6, 91,27.6),1.4,[.75,.75]),
 ...fur('Right ear fringe',P(91,27.6, 90.4,34, 88,40.2, 85.6,46, 80.6,50.4, 75,54, 69.5,60.5),{x:72,y:38},1),
 ...fur('Coat edge',P(69.5,60.5, 67.6,66.4, 65.6,72, 61.6,77.6, 55,80.8, 47.6,81.6, 40,80.8, 33,78.8, 27.4,76, 23,71.6, 20.2,65.4, 20.4,57.4),{x:44,y:62},.9),
 // ── inside the ears ──
 stroke('Left ear hollow, right side',P(10.5,19.6, 16,22, 20,27, 21,33, 20,39.4, 18.5,41.5),1.15,[.6,.8]),
 stroke('Left ear hollow, left side',P(18.5,41.5, 15.5,39.6, 12,36, 10,30, 9.7,23),1.15,[.8,.6]),
 stroke('Left ear fold',P(15,25, 19,27.6, 22.5,30.4, 26,32.2),1.05,[.6,.6]),
 stroke('Right ear hollow, top',P(72.4,33, 74,31.6, 77,31, 82,31.5, 85.4,33.4, 86.2,35.6),1.15,[.6,.6]),
 stroke('Right ear hollow, bottom',P(84.2,39.2, 80,39.7, 76.4,39, 74,37.2),1.15,[.6,.6]),
 // ── the parting on her forehead ──
 stroke('Parting left',P(44.5,30.6, 39.5,31.6, 34.5,34.5, 31,38.6),1.15),
 stroke('Parting left, inner',P(44,34, 40.4,36.2, 37.8,39.8),1.05),
 stroke('Parting right',P(46.6,30.6, 52,32, 57,35, 60.6,39.6),1.15),
 stroke('Parting right, inner',P(47.6,34, 51.4,36.4, 53.6,40.4),1.05),
 // ── eyes ──
 ...eye('Left eye',33.5,46.7,3.7,{x0:33.5,x1:36.1,y0:44.6,y1:46.4}),
 stroke('Left eye, inner corner',P(36.4,49.2, 37.4,50.5, 38.6,51.2),1.1,[.9,.55]),
 ...eye('Right eye',56,49.2,3.75,{x0:54.1,x1:57,y0:47,y1:48.8}),
 stroke('Right eye, inner corner',P(53,51.6, 51.8,51.5, 50.8,50.6),1.1,[.9,.55]),
 // ── nose and mouth as one run ──
 lobe('Nose left',P(42.2,58.9, 39.5,59.25, 37.6,60.5, 36.8,62.6, 37.3,64.8, 38.6,66.8, 40.4,68.3, 42.4,68.9),43,{y0:60.2,y1:61.5,x:40.4}),
 lobe('Nose right',P(43.6,58.9, 46.3,59.25, 48.4,60.6, 49.3,62.8, 48.8,65, 47.4,67, 45.4,68.4, 43.4,68.9),42.6,{y0:60.2,y1:61.5,x:45.2},true),
 stroke('Mouth left',P(37.4,71, 39.6,72.1, 41.4,71.9, 42.8,70.8),1.15,[.6,.8]),
 stroke('Mouth right',P(42.8,70.8, 44.4,72, 46.6,72.2, 48.6,71),1.15,[.8,.6]),
 // ── moustache locks ──
 stroke('Moustache left 1',P(37.4,57.6, 32,56.6, 27,57.6, 23.6,61),1.2,[.7,.5]),
 stroke('Moustache left 2',P(36.8,61.2, 32.5,62.6, 29.6,65.6, 28.7,69.6),1.2,[.7,.5]),
 stroke('Moustache left 3',P(36.6,66.6, 34,68.6, 32.6,71.6, 32.7,74.6),1.2,[.7,.5]),
 stroke('Moustache right 1',P(48,57, 51.5,57.7, 54,59.6, 55.5,62.6),1.2,[.7,.5]),
 stroke('Moustache right 2',P(56,54.6, 56.7,58.5, 56.9,62.5, 57.5,66),1.2,[.6,.5]),
 stroke('Moustache right 3',P(60,57, 62.5,62, 63.5,67, 63,72),1.2,[.6,.5]),
 // ── cheeks ──
 stroke('Left cheek fur',P(29,51.2, 25,52.6, 21.8,56.4, 20.9,60.6),1.15,[.6,.5]),
 stroke('Right cheek fur',P(61.2,47.2, 64.5,52, 66.4,57.6, 66.9,63),1.15,[.6,.5]),
 // ── chest ──
 stroke('Chest left edge',P(25.2,76.4, 20.4,80, 17.8,86, 18,92),1.3,[.6,.5]),
 stroke('Chest right edge',P(60.6,81, 64.4,84.4, 66,89, 65.6,93),1.3,[.6,.5]),
 stroke('Chest lock 1',P(32.6,84.4, 31.6,88, 32,91.4),1.1,[.7,.5]),
 stroke('Chest lock 2',P(43,85.6, 42.8,89, 43.4,92.4),1.1,[.7,.5]),
 stroke('Chest lock 3',P(52.4,84.8, 53.6,88, 53.4,91.2),1.1,[.7,.5]),
];
