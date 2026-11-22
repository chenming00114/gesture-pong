import { createGame, step, serve, STEP, PADDLE_LIMIT, WIN_SCORE, configureField } from './game.js';
import { createRenderer } from './render.js';
import { OneEuro } from './oneEuro.js';
import { createHandTracker, classify, palmCenter, drawLandmarks } from './tracking.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- settings (persisted) ----------
const DEFAULTS = { source: 'palm', gain: 2.0, dead: 0.02, center: 0.5, minCutoff: 1.5, beta: 8, aiSpeed: 6.5, invert: false, shadows: true };
const cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('gp-cfg') || '{}'));
const save = () => localStorage.setItem('gp-cfg', JSON.stringify(cfg));

configureField(window.innerHeight > window.innerWidth);
const game = createGame();
const view = createRenderer($('scene'));
const euro = new OneEuro(cfg.minCutoff, cfg.beta);

const T = window.__pong = {                     // debug / test hook
  game, cfg, handVisible: false, rawY: null, filtY: null, gesture: 'None', delegate: null, modelReady: false,
  detections: 0, frames: 0, fps: 0, latencyMs: null, inferMs: null, cameraOn: false, log: [], errors: [],
};
window.addEventListener('error', (e) => T.errors.push(String(e.message)));

// ---------- settings UI ----------
function bindRange(id, outId, key, fmt = (v) => v) {
  const el = $(id), out = $(outId);
  el.value = cfg[key]; out.textContent = fmt(cfg[key]);
  el.addEventListener('input', () => { cfg[key] = parseFloat(el.value); out.textContent = fmt(cfg[key]); apply(); save(); });
}
function apply() { euro.minCutoff = cfg.minCutoff; euro.beta = cfg.beta; game.ai.maxSpeed = cfg.aiSpeed; view.setShadows(cfg.shadows); }
bindRange('optGain', 'vGain', 'gain'); bindRange('optDead', 'vDead', 'dead'); bindRange('optCenter', 'vCenter', 'center');
bindRange('optMin', 'vMin', 'minCutoff'); bindRange('optBeta', 'vBeta', 'beta'); bindRange('optAI', 'vAI', 'aiSpeed');
$('optSource').value = cfg.source; $('optSource').onchange = (e) => { cfg.source = e.target.value; euro.reset(); save(); };
$('optInvert').checked = cfg.invert; $('optInvert').onchange = (e) => { cfg.invert = e.target.checked; save(); };
$('optShadows').checked = cfg.shadows; $('optShadows').onchange = (e) => { cfg.shadows = e.target.checked; apply(); save(); };
$('gear').onclick = () => $('settings').classList.toggle('hidden');
$('btnClose').onclick = () => $('settings').classList.add('hidden');
$('btnReset').onclick = () => { Object.assign(cfg, DEFAULTS); save(); location.reload(); };
$('btnRecenter').onclick = () => { if (T.rawY != null) { cfg.center = +T.rawY.toFixed(2); $('optCenter').value = cfg.center; $('vCenter').textContent = cfg.center; save(); } };
apply();

// ---------- input: hand → paddle ----------
// handY: normalized 0 (top of camera frame) .. 1 (bottom). Hand UP => paddle toward far side (up on screen, -z).
function mapHandToZ(handY) {
  let off = handY - cfg.center;
  const s = Math.sign(off); off = Math.max(0, Math.abs(off) - cfg.dead) * s;   // dead zone around center
  let n = off * cfg.gain * 2;                                                   // -1..1 across reachable band
  if (cfg.invert) n = -n;
  return Math.max(-1, Math.min(1, n)) * PADDLE_LIMIT;
}

let touchActiveUntil = 0;
const canvas = $('scene');
function onPointer(e) {
  if (e.target !== canvas) return;
  const z = view.screenToTableZ(e.clientX, e.clientY);
  if (z != null) { game.player.target = z; touchActiveUntil = performance.now() + 1500; }
}
canvas.addEventListener('pointerdown', (e) => { onPointer(e); if (game.state === 'serve' || game.state === 'over') { if (serve(game)) T.log.push('serve:tap'); } });
canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') onPointer(e); });

// ---------- gestures ----------
let palmFrames = 0, pinchArmed = true, fistStart = 0, fistFired = false;
function handleGesture(gesture, now) {
  // serve: open palm held 3 frames, or pinch onset
  if (gesture === 'Open_Palm') palmFrames++; else palmFrames = 0;
  const pinchOnset = gesture === 'Pinch' && pinchArmed;
  pinchArmed = gesture !== 'Pinch';
  if ((palmFrames === 3 || pinchOnset) && (game.state === 'serve' || game.state === 'over')) {
    if (serve(game)) T.log.push('serve:' + gesture);
  }
  // pause: fist held ~0.5 s toggles
  if (gesture === 'Closed_Fist') {
    if (!fistStart) fistStart = now;
    if (!fistFired && now - fistStart > 500) { game.paused = !game.paused; fistFired = true; T.log.push(game.paused ? 'pause' : 'resume'); }
  } else { fistStart = 0; fistFired = false; }
}

// ---------- camera + tracking ----------
const video = $('video'), overlay = $('overlay');
let tracker = null, lastVideoTime = -1, lastCaptureTime = null, handLostSince = performance.now();

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 60 } },
  });
  video.srcObject = stream; await video.play(); T.cameraOn = true;
  const fitPreview = () => { if (video.videoWidth) $('preview').style.aspectRatio = video.videoWidth + '/' + video.videoHeight; };
  video.addEventListener('resize', fitPreview); fitPreview();
  if ('requestVideoFrameCallback' in video) {
    const cb = (now, meta) => { lastCaptureTime = meta.captureTime ?? meta.expectedDisplayTime ?? null; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
}

function track(now) {
  if (!tracker || !T.cameraOn || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const capture = lastCaptureTime;
  const t0 = performance.now();
  const res = tracker.landmarker.detectForVideo(video, t0);
  const t1 = performance.now();
  T.inferMs = t1 - t0;
  T.latencyMs = capture && capture <= t1 && t1 - capture < 1000 ? t1 - capture : T.inferMs;
  T.detections++;
  const lm = res.landmarks && res.landmarks[0];
  if (lm) {
    const p = cfg.source === 'index' ? lm[8] : palmCenter(lm);
    T.rawY = p.y;
    T.filtY = euro.filter(p.y, t1 / 1000);
    T.handVisible = true; handLostSince = 0;
    const c = classify(lm); T.gesture = c.gesture; handleGesture(c.gesture, t1);
    if (performance.now() > touchActiveUntil) game.player.target = mapHandToZ(T.filtY);
  } else {
    if (!handLostSince) handLostSince = t1;
    T.handVisible = false; T.gesture = 'None'; handleGesture('None', t1);
    if (t1 - handLostSince > 300) euro.reset();
  }
  drawLandmarks(overlay, video, lm, T.gesture);
}

// ---------- start flow ----------
const status = (s) => { $('loadStatus').textContent = s; T.status = s; };
let running = false;
async function start() {
  $('btnStart').disabled = true;
  const camP = startCamera().catch((e) => { console.warn('camera unavailable', e); status('Camera unavailable: ' + e.name + ' — touch/drag mode'); });
  const trkP = createHandTracker(status).then((t) => { tracker = t; T.delegate = t.delegate; T.modelReady = true; })
    .catch((e) => { console.warn('hand model failed', e); T.errors.push('model:' + e); });
  await camP;   // camera permission must be requested from the tap
  $('start').classList.add('hidden');
  if (!running) { running = true; requestAnimationFrame(loop); }
  await trkP;
}
$('btnStart').onclick = start;
if (params.has('autostart')) start();

// ---------- main loop: fixed 120 Hz physics + interpolated render ----------
let last = performance.now(), acc = 0, fpsT = last, fpsN = 0;
const scoreP = $('sPlayer'), scoreA = $('sAI'), msg = $('msg');
function loop(now) {
  requestAnimationFrame(loop);
  track(now);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) { step(game, STEP); acc -= STEP; }
  const ghostZ = T.handVisible && T.filtY != null ? mapHandToZ(T.filtY) : null;
  view.draw(game, acc / STEP, ghostZ);
  T.frames++; fpsN++;
  if (now - fpsT > 500) { T.fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; hud(); }
  if (params.has('log') && T.frames % 15 === 0) T.log.push({ t: Math.round(now), rawY: T.rawY, z: +game.player.z.toFixed(3), g: T.gesture });
}
function hud() {
  scoreP.textContent = game.score.player; scoreA.textContent = game.score.ai;
  $('fps').textContent = T.fps.toFixed(0) + ' fps';
  $('lat').textContent = T.latencyMs != null ? `trk ${T.latencyMs.toFixed(0)} ms (inf ${T.inferMs.toFixed(0)})` : (T.modelReady ? 'trk — no cam' : 'trk loading…');
  $('gest').textContent = (T.delegate ? T.delegate + ' · ' : '') + T.gesture;
  $('handLost').classList.toggle('hidden', !T.cameraOn || !T.modelReady || T.handVisible || performance.now() - handLostSince < 250);
  let m = '';
  if (game.paused) m = '⏸ Paused — hold fist to resume';
  else if (game.state === 'serve') m = 'Open palm ✋ or pinch 🤏 (or tap) to serve';
  else if (game.state === 'over') m = (game.score.player >= WIN_SCORE ? 'You win! 🎉' : 'AI wins') + ' — serve to play again';
  else if (game.state === 'point') m = game.lastScorer === 'player' ? 'Point!' : 'AI scores';
  msg.textContent = m;
}
