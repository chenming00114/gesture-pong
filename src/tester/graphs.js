// Rolling ~2 s multi-channel graphs for hand tracking features & velocities.
const WINDOW_S = 2.2;

export function drawGraphs(canvas, hist, spec, nowSec) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 360, cssH = canvas.clientHeight || 260;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const panels = [
    { label: 'Pinch', min: 0, max: 1.6, lines: [{ k: 'pinchRatio', c: '#7aff9c' }],
      thresh: [{ v: spec.pinchOn, c: '#5cf2ff', lbl: 'on' }, { v: spec.pinchOff, c: '#ff7a7a', lbl: 'off' }] },
    { label: 'Hand X (cyan) / Y (gold)', min: 0, max: 1, lines: [{ k: 'sx', c: '#5cf2ff' }, { k: 'sy', c: '#ffd166' }] },
    { label: 'Hand Size (depth)', min: 0.04, max: 0.35, lines: [{ k: 'ss', c: '#c792ea' }] },
    { label: 'Wrist Flex (deg)', min: -60, max: 60, lines: [{ k: 'sa', c: '#ff9f43' }], thresh: [{ v: 0, c: '#ffffff44' }] },
    { label: 'Speed (drive / up / fwd)', min: -0.5, max: 3.8,
      lines: [{ k: 'flickSpeed', c: '#ffffff' }, { fn: (s) => -s.vy, c: '#5cf2ff' }, { fn: (s) => s.vSize * 3, c: '#7aff9c' }],
      thresh: [{ v: spec.minSpeed, c: '#ff5a5f', lbl: 'min' }] },
  ];

  const tMax = hist.length ? Math.max(nowSec, hist[hist.length - 1].t) : nowSec;
  const tMin = tMax - WINDOW_S;
  const pad = 4, ph = (cssH - pad * (panels.length + 1)) / panels.length;

  panels.forEach((p, idx) => {
    const y0 = pad + idx * (ph + pad);
    ctx.fillStyle = '#15192b';
    ctx.fillRect(0, y0, cssW, ph);
    const mapY = (v) => y0 + ph - Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min))) * (ph - 4) - 2;
    const mapX = (t) => ((t - tMin) / WINDOW_S) * cssW;

    if (p.thresh) {
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      for (const th of p.thresh) {
        const ty = mapY(th.v);
        ctx.strokeStyle = th.c; ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(cssW, ty); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const ln of p.lines) {
      ctx.strokeStyle = ln.c; ctx.lineWidth = 1.6; ctx.beginPath();
      let started = false;
      for (const s of hist) {
        if (s.t < tMin) continue;
        const val = ln.fn ? ln.fn(s) : s[ln.k];
        const x = mapX(s.t), y = mapY(val);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#b9c4e0'; ctx.font = '10px ui-monospace, monospace';
    const last = hist[hist.length - 1];
    const vTxt = last ? (p.lines[0].fn ? p.lines[0].fn(last) : last[p.lines[0].k]).toFixed(2) : '—';
    ctx.fillText(`${p.label}: ${vTxt}`, 6, y0 + 11);
  });
  ctx.restore();
}
