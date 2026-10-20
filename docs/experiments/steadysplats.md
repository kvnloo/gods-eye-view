# SteadySplats downstream rendering experiment

**Scope:** opt-in CPU reference **and independent WebGL2 research laboratory**.
Neither is a production GEV layer, a Cesium renderer replacement, nor an
upstream-ready feature. All normal sessions use the unchanged Cesium path.

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

## GPU experiment (separate WebGL2 lab)

The branch `experiment/steadysplats-resampling` also includes a gated hardware
path, available only when Vite runs in development mode:

```sh
npm ci
npm run dev
# http://localhost:4173/?experiment=steadysplats-gpu
node --test src/experiments/steadysplats/*.test.mjs
node scripts/qa-steadysplats-webgl.mjs
```

The GPU prototype uses **instanced screen-projected 3D Gaussians** in a separate
WebGL2 context; it does not replace Cesium or import GEV viewer internals.
Reference: sorted back-to-front alpha blending. Stochastic: independent alpha
masks and a depth buffer, with no per-fragment depth sort. Spatial: up to four
reprojected sample surfaces, five-pixel neighborhoods and a capped ratio of
estimated Gaussian alpha probabilities. Temporal: prior filtered image
reprojection with a 3×3 neighborhood clamp and variance-sensitive rejection.

`gpuScene.js` supports standard `binary_little_endian` and `ascii` 3DGS PLY
vertices, logistic opacity, exponentiated scale, quaternion rotation and SH0
(DC) colors. Covariances are projected using the perspective Jacobian and
rotated elliptical screen footprints. The UI can load an optional local PLY
without server upload, capped at 100 MB. GPU sampling identifiers are 16-bit;
only the first 2,000 projected PLY points are used by the interactive preview.
Camera-motion testing is a 2D translation of projected Gaussians (a screen-space
pan approximation), **not** a full six-degree-of-freedom 3DGS renderer. The
projection and sorting happen on the CPU; OIT visibility and resampling happen
in fragment shaders. SH bands above DC are omitted.

### GPU provenance and reproducible testing

The repo contains `.github/workflows/steadysplats-research.yml`, designed to run
on each push to the experimental branch. Three distinct jobs prevent software
emulation from being misrepresented as GPU hardware:

1. `ubuntu-latest`: Chromium/ANGLE SwiftShader, **software graphics correctness
   only**. Checks GLSL/browser execution and exports PNG+JSON evidence.
2. `macos-26`: Apple Silicon WebGL hardware probe. A detected software renderer
   or unknown GPU name fails the probe; the job is initially non-blocking until
   the environment is confirmed.
3. `[self-hosted, linux, x64, nvidia]`: optional **manual** NVIDIA runner job,
   guarded by `nvidia-smi`, and requiring a non-software browser renderer.

The browser harness stores `artifacts/steadysplats-webgl/report.json`, static
and moving-camera screenshots, driver identification, CPU command submission
p50/p95, available GPU timer readings and sorted-alpha-reference PSNR. The
`--require-hardware` flag exits nonzero if Chromium reports SwiftShader,
llvmpipe, or an unrecognized renderer. A GPU candidate is not itself proof of
CUDA usage: GL driver and actual GPU utilization require hardware validation.

**To attach the local RTX 3080 Ti:** follow GitHub Settings → Actions → Runners
→ New self-hosted runner, register it for the downstream fork with the additional
label `nvidia`, and run the NVIDIA job manually. Keep the runner bound to trusted
repo-owned workflows: do not expose a personal GPU runner to untrusted pull
request code or fork-triggered jobs. Standard GitHub Actions public runner
minutes are free, while organization-managed Tesla T4 larger runners are paid.

### What remains unverified

The current isolated sandbox has no NVIDIA device and rejects hardware WebGL2.
Node tests and the CPU synthetic lab **do not** prove a working GPU shader or
make a real-hardware speed claim. Do not mark this experiment as upstream-ready
until the browser runner passes, driver/VRAM evidence is recorded, a real PLY is
rendered successfully and the GPU-quality/performance regressions are reviewed.

The reference is Windisch et al., *SteadySplats* (arXiv:2610.05576). This is
independent research-code approximation, **not** a reproduction of the author's
Vulkan code or their trained regularizer. Preserve original author credit.
