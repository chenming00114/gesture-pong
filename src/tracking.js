import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

export async function createHandTracker(onStatus = () => {}) {
  const base = new URL('./', document.baseURI).href;
  onStatus('loading wasm…');
  const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: base + 'models/hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let landmarker, delegate = 'GPU';
  try { onStatus('loading model (GPU)…'); landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch (e) { console.warn('GPU delegate failed, falling back to CPU', e); delegate = 'CPU'; onStatus('loading model (CPU)…'); landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
  onStatus('model ready (' + delegate + ')');
  return { landmarker, delegate };
}

// Cheap landmark heuristics for gestures (avoids running a second model on phones).
export function classify(lm) {
  const palm = d(lm[0], lm[9]) || 1e-3;
  const ext = (tip, pip) => d(lm[0], lm[tip]) > d(lm[0], lm[pip]) * 1.15;
  const fingers = [ext(8, 6), ext(12, 10), ext(16, 14), ext(20, 18)];
  const nExt = fingers.filter(Boolean).length;
  const pinchRatio = d(lm[4], lm[8]) / palm;
  const curled = (tip, mcp) => d(lm[0], lm[tip]) < d(lm[0], lm[mcp]) * 1.25;
  const nCurled = [curled(8, 5), curled(12, 9), curled(16, 13), curled(20, 17)].filter(Boolean).length;
  let gesture = 'None';
  if (pinchRatio < 0.3 && fingers[1]) gesture = 'Pinch';           // thumb-index touch, middle finger still out
  else if (nExt === 4 && d(lm[4], lm[5]) / palm > 0.45) gesture = 'Open_Palm';
  else if (nCurled >= 4) gesture = 'Closed_Fist';
  else if (pinchRatio < 0.3) gesture = 'Pinch';
  return { gesture, pinchRatio, nExt };
}

export function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17]; let x = 0, y = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; }
  return { x: x / ids.length, y: y / ids.length };
}

export function drawLandmarks(canvas, video, lm, gesture) {
  const w = video.videoWidth || 640, h = video.videoHeight || 480;
  if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = Math.max(2, w / 160); ctx.strokeStyle = gesture === 'Closed_Fist' ? '#ff7a7a' : gesture === 'Pinch' || gesture === 'Open_Palm' ? '#7aff9c' : '#5cf2ff';
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(2.5, w / 120), 0, Math.PI * 2); ctx.fill(); }
  const c = palmCenter(lm); ctx.fillStyle = '#ffdd33'; ctx.beginPath(); ctx.arc(c.x * w, c.y * h, w / 50, 0, Math.PI * 2); ctx.fill();
}
