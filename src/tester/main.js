import { createHandTracker, drawLandmarks } from '../tracking.js';
import { SEQUENCES, SequenceTester, extractFeatures } from './sequences.js';
import { drawGraphs } from './graphs.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const tester = new SequenceTester(params.get('seq') || 'arc');
const video = $('video'), overlay = $('overlay'), graphCanvas = $('graphs');

let tracker = null, cameraOn = false, running = false, injecting = false;
let lastVideoTime = -1, lastCap = null, lastLm = null;
let fpsT = performance.now(), fpsN = 0, fps = 0, inferMs = null, latMs = null;

// Trace recorder (both rolling 5 s buffer and explicit session recording)
const rollingTrace = [];
let sessionRec = false;
let sessionTrace = [];

const T = window.__tester = {
  tester, SEQUENCES, modelReady: false, cameraOn: false, delegate: null, errors: [],
  lastPhase: 'IDLE', lastCoach: '', lastThrow: null, throws: tester.throws,
  inject: null, stopInject: null, exportTrace: null,
};
window.addEventListener('error', (e) => T.errors.push(String(e.message)));

// ---------- Sequence tabs & step pills ----------
const tabsEl = $('seqTabs'), stepsEl = $('phaseSteps'), seqDescEl = $('seqDesc');
function renderSeqUI() {
  const spec = tester.getSpec();
  tabsEl.innerHTML = '';
  for (const id of Object.keys(SEQUENCES)) {
    const b = document.createElement('button');
    b.textContent = SEQUENCES[id].name;
    b.className = id === tester.seqId ? 'active' : '';
    b.onclick = () => { tester.setSequence(id); renderSeqUI(); renderSteps(); };
    tabsEl.appendChild(b);
  }
  seqDescEl.textContent = spec.short;
  renderSteps();
}
function renderSteps() {
  const spec = tester.getSpec();
  const idx = spec.steps.indexOf(tester.phase);
  stepsEl.innerHTML = '';
  spec.steps.forEach((st, i) => {
    const sp = document.createElement('span');
    sp.textContent = st;
    if (i < idx) sp.className = 'on';
    else if (i === idx) sp.className = 'curr';
    stepsEl.appendChild(sp);
  });
}
renderSeqUI();

// ---------- Throw summary cards ----------
const throwsEl = $('throwsList');
function renderThrows() {
  if (!tester.throws.length) {
    throwsEl.innerHTML = '<p class="small">No throws detected yet. Pinch, wind up, flick, and open your fingers to test.</p>';
    return;
  }
  throwsEl.innerHTML = '';
  for (const r of tester.throws) {
    const card = document.createElement('div');
    card.className = 'tcard' + (r.valid ? '' : ' bad');
    const timing = `${r.dtPeakMs >= 0 ? '+' : ''}${r.dtPeakMs} ms vs peak`;
    card.innerHTML = `
      <div class="top">
        <span>${r.valid ? '✅ VALID' : '❌ INVALID'} · ${r.seqName}</span>
        <span>${r.speedMs} m/s (${r.aimDir})</span>
      </div>
      <div class="meta">
        <div>${r.reason}</div>
        <div>Peak: <b>${r.peakSpeed}</b> (${r.direction}) · Release: <b>${timing}</b> · Hold: ${r.holdDurationMs} ms · Wind-up: ${r.windupReached ? 'yes' : 'no'}</div>
        <div>Would-be shot: ${r.simResult} (vx=${r.vxWorld} m/s)</div>
      </div>`;
    throwsEl.appendChild(card);
  }
}
renderThrows();

// ---------- Landmark drawing ----------
function drawTesterOverlay(lm) {
  drawLandmarks(overlay, video, lm, tester.pinched ? 'Pinch' : 'None');
  if (!lm) return;
  const ctx = overlay.getContext('2d'), w = overlay.width, h = overlay.height;
  // Thumb-index pinch line
  const a = lm[4], b = lm[8];
  ctx.strokeStyle = tester.pinched ? '#7aff9c' : '#ffd166';
  ctx.lineWidth = Math.max(3, w / 80);
  ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
  if (tester.pinched) {
    ctx.beginPath(); ctx.arc((a.x + b.x) / 2 * w, (a.y + b.y) / 2 * h, w / 20, 0, Math.PI * 2); ctx.stroke();
  }
  // Wrist -> middle MCP vector
  ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = Math.max(2, w / 110);
  ctx.beginPath(); ctx.moveTo(lm[0].x * w, lm[0].y * h); ctx.lineTo(lm[9].x * w, lm[9].y * h); ctx.stroke();
}

// ---------- Per-frame step ----------
function handleFrame(lm, tMs) {
  const prevPhase = tester.phase;
  const out = tester.step(lm, tMs);
  T.lastPhase = out.phase;
  T.lastCoach = out.coach;
  if (out.phase !== prevPhase) renderSteps();

  const rec = { tMs: Math.round(tMs), phase: out.phase, pinched: tester.pinched, lm: lm ? lm.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.z ?? 0).toFixed(4)]) : null, features: out.sample ? {
    pinch: +out.sample.pinchRatio.toFixed(3), x: +out.sample.sx.toFixed(3), y: +out.sample.sy.toFixed(3),
    size: +out.sample.ss.toFixed(3), wristDeg: +out.sample.sa.toFixed(1),
    vx: +out.sample.vx.toFixed(2), vy: +out.sample.vy.toFixed(2), vSize: +out.sample.vSize.toFixed(3), flick: +out.sample.flickSpeed.toFixed(2),
  } : null };
  rollingTrace.push(rec);
  while (rollingTrace.length > 240) rollingTrace.shift();
  if (sessionRec) sessionTrace.push(rec);

  if (out.throwEvent) {
    T.lastThrow = out.throwEvent;
    renderThrows();
  }

  // Readouts & coach
  const s = out.sample;
  $('rPinch').textContent = s ? `${s.pinchRatio.toFixed(2)} (3f:${s.pinch3Ratio.toFixed(2)})` : '—';
  $('rXY').textContent = s ? `${s.sx.toFixed(2)}, ${s.sy.toFixed(2)}` : '—';
  $('rSize').textContent = s ? `${s.ss.toFixed(3)} (${s.vSize >= 0 ? '+' : ''}${s.vSize.toFixed(2)}/s)` : '—';
  $('rWrist').textContent = s ? `${s.sa.toFixed(0)}° (${s.vFlex >= 0 ? '+' : ''}${s.vFlex.toFixed(0)}°/s)` : '—';
  $('rVel').textContent = s ? `up:${(-s.vy).toFixed(2)} x:${s.vx.toFixed(2)}` : '—';
  $('rDrive').textContent = s ? `${s.flickSpeed.toFixed(2)} / ${tester.getSpec().minSpeed.toFixed(2)}` : '—';

  const coachEl = $('coach');
  coachEl.textContent = out.coach;
  coachEl.className = 'coach' + (out.phase === 'RELEASE' && tester.lastResult ? (tester.lastResult.valid ? ' good' : ' bad') : '');

  drawTesterOverlay(lm);
  drawGraphs(graphCanvas, tester.hist, tester.getSpec(), tMs / 1000);
}

// ---------- Camera & MediaPipe ----------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 60 } } });
  video.srcObject = stream; await video.play();
  cameraOn = true; T.cameraOn = true;
  if ('requestVideoFrameCallback' in video) {
    const cb = (_now, meta) => { lastCap = meta.captureTime ?? null; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
}

async function init() {
  $('btnStart').disabled = true;
  const status = (s) => { $('camStatus').textContent = s; };
  const camP = startCamera().catch((e) => { status('Camera unavailable (' + e.name + ') — use Demo button'); });
  const trkP = createHandTracker(status).then((t) => { tracker = t; T.delegate = t.delegate; T.modelReady = true; })
    .catch((e) => { T.errors.push('model:' + e); status('Model failed: ' + e.message); });
  await camP;
  if (!running) { running = true; requestAnimationFrame(loop); }
  await trkP;
}
$('btnStart').onclick = init;
if (params.has('autostart')) init();

function loop(now) {
  requestAnimationFrame(loop);
  if (!injecting && tracker && cameraOn && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const cap = lastCap, t0 = performance.now();
    const res = tracker.landmarker.detectForVideo(video, t0);
    const t1 = performance.now();
    inferMs = t1 - t0;
    latMs = cap && cap <= t1 && t1 - cap < 1000 ? t1 - cap : inferMs;
    lastLm = res.landmarks?.[0] || null;
    handleFrame(lastLm, t1);
  } else if (tester.hist.length && !injecting) {
    drawGraphs(graphCanvas, tester.hist, tester.getSpec(), now / 1000);
  }
  fpsN++;
  if (now - fpsT > 500) {
    fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now;
    $('camStats').textContent = `${fps.toFixed(0)} fps · ${T.delegate || '—'} · trk ${latMs != null ? latMs.toFixed(0) + ' ms' : '—'}`;
  }
}

// ---------- Trace recording & JSON download ----------
function buildPayload() {
  const frames = sessionTrace.length ? sessionTrace : rollingTrace;
  return {
    exportedAt: new Date().toISOString(),
    sequence: tester.seqId,
    userAgent: navigator.userAgent,
    throws: tester.throws,
    frameCount: frames.length,
    frames,
  };
}
T.exportTrace = buildPayload;

function downloadJSON(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('btnRec').onclick = () => {
  if (!sessionRec) {
    sessionRec = true; sessionTrace = [];
    $('btnRec').textContent = '⏹ Stop & Download JSON'; $('btnRec').classList.add('rec');
  } else {
    sessionRec = false;
    $('btnRec').textContent = '⏺ Record Session'; $('btnRec').classList.remove('rec');
    downloadJSON(buildPayload(), `gesture-trace-${tester.seqId}-${Date.now()}.json`);
  }
};
$('btnDownload').onclick = () => downloadJSON(buildPayload(), `gesture-trace-${tester.seqId}-${Date.now()}.json`);
$('btnClear').onclick = () => { tester.throws.length = 0; tester.hist.length = 0; tester.resetState(); rollingTrace.length = 0; sessionTrace.length = 0; renderSteps(); renderThrows(); };

// ---------- Synthetic demo & test hook ----------
T.inject = (lm, tMs = performance.now()) => { injecting = true; lastLm = lm; handleFrame(lm, tMs); };
T.stopInject = () => { injecting = false; };

$('btnDemo').onclick = () => {
  // Play a built-in synthetic Arc throw so Justin can watch the state machine & graphs even without throwing
  const T0 = [[0,0],[-0.35,-0.25],[-0.55,-0.45],[-0.7,-0.65],[-0.8,-0.85],[-0.25,-0.95],[-0.28,-1.3],[-0.3,-1.55],[-0.32,-1.75],
    [0,-1.0],[0,-1.4],[0,-1.65],[0,-1.85],[0.22,-0.95],[0.25,-1.3],[0.27,-1.52],[0.28,-1.7],[0.42,-0.85],[0.48,-1.1],[0.52,-1.28],[0.55,-1.42]];
  const mk = (wx, wy, p, s = 0.12, dz = 0) => T0.map(([x, y], idx) => {
    let px = x, py = y;
    const meet = [-0.52, -1.18];
    if (idx === 4) { px += (meet[0] - px) * p; py += (meet[1] - py) * p; }
    if (idx === 8) { px += (meet[0] + 0.02 - px) * p; py += (meet[1] - 0.04 - py) * p; }
    return { x: wx + px * s, y: wy + py * s, z: idx === 9 ? dz : 0 };
  });
  const base = performance.now();
  let k = 0;
  const run = () => {
    const t = base + k * 33;
    let lm;
    if (k < 8) lm = mk(0.55, 0.60, 0, 0.12, 0);
    else if (k < 13) lm = mk(0.55, 0.60, (k - 7) / 5, 0.12, 0);
    else if (k < 24) { const u = (k - 12) / 11; lm = mk(0.55, 0.60 + 0.18 * u, 1, 0.12 - 0.02 * u, 0.05 * u); }
    else if (k < 29) { const u = (k - 23) / 5; lm = mk(0.55 - 0.03 * u, 0.78 - 0.36 * u, 1, 0.10 + 0.06 * u, 0.05 - 0.11 * u); }
    else if (k < 38) lm = mk(0.52, 0.40, 0, 0.16, -0.06);
    else { T.stopInject(); return; }
    T.inject(lm, t);
    k++;
    setTimeout(run, 33);
  };
  run();
};
