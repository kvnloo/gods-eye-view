# RFC — Branchable Investigation Workspace

Status: downstream experiment
Date: 2026-09-28

## TL;DR

Give the operator a disposable investigation workspace that can branch from the
live globe, explore alternatives, and then be committed or discarded without
polluting canonical live state.

Think **RAM workspace over a durable world**.

## Modes of state

Every workspace artifact is explicitly classified:

- observed;
- derived;
- inferred;
- predicted;
- hypothetical/counterfactual;
- user-authored annotation.

The renderer must never make hypothetical state look like live observation.

## Branch operation

```
LIVE WORLD
   |
   +-- fork investigation A
   |     compare sources
   |     annotate
   |     replay time
   |     test hypothetical route/extent
   |
   +-- live world keeps updating independently
```

The branch records its base world-state identity/time.

## What can live in a branch

- temporary layer/panel layout;
- selected evidence set;
- annotations;
- comparison configuration;
- time offset;
- prepared queries/results;
- hypothetical overlays;
- notes and candidate conclusions.

## What cannot silently cross back

- simulated entities;
- inferred facts;
- hypothetical geometry;
- temporary source state;
- unverified conclusions.

Commit is explicit and typed:

- save annotation;
- save scene;
- create/share investigation artifact;
- promote a verified evidence reference.

## Live drift

If the live world changes after fork:

- branch stays historically coherent;
- show drift indicator;
- user may rebase selected live evidence explicitly;
- never rewrite historical branch evidence in place.

## Why this matters

It separates exploration from truth and makes comparison/replay safe for both
humans and agents.

## First experiment

Branch only presentation + selected evidence + annotations from one hazard
workflow. No simulation engine required.

## Metrics

- accidental live-state mutation;
- branch restore fidelity;
- commit/discard clarity;
- time to compare alternatives;
- stale-base detection.
