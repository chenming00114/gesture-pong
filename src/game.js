// Fixed-timestep Pong physics on the table plane (x = length, z = paddle travel). Units: meters-ish.
export const FIELD = { L: 12, W: 9 };           // table length (ball travel) and width (paddle travel)
export const PADDLE = { len: 2.0, thick: 0.3, inset: 0.6 };
// Portrait phones get a taller table (more paddle travel on screen); call before createGame/createRenderer.
export function configureField(portrait) {
  if (portrait) { FIELD.L = 9; FIELD.W = 13; PADDLE.len = 2.4; } else { FIELD.L = 14; FIELD.W = 9; PADDLE.len = 2.0; }
  halfW = FIELD.W / 2; halfL = FIELD.L / 2; PADDLE_LIMIT = halfW - PADDLE.len / 2;
  playerX = -halfL + PADDLE.inset; aiX = halfL - PADDLE.inset;
}
export const BALL_R = 0.22;
const START_SPEED = 7, SPEED_UP = 1.045, MAX_SPEED = 19, MAX_ANGLE = 55 * Math.PI / 180;
export const WIN_SCORE = 7;
export const STEP = 1 / 120;

let halfW = FIELD.W / 2, halfL = FIELD.L / 2;
export let PADDLE_LIMIT = halfW - PADDLE.len / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createGame() {
  const g = {
    state: 'serve',              // 'serve' | 'play' | 'point' | 'over'
    paused: false,
    score: { player: 0, ai: 0 },
    ball: { x: 0, z: 0, vx: 0, vz: 0, px: 0, pz: 0 },
    player: { z: 0, pz: 0, target: 0 },
    ai: { z: 0, pz: 0, maxSpeed: 8.5, err: 0 },
    timer: 0, hits: 0, lastScorer: null, events: [],
    speed: START_SPEED,
  };
  placeBallOnPlayer(g);
  return g;
}

export let playerX = -halfL + PADDLE.inset, aiX = halfL - PADDLE.inset;

function placeBallOnPlayer(g) {
  g.ball.x = playerX + PADDLE.thick / 2 + BALL_R + 0.05; g.ball.z = g.player.z; g.ball.vx = g.ball.vz = 0;
}

export function serve(g) {
  if (g.paused) return false;
  if (g.state === 'over') { resetMatch(g); return true; }
  if (g.state !== 'serve') return false;
  const ang = (Math.random() * 2 - 1) * 0.35;
  g.speed = START_SPEED; g.hits = 0;
  g.ball.vx = Math.cos(ang) * g.speed; g.ball.vz = Math.sin(ang) * g.speed;
  g.state = 'play'; g.events.push('serve');
  return true;
}

export function resetMatch(g) {
  g.score.player = g.score.ai = 0; g.state = 'serve'; g.paused = false; placeBallOnPlayer(g);
}

function paddleBounce(g, paddleZ, dir) {
  const off = clamp((g.ball.z - paddleZ) / (PADDLE.len / 2 + BALL_R), -1, 1);
  g.speed = Math.min(MAX_SPEED, g.speed * SPEED_UP); g.hits++;
  const ang = off * MAX_ANGLE;
  g.ball.vx = dir * Math.cos(ang) * g.speed; g.ball.vz = Math.sin(ang) * g.speed;
  g.events.push('hit');
}

export function step(g, dt = STEP) {
  const b = g.ball;
  b.px = b.x; b.pz = b.z; g.player.pz = g.player.z; g.ai.pz = g.ai.z;
  if (g.paused) return;

  // Player paddle follows its target (from hand / touch) instantly, clamped.
  g.player.z = clamp(g.player.target, -PADDLE_LIMIT, PADDLE_LIMIT);

  // AI: chase the ball when it is coming, drift back to center otherwise; capped speed + aim error.
  let aiTarget = 0;
  if (g.state === 'play' && b.vx > 0) aiTarget = b.z + g.ai.err;
  else if (g.state === 'play') aiTarget = b.z * 0.3;
  const dz = aiTarget - g.ai.z, maxStep = g.ai.maxSpeed * dt;
  g.ai.z = clamp(g.ai.z + clamp(dz, -maxStep, maxStep), -PADDLE_LIMIT, PADDLE_LIMIT);

  if (g.state === 'serve') { placeBallOnPlayer(g); b.px = b.x; b.pz = b.z; return; }
  if (g.state === 'point' || g.state === 'over') {
    g.timer -= dt;
    if (g.state === 'point' && g.timer <= 0) { g.state = 'serve'; placeBallOnPlayer(g); b.px = b.x; b.pz = b.z; }
    return;
  }

  b.x += b.vx * dt; b.z += b.vz * dt;
  // Side walls
  if (b.z > halfW - BALL_R) { b.z = 2 * (halfW - BALL_R) - b.z; b.vz = -Math.abs(b.vz); g.events.push('wall'); }
  if (b.z < -halfW + BALL_R) { b.z = 2 * (-halfW + BALL_R) - b.z; b.vz = Math.abs(b.vz); g.events.push('wall'); }

  const reach = PADDLE.len / 2 + BALL_R;
  // Player paddle face
  const pFace = playerX + PADDLE.thick / 2 + BALL_R;
  if (b.vx < 0 && b.x <= pFace && b.px >= pFace - 0.4 && Math.abs(b.z - g.player.z) <= reach) {
    b.x = pFace; paddleBounce(g, g.player.z, +1);
    g.ai.err = (Math.random() * 2 - 1) * (0.4 + 0.08 * g.hits);  // AI gets sloppier as rally speeds up
  }
  const aFace = aiX - PADDLE.thick / 2 - BALL_R;
  if (b.vx > 0 && b.x >= aFace && b.px <= aFace + 0.4 && Math.abs(b.z - g.ai.z) <= reach) {
    b.x = aFace; paddleBounce(g, g.ai.z, -1);
  }
  // Scoring
  if (b.x < -halfL - 1) pointTo(g, 'ai');
  else if (b.x > halfL + 1) pointTo(g, 'player');
}

function pointTo(g, who) {
  g.score[who]++; g.lastScorer = who; g.events.push('point:' + who);
  if (g.score[who] >= WIN_SCORE) { g.state = 'over'; g.timer = 0; }
  else { g.state = 'point'; g.timer = 0.9; }
  g.ball.vx = g.ball.vz = 0;
}
