// Physics checks for beer pong: deterministic cases + randomized throw statistics.
import { rack, simulate, solveLaunch, CUP, BALL_R } from '../src/beer/physics.js';
import { assistThrow } from '../src/beer/game.js';
const cups = rack('far');
const res = {};
const show = (name, r) => (res[name] = r.event.type === 'cup' ? `made ${r.event.cup.id}` : `${r.event.type}:${r.event.reason} (bounces ${r.ball.bounces}, rim hits ${r.ball.rims})`);
const c0 = cups[0], apex = cups[9];
show('drop straight into cup center', simulate({ x: c0.x, y: 0.4, z: c0.z }, { x: 0, y: 0, z: 0 }, cups));
show('drop onto rim edge', simulate({ x: apex.x + CUP.R + 0.004, y: 0.4, z: apex.z }, { x: 0, y: 0, z: 0 }, cups));
show('drop next to cup (table)', simulate({ x: apex.x, y: 0.4, z: apex.z + 0.12 }, { x: 0, y: 0, z: 0 }, cups));
const from = { x: 0, y: 0.32, z: 1.3 };
for (const c of [apex, cups[5], cups[0], cups[3]]) {
  const v = solveLaunch(from, { x: c.x, y: CUP.H, z: c.z }, 50 * Math.PI / 180);
  show(`solved 50deg throw at ${c.id} (v=${v.speed.toFixed(2)} m/s)`, simulate(from, v, cups));
}
show('way too weak (lands short)', simulate(from, { x: 0, y: 2.5, z: -2.0 }, cups));
show('way too strong (flies long)', simulate(from, { x: 0, y: 4.5, z: -4.5 }, cups));
// Randomized: aim at a random cup with N(0, sigma) target error
const stats = {};
for (const sigma of [0.0, 0.02, 0.05, 0.1]) {
  let made = 0, rim = 0, N = 1000;
  for (let i = 0; i < N; i++) {
    const c = cups[Math.floor(Math.random() * cups.length)];
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sigma; // ~normal
    const v = solveLaunch(from, { x: c.x + g(), y: CUP.H, z: c.z + g() }, 50 * Math.PI / 180);
    const r = simulate(from, v, cups);
    if (r.event.type === 'cup') made++; if (r.ball.rims) rim++;
  }
  stats[`sigma ${sigma} m`] = `${(100 * made / N).toFixed(1)}% made, ${(100 * rim / N).toFixed(1)}% touched a rim`;
}
// Player-style throws: 45deg arc from a typical release point, speed 3.6-4.5 m/s, lateral -0.15..0.15 m/s, with assist levels
const assist = {}; const from2 = { x: 0, y: 0.7, z: 1.05 }, a45 = Math.PI / 4;
for (const k of [0, 0.5, 0.7, 1]) {
  let made = 0, N = 1000;
  for (let i = 0; i < N; i++) {
    const sp = 3.6 + Math.random() * 0.9, vx = (Math.random() - 0.5) * 0.3;
    const raw = { x: vx, y: sp * Math.sin(a45), z: -sp * Math.cos(a45), speed: Math.hypot(vx, sp) };
    const v = assistThrow(from2, raw, cups, a45, k);
    if (simulate(from2, v, cups).event.type === 'cup') made++;
  }
  assist[`assist ${k}`] = `${(100 * made / N).toFixed(1)}% made`;
}
console.log(JSON.stringify({ cases: res, randomized: stats, playerThrowsWithAssist: assist }, null, 1));
