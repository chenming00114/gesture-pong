# Gesture Pong 3D

Hand-gesture 3D Pong for phones (Chrome on Android first, Safari on iOS second).
Move your hand **up/down** in front of the front camera to steer your paddle.

- **Tracking:** MediaPipe Tasks Vision `HandLandmarker` (VIDEO mode, GPU delegate with CPU fallback, 1 hand). Wasm + model are served same-origin from this site.
- **Gestures (landmark heuristics, no second model):** open palm or pinch (thumb tip to index tip) = serve; fist held ~0.5 s = pause/resume.
- **Smoothing:** One Euro filter on hand y, then dead zone + gain mapping onto the paddle's travel.
- **Physics:** custom fixed-timestep (120 Hz) Pong with render interpolation; hit-offset angles, gradual speed-up, capped-speed AI, first to 7.
- **Render:** Three.js side/elevated view (paddles move up/down on screen), one shadowed light.
- **Fallback:** drag/tap on the table to move the paddle; tap to serve.

Tuning panel (⚙): hand point (palm/index tip), gain, dead zone, center, One Euro minCutoff/beta, AI speed, invert, shadows, "Recenter on hand".

## Dev
```
npm install          # also copies MediaPipe wasm into public/wasm
npm run dev          # https needed on phones; use a tunnel or deploy
npm run build && npm run preview
npm test             # headless Chrome with a fake camera fed from test-video/*.y4m
```
Test video: `test-video/six7.webm` (CC0, Wikimedia Commons "6-7 hand gesture 2025.webm"), cropped to one hand and converted to y4m:
`ffmpeg -stream_loop 3 -i test-video/six7.webm -vf "crop=378:504:300:330,scale=480:640,fps=30,format=yuv420p" test-video/six7_righthand.y4m`

## Deploy
`dist/` is published to the `gh-pages` branch (GitHub Pages).
