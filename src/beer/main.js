import { createGame, resetGame, step, launch, alive, assistThrow } from './game.js';
import { STEP, CUP, simulate, solveLaunch } from './physics.js';
import { createRenderer } from './render.js';
import { OneEuro } from '../oneEuro.js';
import { createHandTracker, drawLandmarks } from '../tracking.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- settings ----------
const DEFAULTS = { power: 1.0, aimGain: 1.0, arc: 45, assist: 0.7, minCutoff: 2.0, beta: 10, hint: true, aiAccuracy: 0.5, centerX: 0.5, centerY: 0.55,
  pinchOn: 0.3, pinchOff: 0.45, shadows: true };
const cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('bp-cfg') || '{}'));
const save = () => localStorage.setItem('bp-cfg', JSON.stringify(cfg));

const game = createGame();
const view = createRenderer($('scene'), game);
const fx = new OneEuro(cfg.minCutoff, cfg.beta), fy = new OneEuro(cfg.minCutoff, cfg.beta);

const K_SPEED = 1.4;            // m/s of ball speed per (frame-heights/s) of upward hand speed
const K_TOUCH = 0.9;            // touch swipes are faster in normalized units
const MIN_FLICK = 0.6;          // frame-heights/s; slower releases just drop the ball back
const VEL_WIN = 0.11, VEL_LOOKBACK = 0.26;   // s

const T = window.__bp = { game, cfg, handVisible: false, pinched: false, pinchRatio: null, holding: null, held: null,
  gestureState: 'no hand', lastThrow: null, delegate: null, modelReady: false, cameraOn: false, injecting: false,
  fps: 0, latencyMs: null, inferMs: null, errors: [], log: [], status: '' };
window.addEventListener('error', (e) => T.errors.push(String(e.message)));

// ---------- settings UI ----------
function bindRange(id, key, fmt = (v) => v) {
  const el = $(id), out = el.parentElement.querySelector('output');
  el.value = cfg[key]; out.textContent = fmt(cfg[key]);
  el.addEventListener('input', () => { cfg[key] = parseFloat(el.value); out.textContent = fmt(cfg[key]); apply(); save(); });
}
function apply() { for (const f of [fx, fy]) { f.minCutoff = cfg.minCutoff; f.beta = cfg.beta; } game.aiAccuracy = cfg.aiAccuracy; view.setShadows(cfg.shadows); }
bindRange('optPower', 'power'); bindRange('optAim', 'aimGain'); bindRange('optArc', 'arc', (v) => v + '°');
bindRange('optMin', 'minCutoff'); bindRange('optBeta', 'beta'); bindRange('optAI', 'aiAccuracy', (v) => Math.round(v * 100) + '%');
bindRange('optPinch', 'pinchOn'); bindRange('optAssist', 'assist', (v) => Math.round(v * 100) + '%');
$('optHint').checked = cfg.hint; $('optHint').onchange = (e) => { cfg.hint = e.target.checked; save(); };
$('optShadows').checked = cfg.shadows; $('optShadows').onchange = (e) => { cfg.shadows = e.target.checked; apply(); save(); };
$('gear').onclick = () => $('settings').classList.toggle('hidden');
$('btnClose').onclick = () => $('settings').classList.add('hidden');
$('btnReset').onclick = () => { localStorage.removeItem('bp-cfg'); location.reload(); };
$('btnRerack').onclick = () => { resetGame(game); $('settings').classList.add('hidden'); };
$('btnRecenter').onclick = () => { if (T.rawX != null) { cfg.centerX = +T.rawX.toFixed(3); cfg.centerY = +T.rawY.toFixed(3); save(); flash('Recentered on your hand'); } };
apply();

// ---------- throw mapping ----------
// Hand coords are raw camera-normalized (0..1, x not mirrored). Preview is mirrored, so user's right = smaller raw x.
function mapHeld(hx, hy) {
  return {
    x: clamp((cfg.centerX - hx) * 0.7 * cfg.aimGain, -0.28, 0.28),
    y: clamp(0.5 + (cfg.centerY - hy) * 0.6, 0.25, 0.85),
    z: 1.15 + clamp((hy - cfg.centerY) * 0.3, -0.1, 0.2),     // pulling the hand down also pulls the ball back
  };
}
// Peak upward velocity over sliding windows in the last VEL_LOOKBACK seconds before release.
function releaseVelocity(hist, tRel) {
  let best = null;
  const recent = hist.filter((s) => s.t >= tRel - VEL_LOOKBACK && s.t <= tRel + 1e-6);
  for (let j = recent.length - 1; j > 0; j--) {
    const b = recent[j]; let i = j - 1;
    while (i > 0 && b.t - recent[i].t < VEL_WIN) i--;
    const a = recent[i], dt = b.t - a.t; if (dt < 0.03) continue;
    const v = { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, dt };
    if (!best || -v.vy > -best.vy) best = v;
  }
  return best || { vx: 0, vy: 0, dt: 0 };
}
function throwVelocity(vxImg, sUp, scale = 1) {
  const speed = clamp(sUp * scale * K_SPEED * cfg.power, 1.2, 7.5), a = cfg.arc * Math.PI / 180;
  return { x: clamp(-vxImg * scale * 0.35 * cfg.aimGain, -1.2, 1.2), y: speed * Math.sin(a), z: -speed * Math.cos(a), speed };
}

// Power/aim assist: pull the throw toward the nearest cup it was "going for" (0 = pure physics, 1 = always on target).
const applyAssist = (from, raw) => assistThrow(from, raw, game.far, cfg.arc * Math.PI / 180, cfg.assist);

let thrownUntil = 0;
function release(hist, tRel, scale, source) {
  const held = T.held; T.holding = null; T.held = null;
  const rv = releaseVelocity(hist, tRel), sUp = -rv.vy * scale;
  if (sUp < MIN_FLICK || game.state !== 'aim') { flash('Too soft: pull back, then flick up fast and let go'); T.log.push({ drop: true, sUp, n: hist.length, ts: hist.slice(-8).map((s) => [+(s.t - tRel).toFixed(3), +s.y.toFixed(3)]) }); return null; }
  const raw = throwVelocity(rv.vx, -rv.vy, scale);
  const v = applyAssist(held, raw);
  launch(game, held, v, 'player');
  T.lastThrow = { source, rawSpeed: +raw.speed.toFixed(2), assistCup: v.cup, sUp: +sUp.toFixed(2), vxImg: +rv.vx.toFixed(2), speed: +v.speed.toFixed(2), v: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) }, from: held };
  T.lastSpeed = v.speed; thrownUntil = performance.now() + 900;
  T.log.push({ throw: T.lastThrow });
  return T.lastThrow;
}

// ---------- hand pipeline (camera or injected landmarks) ----------
const handHist = [];
let lostSince = 0;
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
function processHand(lm, tMs) {
  const t = tMs / 1000;
  if (!lm) {
    T.handVisible = false;
    if (!lostSince) lostSince = t;
    // fast flicks often blur out of tracking: treat losing the hand mid-flick as the release
    if (T.holding === 'hand') {
      const rv = releaseVelocity(handHist, t);
      if (-rv.vy > MIN_FLICK) release(handHist, t, 1, 'hand-lost');
      else if (t - lostSince > 0.4) { T.holding = null; T.held = null; }
    }
    if (t - lostSince > 0.3) { fx.reset(); fy.reset(); handHist.length = 0; T.pinched = false; }
    return;
  }
  lostSince = 0; T.handVisible = true;
  const ratio = d3(lm[4], lm[8]) / (d3(lm[0], lm[9]) || 1e-3);
  T.pinchRatio = ratio;
  const was = T.pinched;
  if (!was && ratio < cfg.pinchOn) T.pinched = true;
  else if (was && ratio > Math.max(cfg.pinchOff, cfg.pinchOn + 0.08)) T.pinched = false;
  const px = (lm[4].x + lm[8].x) / 2, py = (lm[4].y + lm[8].y) / 2;     // pinch point
  T.rawX = px; T.rawY = py;
  const sx = fx.filter(px, t), sy = fy.filter(py, t);
  handHist.push({ t, x: sx, y: sy }); while (handHist.length && handHist[0].t < t - 0.6) handHist.shift();

  if (T.pinched && !was) {
    if (game.state === 'aim' && game.turn === 'player' && !T.holding) { T.holding = 'hand'; T.log.push({ grab: 'hand', t: tMs }); }
    else if (game.state === 'won' || game.state === 'lost') resetGame(game);
  }
  if (T.holding === 'hand') T.held = mapHeld(sx, sy);
  if (!T.pinched && was && T.holding === 'hand') release(handHist, t, 1, 'hand');
}

// ---------- touch fallback: press, drag back, flick up, release ----------
const touchHist = []; const canvas = $('scene');
const touchToHand = (e) => ({ x: cfg.centerX - (e.clientX / innerWidth - 0.5) * 0.6, y: cfg.centerY + (e.clientY / innerHeight - 0.7) * 0.8 });
canvas.addEventListener('pointerdown', (e) => {
  if (game.state === 'won' || game.state === 'lost') { resetGame(game); return; }
  if (game.state !== 'aim' || game.turn !== 'player' || T.holding === 'hand') return;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  T.holding = 'touch'; touchHist.length = 0;
  const h = touchToHand(e); touchHist.push({ t: e.timeStamp / 1000, x: h.x, y: h.y }); T.held = mapHeld(h.x, h.y);
});
canvas.addEventListener('pointermove', (e) => {
  if (T.holding !== 'touch') return;
  const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];   // low-fps frames coalesce moves
  for (const ce of evs) { const h = touchToHand(ce); touchHist.push({ t: ce.timeStamp / 1000, x: h.x, y: h.y }); T.held = mapHeld(h.x, h.y); }
  while (touchHist.length > 120) touchHist.shift();
});
const endTouch = (e) => {
  if (T.holding !== 'touch') return;
  const h = touchToHand(e); touchHist.push({ t: e.timeStamp / 1000, x: h.x, y: h.y });
  release(touchHist, e.timeStamp / 1000, K_TOUCH, 'touch');
};
canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);

// ---------- camera + tracker ----------
const video = $('video'), overlay = $('overlay');
let tracker = null, lastVideoTime = -1, lastCaptureTime = null, lastLm = null;
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 60 } } });
  video.srcObject = stream; await video.play(); T.cameraOn = true;
  const fitPreview = () => { if (video.videoWidth) $('preview').style.aspectRatio = video.videoWidth + '/' + video.videoHeight; };
  video.addEventListener('resize', fitPreview); fitPreview();
  if ('requestVideoFrameCallback' in video) {
    const cb = (now, meta) => { lastCaptureTime = meta.captureTime ?? null; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
}
function track() {
  if (T.injecting || !tracker || !T.cameraOn || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const cap = lastCaptureTime, t0 = performance.now();
  const res = tracker.landmarker.detectForVideo(video, t0);
  const t1 = performance.now();
  T.inferMs = t1 - t0; T.latencyMs = cap && cap <= t1 && t1 - cap < 1000 ? t1 - cap : T.inferMs;
  lastLm = res.landmarks?.[0] || null;
  processHand(lastLm, t1);
  drawOverlay();
}
function drawOverlay() {
  drawLandmarks(overlay, video, lastLm, T.pinched ? 'Pinch' : 'None');
  if (!lastLm) return;
  const ctx = overlay.getContext('2d'), w = overlay.width, h = overlay.height, a = lastLm[4], b = lastLm[8];
  ctx.strokeStyle = T.pinched ? '#7aff9c' : '#ffdd33'; ctx.lineWidth = w / 60;
  ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
  if (T.pinched) { ctx.beginPath(); ctx.arc((a.x + b.x) / 2 * w, (a.y + b.y) / 2 * h, w / 18, 0, Math.PI * 2); ctx.stroke(); }
}

// ---------- start ----------
const status = (s) => { $('loadStatus').textContent = s; T.status = s; };
let running = false;
async function start() {
  $('btnStart').disabled = true;
  const camP = startCamera().catch((e) => { console.warn('camera unavailable', e); flash('No camera: press, pull down, flick up on the screen'); });
  const trkP = createHandTracker(status).then((t) => { tracker = t; T.delegate = t.delegate; T.modelReady = true; })
    .catch((e) => { console.warn('hand model failed', e); T.errors.push('model:' + e); });
  await camP;
  $('start').classList.add('hidden');
  if (!running) { running = true; requestAnimationFrame(loop); }
  await trkP;
}
$('btnStart').onclick = start;
if (params.has('autostart')) start();

// ---------- test hooks ----------
T.inject = (lm, tMs = performance.now()) => { T.injecting = true; lastLm = lm; processHand(lm, tMs); drawOverlay(); };
T.stopInject = () => { T.injecting = false; };
T.throwAt = (cupId, from = { x: 0, y: 0.5, z: 1.15 }) => {
  const c = game.far.find((k) => k.id === cupId && k.alive) || alive(game.far)[0];
  const v = solveLaunch(from, { x: c.x, y: CUP.H, z: c.z }, cfg.arc * Math.PI / 180);
  return launch(game, from, v, 'player') ? { cup: c.id, v } : null;
};

// ---------- loop ----------
let flashMsg = '', flashUntil = 0;
function flash(m) { flashMsg = m; flashUntil = performance.now() + 2200; }
let last = performance.now(), acc = 0, fpsT = last, fpsN = 0, lastEvents = 0;
function loop(now) {
  requestAnimationFrame(loop);
  track();
  let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
  acc += dt; while (acc >= STEP) { step(game, STEP); acc -= STEP; }
  for (; lastEvents < game.events.length; lastEvents++) { const e = game.events[lastEvents]; if (e.type === 'made' || e.type === 'miss') flash(game.lastResult); }
  // aim hint: path for the current held position at your last throw's power
  if (cfg.hint && game.state === 'aim' && game.turn === 'player') {
    const from = T.held || mapHeld(T.rawX ?? cfg.centerX, T.rawY ?? cfg.centerY);
    const sp = T.lastSpeed || 4.0, a = cfg.arc * Math.PI / 180;
    view.setHint(simulate(from, { x: 0, y: sp * Math.sin(a), z: -sp * Math.cos(a) }, game.far, { record: true, maxT: 1.5 }).path);
  } else view.setHint(null);
  view.draw(game, acc / STEP, T.holding ? T.held : null, dt);
  fpsN++; if (now - fpsT > 500) { T.fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; hud(now); }
}
function hud(now) {
  $('cupsOpp').textContent = alive(game.far).length; $('cupsMine').textContent = alive(game.near).length;
  $('balls').textContent = game.turn === 'player' ? '●'.repeat(game.ballsLeft) + '○'.repeat(2 - game.ballsLeft) : 'AI';
  $('fps').textContent = T.fps.toFixed(0) + ' fps';
  $('lat').textContent = T.latencyMs != null ? `trk ${T.latencyMs.toFixed(0)} ms (inf ${T.inferMs.toFixed(0)})` : (T.modelReady ? 'trk — no cam' : 'trk loading…');
  T.gestureState = now < thrownUntil ? 'thrown' : T.holding ? 'holding' : !T.handVisible ? 'no hand' : T.pinched ? 'pinched' : 'open';
  $('gest').textContent = (T.delegate ? T.delegate + ' · ' : '') + T.gestureState + (T.pinchRatio != null && T.handVisible ? ` (${T.pinchRatio.toFixed(2)})` : '');
  const badge = $('pinchBadge'); badge.textContent = T.pinched ? '🤏 PINCH' : T.handVisible ? '✋ open' : '—'; badge.className = T.pinched ? 'on' : '';
  $('handLost').classList.toggle('hidden', !T.cameraOn || !T.modelReady || T.handVisible || T.injecting);
  let m;
  if (now < flashUntil) m = flashMsg;
  else if (game.state === 'won') m = 'You cleared the table! 🏆 Pinch or tap to re-rack';
  else if (game.state === 'lost') m = 'AI cleared your cups. Pinch or tap to re-rack';
  else if (game.turn === 'ai') m = 'AI is throwing at your cups…';
  else if (T.holding) m = 'Pull back… flick up and let go!';
  else m = 'Pinch to grab the ball (or press on screen)';
  $('msg').textContent = m;
}
