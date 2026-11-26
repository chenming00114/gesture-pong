import { OneEuro } from '../oneEuro.js';
import { simulate, rack } from '../beer/physics.js';

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const SEQUENCES = {
  arc: {
    id: 'arc',
    name: 'Arc Snap (Recommended)',
    short: 'Pinch → Wind-up (pull back/down or eye level) → Up/forward snap → Open mid-snap',
    steps: ['IDLE', 'GRAB', 'WINDUP', 'FLICK', 'RELEASE'],
    pinchOn: 0.34,
    pinchOff: 0.45,
    minSpeed: 0.75,
    maxLateMs: 140,
  },
  dart: {
    id: 'dart',
    name: 'Dart Push (Depth + Wrist)',
    short: 'Pinch → Cock wrist back → Push toward camera + wrist snap → Release',
    steps: ['IDLE', 'GRAB', 'COCK', 'PUSH', 'RELEASE'],
    pinchOn: 0.34,
    pinchOff: 0.45,
    minSpeed: 0.22,   // palmSize growth /s (or wrist flex)
    maxLateMs: 140,
  },
  underhand: {
    id: 'underhand',
    name: 'Current Game (Underhand)',
    short: 'Matches live game: Pinch (<0.30) → Pull down → Flick up (-vy>0.60) → Release (>0.45)',
    steps: ['IDLE', 'GRAB', 'PULLBACK', 'FLICK', 'RELEASE'],
    pinchOn: 0.30,
    pinchOff: 0.45,
    minSpeed: 0.60,
    maxLateMs: 180,
  },
};

export function extractFeatures(lm) {
  const palmSize = d2(lm[0], lm[9]) || 1e-3;
  const palm3d = d3(lm[0], lm[9]) || 1e-3;
  const pinchRatio = d3(lm[4], lm[8]) / palm3d;
  const pinch3Ratio = Math.min(d3(lm[4], lm[8]), d3(lm[4], lm[12])) / palm3d;
  const hx = (lm[4].x + lm[8].x) / 2;
  const hy = (lm[4].y + lm[8].y) / 2;
  // Wrist pitch/flex: 0 deg = upright facing camera; negative = cocked back; positive = snapped forward toward screen.
  const dz = (lm[9].z ?? 0) - (lm[0].z ?? 0);
  const dy = Math.max(0.015, lm[0].y - lm[9].y);
  const wristFlex = Math.atan2(-dz, dy) * (180 / Math.PI);
  return { hx, hy, palmSize, pinchRatio, pinch3Ratio, wristFlex };
}

function estimateThrowOutcome(speedMs, vxImg) {
  const arcRad = 45 * (Math.PI / 180);
  const from = { x: 0, y: 0.7, z: 1.05 };
  const vxWorld = clamp(-vxImg * 0.35, -1.2, 1.2);
  const v = { x: vxWorld, y: speedMs * Math.sin(arcRad), z: -speedMs * Math.cos(arcRad) };
  const cups = rack('far');
  const sim = simulate(from, v, cups, { maxT: 3.5 });
  const aimDir = vxWorld < -0.15 ? 'left' : vxWorld > 0.15 ? 'right' : 'center';
  return {
    speedMs: +speedMs.toFixed(2),
    vxWorld: +vxWorld.toFixed(2),
    aimDir,
    simResult: sim.event.type === 'cup' ? `Would sink ${sim.event.cup.id}!` : `Table sim: ${sim.event.reason}`,
  };
}

export class SequenceTester {
  constructor(seqId = 'arc') {
    this.seqId = seqId;
    this.fx = new OneEuro(2.0, 10);
    this.fy = new OneEuro(2.0, 10);
    this.fs = new OneEuro(1.5, 4);
    this.fa = new OneEuro(1.5, 4);
    this.hist = [];          // rolling samples (~3 s)
    this.throws = [];        // recent evaluated throws
    this.resetState();
  }

  setSequence(id) {
    if (!SEQUENCES[id]) return;
    this.seqId = id;
    this.resetState();
  }

  resetState() {
    this.phase = 'IDLE';
    this.pinched = false;
    this.grabInfo = null;
    this.windupReached = false;
    this.peak = null;        // { t, speed, vx, vy, vSize, vFlex, flickSpeed }
    this.holdSamples = [];
    this.lastResult = null;
    this.cooldownUntil = 0;
    this.lostSince = 0;
  }

  getSpec() { return SEQUENCES[this.seqId]; }

  // Speed metric per candidate sequence at sample `s`
  driveSpeed(s) {
    if (this.seqId === 'arc') {
      // Combine upward hand speed (-vy) and forward camera push (+vSize scaled)
      const up = Math.max(0, -s.vy);
      const fwd = Math.max(0, s.vSize * 3.0);
      return Math.hypot(up, fwd);
    }
    if (this.seqId === 'dart') {
      // Forward push toward camera (+vSize) + wrist forward snap (+vFlex)
      return Math.max(0, s.vSize) + Math.max(0, s.vFlex / 240);
    }
    return Math.max(0, -s.vy);
  }

  step(lm, tMs) {
    const t = tMs / 1000;
    const spec = this.getSpec();
    if (!lm) {
      if (!this.lostSince) this.lostSince = t;
      // If hand blurs out mid-flick while holding, evaluate as blur-release
      if (this.pinched && this.peak && this.peak.speed >= spec.minSpeed && (t - this.peak.t) < 0.2) {
        const res = this.evaluateRelease(t, 'blur-release');
        this.resetState();
        this.lastResult = res;
        this.cooldownUntil = t + 0.9;
        return { sample: null, phase: this.phase, coach: this.coach(t), throwEvent: res };
      }
      if (t - this.lostSince > 0.35) {
        this.fx.reset(); this.fy.reset(); this.fs.reset(); this.fa.reset();
        this.resetState();
      }
      return { sample: null, phase: this.phase, coach: 'Show your throwing hand to the camera', throwEvent: null };
    }
    this.lostSince = 0;

    const raw = extractFeatures(lm);
    const sx = this.fx.filter(raw.hx, t);
    const sy = this.fy.filter(raw.hy, t);
    const ss = this.fs.filter(raw.palmSize, t);
    const sa = this.fa.filter(raw.wristFlex, t);

    // Compute velocity over ~75-110 ms lookback
    let vx = 0, vy = 0, vSize = 0, vFlex = 0;
    const prev = this.findLookback(t, 0.09);
    if (prev) {
      const dt = Math.max(0.02, t - prev.t);
      vx = (sx - prev.sx) / dt;
      vy = (sy - prev.sy) / dt;
      vSize = (ss - prev.ss) / dt;
      vFlex = (sa - prev.sa) / dt;
    }

    const s = { t, tMs, ...raw, sx, sy, ss, sa, vx, vy, vSize, vFlex, flickSpeed: 0 };
    s.flickSpeed = this.driveSpeed(s);
    this.hist.push(s);
    while (this.hist.length && this.hist[0].t < t - 3.0) this.hist.shift();

    // Pinch hysteresis
    const wasPinched = this.pinched;
    if (!wasPinched && raw.pinchRatio < spec.pinchOn) this.pinched = true;
    else if (wasPinched && raw.pinchRatio > spec.pinchOff) this.pinched = false;

    let throwEvent = null;

    if (this.pinched && !wasPinched) {
      this.phase = 'GRAB';
      this.grabInfo = { t, sx, sy, ss, sa };
      this.windupReached = false;
      this.peak = null;
      this.holdSamples = [s];
    } else if (this.pinched) {
      this.holdSamples.push(s);
      if (this.holdSamples.length > 90) this.holdSamples.shift();

      // Track peak velocity during the last ~350 ms of the hold
      if (!this.peak || s.flickSpeed >= this.peak.speed || (t - this.peak.t) > 0.35) {
        if (!this.peak || s.flickSpeed >= this.peak.speed || s.flickSpeed > spec.minSpeed * 0.6) {
          if (!this.peak || (t - this.peak.t) > 0.35 || s.flickSpeed >= this.peak.speed) {
            this.peak = { t, speed: s.flickSpeed, vx: s.vx, vy: s.vy, vSize: s.vSize, vFlex: s.vFlex };
          }
        }
      }

      // Wind-up & flick phase transitions
      if (this.seqId === 'arc') {
        const pulledDown = sy - this.grabInfo.sy > 0.04;
        const pulledBack = this.grabInfo.ss - ss > 0.014;
        const raisedToEye = this.grabInfo.sy - sy > 0.045;
        const cockedWrist = sa - this.grabInfo.sa < -10;
        if (pulledDown || pulledBack || raisedToEye || cockedWrist) this.windupReached = true;
        if (s.flickSpeed >= spec.minSpeed) this.phase = 'FLICK';
        else if (this.windupReached) this.phase = 'WINDUP';
        else this.phase = 'GRAB';
      } else if (this.seqId === 'dart') {
        const cocked = (sa - this.grabInfo.sa < -8) || (this.grabInfo.ss - ss > 0.01) || (sy - this.grabInfo.sy > 0.035);
        if (cocked) this.windupReached = true;
        if (s.flickSpeed >= spec.minSpeed) this.phase = 'PUSH';
        else if (this.windupReached) this.phase = 'COCK';
        else this.phase = 'GRAB';
      } else {
        // underhand (current game)
        if (sy - this.grabInfo.sy > 0.03) this.windupReached = true;
        if (-vy >= spec.minSpeed) this.phase = 'FLICK';
        else if (this.windupReached) this.phase = 'PULLBACK';
        else this.phase = 'GRAB';
      }
    } else if (!this.pinched && wasPinched) {
      throwEvent = this.evaluateRelease(t, 'pinch-open');
      this.lastResult = throwEvent;
      this.throws.unshift(throwEvent);
      if (this.throws.length > 12) this.throws.pop();
      this.phase = 'RELEASE';
      this.cooldownUntil = t + 1.0;
    } else {
      if (this.phase === 'RELEASE' && t > this.cooldownUntil) this.phase = 'IDLE';
      else if (this.phase !== 'RELEASE') this.phase = 'IDLE';
    }

    return { sample: s, phase: this.phase, coach: this.coach(t), throwEvent };
  }

  findLookback(t, targetDt) {
    let best = null;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const h = this.hist[i];
      if (t - h.t >= targetDt * 0.7) { best = h; break; }
    }
    return best;
  }

  evaluateRelease(tRel, trigger) {
    const spec = this.getSpec();
    // Best peak in the last 550 ms before release
    const recent = this.holdSamples.filter((h) => h.t >= tRel - 0.55 && h.t <= tRel);
    let peak = recent[0] || this.peak || { t: tRel, flickSpeed: 0, vx: 0, vy: 0, vSize: 0, vFlex: 0 };
    for (const h of recent) if (h.flickSpeed > peak.flickSpeed) peak = h;

    const peakSpeed = peak.flickSpeed ?? peak.speed ?? 0;
    const dtPeakMs = Math.round((tRel - peak.t) * 1000);

    // Compute direction label
    const dirParts = [];
    if (-peak.vy > 0.35) dirParts.push('up');
    else if (peak.vy > 0.35) dirParts.push('down');
    if (peak.vSize > 0.08) dirParts.push('forward');
    if (peak.vx < -0.25) dirParts.push('right'); // mirrored camera
    else if (peak.vx > 0.25) dirParts.push('left');
    const direction = dirParts.length ? dirParts.join(' + ') : 'still';

    // Map peak speed to would-be beer pong speed (m/s)
    let wouldBeSpeed;
    if (this.seqId === 'dart') wouldBeSpeed = clamp(peakSpeed * 2.1 + 1.2, 1.5, 7.0);
    else wouldBeSpeed = clamp(peakSpeed * 1.45, 1.2, 7.5);
    const outcome = estimateThrowOutcome(wouldBeSpeed, peak.vx || 0);

    // Determine validity + human-friendly reason
    let valid = true;
    let reason = 'Crisp release near peak velocity';
    const holdDurationMs = this.grabInfo ? Math.round((tRel - this.grabInfo.t) * 1000) : 0;

    if (holdDurationMs < 90 && peakSpeed < spec.minSpeed) {
      valid = false;
      reason = 'Pinch flicker / too quick — hold pinch, wind up, then flick';
    } else if (peakSpeed < spec.minSpeed) {
      valid = false;
      reason = `Flick too soft (${peakSpeed.toFixed(2)} < ${spec.minSpeed.toFixed(2)})`;
    } else if (dtPeakMs > spec.maxLateMs) {
      valid = false;
      reason = `Released too late (+${dtPeakMs} ms after peak — hand already stopped)`;
    } else if (!this.windupReached && this.seqId !== 'underhand') {
      valid = false;
      reason = 'Minimal wind-up — pull back/down or cock wrist first for consistent power';
    } else if (dtPeakMs < -40) {
      valid = false;
      reason = `Released too early (${dtPeakMs} ms before peak)`;
    }

    return {
      id: Date.now() + Math.random(),
      seqId: this.seqId,
      seqName: spec.name,
      trigger,
      valid,
      reason,
      peakSpeed: +peakSpeed.toFixed(2),
      dtPeakMs,
      direction,
      windupReached: this.windupReached,
      holdDurationMs,
      ...outcome,
      tRel,
    };
  }

  coach(t) {
    if (this.phase === 'IDLE') return 'Pinch thumb & index tip together to grab the ball';
    if (this.phase === 'GRAB') {
      if (this.seqId === 'dart') return 'Cock your wrist back / pull slightly toward you';
      if (this.seqId === 'underhand') return 'Pull your hand down to wind up';
      return 'Wind up: pull hand back/down (or raise to eye level)';
    }
    if (this.phase === 'WINDUP' || this.phase === 'COCK' || this.phase === 'PULLBACK') {
      return this.seqId === 'dart'
        ? 'Now push toward camera + snap wrist, and release!'
        : 'Ready — flick up & forward, and open fingers mid-snap!';
    }
    if (this.phase === 'FLICK' || this.phase === 'PUSH') return 'OPEN FINGERS NOW to release!';
    if (this.phase === 'RELEASE' && this.lastResult) {
      return this.lastResult.valid
        ? `VALID throw! (${this.lastResult.dtPeakMs >= 0 ? '+' : ''}${this.lastResult.dtPeakMs} ms vs peak) — pinch again to retry`
        : `${this.lastResult.reason} — pinch again to retry`;
    }
    return 'Pinch to grab';
  }
}
