# RFC — Intervention Value Lab

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV should not assume that a proactive suggestion, animation, hint, prefetch, or
attention intervention is useful just because users occasionally click it.

Add a development-only experiment layer that can **randomly withhold** an eligible
intervention and compare verified outcomes.

This measures causal value rather than correlation.

## Why

A suggestion is often surfaced in exactly the moments where the user was already
likely to take that action.

Acceptance rate alone therefore overstates value.

## Experiment unit

```js
{
  experimentId,
  eligibilityContext,
  intervention,
  assignment: 'surface' | 'withhold',
  outcomeWindow,
  verifiedOutcome,
  correctionOrUndo,
  latency,
  interactions
}
```

No private content is required for the default receipt.

## Suitable interventions

- next-action shelf;
- prepare/commit prefetch;
- semantic summary;
- What Changed prominence;
- attention-governor disposition;
- compiled routine suggestion.

## Primary metrics

- task completion;
- time to completion;
- interactions/turns;
- corrections/undo;
- focus displacement;
- compute/network cost;
- verified outcome quality.

## Guardrails

- experiments cannot withhold critical safety/error state;
- accessibility behavior is never a treatment;
- assignment is stable within one interaction episode;
- experiment state is development-only until explicitly productized;
- no dark-pattern optimization for retention/session length.

## Relation to Interaction Lab

Interaction Lab (#46) records what happened.

Intervention Value Lab answers the stronger question:

**did surfacing this intervention cause a better outcome than withholding it?**

## First experiment

Randomly withhold the prepare-only next-action shelf for eligible hazard
selections and compare time/interactions to the same evidence action.
