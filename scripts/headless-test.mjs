// Headless Chrome test: fake camera from a y4m hand video, checks model load, landmarks, paddle motion, game loop.
// Usage: node scripts/headless-test.mjs [url] [y4m] [outPrefix]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:4173/?log=1';
const y4m = process.argv[3] || 'test-video/six7_righthand.y4m';
const prefix = process.argv[4] || 'run';
const out = 'test-artifacts'; mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(y4m !== 'none' ? ['--use-file-for-fake-video-capture=' + y4m] : []),
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => consoleMsgs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${out}/${prefix}-0-start.png` });
await page.click('#btnStart');
await page.waitForFunction(() => window.__pong?.modelReady || window.__pong?.errors.length, { timeout: 90000 });
const t0 = Date.now();
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/${prefix}-1-tracking.png` });
// sample paddle/hand positions for ~8 s
const samples = []; let shotUp = false, shotDown = false;
for (let i = 0; i < 40; i++) {
  samples.push(await page.evaluate(() => { const T = window.__pong; return { t: Math.round(performance.now()), hand: T.handVisible, rawY: T.rawY && +T.rawY.toFixed(3), filtY: T.filtY && +T.filtY.toFixed(3), paddleZ: +T.game.player.z.toFixed(3), gesture: T.gesture, state: T.game.state, ballX: +T.game.ball.x.toFixed(2), fps: +T.fps.toFixed(1), lat: T.latencyMs && +T.latencyMs.toFixed(1) }; }));
  const s = samples[samples.length - 1];
  if (s.hand && s.paddleZ < -1.5 && !shotUp) { shotUp = true; await page.screenshot({ path: `${out}/${prefix}-hand-up.png` }); }
  if (s.hand && s.paddleZ > 3 && !shotDown) { shotDown = true; await page.screenshot({ path: `${out}/${prefix}-hand-down.png` }); }
  if (i === 20) await page.screenshot({ path: `${out}/${prefix}-2-gameplay.png` });
  await new Promise((r) => setTimeout(r, 200));
}
await page.screenshot({ path: `${out}/${prefix}-3-gameplay.png` });
// touch fallback: tap near far/near edges of the table and see paddle target change
const touch = await page.evaluate(async () => {
  const T = window.__pong; const c = document.getElementById('scene');
  const fire = (y) => c.dispatchEvent(new PointerEvent('pointerdown', { clientX: innerWidth * 0.3, clientY: y, bubbles: true, pointerType: 'touch', buttons: 1 }));
  fire(innerHeight * 0.38); await new Promise((r) => setTimeout(r, 100)); const a = T.game.player.z;
  fire(innerHeight * 0.62); await new Promise((r) => setTimeout(r, 100)); const b = T.game.player.z;
  return { zAfterUpperTap: +a.toFixed(3), zAfterLowerTap: +b.toFixed(3) };
});
const final = await page.evaluate(() => { const T = window.__pong; return { delegate: T.delegate, detections: T.detections, frames: T.frames, score: T.game.score, state: T.game.state, log: T.log.filter((x) => typeof x === 'string'), errors: T.errors, status: T.status }; });
const handFrames = samples.filter((s) => s.hand).length;
const zs = samples.filter((s) => s.hand).map((s) => s.paddleZ), ys = samples.filter((s) => s.hand).map((s) => s.rawY);
const report = { url, y4m, elapsedMs: Date.now() - t0, final, touch, handSampleRatio: handFrames / samples.length,
  rawYRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null, paddleZRange: zs.length ? [Math.min(...zs), Math.max(...zs)] : null,
  samples, console: consoleMsgs };
writeFileSync(`${out}/${prefix}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: samples.slice(0, 40).map((s) => `${s.hand ? 'H' : '-'} y=${s.rawY} z=${s.paddleZ} ${s.gesture} ${s.state} fps=${s.fps} lat=${s.lat}`) }, null, 1));
await browser.close();
