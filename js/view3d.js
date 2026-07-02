// High-fidelity 3D stitch viewer (three.js). Every stitch is a physical thread
// cylinder laid over a woven fabric plane inside the SE700 hoop, with studio
// lighting so satin/tatami sheen reads like real embroidery. A sew-order
// playback (slider + play) shows exactly how the design is stitched.
//
// Loaded lazily — three.js only downloads the first time the 3D view opens.

import * as THREE from "three";

const THREAD_R = 0.19;      // thread radius (mm) — 40wt polyester ≈ 0.38mm wide
const LIFT = 0.24;          // how high thread sits above the fabric plane

let ctx3d = null; // { renderer, scene, camera, mesh, total, ... }

// ---------------------------------------------------------------- fabric
function fabricTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  g.fillStyle = "#f4f1e9";
  g.fillRect(0, 0, 256, 256);
  // simple plain-weave: alternating warp/weft tiles + soft noise
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const t = (x + y) % 2 === 0;
      g.fillStyle = t ? "rgba(210,203,186,0.55)" : "rgba(255,255,252,0.5)";
      g.fillRect(x * 4, y * 4, 4, 4);
      g.fillStyle = "rgba(0,0,0,0.05)";
      if (t) g.fillRect(x * 4, y * 4 + 3, 4, 1); else g.fillRect(x * 4 + 3, y * 4, 1, 4);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.anisotropy = 4;
  return tex;
}

// Rounded-rect ring (the physical hoop) as an extruded shape.
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

// ---------------------------------------------------------------- stitches
// One instanced capsule-ish cylinder per stitch segment, oriented in-plane.
function buildStitches(compiled, hoop) {
  const segs = [];
  let last = null, penDown = false;
  for (const s of compiled.plan) {
    if (s.cmd === "stitch") {
      if (penDown && last) {
        const len = Math.hypot(s.x - last.x, s.y - last.y);
        if (len > 0.05) segs.push({ a: last, b: s, color: compiled.colors[s.color]?.color || "#333333" });
      }
      last = { x: s.x, y: s.y }; penDown = true;
    } else { if (s.cmd === "jump") last = { x: s.x, y: s.y }; penDown = false; }
  }
  const geo = new THREE.CapsuleGeometry(THREAD_R, 1, 3, 10);
  geo.rotateZ(Math.PI / 2); // capsule axis along +X, unit mid-length
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.06 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, segs.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const col = new THREE.Color();
  // keep TRUE hoop placement: world origin = hoop center
  const cx = hoop.w / 2, cy = hoop.h / 2;
  segs.forEach((s, i) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    // y-down design space → y-up world
    const mx = (s.a.x + s.b.x) / 2 - cx, my = -((s.a.y + s.b.y) / 2 - cy);
    q.setFromAxisAngle(zAxis, Math.atan2(-dy, dx));
    m.compose(
      new THREE.Vector3(mx, my, LIFT + (i % 5) * 0.012), // slight layering avoids z-fighting
      q,
      new THREE.Vector3(Math.max(0.05, len - THREAD_R * 0.7), 1, 0.82) // squash z: thread flattens onto fabric
    );
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(s.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, total: segs.length, segs, center: { x: cx, y: cy } };
}

// ---------------------------------------------------------------- viewer
export function open3DView(compiled, hoop, ui) {
  close3DView();
  const host = ui.container;
  const W = host.clientWidth || 800, H = host.clientHeight || 520;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2029);

  // fabric plane inside the hoop
  const fab = new THREE.Mesh(
    new THREE.PlaneGeometry(hoop.w + 26, hoop.h + 26),
    new THREE.MeshStandardMaterial({ map: fabricTexture(), roughness: 0.9, metalness: 0 })
  );
  fab.receiveShadow = true;
  scene.add(fab);
  scene.add(hoopMesh(hoop.w + 6, hoop.h + 6, 9, 5, 0xdde3ea));

  const { mesh, total } = buildStitches(compiled, hoop);
  mesh.castShadow = true;
  scene.add(mesh);

  // needle marker for playback
  const needle = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xff3b6b, roughness: 0.4 })
  );
  needle.rotation.x = Math.PI; // point down
  needle.position.z = 4.2;
  needle.visible = false;
  scene.add(needle);

  // lights: warm key + cool fill + ambient — makes thread sheen read
  const key = new THREE.DirectionalLight(0xfff2df, 2.6);
  key.position.set(-60, 80, 120);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const d = Math.max(hoop.w, hoop.h);
  key.shadow.camera.left = -d; key.shadow.camera.right = d;
  key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  fill.position.set(80, -40, 60);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const camera = new THREE.PerspectiveCamera(38, W / H, 1, 2000);

  // ------------- navigation: smooth damped orbit around a movable target ----
  // Start framed on the DESIGN (true hoop position), not the whole hoop.
  // `goal` is where the user is steering; `cur` eases toward it every frame,
  // which makes rotate/zoom feel fluid instead of twitchy.
  const bb = compiled.bounds;
  const designW = Math.max(10, bb.maxX - bb.minX), designH = Math.max(10, bb.maxY - bb.minY);
  const home = {
    theta: -0.35, phi: 0.95,
    dist: Math.min(360, Math.max(45, Math.max(designW, designH) * 2.6)),
    tx: (bb.minX + bb.maxX) / 2 - hoop.w / 2,
    ty: -((bb.minY + bb.maxY) / 2 - hoop.h / 2),
  };
  const goal = { ...home };
  const cur = { ...home };
  const clampView = () => {
    goal.phi = Math.max(0.04, Math.min(1.52, goal.phi));
    goal.dist = Math.max(8, Math.min(700, goal.dist));
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
  const el = renderer.domElement;
  el.style.touchAction = "none";
  el.style.cursor = "grab";
  el.addEventListener("pointerdown", (e) => {
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    dragging = { x: e.clientX, y: e.clientY, pan, grab: pan ? planePoint(e.clientX, e.clientY) : null };
    el.style.cursor = pan ? "move" : "grabbing";
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
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
  const endDrag = () => { dragging = null; el.style.cursor = "grab"; };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= el.clientHeight;
    dy = Math.max(-60, Math.min(60, dy));
    const prev = goal.dist;
    goal.dist = Math.max(8, Math.min(700, prev * Math.exp(dy * 0.0016)));
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

  // playback state
  const segsPerStitch = total; // slider domain
  const state3d = { shown: total, playing: false, speed: 6 };
  ui.scrub.max = String(total);
  ui.scrub.value = String(total);

  const setShown = (n) => {
    state3d.shown = Math.max(0, Math.min(total, Math.round(n)));
    mesh.count = state3d.shown;
    ui.scrub.value = String(state3d.shown);
    ui.counter.textContent = `${state3d.shown.toLocaleString()} / ${total.toLocaleString()}`;
    if (state3d.shown > 0 && state3d.shown < total) {
      const m = new THREE.Matrix4(), pos = new THREE.Vector3();
      mesh.getMatrixAt(state3d.shown - 1, m);
      pos.setFromMatrixPosition(m);
      needle.position.x = pos.x; needle.position.y = pos.y;
      needle.visible = true;
    } else needle.visible = false;
  };
  setShown(total);

  let raf = 0;
  const DAMP = 0.16; // ease factor per frame — smooth but responsive
  const loop = () => {
    if (state3d.playing) {
      const next = state3d.shown + state3d.speed;
      setShown(next);
      if (state3d.shown >= total) { state3d.playing = false; ui.play.textContent = "▶"; }
    }
    // ease the camera toward its goal (rotation, zoom, and preset moves)
    cur.theta += (goal.theta - cur.theta) * DAMP;
    cur.phi += (goal.phi - cur.phi) * DAMP;
    cur.dist += (goal.dist - cur.dist) * DAMP;
    cur.tx += (goal.tx - cur.tx) * DAMP;
    cur.ty += (goal.ty - cur.ty) * DAMP;
    applyCam();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  ui.play.onclick = () => {
    if (!state3d.playing && state3d.shown >= total) setShown(0);
    state3d.playing = !state3d.playing;
    ui.play.textContent = state3d.playing ? "⏸" : "▶";
  };
  ui.scrub.oninput = () => { state3d.playing = false; ui.play.textContent = "▶"; setShown(parseInt(ui.scrub.value, 10)); };
  ui.speed.onchange = () => { state3d.speed = parseInt(ui.speed.value, 10); };

  const onResize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  ctx3d = { renderer, raf: () => raf, onResize, host };
  return { total };
}

export function close3DView() {
  if (!ctx3d) return;
  cancelAnimationFrame(ctx3d.raf());
  window.removeEventListener("resize", ctx3d.onResize);
  ctx3d.renderer.dispose();
  ctx3d.host.innerHTML = "";
  ctx3d = null;
}
