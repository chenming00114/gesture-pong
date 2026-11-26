// Headless test for Gesture Tester (tester.html).
// Usage: node scripts/tester-test.mjs [url] [prefix] [y4m|none]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:4173/tester.html';
const prefix = process.argv[3] || 'tester';
const y4m = process.argv[4] || 'none';
const out = 'test-artifacts'; mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(y4m !== 'none' ? ['--use-file-for-fake-video-capture=' + y4m] : []),
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const con = [];
page.on('console', (m) => con.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => con.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => con.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) con.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(url, { waitUntil: 'networkidle0' });
await page.click('#btnStart');
await page.waitForFunction(() => window.__tester?.modelReady || window.__tester?.errors.length, { timeout: 90000 });
await sleep(1200);

const R = { url, y4m };

if (y4m !== 'none') {
  // Real hand video check: ensure landmarks track & zero false throws on non-throwing wave
  const samples = [];
  for (let i = 0; i < 24; i++) {
    samples.push(await page.evaluate(() => ({
      phase: window.__tester.lastPhase,
      throws: window.__tester.throws.length,
      histLen: window.__tester.tester.hist.length,
      pinch: window.__tester.tester.hist.at(-1)?.pinchRatio ?? null,
    })));
    await sleep(250);
  }
  await page.screenshot({ path: `${out}/${prefix}-realvideo.png`, fullPage: true });
  R.realVideo = {
    samplesCount: samples.length,
    detectedFrames: samples.at(-1).histLen,
    falseThrows: samples.at(-1).throws,
    minPinch: Math.min(...samples.filter((s) => s.pinch != null).map((s) => s.pinch)),
  };
} else {
  // Scripted sequences for all 3 candidates + invalid throws
  R.sequences = await page.evaluate(() => {
    const T0 = [[0,0],[-0.35,-0.25],[-0.55,-0.45],[-0.7,-0.65],[-0.8,-0.85],[-0.25,-0.95],[-0.28,-1.3],[-0.3,-1.55],[-0.32,-1.75],
      [0,-1.0],[0,-1.4],[0,-1.65],[0,-1.85],[0.22,-0.95],[0.25,-1.3],[0.27,-1.52],[0.28,-1.7],[0.42,-0.85],[0.48,-1.1],[0.52,-1.28],[0.55,-1.42]];
    const mk = (wx, wy, p, s = 0.12, dz = 0) => T0.map(([x, y], idx) => {
      let px = x, py = y;
      const meet = [-0.52, -1.18];
      if (idx === 4) { px += (meet[0] - px) * p; py += (meet[1] - py) * p; }
      if (idx === 8) { px += (meet[0] + 0.02 - px) * p; py += (meet[1] - 0.04 - py) * p; }
      return { x: wx + px * s, y: wy + py * s, z: idx === 9 ? dz : 0 };
    });

    const runSeq = (seqId, frames) => {
      const btn = [...document.querySelectorAll('#seqTabs button')].find((b) => b.textContent.toLowerCase().includes(seqId === 'underhand' ? 'current' : seqId));
      btn.click();
      document.getElementById('btnClear').click();
      const phasesSeen = new Set();
      let t = performance.now();
      for (const f of frames) {
        t += f.dt || 33;
        window.__tester.inject(f.lm, t);
        phasesSeen.add(window.__tester.lastPhase);
      }
      return { seqId, phasesSeen: [...phasesSeen], throws: [...window.__tester.throws] };
    };

    const makeThrow = ({ cockDy = 0.18, cockDs = -0.02, cockDz = 0.05, flickDy = -0.34, flickDs = 0.05, flickDz = -0.10, lateHoldFrames = 0, flickSteps = 5 }) => {
      const f = [];
      for (let i = 0; i < 8; i++) f.push({ lm: mk(0.55, 0.58, 0, 0.12, 0) });
      for (let i = 1; i <= 5; i++) f.push({ lm: mk(0.55, 0.58, i / 5, 0.12, 0) });
      for (let i = 1; i <= 10; i++) {
        const u = i / 10;
        f.push({ lm: mk(0.55, 0.58 + cockDy * u, 1, 0.12 + cockDs * u, cockDz * u) });
      }
      for (let i = 1; i <= flickSteps; i++) {
        const u = i / flickSteps;
        f.push({ lm: mk(0.55 - 0.03 * u, 0.58 + cockDy + flickDy * u, 1, 0.12 + cockDs + flickDs * u, cockDz + flickDz * u) });
      }
      for (let i = 0; i < lateHoldFrames; i++) {
        f.push({ lm: mk(0.52, 0.58 + cockDy + flickDy, 1, 0.12 + cockDs + flickDs, cockDz + flickDz) });
      }
      f.push({ lm: mk(0.52, 0.58 + cockDy + flickDy - 0.02, 0, 0.12 + cockDs + flickDs, cockDz + flickDz) });
      for (let i = 0; i < 4; i++) f.push({ lm: mk(0.52, 0.58 + cockDy + flickDy - 0.02, 0, 0.12 + cockDs + flickDs, cockDz + flickDz) });
      return f;
    };

    const arcValid = runSeq('arc', makeThrow({}));
    const dartValid = runSeq('dart', makeThrow({ cockDy: 0.02, cockDs: -0.02, cockDz: 0.06, flickDy: -0.04, flickDs: 0.07, flickDz: -0.12 }));
    const underValid = runSeq('underhand', makeThrow({ cockDy: 0.20, cockDs: 0, cockDz: 0, flickDy: -0.35, flickDs: 0, flickDz: 0 }));

    // Also test late release & soft flick on recommended 'arc'
    const arcLate = runSeq('arc', makeThrow({ lateHoldFrames: 10 }));
    const arcSoft = runSeq('arc', makeThrow({ cockDy: 0.06, flickDy: -0.05, flickDs: 0.005, flickSteps: 10 }));
    // Leave a valid Arc throw on screen for screenshot
    const arcFinal = runSeq('arc', makeThrow({}));
    const trace = window.__tester.exportTrace();
    return {
      arcValid, dartValid, underValid, arcLate, arcSoft, arcFinal,
      traceCheck: { frameCount: trace.frameCount, throwsInTrace: trace.throws.length, hasLandmarks: !!trace.frames.at(-1)?.lm?.length },
    };
  });
  await sleep(300);
  await page.screenshot({ path: `${out}/${prefix}-arc-valid.png`, fullPage: true });
}

R.errors = await page.evaluate(() => window.__tester.errors);
R.console = con;
writeFileSync(`${out}/${prefix}-report.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
await browser.close();
