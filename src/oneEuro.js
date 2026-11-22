// One Euro filter (Casiez et al. 2012). t in seconds.
function alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.03, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.reset(); }
  reset() { this.x = null; this.dx = 0; this.t = null; }
  filter(value, t) {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
