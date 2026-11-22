// Headless beer pong test. Usage: node scripts/beer-test.mjs [baseUrl] [prefix] [y4m|none]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { throwSequence } from './synth-hand.mjs';
const base = process.argv[2] || 'http://localhost:4173/';
const prefix = process.argv[3] || 'beer';
const y4m = process.argv[4] || 'none';
const out = 'test-artifacts'; mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(y4m !== 'none' ? ['--use-file-for-fake-video-capture=' + y4m] : []),
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const con = [];
page.on('console', (m) => con.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => con.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => con.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) con.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(base, { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${out}/${prefix}-0-start.png` });
await page.click('#btnStart');
await page.waitForFunction(() => window.__bp?.modelReady || window.__bp?.errors.length, { timeout: 90000 });
await sleep(1500);
const R = { base, y4m };
const st = () => page.evaluate(() => { const T = window.__bp, g = T.game; return { state: g.state, turn: g.turn, ballsLeft: g.ballsLeft,
  farAlive: g.far.filter((c) => c.alive).length, nearAlive: g.near.filter((c) => c.alive).length, holding: T.holding, pinched: T.pinched,
  pinchRatio: T.pinchRatio && +T.pinchRatio.toFixed(3), hand: T.handVisible, gesture: T.gestureState, delegate: T.delegate, fps: +T.fps.toFixed(1), lat: T.latencyMs && +T.latencyMs.toFixed(0),
  ball: g.ball && { x: +g.ball.x.toFixed(3), y: +g.ball.y.toFixed(3), z: +g.ball.z.toFixed(3) }, lastThrow: T.lastThrow, errors: T.errors }; });

if (y4m !== 'none') {
  // Real-video sanity: does the tracker see the hand and produce pinch ratios in beer mode?
  const samples = [];
  for (let i = 0; i < 25; i++) { samples.push(await st()); await sleep(250); }
  await page.screenshot({ path: `${out}/${prefix}-realvideo.png` });
  R.realVideo = { handRatio: samples.filter((s) => s.hand).length / samples.length, pinchRatios: samples.filter((s) => s.hand).map((s) => s.pinchRatio), delegate: samples.at(-1).delegate, lat: samples.map((s) => s.lat) };
} else {
  // 1) Landmark-injection throw: pinch -> pull back -> flick -> release (synthetic timestamps at 30 fps)
  const seq = throwSequence();
  const phases = [];
  await page.evaluate(() => { window.__seqT = performance.now(); });
  for (let i = 0; i < seq.length; i++) {
    const f = seq[i];
    const s = await page.evaluate((lm, k) => { const T = window.__bp; T.inject(lm, window.__seqT + k * 33);
      return { pinched: T.pinched, holding: T.holding, ratio: +T.pinchRatio.toFixed(3), held: T.held && { x: +T.held.x.toFixed(3), y: +T.held.y.toFixed(3), z: +T.held.z.toFixed(3) }, state: T.game.state, thrown: !!T.lastThrow }; }, f.lm, i);
    phases.push({ i, phase: f.phase, ...s });
    if (f.phase === 'holding' && seq[i + 1]?.phase === 'pullback') { await sleep(400); await page.screenshot({ path: `${out}/${prefix}-1-grabbed.png` }); }
    if (f.phase === 'pullback' && seq[i + 1]?.phase === 'flick') { await sleep(400); await page.screenshot({ path: `${out}/${prefix}-2-pulledback.png` }); }
  }
  await page.evaluate(() => window.__bp.stopInject());
  await sleep(150); await page.screenshot({ path: `${out}/${prefix}-3-inflight.png` });
  R.injectedThrow = { phases: phases.filter((p, i) => i === 0 || p.phase !== phases[i - 1].phase || p.thrown !== phases[i - 1].thrown), lastThrow: (await st()).lastThrow };
  // wait until it resolves
  await page.waitForFunction(() => window.__bp.game.events.some((e) => e.type === 'made' || e.type === 'miss'), { timeout: 60000 });
  R.injectedResult = await page.evaluate(() => window.__bp.game.events.filter((e) => e.type !== 'throw'));
  await page.waitForFunction(() => window.__bp.game.state === 'aim' || window.__bp.game.state === 'ai-wait', { timeout: 30000 });
  R.afterInjected = await st();
  // 2) Scripted throw into a cup proves made cups are removed
  if (R.afterInjected.state === 'aim') {
    const before = R.afterInjected.farAlive;
    R.scripted = await page.evaluate(() => window.__bp.throwAt('far9'));
    await sleep(300); await page.screenshot({ path: `${out}/${prefix}-4-scripted-inflight.png` });
    await page.waitForFunction((b) => window.__bp.game.far.filter((c) => c.alive).length < b || window.__bp.game.state === 'ai-wait', { timeout: 60000 }, before);
    await sleep(800);
    R.afterScripted = await st(); R.scripted.cupsBefore = before; R.scripted.cupsAfter = R.afterScripted.farAlive;
    await page.screenshot({ path: `${out}/${prefix}-5-cup-removed.png` });
  }
  // 3) AI turn
  await page.waitForFunction(() => window.__bp.game.turn === 'ai', { timeout: 60000 });
  await sleep(2500); await page.screenshot({ path: `${out}/${prefix}-6-ai-turn.png` });
  await page.waitForFunction(() => window.__bp.game.turn === 'player' && window.__bp.game.state === 'aim', { timeout: 90000 });
  R.afterAI = await st();
  R.events = await page.evaluate(() => window.__bp.game.events.map((e) => e.type === 'throw' ? `${e.by} throw v=(${e.v.x.toFixed(2)},${e.v.y.toFixed(2)},${e.v.z.toFixed(2)})` : `${e.by} ${e.type}${e.cup ? ' ' + e.cup : ''}${e.reason ? ' (' + e.reason + ')' : ''}`));
  // 4) Touch fallback: press, drag down, flick up, release
  await sleep(1500);
  // Synthetic pointer events dispatched synchronously with real (busy-waited) timing; CDP mouse moves are
  // throttled to the ~5 fps headless frame rate, which would turn the flick into a slow drag.
  await page.evaluate(() => {
    const c = document.getElementById('scene'), wait = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
    const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 206, 600);
    for (let i = 1; i <= 8; i++) { wait(30); ev('pointermove', 206, 600 + i * 12); }
    for (let i = 1; i <= 5; i++) { wait(25); ev('pointermove', 206 + i * 3, 696 - i * 70); }
    wait(10); ev('pointerup', 222, 340);
  });
  await sleep(300);
  R.touchThrow = (await st()).lastThrow; R.touchLog = await page.evaluate(() => window.__bp.log.slice(-2));
  await page.screenshot({ path: `${out}/${prefix}-7-touch-throw.png` });
}
R.final = await st(); R.console = con;
writeFileSync(`${out}/${prefix}-report.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
await browser.close();
