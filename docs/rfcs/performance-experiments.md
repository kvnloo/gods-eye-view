# RFC — Field Performance Experiment Queue

Status: downstream work queue
Date: 2026-09-29
Parent: #103

Every experiment must be independently measurable, reversible and small enough to
review without accepting the entire performance architecture.

## P1 — Explicit potato render profile

Add `?performance=potato` while keeping the default viewer unchanged.

Initial candidate:
- target frame rate 30;
- MSAA 1;
- resolution scale 0.75.

Success: lower frame/GPU cost on constrained hardware with identical source state.

## P2 — Performance budget harness

Record frame-time percentiles, long tasks, heap where available, source cohort
counts, renderer/DPR and network counts for scripted scenes.

Success: one reproducible low-end journey with committed thresholds (#110).

## P3 — Singleflight request primitive

Implement caller-independent request joining with cancellation tests.

Success: N equivalent concurrent callers cause one loader execution.

## P4 — One broker adoption

Move one cache-safe request family to the broker.

Success: fewer upstream calls with identical freshness/error semantics.

## P5 — Traffic simulation decimation

Update traffic simulation at a bounded cadence and visually interpolate.

Success: lower CPU p95 at large dot counts with no selected-road correctness loss.

## P6 — Ambient overlay pressure ladder

Reduce ambient cards/labels before selected/tracked state.

Success: frame-time recovery under overload without losing the focused object.

## P7 — Field Lite manual map switch

Expose a cheap map path associated with the low-end profile.

Success: lower startup/network/GPU cost; exact selection state survives switching.

## P8 — Mobile bottom sheet

Replace desktop rail collision on narrow screens with one owned sheet.

Success: scripted select/inspect/toggle task has no unreachable controls at target
phone viewports.

## P9 — Read-only Remote companion

Paired mobile page receives bounded state from desktop but cannot mutate it.

Success: reconnection, expiry and stale-state behavior are explicit.

## P10 — Adaptive governor shadow mode

Compute quality decisions but do not apply them.

Success: logs show stable decisions with hysteresis on recorded workloads.

## P11 — Adaptive governor active mode

Apply only policies validated in shadow mode.

Success: p95 interaction improves without oscillation or selected-evidence loss.

## Promotion rule

Promote measured leaves, not the umbrella. A failed experiment should be deleted
without leaving compatibility baggage.
