// Beer pong ball physics: fixed-timestep, real-world units (meters, seconds). No external engine.
export const TABLE = { L: 2.44, W: 0.61, nearZ: 1.22, farZ: -1.22 };
export const CUP = { R: 0.046, Rb: 0.03, H: 0.12, rim: 0.004 };
export const BALL_R = 0.02;
export const G = 9.81;
export const STEP = 1 / 240;
const E_TABLE = 0.78, E_RIM = 0.5, E_WALL = 0.4;

// 10 cups, 4-3-2-1, apex toward table center. side: 'far' (opponent) | 'near' (player's own)
export function rack(side) {
  const cups = [], d = CUP.R * 2 + 0.004, rowDz = d * Math.sqrt(3) / 2;
  const back = side === 'far' ? TABLE.farZ + CUP.R + 0.03 : TABLE.nearZ - CUP.R - 0.03;
  const dir = side === 'far' ? 1 : -1;
  let id = 0;
  for (let row = 0; row < 4; row++) {
    const n = 4 - row;
    for (let i = 0; i < n; i++) cups.push({ id: `${side}${id++}`, side, x: (i - (n - 1) / 2) * d, z: back + dir * row * rowDz, alive: true });
  }
  return cups;
}

export function makeBall(p, v) { return { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, px: p.x, py: p.y, pz: p.z, t: 0, bounces: 0, rims: 0 }; }

// Advances the ball one step. Returns null or an event {type:'cup',cup} | {type:'out',reason}.
export function stepBall(b, cups, dt = STEP) {
  b.px = b.x; b.py = b.y; b.pz = b.z; b.t += dt;
  b.vy -= G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const r = BALL_R;

  // Cups (cylinder walls + torus rim at the top)
  let insideAnyCup = false;
  for (const c of cups) {
    if (!c.alive) continue;
    const dx = b.x - c.x, dz = b.z - c.z, h = Math.hypot(dx, dz);
    if (h > CUP.R + r + CUP.rim + 0.005 || b.y > CUP.H + r + CUP.rim + 0.01) continue;
    const nx = h > 1e-7 ? dx / h : 1, nz = h > 1e-7 ? dz / h : 0;
    // rim: closest point on the rim circle
    const ex = b.x - (c.x + nx * CUP.R), ey = b.y - CUP.H, ez = b.z - (c.z + nz * CUP.R);
    const dist = Math.hypot(ex, ey, ez), minD = r + CUP.rim;
    if (dist < minD && dist > 1e-7) {
      const ux = ex / dist, uy = ey / dist, uz = ez / dist;
      b.x += ux * (minD - dist); b.y += uy * (minD - dist); b.z += uz * (minD - dist);
      const vn = b.vx * ux + b.vy * uy + b.vz * uz;
      if (vn < 0) { b.vx -= (1 + E_RIM) * vn * ux; b.vy -= (1 + E_RIM) * vn * uy; b.vz -= (1 + E_RIM) * vn * uz; b.vx *= 0.9; b.vz *= 0.9; b.rims++; }
    }
    if (b.y < CUP.H) {
      const h2 = Math.hypot(b.x - c.x, b.z - c.z);
      if (h2 < CUP.R) {                 // inside the cup
        insideAnyCup = true;
        if (h2 > CUP.R - r) {           // inner wall
          b.x = c.x + nx * (CUP.R - r); b.z = c.z + nz * (CUP.R - r);
          const vr = b.vx * nx + b.vz * nz; if (vr > 0) { b.vx -= (1 + E_WALL) * vr * nx; b.vz -= (1 + E_WALL) * vr * nz; }
        }
        if (b.y < CUP.H - r * 1.5) { c.alive = false; return { type: 'cup', cup: c }; }
      } else if (h2 < CUP.R + r) {      // outer wall
        b.x = c.x + nx * (CUP.R + r); b.z = c.z + nz * (CUP.R + r);
        const vr = b.vx * nx + b.vz * nz; if (vr < 0) { b.vx -= (1 + E_WALL) * vr * nx; b.vz -= (1 + E_WALL) * vr * nz; }
      }
    }
  }

  // Table top
  const onTable = Math.abs(b.x) <= TABLE.W / 2 && b.z >= TABLE.farZ && b.z <= TABLE.nearZ;
  if (onTable && !insideAnyCup && b.y < r && b.py >= r - 0.02) {
    b.y = r;
    if (b.vy < 0) { b.vy = -b.vy * E_TABLE; b.vx *= 0.92; b.vz *= 0.92; b.bounces++; if (b.vy < 0.15) b.vy = 0; }
  }
  if (b.y < -0.4) return { type: 'out', reason: 'floor' };
  if (Math.abs(b.x) > 2 || b.z < -3 || b.z > 3.5) return { type: 'out', reason: 'away' };
  if (onTable && b.vy === 0 && Math.hypot(b.vx, b.vz) < 0.08) return { type: 'out', reason: 'stopped' };
  if (b.t > 5) return { type: 'out', reason: 'timeout' };
  return null;
}

// Simulate a whole throw without side effects on the given cups (copies them). Returns {event, path}.
export function simulate(p, v, cups, { maxT = 5, record = false } = {}) {
  const cs = cups.map((c) => ({ ...c })), b = makeBall(p, v), path = [];
  for (let t = 0; t < maxT; t += STEP) {
    const ev = stepBall(b, cs);
    if (record) path.push([b.x, b.y, b.z]);
    if (ev) return { event: ev, path, ball: b };
  }
  return { event: { type: 'out', reason: 'timeout' }, path, ball: b };
}

// Launch velocity that lands the ball at (tx, ty, tz) with elevation angle `angle` (radians), no drag.
export function solveLaunch(p, target, angle) {
  const dx = target.x - p.x, dz = target.z - p.z, D = Math.hypot(dx, dz), dy = target.y - p.y;
  const den = 2 * Math.cos(angle) ** 2 * (D * Math.tan(angle) - dy);
  if (den <= 0) return null;
  const v = Math.sqrt(G * D * D / den);
  const hx = dx / D, hz = dz / D;
  return { x: v * Math.cos(angle) * hx, y: v * Math.sin(angle), z: v * Math.cos(angle) * hz, speed: v };
}
