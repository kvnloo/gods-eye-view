# Factory CI: exact-SHA gates for nightly and staging

Every commit that lands on `nightly` or is promoted to `staging` must carry green
`gev-ci/*` commit statuses **on that exact SHA**. Two runners produce the same
statuses from the same driver, `scripts/factory-ci.mjs`:

- **GitHub Actions:** `.github/workflows/factory-ci-sha.yml` (`workflow_call` and
  `workflow_dispatch`, input `sha`). `ci.yml` calls it for PRs into `nightly` or
  `staging` and for pushes to them. Actions is currently paused on this fork by
  GitHub; only the owner can re-enable it at `/actions`.
- **Boat:** `scripts/factory-ci-boat.sh <sha> [base-sha]` runs the gates in a
  disposable Boat VM with no credentials. It then posts statuses from the
  trusted host. This is the working path while Actions is paused.

## Contract for nightly integration and staging promotion

| Item | Value |
|---|---|
| Input | `sha`: 40 lowercase hex characters. Anything else is refused before checkout. Optional `base-sha` (full SHA) turns on the append-only ledger checks against that base. |
| Checkout | `fetch-depth: 0` at `sha`, then `git rev-parse HEAD == sha` is asserted. The unit gate needs `origin/main` because two policy tests diff against it. |
| Output | Commit statuses on `sha`, one per gate, plus `gev-ci/full`. The Actions run also exposes `outputs.full` (`success` or `failure`). |
| Required check | `gev-ci/full`. It is `success` only when all eight gate results exist and are `success`. A missing result counts as `error`. |
| Evidence link | Each status's `target_url`: the Actions run, or `factory/ci-evidence/<sha>/<UTC stamp>/` for Boat runs (gate JSON, logs, `globe.png`). |
| States | `success`. `failure` means the code under test failed. `error` means the gate could not produce a trustworthy result, for example a crash, a timeout, missing history, an environment mismatch or a missing build. Never treat `error` as a pass. |

Consumers must read statuses for the exact SHA they are about to publish, and
must re-read the branch ref right before the update. A status on any other SHA,
including the PR head when the integration commit is a merge, authorizes
nothing.

## Gates (stable context names)

| Context | What runs | Fails when |
|---|---|---|
| `gev-ci/lint` | `format:check`, `check:boundaries`, `library:check`, plus `layer-token:check --base-ref` when `base-sha` is given | any command exits non-zero |
| `gev-ci/typecheck` | `tsc --strict --module ESNext --moduleResolution Bundler` over `src/render/**/*.d.ts` | a type error. This covers the renderer declarations only. The app is JavaScript, so there is no whole-app typecheck. |
| `gev-ci/translations` | `npm run i18n` (13 catalogs) | a catalog is out of step |
| `gev-ci/unit` | every `*.test.mjs` under `src/` and `server/`, compared with the baseline (below) | a new failure, a newly skipped test, or a test file that emptied |
| `gev-ci/build` | `vite build` | the build fails |
| `gev-ci/bundle-budget` | `scripts/factory-bundle-budget.mjs` | a size is over its limit (below) |
| `gev-ci/globe-smoke` | `scripts/factory-globe-smoke.mjs` on the production `dist/` | the globe does not draw (below) |
| `gev-ci/perf-smoke` | the repository's `*.perf.test.mjs` budgets, 5 serial runs | one benchmark misses its own budget in 3 or more of the 5 runs |

### Unit baseline

`ci/factory/unit-baseline.json` is the reviewable baseline. It records the commit,
tree, lockfile hash, driver hash and environment (Node, npm, OS, CPUs). It also
holds the exact IDs of failing and skipped tests and the test count per file.
A test ID is `<file> > <suite> > ... > <test>`. A file that fails outside any
test is `<file> > (file)`.

The current baseline is `53f0caa6e54d9769740d69424e8bf26364b00a6a` (nightly and
staging tip on 2026-11-25), Node 24.22.2 on Linux x64. It has 14,427 tests:
**0 failing**, 3 skipped. The skipped tests are a Windows-only DACL test and the
two timing benchmarks, which normal runs skip on purpose; perf-smoke runs them.

The gate is strict about what it trusts:

- Every test process runs, including the two GC-bracketed allocation probes, even
  when an earlier process failed. `npm test` stops at the first red process, so it
  would skip them.
- A run is an `error` when the process was killed or timed out, or when the
  runner's own count of tests differs from the results it emitted. It is also an
  `error` when the exit code disagrees with the results: non-zero with no failing
  test, or zero with one.
- If the baseline was recorded on a different Node version or platform, the gate
  returns `error` and does not compare.
- Baseline failures that now pass are listed as `fixed`. Remove them in the next
  baseline refresh so they cannot regress silently.
- Deleted test files are listed and do not block. A file that still exists but
  now runs zero tests blocks.

To refresh the baseline, run this on the pinned environment and commit the file
as its own reviewed change:

```sh
node scripts/factory-ci.mjs unit --write-baseline
```

Never refresh the baseline just to turn a red PR green. Fix the test, or explain
the new failure in the PR that adds it to the baseline.

### Bundle budget

These limits were measured at `53f0caa6` and sit about 5% above the measured
sizes. Raising one is a reviewed edit to `LIMITS` in
`scripts/factory-bundle-budget.mjs`.

| Metric | Measured | Limit |
|---|---:|---:|
| `dist/` total bytes | 80,939,371 | 85,000,000 |
| All JS, gzip | 7,456,194 | 7,850,000 |
| Largest JS file, gzip (`assets/index-*.js`) | 2,796,702 | 3,000,000 |
| Entry scripts in `index.html`, gzip | 4,498,737 | 4,750,000 |

### Globe smoke

The smoke serves the production build with `vite preview`. It blocks every
non-local request, so no keys or tiles are used. It opens `/` in headless Chrome
(SwiftShader WebGL) and waits for the Cesium scene. It then renders a 256×256
central crop twice, with the globe shown and hidden. It passes when:

- at least **20%** of the crop changes (a channel delta above 24), and
- the luma standard deviation of the globe crop is at least **4**, so a flat
  fill fails.

Measured at `53f0caa6`: 98.27% of pixels changed, luma standard deviation 9.49,
ready in 6.7 s. The full-page screenshot is uploaded as `globe.png`. The
screenshot shows globe geometry and atmosphere only. Map imagery and Google 3D
tiles are not tested.

### Performance smoke (limits pending GEV-F3)

This gate runs the repository's two wall-clock benchmarks with their own
budgets, and never changes those budgets:

- icon model updates within 4 ms, 8 ms and 20 ms at N = 500, 2,000 and 5,000
- the dense continental moveEnd pipeline yielding every 4 ms

The gate runs 5 separate serial runs. A benchmark is over budget when it misses
in 3 or more of them. That benchmark fails the gate unless
`ci/factory/perf-baseline.json` lists it as already over budget at the baseline
commit on this runner class. Each listed entry carries its measured miss rate.
Listed benchmarks still appear in every description and JSON result. The gate
also returns `error` when the baseline's Node version or platform differs from
the runner's.

There is one listed entry today, measured on Boat `default` VMs with the
moveEnd pipeline:

- At `53f0caa6` it missed its 4 ms budget in 11 of 20 runs.
- On identical `src/` at the candidate head it missed in 14 of 20.
- Run alone, it missed in 16 of 20.
- The slowest slices measured 4.2 to 8.3 ms. Thread CPU time was about the
  same as wall time and steal was near zero, so the overrun is CPU work on this
  hardware, not noise.

The budget stays at 4 ms. Remove the entry once the layer meets it.

Limitations:

- This is a Node microbenchmark smoke on a shared x64 VM. It does not measure
  frame rate, GPU time, input latency or device resolution. Those belong to
  GEV-F3 (real-device hill climbs, for example on an S25).
- A listed benchmark is not checked for further regression. Until F3 lands, a
  green perf-smoke means only that no other CPU hot path went over its budget.

## Caching

- **Actions:** `.github/actions/factory-node` restores `node_modules` only on an
  exact key: `factory-nm-v1-<ImageOS>-<arch>-node<v>-npm<v>-<sha256(package-lock.json)>`.
  It sets no `restore-keys`, so a partial or older tree is never reused. A miss
  runs `npm ci`. Puppeteer's Chrome is cached under its own key, built from the
  same lockfile hash.
- **Boat:** every run starts from a fresh VM and runs `npm ci`. The measurements
  below show why a cache would save little there.

## Measured cost

Boat `default` VM: 4 vCPU (AMD EPYC 4585PX), 8 GiB, Ubuntu 24.04, Node 24.22.2,
npm 11.19.1. See `REPORT` in the PR for single-run numbers and their spread.
