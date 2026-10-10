# RFC — Attention / Information-Density Experiment Queue

Status: downstream work queue
Date: 2026-09-28

Each experiment must be independently reversible and measured before becoming a
cross-app convention.

## E1 — Panel ownership invariant

Fix #804 class bugs by enforcing parent/nested disclosure ownership before no-op
returns. Add regression coverage for compact Radio + Context.

Success: zero overlap; no new z-index exception.

## E2 — Semantic panel summaries

Prototype ambient/focus/detail summaries on Weather and Context.

Success: collapsed state communicates identity + health + newest material change.

## E3 — What Changed ribbon

Bounded/coalesced activity ribbon with stable ids and <=100 ms batching.

Success: visible state changes without scroll churn or repeated unchanged events.

## E4 — Focus lens

Presentation-only fading of unrelated overlays while an explicit entity is selected.

Success: selected target is obvious; exact prior state restores on exit.

## E5 — Text scale

One global UI text-scale setting using shared CSS variables, not per-panel overrides.

Success: 100/115/130% survives major panels without clipping at target viewports.

## E6 — Keyboard command palette

Command search over the existing typed action vocabulary.

Success: common actions execute without bespoke DOM click automation.

## E7 — World Packet

Deterministic bounded state packet for voice/JEV/HUD.

Success: <=8 KiB default packet; unknown/freshness/provenance preserved.

## E8 — JEV shadow router

Run bounded route classification with no authority.

Success: measured latency/agreement/abstention receipts; no media-path regression.

## E9 — Voice state pill

Explicit `idle -> connecting -> listening -> thinking -> speaking -> interrupted`
presentation independent from raw audio amplitude.

Success: state changes are understandable without opening a voice panel.

## E10 — Transcript sidecar

If input transcription is intentionally enabled and cost-accounted, show short-lived
user/assistant captions as a sidecar; do not make transcript timing part of the
audio-control path.

Success: captions never block tool execution or speech interruption.

## E11 — Provenance/freshness micro-badges

Use one compact grammar for LIVE / STALE / PARTIAL / UNAVAILABLE + source.

Success: same semantic states render consistently across two unrelated layers.

## E12 — Delta-first cards

Keep stable metadata behind disclosure; surface only material changes on the primary
card.

Success: fewer repeated lines while preserving full detail on demand.

## E13 — Prepare/commit

Pre-resolve candidate entity/action or warm data before the user commits.

Success: lower post-commit latency; zero visible side effect before commit.

## E14 — Attention telemetry

Development-only receipt stream:

```
input -> referent -> action -> first feedback -> completion -> correction/undo
```

Success: metrics can compare variants without logging private content by default.

## E15 — Agent trace drawer

Collapsed-by-default trace for model actions:

```
intent -> route -> tool -> result -> verification
```

Success: enough evidence to debug an action without adding permanent HUD noise.

## E16 — Quiet / observation mode

One reversible command hides nonessential chrome while preserving a small status strip
and all data acquisition.

Success: map remains operable; Escape/command restores exact prior presentation.

## Promotion rule

Do not merge multiple experiments into one architectural PR. A successful experiment
earns a small shared primitive; unsuccessful experiments are deleted without leaving
compatibility baggage.
