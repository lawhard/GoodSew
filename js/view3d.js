// Local PES / stitch-plan inspector. PBR thread and fabric materials with
// millimeter geometry; loft and crossing height remain explicit estimates.
import * as THREE from 'three';
import {VIEWER_DEFAULTS,prepareThreadSegments,estimateLayers,threadTubeData,visibleSegmentCount} from './thread-model.js';
let ctx3d=null;
const FINISHES={polyester:{roughness:.32,anisotropy:.8,sheen:.45},rayon:{roughness:.23,anisotropy:.9,sheen:.7},cotton:{roughness:.68,anisotropy:.3,sheen:.9}};
function textureFromPixels(size,pixel) {
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,c=pixel(x/size,y/size);data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];data[i+3]=255;}
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;return texture;
}
function threadNormal() {
  return textureFromPixels(256,(u,v)=>{
    const twist=Math.PI*2*(v*3-u),fine=Math.PI*2*(v*19-u*5);
    const nx=.12*Math.cos(twist)+.025*Math.cos(fine),ny=.36*Math.cos(twist)+.07*Math.cos(fine),nz=1,inv=1/Math.hypot(nx,ny,nz);
    return [128+127*nx*inv,128+127*ny*inv,128+127*nz*inv];
  });
}
function fabricMaps() {
  const height=(u,v)=>{
    const x=u*8,y=v*8,warp=(Math.floor(x)+Math.floor(y))%2===0;
    const a=Math.sin(Math.PI*(warp?y:x))**2,b=Math.sin(Math.PI*(warp?x:y))**2;
    return .65*a+.2*b+.015*Math.sin(u*512+Math.sin(v*200));
  };
  const normal=textureFromPixels(256,(u,v)=>{const e=1/256,nx=(height(u-e,v)-height(u+e,v))*1.3,ny=(height(u,v-e)-height(u,v+e))*1.3,inv=1/Math.hypot(nx,ny,1);return [128+127*nx*inv,128+127*ny*inv,128+127*inv];});
  const color=textureFromPixels(256,(u,v)=>{const n=202+height(u,v)*50;return [n,n,n];});color.colorSpace=THREE.SRGBColorSpace;
  return {normal,color};
}
function makeThreadGeometry(quality,loft) {
  const [l,r]=quality==='macro'?[12,12]:quality==='economy'?[4,6]:[6,8];
  const data=threadTubeData(l,r,loft),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));geometry.setIndex(data.indices);geometry.computeVertexNormals();geometry.computeTangents();return geometry;
}
function disposeScene(scene) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);if(o.isInstancedMesh)o.dispose();});
  for(const m of materials){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();}
  geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());
}

function hoopMesh(w, h, rim, depth, color) {
  const r = 8;
  const rect = (shape, x0, y0, x1, y1, rr) => {
    shape.moveTo(x0 + rr, y0);
    shape.lineTo(x1 - rr, y0); shape.quadraticCurveTo(x1, y0, x1, y0 + rr);
    shape.lineTo(x1, y1 - rr); shape.quadraticCurveTo(x1, y1, x1 - rr, y1);
    shape.lineTo(x0 + rr, y1); shape.quadraticCurveTo(x0, y1, x0, y1 - rr);
    shape.lineTo(x0, y0 + rr); shape.quadraticCurveTo(x0, y0, x0 + rr, y0);
  };
  const shape = new THREE.Shape();
  rect(shape, -w / 2 - rim, -h / 2 - rim, w / 2 + rim, h / 2 + rim, r);
  const hole = new THREE.Path();
  rect(hole, -w / 2, -h / 2, w / 2, h / 2, r * 0.6);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2 });
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.6;
  return mesh;
}


export function open3DView(compiled,hoop,ui) {
  close3DView();
  const host=ui.container,W=host.clientWidth||800,H=host.clientHeight||520;
  const settings={...VIEWER_DEFAULTS,...(ui.fabric?{fabric:ui.fabric}:{})},model=prepareThreadSegments(compiled),colors=compiled.colors.map(c=>({...c}));
  if(!model.totalStitches)throw new Error('There are no stitches to preview.');
  if(model.totalStitches>200000)throw new Error('The 3D viewer supports up to 200,000 stitches.');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.setSize(W,H);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=settings.exposure;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  host.replaceChildren(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#202a32');
  const fabricSize={w:Math.max(126,compiled.bounds.w+28),h:Math.max(126,compiled.bounds.h+28)};
  const maps=fabricMaps(),fabricMaterial=new THREE.MeshPhysicalMaterial({color:settings.fabric,map:maps.color,normalMap:maps.normal,normalScale:new THREE.Vector2(.45,.45),roughness:.92,sheen:1,sheenRoughness:.8,sheenColor:new THREE.Color('#c8c4b9')});
  const fabric=new THREE.Mesh(new THREE.PlaneGeometry(fabricSize.w,fabricSize.h),fabricMaterial);fabric.receiveShadow=true;scene.add(fabric);
  const hoopRing=hoopMesh(hoop.w+6,hoop.h+6,9,5,0xc4cfd4);scene.add(hoopRing);
  const needle=new THREE.Mesh(new THREE.ConeGeometry(.35,5,12),new THREE.MeshStandardMaterial({color:0xe67840,metalness:.25,roughness:.35}));needle.rotation.x=-Math.PI/2;needle.visible=false;scene.add(needle);
  const key=new THREE.DirectionalLight(0xfff6e8,3.5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
  const d=Math.max(hoop.w,hoop.h,compiled.bounds.w,compiled.bounds.h)*.7;
  key.shadow.camera.left=-d;key.shadow.camera.right=d;key.shadow.camera.top=d;key.shadow.camera.bottom=-d;key.shadow.camera.near=1;key.shadow.camera.far=1200;key.shadow.normalBias=.025;key.shadow.bias=-.00002;scene.add(key);
  const fill=new THREE.DirectionalLight(0xc8dfff,1.1);fill.position.set(65,-50,65);scene.add(fill);scene.add(new THREE.AmbientLight(0xffffff,.65));
  const camera=new THREE.PerspectiveCamera(38,W/H,.1,5000);
  const normal=threadNormal(),threadMaterial=new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.32,anisotropy:.8,anisotropyRotation:0,sheen:.45,sheenRoughness:.45,sheenColor:new THREE.Color('#ffffff'),normalMap:normal,normalScale:new THREE.Vector2(.22,.22),side:THREE.DoubleSide});
  threadMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float threadLength;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_NORMALMAP\nvNormalMapUv.x *= threadLength / 0.65;\n#endif');
  };
  threadMaterial.customProgramCacheKey=()=> 'goodsew-thread-physical-1';
  const threadGroup=new THREE.Group();scene.add(threadGroup);let chunks=[],threadGeometry;
  const color=new THREE.Color(),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3(),axis=new THREE.Vector3(0,0,1);
  let shown=model.totalStitches,playing=false,speed=Number(ui.speed.value)||400,acc=0,raf=0,disposed=false,lastTime=performance.now();
  const rebuildThreads=()=>{
    for(const mesh of chunks){threadGroup.remove(mesh);mesh.geometry.dispose();mesh.dispose();}
    chunks=[];
    if(settings.layering)estimateLayers(model.segments,settings.diameter);else model.segments.forEach(s=>s.layer=0);
    threadGeometry?.dispose();threadGeometry=makeThreadGeometry(settings.quality,settings.loft);
    for(let start=0;start<model.segments.length;start+=2048) {
      const segs=model.segments.slice(start,start+2048),geo=threadGeometry.clone();
      geo.setAttribute('threadLength',new THREE.InstancedBufferAttribute(Float32Array.from(segs,s=>s.length),1));
      const mesh=new THREE.InstancedMesh(geo,threadMaterial,segs.length);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.start=start;
      segs.forEach((s,i)=>{
        quat.setFromAxisAngle(axis,Math.atan2(-(s.b.y-s.a.y),s.b.x-s.a.x));
        pos.set(s.a.x-hoop.w/2,-(s.a.y-hoop.h/2),s.layer+.035);
        scale.set(s.length,settings.diameter,settings.diameter);matrix.compose(pos,quat,scale);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,color.set(colors[s.color]?.color||'#777777'));
      });
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();chunks.push(mesh);threadGroup.add(mesh);
    }
    setShown(shown);
  };
  const jumpGeometry=new THREE.BufferGeometry();jumpGeometry.setAttribute('position',new THREE.Float32BufferAttribute(model.jumps.flatMap(j=>[j.a.x-hoop.w/2,-(j.a.y-hoop.h/2),.65,j.b.x-hoop.w/2,-(j.b.y-hoop.h/2),.65]),3));
  const jumpLines=new THREE.LineSegments(jumpGeometry,new THREE.LineDashedMaterial({color:0xe87e4a,dashSize:1,gapSize:.7,transparent:true,opacity:.7}));jumpLines.computeLineDistances();jumpLines.visible=false;scene.add(jumpLines);
  const holeGeometry=new THREE.BufferGeometry();holeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(model.penetrations.flatMap(p=>[p.x-hoop.w/2,-(p.y-hoop.h/2),.045]),3));
  const holes=new THREE.Points(holeGeometry,new THREE.PointsMaterial({color:0x362a21,size:.16,sizeAttenuation:true}));holes.visible=false;scene.add(holes);
  const overlay=document.createElement('div');overlay.className='viewer-overlay';
  const scaleBar=document.createElement('div');scaleBar.className='viewer-scale';overlay.append(scaleBar);
  const inspect=document.createElement('div');inspect.className='viewer-inspect';inspect.textContent='Click a strand to inspect its stitch length.';overlay.append(inspect);host.append(overlay);
  ui.scrub.max=String(model.totalStitches);ui.scrub.value=String(model.totalStitches);
  const setShown=n=>{
    shown=Math.max(0,Math.min(model.totalStitches,Math.floor(n)));const visible=visibleSegmentCount(model.segments,shown);
    for(const mesh of chunks) {
      mesh.count=Math.max(0,Math.min(mesh.instanceMatrix.count,visible-mesh.userData.start));
      mesh.visible=true;
    }
    ui.scrub.value=String(shown);ui.counter.textContent=`${shown.toLocaleString()} / ${model.totalStitches.toLocaleString()} stitches`;
    const point=model.penetrations[Math.max(0,shown-1)];needle.visible=shown>0&&shown<model.totalStitches;
    if(point)needle.position.set(point.x-hoop.w/2,-(point.y-hoop.h/2),2.6);
    holeGeometry.setDrawRange(0,shown);
    jumpGeometry.setDrawRange(0,visibleSegmentCount(model.jumps,shown)*2);
  };

  // ------------- navigation: smooth damped orbit around a movable target ----
  // Start framed on the DESIGN (true hoop position), not the whole hoop.
  // `goal` is where the user is steering; `cur` eases toward it every frame,
  // which makes rotate/zoom feel fluid instead of twitchy.
  const bb = compiled.bounds;
  const designW = Math.max(10, bb.maxX - bb.minX), designH = Math.max(10, bb.maxY - bb.minY);
  const home = {
    theta: -0.35, phi: 0.95,
    dist: Math.max(30, Math.max(designW, designH) * 2.6),
    tx: (bb.minX + bb.maxX) / 2 - hoop.w / 2,
    ty: -((bb.minY + bb.maxY) / 2 - hoop.h / 2),
  };
  const goal = { ...home };
  const cur = { ...home };
  const clampView = () => {
    goal.phi = Math.max(0.04, Math.min(1.52, goal.phi));
    goal.dist = Math.max(8, Math.min(5000, goal.dist));
    const lim = Math.max(hoop.w, hoop.h) * 1.2; // keep the hoop in reach
    goal.tx = Math.max(-lim, Math.min(lim, goal.tx));
    goal.ty = Math.max(-lim, Math.min(lim, goal.ty));
  };
  const applyCam = () => {
    const sp = Math.sin(cur.phi), cp = Math.cos(cur.phi);
    camera.position.set(
      cur.tx + cur.dist * sp * Math.sin(cur.theta),
      cur.ty - cur.dist * sp * Math.cos(cur.theta),
      cur.dist * cp
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(cur.tx, cur.ty, 0);
  };
  applyCam();

  // Where the pointer ray hits the fabric plane (z=0) — the anchor for
  // grab-the-fabric panning, cursor-centred zoom, and dblclick recentring.
  const raycaster = new THREE.Raycaster();
  const fabricPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const planePoint = (clientX, clientY) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -(((clientY - r.top) / r.height) * 2 - 1)
    ), camera);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(fabricPlane, pt) ? pt : null;
  };

  let dragging = null;
  const touchPoints=new Map();let pinchDistance=0;
  const el = renderer.domElement;
  el.style.touchAction = "none";
  el.style.cursor = "grab";
  el.addEventListener("pointerdown", (e) => {
    touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touchPoints.size===2){const [a,b]=[...touchPoints.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);dragging=null;el.setPointerCapture(e.pointerId);return;}
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    dragging = { x: e.clientX, y: e.clientY, pan, grab: pan ? planePoint(e.clientX, e.clientY) : null };
    el.style.cursor = pan ? "move" : "grabbing";
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if(touchPoints.has(e.pointerId))touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touchPoints.size===2){const [a,b]=[...touchPoints.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance>1&&pinchDistance>1){goal.dist*=pinchDistance/distance;clampView();}pinchDistance=distance;return;}
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    dragging.x = e.clientX; dragging.y = e.clientY;
    if (dragging.pan) {
      // grab-the-fabric: keep the grabbed spot pinned under the cursor. Pan is
      // applied to cur AND goal so it tracks the pointer exactly (no lag).
      const p = dragging.grab && planePoint(e.clientX, e.clientY);
      if (p && dragging.grab) {
        const mx = dragging.grab.x - p.x, my = dragging.grab.y - p.y;
        cur.tx += mx; cur.ty += my; goal.tx = cur.tx; goal.ty = cur.ty;
        clampView();
        cur.tx = goal.tx; cur.ty = goal.ty;
        applyCam();
      }
    } else {
      // rotate speed scales with viewport so a half-screen drag ≈ half a turn
      const k = 3.2 / Math.max(300, el.clientWidth);
      goal.theta += dx * k;
      goal.phi -= dy * k;
      clampView();
    }
  });
  const endDrag = (e) => { touchPoints.delete(e.pointerId);pinchDistance=0;dragging = null; el.style.cursor = "grab"; };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= el.clientHeight;
    dy = Math.max(-60, Math.min(60, dy));
    const prev = goal.dist;
    goal.dist = Math.max(8, Math.min(5000, prev * Math.exp(dy * 0.0016)));
    // cursor-centred zoom: pull the target toward the spot under the pointer
    const f = goal.dist / prev;
    const p = planePoint(e.clientX, e.clientY);
    if (p && f < 1) {
      goal.tx = p.x + (goal.tx - p.x) * f;
      goal.ty = p.y + (goal.ty - p.y) * f;
    }
    clampView();
  }, { passive: false });
  el.addEventListener("dblclick", (e) => {
    const p = planePoint(e.clientX, e.clientY);
    if (p) { goal.tx = p.x; goal.ty = p.y; goal.dist = Math.max(24, goal.dist * 0.55); clampView(); }
  });
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  // preset views (buttons in the modal header)
  const hoopDist = Math.max(hoop.w, hoop.h) * 2.2;
  const setView = (name) => {
    if (name === "home") Object.assign(goal, home);
    else if (name === "top") Object.assign(goal, { theta: 0, phi: 0.04, dist: home.dist, tx: home.tx, ty: home.ty });
    else if (name === "front") Object.assign(goal, { theta: 0, phi: 1.38, dist: home.dist, tx: home.tx, ty: home.ty });
    else if (name === "hoop") Object.assign(goal, { theta: -0.35, phi: 0.75, dist: hoopDist, tx: 0, ty: 0 });
    // unwind any full turns so the camera takes the short way around
    cur.theta = goal.theta + ((cur.theta - goal.theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    clampView();
  };
  const viewBtns = ui.views ? [...ui.views.querySelectorAll("[data-view]")] : [];
  viewBtns.forEach((b) => { b.onclick = () => setView(b.dataset.view); });

  const listeners=new AbortController();let rebuildTimer=0;
  const listen=(el,event,fn)=>el?.addEventListener(event,fn,{signal:listeners.signal});
  const settingsHost=ui.controls;
  const applyMaterials=()=>{
    Object.assign(threadMaterial,FINISHES[settings.finish]);threadMaterial.needsUpdate=true;
    fabricMaterial.color.set(settings.fabric);fabricMaterial.sheenColor.set(settings.fabric);
    maps.normal.repeat.set(fabricSize.w/(settings.weave*8),fabricSize.h/(settings.weave*8));maps.color.repeat.copy(maps.normal.repeat);
    const angle=settings.lightAngle*Math.PI/180,elevation=settings.lightHeight*Math.PI/180;
    key.position.set(Math.cos(angle)*200*Math.cos(elevation),Math.sin(angle)*200*Math.cos(elevation),200*Math.sin(elevation));
    renderer.toneMappingExposure=settings.exposure;jumpLines.visible=settings.showJumps;hoopRing.visible=settings.showHoop;holes.visible=settings.showHoles;
  };
  const syncControls=()=>{
    for(const input of settingsHost?.querySelectorAll('[data-setting]')||[]) {
      const value=settings[input.dataset.setting];if(input.type==='checkbox')input.checked=value;else input.value=String(value);
      const output=settingsHost.querySelector(`[data-value="${input.dataset.setting}"]`);if(output)output.textContent=typeof value==='number'?String(value):value;
    }
  };
  for(const input of settingsHost?.querySelectorAll('[data-setting]')||[])listen(input,'input',()=>{
    const setting=input.dataset.setting;settings[setting]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    syncControls();applyMaterials();
    if(['diameter','loft','quality','layering'].includes(setting)){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{if(!disposed)rebuildThreads();},120);}
  });
  const sequence=ui.threads;sequence.replaceChildren();
  colors.forEach((c,i)=>{
    const row=document.createElement('div');row.className='viewer-thread';
    const picker=document.createElement('input');picker.type='color';picker.value=c.color;picker.title=`Preview color for thread ${i+1}`;picker.setAttribute('aria-label',picker.title);
    const button=document.createElement('button');button.type='button';button.textContent=`${i+1}. ${c.name||c.brother?.name||'Thread'}${c.stop?' · stop':''}`;button.title='Move playback to the start of this thread block';
    listen(button,'click',()=>{playing=false;ui.play.textContent='▶';const first=model.penetrations.find(p=>p.color===i);if(first)setShown(first.stitchIndex);});
    listen(picker,'input',()=>{c.color=picker.value;for(const mesh of chunks){const start=mesh.userData.start;for(let j=0;j<mesh.instanceMatrix.count;j++)if(model.segments[start+j].color===i)mesh.setColorAt(j,color.set(c.color));if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}});
    row.append(picker,button);sequence.append(row);
  });
  listen(ui.reset,'click',()=>{Object.assign(settings,VIEWER_DEFAULTS);syncControls();applyMaterials();rebuildThreads();setView('home');});
  listen(ui.snapshot,'click',()=>{
    renderer.render(scene,camera);
    // Keep the download inside the click's user activation. Some embedded
    // browsers reject synthetic downloads from an asynchronous toBlob callback.
    const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download='Good-Sew-3D-preview.png';document.body.append(a);a.click();a.remove();
    inspect.textContent='PNG prepared. Check your browser downloads.';
  });
  listen(ui.play,'click',()=>{if(!playing&&shown>=model.totalStitches)setShown(0);playing=!playing;lastTime=performance.now();acc=0;ui.play.textContent=playing?'⏸':'▶';});
  listen(ui.scrub,'input',()=>{playing=false;ui.play.textContent='▶';setShown(Number(ui.scrub.value));});
  listen(ui.speed,'change',()=>{speed=Number(ui.speed.value);});
  el.tabIndex=0;el.setAttribute('aria-label','3D embroidery: drag to orbit, Shift-drag to pan, scroll to zoom; arrow keys orbit, plus and minus zoom, Home resets.');
  listen(el,'keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=','Home'].includes(e.key))e.preventDefault();
    if(e.key==='ArrowLeft')goal.theta-=.15;if(e.key==='ArrowRight')goal.theta+=.15;
    if(e.key==='ArrowUp')goal.phi-=.1;if(e.key==='ArrowDown')goal.phi+=.1;
    if(e.key==='+'||e.key==='=')goal.dist*=.85;if(e.key==='-')goal.dist*=1.18;if(e.key==='Home')setView('home');clampView();
  });
  let pointerStart=null;
  listen(el,'pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
  listen(el,'pointerup',e=>{
    if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>4)return;
    const r=el.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
    const hit=raycaster.intersectObjects(chunks,false)[0];if(!hit||hit.instanceId==null)return;
    const s=model.segments[hit.object.userData.start+hit.instanceId];
    inspect.textContent=`Stitch ${s.stitchIndex.toLocaleString()} · ${s.length.toFixed(2)} mm · thread ${s.color+1} · diameter ${settings.diameter.toFixed(2)} mm`;
  });
  const onResize=()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}};
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(onResize):null;observer?.observe(host);window.addEventListener('resize',onResize);
  const updateScale=()=>{
    const a=new THREE.Vector3(cur.tx,cur.ty,0).project(camera),b=new THREE.Vector3(cur.tx+Math.cos(cur.theta),cur.ty+Math.sin(cur.theta),0).project(camera);
    const pixels=Math.hypot((b.x-a.x)*host.clientWidth/2,(b.y-a.y)*host.clientHeight/2);
    const mm=[.1,.2,.5,1,2,5,10,20,50,100].find(n=>n*pixels>=65)||100;
    scaleBar.style.width=`${Math.max(1,mm*pixels)}px`;scaleBar.textContent=`${mm} mm`;scaleBar.title='Scale at the camera focus plane; not calibrated to physical screen size.';
  };
  const loop=time=>{
    if(disposed)return;const dt=Math.min(.1,Math.max(0,(time-lastTime)/1000));lastTime=time;
    if(playing){acc+=speed*dt;const step=Math.floor(acc);if(step){acc-=step;setShown(shown+step);}if(shown>=model.totalStitches){playing=false;ui.play.textContent='▶';}}
    const ease=1-Math.exp(-10*dt);
    for(const prop of ['theta','phi','dist','tx','ty'])cur[prop]+=(goal[prop]-cur[prop])*ease;
    applyCam();camera.updateMatrixWorld();updateScale();renderer.render(scene,camera);raf=requestAnimationFrame(loop);
  };
  const onLost=e=>{e.preventDefault();playing=false;inspect.textContent='The graphics context was lost. Close and reopen the viewer.';};el.addEventListener('webglcontextlost',onLost);
  const cleanup=()=>{
    disposed=true;cancelAnimationFrame(raf);clearTimeout(rebuildTimer);listeners.abort();observer?.disconnect();window.removeEventListener('resize',onResize);viewBtns.forEach(b=>b.onclick=null);
    threadGeometry?.dispose();disposeScene(scene);key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();host.replaceChildren();sequence.replaceChildren();
  };
  ctx3d={cleanup,capture:(focus,view)=>{if(focus){const distance=Math.max(focus.h,focus.w/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2))*1.25;Object.assign(goal,{tx:focus.x+focus.w/2-hoop.w/2,ty:-(focus.y+focus.h/2-hoop.h/2),dist:Math.max(8,distance),theta:0,phi:view==='angled'?.7:.04});Object.assign(cur,goal);applyCam();camera.updateMatrixWorld();updateScale();}renderer.render(scene,camera);return renderer.domElement.toDataURL("image/png");}};
  try{syncControls();applyMaterials();rebuildThreads();renderer.compile(scene,camera);ui.play.textContent='▶';loop(performance.now());}
  catch(err){close3DView();throw err;}
  return {total:model.totalStitches,segments:model.segments.length};
}
export function close3DView(){if(ctx3d){const current=ctx3d;ctx3d=null;current.cleanup();}}

export function capture3DView(focus,view){if(!ctx3d)throw Error("3D viewer is not ready.");return ctx3d.capture(focus,view);}
