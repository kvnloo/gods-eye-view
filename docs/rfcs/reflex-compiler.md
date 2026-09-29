# RFC — Reflex Compiler: Routine -> Suggestion -> Macro -> Reflex

Status: downstream experiment
Date: 2026-09-28

## TL;DR

Repeated successful GEV interaction sequences should be able to compile into
small deterministic shortcuts without teaching a model to silently operate the UI.

Progression:

```
repeated explicit sequence
  -> candidate routine
  -> surfaced suggestion
  -> user-confirmed macro
  -> verified deterministic reflex
  -> drift demotion when assumptions stop holding
```

## Examples

- select wildfire -> Recent Imagery -> nearby CCTV;
- enable Weather -> Radar -> Tactical HUD;
- select aircraft -> Contacts -> Cockpit;
- open one investigation layout repeatedly.

## Episode format

Learn only from bounded verified episodes:

```js
{
  contextFingerprint,
  actions: [
    { name, args, result }
  ],
  outcome,
  correctionOrUndo,
  startedAt,
  completedAt
}
```

No hidden keystroke replay.

## Promotion stages

### 1. Candidate
Sequence repeated with stable context/action identity.

### 2. Suggestion
Surface one-tap macro only above a high utility/confidence threshold.

### 3. Confirmed macro
User explicitly accepts a named deterministic routine.

### 4. Reflex
Routine may be offered as the default compact action for that context, but visible
state changes still require the authority level granted to the macro.

## Drift demotion

A compiled reflex is demoted when:

- an action/schema disappears;
- source/capability availability changes;
- outcome verification begins failing;
- user repeatedly overrides/undos it;
- context distribution changes materially.

Demotion is preferable to silently expanding model reasoning.

## Authority

A routine stores only the authority explicitly granted to it.

Preparation and suggestion can be broader than commit authority.

No routine may inherit a sensitive permission merely because a similar prior
sequence had it.

## Metrics

- interactions removed;
- post-commit latency saved;
- suggestion acceptance;
- correction/undo rate;
- verified-success rate;
- drift detections;
- frontier/model calls avoided.

## First experiment

Compile one existing, fully reversible three-step workflow in shadow mode and
compare:

- manual sequence;
- suggested macro;
- confirmed macro.

No autonomous execution in v1.
