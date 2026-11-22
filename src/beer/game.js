// Beer pong turn logic. Player throws 2 balls, then AI throws 2 at the player's cups.
import { rack, makeBall, stepBall, solveLaunch, CUP, STEP } from './physics.js';

export const AI_FROM = { x: 0, y: 0.34, z: -1.42 };
export const AI_ANGLE = 50 * Math.PI / 180;

export function createGame() {
  const g = { far: rack('far'), near: rack('near'), turn: 'player', state: 'aim', ballsLeft: 2, ball: null,
    lastResult: '', aiTimer: 0, aiAccuracy: 0.5, madeByPlayer: 0, madeByAI: 0, events: [], throws: 0 };
  return g;
}
export const alive = (cups) => cups.filter((c) => c.alive);

export function resetGame(g) { Object.assign(g, createGame(), { aiAccuracy: g.aiAccuracy }); }

// Launch a ball (player or AI). p, v in world units.
export function launch(g, p, v, by = g.turn) {
  if (g.state !== 'aim' && !(by === 'ai' && g.state === 'ai-wait')) return false;
  g.ball = makeBall(p, v); g.ball.by = by; g.state = 'flight'; g.throws++;
  g.events.push({ type: 'throw', by, p: { ...p }, v: { ...v } });
  return true;
}

function aiThrow(g) {
  const targets = alive(g.near); if (!targets.length) return;
  const c = targets[Math.floor(Math.random() * targets.length)];
  const sigma = (1 - g.aiAccuracy) * 0.14 + 0.005;
  const n = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sigma;
  const from = { ...AI_FROM, x: (Math.random() - 0.5) * 0.2 };
  const v = solveLaunch(from, { x: c.x + n(), y: CUP.H, z: c.z + n() }, AI_ANGLE);
  launch(g, from, v, 'ai');
}

function endBall(g, ev) {
  const by = g.ball.by;
  const made = ev.type === 'cup';
  if (made) { by === 'player' ? g.madeByPlayer++ : g.madeByAI++; }
  g.lastResult = made ? (by === 'player' ? 'SPLASH! Cup made 🍺' : 'AI sank one of your cups') : (by === 'player' ? 'Miss' : 'AI missed');
  g.events.push({ type: made ? 'made' : 'miss', by, cup: made ? ev.cup.id : null, reason: ev.reason });
  g.ball.done = true; g.ballsLeft--;
  if (!alive(g.far).length) { g.state = 'won'; return; }
  if (!alive(g.near).length) { g.state = 'lost'; return; }
  if (g.ballsLeft > 0) { g.state = by === 'player' ? 'aim' : 'ai-wait'; g.aiTimer = 0.9; return; }
  // switch turns
  if (by === 'player') { g.turn = 'ai'; g.state = 'ai-wait'; g.aiTimer = 1.2; }
  else { g.turn = 'player'; g.state = 'aim'; }
  g.ballsLeft = 2;
}

export function step(g, dt = STEP) {
  if (g.state === 'flight' && g.ball) {
    const ev = stepBall(g.ball, g.ball.by === 'player' ? g.far : g.near, dt);
    if (ev) { g.resolveDelay = 0.45; g.pendingEv = ev; g.state = 'settle'; }
  } else if (g.state === 'settle') {
    if (g.ball && g.pendingEv.type !== 'cup') { g.ball.px = g.ball.x; g.ball.py = g.ball.y; g.ball.pz = g.ball.z; }
    g.resolveDelay -= dt; if (g.resolveDelay <= 0) endBall(g, g.pendingEv);
  } else if (g.state === 'ai-wait') {
    g.aiTimer -= dt; if (g.aiTimer <= 0) aiThrow(g);
  }
}

// Power/aim assist: pull a throw toward the cup it was "going for" (k: 0 = pure physics, 1 = always on target).
export function assistThrow(from, raw, cups, arc, k) {
  if (!(k > 0)) return raw;
  let best = null;
  for (const c of alive(cups)) {
    const ideal = solveLaunch(from, { x: c.x, y: CUP.H, z: c.z }, arc); if (!ideal) continue;
    const tFlight = Math.abs(c.z - from.z) / Math.max(0.1, -raw.z);
    const xLand = from.x + raw.x * tFlight;
    const cost = Math.abs(ideal.speed - raw.speed) / 0.35 + Math.abs(xLand - c.x) / 0.08;
    if (!best || cost < best.cost) best = { cost, ideal, c };
  }
  if (!best || best.cost > 4) return raw;          // way off target: no help
  const i = best.ideal;
  const v = { x: raw.x + (i.x - raw.x) * k, y: raw.y + (i.y - raw.y) * k, z: raw.z + (i.z - raw.z) * k };
  v.speed = Math.hypot(v.x, v.y, v.z); v.cup = best.c.id; return v;
}
