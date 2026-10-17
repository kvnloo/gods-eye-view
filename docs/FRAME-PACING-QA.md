# Frame pacing / scene-latency QA (opt-in)

This is an **instrumentation experiment**, not a hardware FPS baseline or a
click-to-photon measurement. Complements scripts/qa-perf.mjs (render governor),
scripts/qa-weather-perf.mjs (weather route), and docs/PERFORMANCE.md (Apple M5).
Parent: fork PERF-07 issue #110. No shipped renderer behavior changes.

## Capture

With Node 24.14.x or 26.x, npm dependencies installed, and a local dev/preview
server on port 4173, run:

- node scripts/qa-frame-pacing.mjs --styles normal,noir,snow --mode motion --runs 3 --ms 5000
- node scripts/qa-frame-pacing.mjs --mode drag --styles normal --headful
- node scripts/qa-frame-pacing.mjs --mode idle --styles normal
- node scripts/qa-frame-pacing.mjs --mode motion --layers flights --headful
- node scripts/qa-frame-pacing.mjs --mode motion --require-hardware --headful
- node scripts/compare-frame-pacing.mjs baseline/results.json candidate/results.json
- node --test scripts/frame-pacing-metrics.test.mjs

Results are saved at qa-shots/frame-pacing/results.json; use --out with a separate
path per build. The scripted route moves the camera at a clock-based angular
velocity from a fixed pose over Austin. It does **not** force a render each rAF,
since that would conceal request-render governor starvation. Startup is warmed
separately; this is not a cold-start benchmark.

Record exact external checkout/build SHA, device, power state, browser version,
driver, renderer, focus, viewport, DPR, source cohorts, map stack and screenshot.
Headless/software rendering can verify invariants but **cannot** establish GPU
hardware budgets. Real browser, Pinokio embedded view, and Android are separate
populations. The browser cannot attest its served Git SHA; reports set
sourceRevision to null rather than guessing.

## Metrics

- sceneFps counts Cesium postRender callbacks; rAF Hz does **not** prove a render.
- sceneFrameIntervalMs reports p50/p95/p99/worst and >33/>50/>100 ms **gaps
  between postRender callbacks during motion**, not GPU time or display cadence.
- requestRenderMode idle intentionally has no frame interval percentile.
- inputToChangedSceneRenderMs is delivered canvas pointermove to the next
  postRender where the camera pose changed. Unmatched inputs remain unmatched.
  This excludes USB, OS scheduling, compositor, display scanout and photons.
- longTasks and longAnimationFrames count PerformanceObserver entries when
  available. An observed zero is not proof the API was supported.
- Invalid motion capture (fewer than three renders, no changing camera, invalid
  timestamps) fails, as do canvas/renderer/focus/source changes within a run.
- Offline A/B refuses different style, mode, source counts, performance profile,
  renderer, browser identity, viewport, DPR, canvas or focus. An unknown layer
  count is recorded as null, not silently invented.

No absolute GPU timing thresholds belong in generic SwiftShader CI. The
deterministic fixtures detect rAF/scene divergence, a 200 ms hitch, silent idle,
unmatched input, invalid samples and incompatible A/B. A speedup claim requires
an independently verified exact-head app build and matched hardware evidence.

## Borrow from gaming latency engineering

1. Intel PresentMon and NVIDIA FrameView: separate CPU, GPU, present and
   display stages; do not call a browser postRender timestamp click-to-photon.
2. MangoHud: log frame-time tails, p99/hitch distributions, repeatable workloads
   and real hardware/driver context, not only average FPS.
3. NVIDIA Reflex: prioritize input/camera work over obsolete background decode,
   texture upload, CCTV/imagery refinement, and long JavaScript tasks. The native
   Windows/C++ Reflex SDK is not directly installable in browser Cesium.
4. Build controlled fixtures for dense detection, 100k FIRMS, 12k AIS, CCTV,
   traffic, mobile viewport, post-FX and combined scenarios; preserve selected
   evidence while degrading ambient effects. Never claim live coverage from
   missing network source rows.
5. After measurement, pursue viewport-generation invalidation, singleflight,
   budgeted GPU uploads, LOD, main-thread scheduling and adaptive quality as
   independent reviewed patches. Reuse upstream performance issue #962 and
   existing fork motion-safety work instead of duplicating their rendering API.

Credit: GEV architecture, render governor, and existing QA by Bilawal Sidhu and
contributors; render-performance ideas from original upstream issue #8 and
associated contributors; percentile/instrumentation inspiration from Intel
PresentMon, NVIDIA Reflex/FrameView and FlightlessMango MangoHud.
