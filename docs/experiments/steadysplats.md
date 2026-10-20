# SteadySplats downstream rendering experiment

**Scope:** opt-in CPU reference implementation and synthetic A/B laboratory, not a
new GEV map layer, WebGL renderer, or upstream-ready feature. No production globe
rendering changes are made. All normal sessions use the unchanged Cesium path.

## Run

```sh
npm install
npm run dev
# Open http://localhost:4173/?experiment=steadysplats
node --test src/experiments/steadysplats/renderer.test.mjs
node scripts/qa-steadysplats.mjs
```

The lab is deliberately **development-only** (`import.meta.env.DEV`). The
regular GEV home page remains the default. The experiment requires no API keys
or 3D tiles. It compares a deterministic sorted-alpha reference, a single-sample
stochastic visibility image, spatial importance reuse, and spatial + temporal
reuse. `K` and temporal mixing are adjustable; camera pan exercises history
reprojection and disocclusion rejection. Everything remains in its own module.

## Paper mapping

SteadySplats: *Resampling of Low-Variance Gaussians for High-Fidelity Stochastic
Rendering*, Felix Windisch, Thomas Köhler, Lukas Radl, Chris Wyman, Georgios
Kopanas, Bernhard Kerbl, Markus Steinberger (2026),
[arXiv:2610.05576](https://arxiv.org/abs/2610.05576).

| Paper concept | This experiment | Difference to the published method |
| --- | --- | --- |
| Stochastic order-independent alpha | Independent Gaussian alpha masks; closest surviving sample | CPU projected-Gaussian simulation, **not** a Vulkan/WebGL OIT pass |
| History-based spatial resampling | Five-pixel cross, last `K` sample IDs deduplicated, probability ratios | Finite-history visibility approximation; no GPU reservoir or complete occluder set |
| Temporal resampling | Camera-translation reprojection, 3×3 soft history rejection, EMA (`0.70`) | Synthetic motion vectors; dominant-surface guard instead of real depth/velocity buffers |
| Low-variance color training | `rayColorVariance` reference calculation | **No training/optimization** or variance-regularized 3DGS model |
| Quality reference | Sorted alpha blend computed from the same synthetic Gaussians | Not Mip-NeRF 360 or GEV's real tiles |

The CPU stochastic path loops in depth order to **simulate** the distribution of
independent stochastic fragment survival; it does not claim to eliminate
GPU sorting cost. The K-history weights are deliberately approximate and capped
to avoid pathological low-probability ratios, so results are not strictly
unbiased. Gaussian footprints here are 2D projected ellipses rather than
full covariance-projected 3DGS data.

## Recorded local smoke run

On a sandbox Node 22 environment, 16 deterministic 128×96 synthetic frames
reported mean PSNR (dB) of approximately:

| Camera | 1 spp | Spatial K=4 | Spatial + temporal 0.70 |
| --- | ---: | ---: | ---: |
| Static | 10.61 | 22.40 | 24.48 |
| Moving | 10.60 | 22.40 | 24.93 |

These are **synthetic unit/benchmark observations**, not comparable to the
paper's reported 13 dB gain or FPS. CPU timings and fidelity depend on runtime;
reproduce them with `node scripts/qa-steadysplats.mjs` and capture a browser
screenshot before judging real-world quality. Node's 7 targeted tests passed
locally; the full GEV suite and browser integration have not been executed yet.

## Promotion criteria

1. Replace the CPU visibility simulation with a gated WebGL2/WebGPU splat pass
   using `.ply`/`.spz` data in a standalone Cesium-owned overlay, without
   mutating private Cesium command internals or production render state.
2. Implement source/target probabilities from actual splat alpha, available
   visibility history and depth/motion buffers; validate occlusion edges,
   disocclusions and dynamic motion. Compare exact and approximate weight modes.
3. Benchmark sorted splats, stochastic-only, spatial-only and full temporal on
   the **same** desktop/mobile devices, camera paths and resolution: PSNR,
   tPSNR, SSIM, frame time p50/p95, VRAM and CPU utilization.
4. Explore the color-variance regularizer in the **upstream 3DGS training** tool,
   not in GEV runtime; cite the original authors and license before porting code.
5. Keep the work downstream until the maintainers request an integration and
   there is a demonstrated benefit beyond Cesium's existing splat pipeline.
