import * as THREE from 'three';
import { TABLE, CUP, BALL_R } from './physics.js';

export function createRenderer(canvas, game) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120c18);
  scene.fog = new THREE.Fog(0x120c18, 5, 12);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 40);

  scene.add(new THREE.HemisphereLight(0xffe9d0, 0x2a1830, 0.9));
  const lamp = new THREE.DirectionalLight(0xffffff, 1.7);
  lamp.position.set(0.6, 3.0, 0.8); lamp.castShadow = true; lamp.shadow.mapSize.set(512, 512);
  Object.assign(lamp.shadow.camera, { left: -0.6, right: 0.6, top: 1.5, bottom: -1.5, near: 0.5, far: 6 });
  scene.add(lamp);

  // Table
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.W, 0.03, TABLE.L), new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.7 }));
  top.position.y = -0.015; top.receiveShadow = true; scene.add(top);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.002, TABLE.L), white); e.position.set(sx * (TABLE.W / 2 - 0.006), 0.001, 0); scene.add(e); }
  const midLine = new THREE.Mesh(new THREE.BoxGeometry(TABLE.W, 0.002, 0.01), white); midLine.position.y = 0.001; scene.add(midLine);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), legMat); l.position.set(sx * 0.27, -0.4, sz * 1.15); scene.add(l); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x2a1d22, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.77; scene.add(floor);

  // Cups
  const cupGeo = new THREE.CylinderGeometry(CUP.R, CUP.Rb, CUP.H, 24, 1, true);
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd8232a, roughness: 0.45, side: THREE.DoubleSide });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x2f6fe0, roughness: 0.45, side: THREE.DoubleSide });
  const rimGeo = new THREE.TorusGeometry(CUP.R, CUP.rim, 6, 24); const rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const beerGeo = new THREE.CircleGeometry(CUP.R * 0.93, 20); const beerMat = new THREE.MeshStandardMaterial({ color: 0xf2b233, emissive: 0x553300, roughness: 0.3 });
  const cupMeshes = new Map();
  for (const c of [...game.far, ...game.near]) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(cupGeo, c.side === 'far' ? redMat : blueMat); body.position.y = CUP.H / 2; body.castShadow = true; grp.add(body);
    const rim = new THREE.Mesh(rimGeo, rimMat); rim.rotation.x = Math.PI / 2; rim.position.y = CUP.H; grp.add(rim);
    const beer = new THREE.Mesh(beerGeo, beerMat); beer.rotation.x = -Math.PI / 2; beer.position.y = CUP.H * 0.72; grp.add(beer);
    grp.position.set(c.x, 0, c.z); scene.add(grp); cupMeshes.set(c.id, grp);
  }

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.35, roughness: 0.3 }));
  ball.castShadow = true; scene.add(ball);

  // Aim hint (dotted predicted path)
  const hintN = 60, hintPos = new Float32Array(hintN * 3);
  const hintGeo = new THREE.BufferGeometry(); hintGeo.setAttribute('position', new THREE.BufferAttribute(hintPos, 3));
  const hint = new THREE.Points(hintGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.008, transparent: true, opacity: 0.5, depthWrite: false }));
  hint.frustumCulled = false; scene.add(hint);

  // Camera poses: player's end (first person) and a high view of own cups during AI turns
  const poses = {
    player: { pos: new THREE.Vector3(0, 1.25, 2.05), look: new THREE.Vector3(0, -0.05, -0.7) },
    ai: { pos: new THREE.Vector3(0, 1.35, 2.45), look: new THREE.Vector3(0, 0, 0.55) },
  };
  const camPos = poses.player.pos.clone(), camLook = poses.player.look.clone();
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w > h ? 45 : 58; camera.updateProjectionMatrix();
  }
  fit(); window.addEventListener('resize', fit);

  return {
    camera,
    setShadows(on) { renderer.shadowMap.enabled = on; lamp.castShadow = on; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); },
    setHint(path) {
      if (!path || !path.length) { hint.visible = false; return; }
      hint.visible = true;
      const stride = Math.max(1, Math.floor(path.length / hintN));
      for (let i = 0; i < hintN; i++) { const p = path[Math.min(path.length - 1, i * stride)]; hintPos.set(p, i * 3); }
      hintGeo.attributes.position.needsUpdate = true;
    },
    draw(g, alpha, held, dt) {
      const ownHidden = g.turn === 'player' && g.state !== 'won' && g.state !== 'lost';   // own cups would block the view
      for (const c of [...g.far, ...g.near]) cupMeshes.get(c.id).visible = c.alive && !(c.side === 'near' && ownHidden);
      if (held) { ball.visible = true; ball.position.set(held.x, held.y, held.z); }
      else if (g.ball && !(g.state === 'settle' && g.pendingEv?.type === 'cup') && !g.ball.done) {
        const b = g.ball; ball.visible = true;
        ball.position.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
      } else ball.visible = false;
      const pose = g.turn === 'ai' && g.state !== 'won' && g.state !== 'lost' ? poses.ai : poses.player;
      const k = 1 - Math.exp(-dt * 4);
      camPos.lerp(pose.pos, k); camLook.lerp(pose.look, k);
      camera.position.copy(camPos); camera.lookAt(camLook);
      renderer.render(scene, camera);
    },
  };
}
