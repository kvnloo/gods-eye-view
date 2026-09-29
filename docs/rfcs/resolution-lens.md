# RFC — Resolution Lens: Known / Unknown / Conflict / Next Probe

Status: downstream experiment
Date: 2026-09-28

## TL;DR

When the user asks a difficult spatial question, GEV should not merely produce a
longer summary. It should show:

1. what is established;
2. what is uncertain or conflicting;
3. the **next discriminating observation** that would reduce uncertainty most.

The interface becomes a puzzle-resolution surface rather than a text dump.

## Example

Question: "Is this wildfire expanding toward the road?"

```
KNOWN
- FIRMS detections moved east over 3 observations
- NIFC perimeter timestamp: 18m old

UNKNOWN
- current road-side flame front
- cloud obstruction in latest satellite tile

CONFLICT
- none

NEXT PROBES
1. Recent Imagery at road intersection
2. nearest public camera covering east flank
3. wait for next perimeter revision
```

The probe is an action proposal, not a conclusion.

## Resolution state

```js
{
  question,
  known: [],
  unknown: [],
  conflicts: [],
  candidateExplanations: [],
  probes: [
    {
      action,
      expectedInformationGain,
      cost,
      latency,
      prerequisites
    }
  ]
}
```

Expected information gain can begin as a deterministic heuristic; no false
precision is required.

## Interaction

The lens can project onto:

- selected entity;
- bounded investigation;
- current view.

A user can execute one probe, after which the lens recomputes from new evidence.

## Guardrails

- missing data remains unknown;
- no probe implies its expected result;
- simulated/hypothetical evidence is labeled;
- source conflicts remain visible;
- low-confidence discrimination asks for clarification instead of ranking a fake winner.

## Relationship to existing GEV work

The deep Reality State / Investigation / Research issue family owns evidence and
canonical knowledge. This RFC is only the **operator interaction projection**
that turns a knowledge gap into a next observation.

## Metrics

- probes required to resolve a question;
- unnecessary probes;
- time to resolution;
- user overrides of proposed probe;
- unresolved questions correctly left unresolved.

## First experiment

Use the existing hazard evidence stack with a fixed question template and compare
"summary only" vs "known/unknown/next probe".
