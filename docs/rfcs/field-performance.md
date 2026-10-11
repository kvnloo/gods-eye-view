# RFC — Field Performance and Minimum-Sufficient Rendering

Status: downstream experiment
Date: 2026-09-29
Parent: #103

## TL;DR

GEV should remain operational on weak hardware by protecting **interaction latency
and source truth before visual density**.

The degradation ladder is:

```
source truth
  -> selected / critical evidence
  -> compact ambient evidence
  -> lightweight map context
  -> decorative detail
```

When resources are constrained, remove work from the bottom upward. Never make
freshness, provenance, or an unknown state disappear merely to preserve visuals.

## Why now

The existing Apple M5 baseline is useful but already shows expensive scenes:
dense detection, vessels, FIRMS and combined operational views drop materially
below 60 FPS, while some large layer combinations consume hundreds of MiB of JS
heap. Upstream #365 reports severe stutter on capable-but-non-reference hardware.

The current render governor solves idle waste. This RFC addresses the harder
case: **active scenes whose useful work exceeds the device budget**.

## Performance profiles

Start explicit, not magical.

- `standard` — today's behavior.
- `potato` — lower render resolution, AA and continuous target FPS.
- future `auto` — only after PERF-07 establishes reliable thresholds.

An explicit profile makes A/B testing deterministic and gives field operators a
known escape hatch before automatic adaptation is trusted.

## Adaptive quality order

A future governor may degrade only in a documented order:

1. ambient card/label cohort;
2. optional post-processing and decorative effects;
3. render resolution / antialiasing;
4. background simulation/update cadence;
5. expensive map detail / photorealistic tiles.

Selected or tracked objects receive protected budget. Critical alerts may evict
ambient content, never the reverse.

Recovery needs hysteresis. A single fast frame must not immediately restore a
costly tier and create oscillation.

## Frame-work budget

Rendering at 30 or 60 FPS does not require every subsystem to simulate at the
same frequency.

Examples:

- pointer/camera feedback: render cadence;
- selected object: high cadence;
- traffic/vessel simulation: 10–20 Hz plus interpolation;
- static cohort allocation: camera/data changes only;
- remote/network refresh: source-defined cadence.

Large reconcile operations should yield across frames or move to workers.

See #105.

## Field Lite map stack

Photorealistic 3D is presentation, not source truth.

A field profile should be able to start with inexpensive imagery and bounded
overlays, then request expensive 3D only for a selected area or explicit user
choice.

A map downgrade must preserve:
- camera/selection identity;
- active layers;
- source status;
- freshness/provenance;
- share/restoration semantics where applicable.

See #107.

## Memory

Every cache and retained render cohort needs a cap and an owner.

Prefer:
- bounded LRU;
- exact byte/count diagnostics;
- release on layer disable where reuse value is low;
- no duplicate decoded representations unless measured;
- last-good data kept separately from presentation caches.

A low-end mode should reduce retained ambient work before evicting the currently
selected evidence.

## Network

Do not solve network latency with more polling.

The shared direction is:
- singleflight equivalent requests;
- caller-local cancellation;
- viewport supersession;
- source-specific SWR/last-good eligibility;
- bounded caches;
- conditional requests where supported.

See #106 and `request-broker.md`.

## Mobile

Direct mobile GEV and remote-companion GEV are different products:

1. **Direct mobile** renders a lightweight GEV locally and needs touch-first UI.
2. **GEV Remote** lets the desktop own heavy rendering/providers and sends a
   bounded control/state surface plus optional video to the phone.

Direct mobile is required even if Remote exists because remote connectivity may
fail in the field.

See #108, #109 and `mobile-field-runtime.md`.

## Acceptance

The first calibrated potato scenario targets:
- >=30 FPS steady interaction;
- p95 frame <=33 ms;
- no recurring >100 ms main-thread stalls;
- <350 MiB used JS heap for the representative operational scene;
- no duplicate equivalent network request while one is already in flight.

These are regression targets, not a public minimum-hardware specification.

## Stop conditions

Do not merge an automatic governor if:
- it oscillates visibly;
- it hides selected/critical evidence;
- its decisions cannot be explained in diagnostics;
- quality switching costs more frame time than it saves;
- device detection rather than measured runtime pressure drives policy.
