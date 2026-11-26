# Gesture Beer Pong 3D (+ classic Gesture Pong)

Hand-gesture games for phones (Chrome on Android first). Live: https://chenming00114.github.io/gesture-pong/

- **Beer pong (default, `index.html`)**: **pinch** (thumb tip to index tip) to grab the ball, **pull your hand down** to wind up, **flick up and let go** to throw. Your hand's left/right position (and sideways flick) aims. 2 balls per turn, then the AI throws at your cups. Clear all 10 cups to win.
- **Gesture Tester & Throw Coach**: `tester.html` (live rolling graphs, state machine, throw grading, JSON trace export)
- **Classic paddle Pong**: `pong.html` or `?mode=pong` (git tag `pong-v1` is the original build).

## How the throw works
- MediaPipe `HandLandmarker` (VIDEO mode, GPU→CPU fallback). Pinch = thumb–index distance / palm length, with hysteresis (on < 0.30, off > 0.45).
- The pinch point is One Euro–filtered. On release, velocity = the peak 110 ms window inside the last 260 ms. Upward speed sets throw speed (fixed arc angle), sideways speed adds aim. If tracking drops out mid-flick, that counts as the release.
- Throw assist (default 70%) blends the throw toward the cup it was heading for (0% = pure physics).
- Touch fallback: press, drag down, flick up, release.

## Physics
Custom 240 Hz fixed-step: gravity, table bounce (restitution 0.78), cup outer/inner walls, torus rims. A cup counts as made once the ball drops inside below the rim. No physics engine.

## Dev / tests
```
npm install && npm run build && npx vite preview --port 4173
node scripts/sim-beer.mjs                      # physics checks + hit-rate stats
node scripts/beer-test.mjs                     # headless: injected-landmark throw, scripted made cup, AI turn, touch throw
node scripts/beer-test.mjs http://localhost:4173/ beer-realvideo test-video/six7_righthand.y4m   # real hand video through the tracker
node scripts/headless-test.mjs "http://localhost:4173/?mode=pong&log=1"   # classic pong
```
Test video `test-video/six7.webm` is CC0 (Wikimedia Commons "6-7 hand gesture 2025.webm"); convert with
`ffmpeg -stream_loop 3 -i test-video/six7.webm -vf "crop=378:504:300:330,scale=480:640,fps=30,format=yuv420p" test-video/six7_righthand.y4m`.
The pinch/flick throw test uses synthetic landmarks (`scripts/synth-hand.mjs`) fed through `window.__bp.inject()`.

## Deploy
`dist/` is published to the `gh-pages` branch.
