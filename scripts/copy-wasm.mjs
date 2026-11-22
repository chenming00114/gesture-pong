// Copies MediaPipe wasm runtime into public/wasm so it is served same-origin (HTTPS on Pages).
import { mkdirSync, copyFileSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm/';
mkdirSync('public/wasm', { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copyFileSync(src + f, 'public/wasm/' + f);
console.log('wasm copied');
