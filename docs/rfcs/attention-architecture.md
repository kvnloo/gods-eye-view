# RFC — Attention Architecture for God's Eye View

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV should optimize for **information throughput, not panel count**.

The globe is the primary surface. UI should progressively disclose only the state
needed for the current task. Background state remains available without competing
for attention.

The core interaction rule:

```
world state -> attention ranking -> compact signal -> optional detail -> explicit action
```

No feature should need to invent its own modal, toast, panel, or focus policy.

## Goals

1. Reduce simultaneous competing surfaces.
2. Keep the selected entity/task visually obvious.
3. Preserve provenance, freshness, uncertainty, and failures without verbose cards.
4. Make state changes more visible than unchanged state.
5. Keep background work visible but non-invasive.
6. Never steal keyboard/pointer focus for an automatic update.
7. Preserve user-authored layout/share state separately from responsive presentation.

## Attention states

Every attention-bearing surface can be described by one presentation state:

- `background` — state exists but needs no visible chrome.
- `ambient` — one-line/count/status signal.
- `focus` — current user-selected object/task.
- `critical` — bounded exception requiring awareness.

This is presentation metadata only. It must not change source truth or layer enablement.

## Compact visual grammar

Prefer a small repeated grammar over bespoke cards:

- identity
- newest material delta
- freshness
- provenance/source
- confidence/uncertainty when applicable
- one primary action
- explicit expansion for the rest

Collapsed panels should answer: **what is this, is it healthy, did it change?**

Expanded panels should answer: **what can I do next?**

Full detail should answer: **why should I trust this?**

## Rail ownership

Each panel rail should have one preferred expanded owner.

Rules:

- explicit user expansion updates preferred ownership;
- responsive auto-collapse never overwrites the saved preference;
- automatic updates may change content but never steal preferred ownership;
- nested surfaces cannot paint outside the measured owner unless explicitly registered;
- stale nested disclosures are closed when their parent owner changes state.

This turns panel layout from CSS coincidence into an explicit attention contract.

## Semantic zoom

The same data should project differently at different attention levels.

Example:

```
Weather
  ambient:  RADAR · 4m old · LIVE
  focus:    3 cells nearby · +1 strengthening
  detail:   timeline, provenance, provider, controls
```

No new data pipeline is required. Existing layer stats, selected context, and row
controls are enough for the first experiments.

## Focus lens

A selected entity or explicit investigation may activate a reversible
presentation-only focus lens:

- brighten selected/source-related overlays;
- fade unrelated labels/cards;
- preserve enabled layers and background acquisition;
- keep one compact indicator that other layers remain active;
- restore exact prior presentation on exit.

Focus lens must not silently disable data or mutate share-authored layer state.

## Change-first presentation

Prefer deltas over repeated full snapshots:

- `+12 aircraft`
- `camera source recovered`
- `storm advisory 10 -> 11`
- `FIRMS stale -> live`

Stable unchanged state should decay toward ambient presentation.

## UX metrics

Experiments should report at least:

- time to first useful feedback
- time to resolve task
- clicks/taps/voice turns
- accidental panel/context switches
- stale or contradictory visible state
- keyboard-focus displacement
- p50/p95 action feedback latency

## Initial experiments

1. Fix nested Radio/Context ownership (#804).
2. Add compact text-size/readability controls without bespoke per-panel CSS.
3. Add one generic attention-state helper for rail surfaces.
4. Prototype semantic summaries for 2 existing panels.
5. Prototype a bounded "what changed" ribbon.
6. Measure before expanding scope.

## Stop conditions

Do not proceed with a global rewrite if the first experiments:

- increase interaction count;
- hide failures/freshness;
- require layer-specific ownership exceptions;
- mutate source state for presentation reasons;
- create additional global event buses for already-owned state.
