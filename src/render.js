import * as THREE from 'three';
import { FIELD, PADDLE, BALL_R, playerX, aiX } from './game.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 30, 60);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1a2a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-4, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  scene.add(sun);

  // Table
  const { L, W } = FIELD;
  const table = new THREE.Mesh(new THREE.BoxGeometry(L + 1.2, 0.4, W + 0.6), new THREE.MeshStandardMaterial({ color: 0x0f5c46, roughness: 0.85 }));
  table.position.y = -0.2; table.receiveShadow = true; scene.add(table);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8fff4 });
  const mid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, W), lineMat); mid.position.y = 0.005; scene.add(mid);
  for (const z of [-W / 2, W / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(L + 1.2, 0.35, 0.25), new THREE.MeshStandardMaterial({ color: 0x2a3566, roughness: 0.6 }));
    wall.position.set(0, 0.17, z + Math.sign(z) * 0.125); scene.add(wall);
  }
  const legMat = new THREE.MeshStandardMaterial({ color: 0x222838 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), legMat); leg.position.set(sx * (L / 2 - 0.3), -1.9, sz * (W / 2 - 0.3)); scene.add(leg);
  }

  const mkPaddle = (color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PADDLE.thick, 0.5, PADDLE.len),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
    m.position.y = 0.25; m.castShadow = true; scene.add(m); return m;
  };
  const pMesh = mkPaddle(0x5cf2ff); pMesh.position.x = playerX;
  const aMesh = mkPaddle(0xff7a7a); aMesh.position.x = aiX;
  // ghost marker showing raw hand target
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, PADDLE.len), new THREE.MeshBasicMaterial({ color: 0x5cf2ff, transparent: true, opacity: 0.35 }));
  ghost.position.set(playerX - 0.4, 0.02, 0); scene.add(ghost);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffaa, emissiveIntensity: 0.4 }));
  ball.position.y = BALL_R; ball.castShadow = true; scene.add(ball);

  // Camera: side/elevated view; paddle travel (z) maps to screen vertical, far side = up.
  const portraitLayout = FIELD.W > FIELD.L;
  const dir = new THREE.Vector3(0, portraitLayout ? 2.6 : 1.55, 1).normalize();
  const target = new THREE.Vector3(0, 0, 0.3);
  const corners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 0.4]) corners.push(new THREE.Vector3(sx * (L / 2 + 0.7), y, sz * (W / 2 + 0.4)));
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w > h ? 42 : 50;
    camera.updateProjectionMatrix();
    // leave room for HUD at top/bottom in portrait
    const limX = 0.94, limY = w > h ? 0.78 : 0.74;
    let lo = 5, hi = 120;
    for (let i = 0; i < 30; i++) {
      const D = (lo + hi) / 2; camera.position.copy(target).addScaledVector(dir, D); camera.lookAt(target); camera.updateMatrixWorld();
      const ok = corners.every(c => { const p = c.clone().project(camera); return Math.abs(p.x) <= limX && Math.abs(p.y) <= limY; });
      if (ok) hi = D; else lo = D;
    }
    camera.position.copy(target).addScaledVector(dir, hi); camera.lookAt(target);
  }
  fit(); window.addEventListener('resize', fit);

  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function screenToTableZ(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(plane, hit) ? hit.z : null;
  }

  return {
    renderer,
    setShadows(on) { renderer.shadowMap.enabled = on; sun.castShadow = on; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); },
    draw(g, alpha, ghostZ) {
      const lerp = (a, b) => a + (b - a) * alpha;
      ball.position.x = lerp(g.ball.px, g.ball.x); ball.position.z = lerp(g.ball.pz, g.ball.z);
      ball.visible = g.state !== 'over';
      pMesh.position.z = lerp(g.player.pz, g.player.z);
      aMesh.position.z = lerp(g.ai.pz, g.ai.z);
      ghost.visible = ghostZ != null; if (ghostZ != null) ghost.position.z = ghostZ;
      renderer.render(scene, camera);
    },
    screenToTableZ,
  };
}
