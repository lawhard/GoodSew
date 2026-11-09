// Timmy the Yorkie — authored through the Good Sew assistant commands.
// Coordinates are millimetres in the SE700 4×4 field, measured from the photo
// with a millimetre grid. Every area is split satin whose rails sit across the
// way the fur lies, so each patch of coat catches the light in its own direction.
const P=(...a)=>{const o=[];for(let i=0;i<a.length;i+=2)o.push({x:a[i],y:a[i+1]});return o;};
export const NAME='Timmy';
export const FABRIC='#33415c';
export const COLORS={tan:'#c99258',rose:'#a9766a',cream:'#f1e8d6',sand:'#dcb98f',brown:'#6b452e',black:'#0b0b0b',white:'#fbfaf5'};
const fur={density:.42,split:6.5,underlay:true,pull:.15};
const satin=(name,color,rails,params={})=>({op:'add_satin',name,color,smooth:true,rails,params:{...fur,...params}});
const circle=(cx,cy,rx,ry,n=7)=>{const top=[],bot=[];for(let i=0;i<n;i++){const a=Math.PI*(1-i/(n-1))*.94+Math.PI*.03;top.push({x:cx+rx*Math.cos(a),y:cy-ry*Math.sin(a)});bot.push({x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)});}return [top,bot];};

const ring=(cx,cy,r,n=14)=>Array.from({length:n+1},(_,i)=>({x:cx+r*Math.cos(i/n*2*Math.PI-Math.PI/2),y:cy+r*.96*Math.sin(i/n*2*Math.PI-Math.PI/2)}));
const strand=(name,pts)=>({op:'add_running',name,color:COLORS.brown,points:pts,params:{stitchLength:2.2,returnPass:true,curveTolerance:.15}});
export const CLOSEUPS={eyes:{x:24,y:36,w:40,h:22},muzzle:{x:18,y:48,w:52,h:36}};

export const operations=[
 // ── ears: fringe first, darker inner ear over its root ──
 satin('Left ear fringe',COLORS.tan,[P(33,33, 29,37.5, 25,42, 23,47, 23,51.5),P(33,29.5, 22,21, 10,14.5, 8,28, 9,41, 13,53, 20,56)],{featherA:2,featherB:3.2}),
 satin('Right ear fringe',COLORS.tan,[P(60,35, 64,40, 66.5,45, 68,50, 68.5,54.5),P(60,32.5, 70,28.5, 80,26.5, 91.5,27, 89,38, 82,49.5, 72,58)],{featherA:2,featherB:3.2}),
 satin('Left inner ear',COLORS.rose,[P(31.5,33, 28,38, 25,43, 23.5,48, 24,51),P(28,27.5, 21,22.5, 13.5,20, 11.5,30, 12.5,39, 16,47, 21,51)],{featherB:2.8,density:.45}),
 satin('Right inner ear',COLORS.rose,[P(62,36, 65.5,40, 68,44.5, 69,49, 68.5,52),P(64,33.5, 71,31, 78.5,29.5, 86,30.5, 84.5,38, 79.5,45.5, 72.5,52)],{featherB:2.8,density:.45}),
 // ── chest ruff behind the chin ──
 satin('Chest ruff',COLORS.white,[P(26,72, 33,75, 42,76.5, 52,75.5, 60,72),P(21.5,82, 30.5,88, 42,90.5, 54,88, 64.5,81)],{featherB:3.4}),
 satin('Top knot',COLORS.white,[P(39,30.5, 46.5,29, 54,31),P(37.5,24.5, 46.5,21, 56,25.5)],{featherB:3.6}),
 // ── face coat: every patch overlaps its neighbour by about a millimetre ──
 satin('Forehead',COLORS.cream,[P(21.5,46, 27,44.6, 33,45, 39,45.4, 44,45.8, 50,46.4, 55.5,46.8, 62,47.4, 67,51),P(19.5,44, 22.5,35, 30,30, 38,27.5, 46,25.5, 54,27.5, 61,32, 66.5,41, 69.5,49.5)],{featherB:3}),
 satin('Left cheek',COLORS.cream,[P(31,44.5, 34.5,49.5, 36.5,57),P(19.6,43, 19.2,50, 20.4,58.5)],{featherB:1.8}),
 satin('Right cheek',COLORS.cream,[P(57.8,46.5, 53,52, 51.5,58.5),P(67.8,46, 69.5,52, 68.6,60.5)],{featherB:1.8}),
 satin('Nose bridge',COLORS.cream,[P(33.5,61.5, 42.5,59.8, 52.5,61.5),P(33.5,45, 44,43, 54.8,46.2)],{}),
 // ── muzzle: two fans of whiskers flowing out and down from the nose ──
 satin('Left whiskers',COLORS.sand,[P(38.2,50.4, 38.4,55.5, 38.6,61, 39.6,66.5, 42.4,70.4),P(26.5,54.5, 21.5,59.5, 20.3,65, 24,71.5, 31.5,76.5)],{featherB:3,featherA:.9}),
 satin('Right whiskers',COLORS.sand,[P(47.6,51.4, 47,56, 46.8,61, 45.8,66.5, 42.4,70.4),P(61.5,56.5, 66,61, 67.6,66.5, 64,72.5, 54,77.5)],{featherB:3,featherA:.9}),
 // ── brown: the chin showing under the moustache, and the shadowed inner eye corners ──
 satin('Chin',COLORS.brown,[P(33.5,75.2, 38,72, 42.5,68.6, 47,72, 52,75.6),P(33,76.6, 37,79.2, 42.3,80.4, 48,79.6, 52.6,77)],{featherB:2,split:6}),
 {op:'add_satin',name:'Left eye shadow',color:COLORS.brown,smooth:true,spine:P(35.6,43.9, 36.9,46.8, 35.9,49.9, 33.3,50.6),width:[.8,1.7,1.7,.8],params:{density:.45,underlay:false}},
 {op:'add_satin',name:'Right eye shadow',color:COLORS.brown,smooth:true,spine:P(53,45.6, 51.6,48.5, 52.6,51.7, 55.3,52.4),width:[.8,1.7,1.7,.8],params:{density:.45,underlay:false}},
 // ── black: eyes and a two-lobed nose that meets on the centre line ──
 {op:'add_satin',name:'Left eye',color:COLORS.black,smooth:true,rails:circle(33,46.6,3.5,3.3),params:{density:.38,underlay:true}},
 {op:'add_satin',name:'Right eye',color:COLORS.black,smooth:true,rails:circle(55.5,48.5,3.6,3.4),params:{density:.38,underlay:true}},
 {op:'add_satin',name:'Nose left',color:COLORS.black,smooth:true,rails:[P(41.2,58.4, 38.4,59.2, 36.9,61.6, 37.4,64.8, 39.4,67.6, 41.6,68.9),P(42.7,58.3, 42.7,60, 42.7,62, 42.7,64.8, 42.7,67.4, 42.7,69)],params:{density:.38,underlay:true}},
 {op:'add_satin',name:'Nose right',color:COLORS.black,smooth:true,rails:[P(42.3,58.3, 42.3,60, 42.3,62, 42.3,64.8, 42.3,67.4, 42.3,69),P(43.8,58.4, 46.6,59.2, 48.3,61.6, 47.7,64.8, 45.6,67.6, 43.4,68.9)],params:{density:.38,underlay:true}},
 // ── white: catchlights that bring the eyes to life, and the nose shine ──
 {op:'add_satin',name:'Left catchlight',color:COLORS.white,spine:P(31.5,45.6, 32.5,45, 33.5,45.3),width:[.8,1.2,.8],params:{density:.4,underlay:false}},
 {op:'add_satin',name:'Right catchlight',color:COLORS.white,spine:P(54,47.5, 55,46.9, 56,47.2),width:[.8,1.2,.8],params:{density:.4,underlay:false}},
 {op:'add_satin',name:'Nose shine',color:COLORS.white,spine:P(39.4,60.9, 40.4,60.2, 41.4,60.1),width:[.6,.9,.6],params:{density:.45,underlay:false}},
];
