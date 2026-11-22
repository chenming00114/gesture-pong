// Synthetic 21-point MediaPipe-style hand landmarks (raw camera coords, palm facing camera).
const T = [[0,0],[-0.35,-0.25],[-0.55,-0.45],[-0.7,-0.65],[-0.8,-0.85],[-0.25,-0.95],[-0.28,-1.3],[-0.3,-1.55],[-0.32,-1.75],
  [0,-1.0],[0,-1.4],[0,-1.65],[0,-1.85],[0.22,-0.95],[0.25,-1.3],[0.27,-1.52],[0.28,-1.7],[0.42,-0.85],[0.48,-1.1],[0.52,-1.28],[0.55,-1.42]];
// wx, wy: wrist position; pinch: 0 (open) .. 1 (thumb tip touching index tip); s: hand scale (palm length)
export function hand(wx, wy, pinch = 0, s = 0.12) {
  const pts = T.map(([x, y]) => [x, y]);
  const meet = [-0.52, -1.18];
  const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  pts[4] = lerp(pts[4], meet, pinch); pts[8] = lerp(pts[8], [meet[0] + 0.02, meet[1] - 0.04], pinch);
  pts[3] = lerp(pts[3], [-0.6, -0.95], pinch * 0.6); pts[7] = lerp(pts[7], [-0.45, -1.35], pinch * 0.6);
  return pts.map(([x, y]) => ({ x: wx + x * s, y: wy + y * s, z: 0 }));
}
// Scripted throw: open -> pinch (grab) -> pull back (down) -> fast flick up with slight lateral drift -> release.
export function throwSequence({ x0 = 0.55, rest = 0.62, back = 0.8, top = 0.36, drift = -0.03, flickFrames = 5, dtMs = 33 } = {}) {
  const f = [];
  const push = (wx, wy, p, phase) => f.push({ lm: hand(wx, wy, p), dt: dtMs, phase });
  for (let i = 0; i < 12; i++) push(x0, rest, 0, 'open');
  for (let i = 1; i <= 5; i++) push(x0, rest, i / 5, 'pinching');
  for (let i = 0; i < 6; i++) push(x0, rest, 1, 'holding');
  for (let i = 1; i <= 12; i++) push(x0, rest + (back - rest) * i / 12, 1, 'pullback');
  for (let i = 1; i <= flickFrames; i++) push(x0 + drift * i / flickFrames, back + (top - back) * i / flickFrames, 1, 'flick');
  push(x0 + drift * 1.1, top - 0.02, 0.4, 'release'); push(x0 + drift * 1.15, top - 0.025, 0, 'release');
  for (let i = 0; i < 8; i++) push(x0 + drift * 1.15, top - 0.025, 0, 'open-after');
  return f;
}
