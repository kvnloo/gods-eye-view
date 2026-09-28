# RFC — JEV as the Realtime Control Coprocessor

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV already has realtime voice. JEV should **not** replace the audio/media path.

Use JEV as a fast bounded decision layer beside realtime voice:

```
audio/media plane
  microphone <-> realtime voice provider

control plane
  speech intent / pointer / selection / view state
            |
      deterministic reflex
            |
          JEV
            |
   strong-model fallback
            |
      typed GEV action
            |
     deterministic verify
```

The media plane stays continuous and interruptible. JEV never processes 20–80 ms
audio frames.

## Why

Most GEV voice actions are routing problems, not open-ended reasoning:

- open/close a known panel;
- toggle a layer;
- act on the selected entity;
- choose nearby cameras;
- change HUD/style;
- navigate to a known target;
- decide whether a request needs clarification or a stronger model.

A bounded router can reduce tool-call latency/cost while keeping the existing
realtime provider responsible for conversational audio.

## Inputs

JEV receives a small typed snapshot:

```js
{
  utterance,
  selected: { id, layerId, label } | null,
  pointerTarget: { id, layerId } | null,
  view: { lat, lon, height, tracked },
  activeSurface,
  enabledCapabilities,
  candidateActions
}
```

No raw framebuffer or giant DOM/accessibility dump on the default path.

## Output

```js
{
  route: "direct" | "manipulate" | "query" | "delegate" | "ask" | "ignore",
  action: string | null,
  args: object | null,
  confidence: number,
  abstain: boolean,
  reasonCode: string
}
```

The executor remains deterministic and validates schema/authority independently.

## Routing ladder

1. Deterministic exact/reflex match.
2. JEV bounded classifier/router.
3. Existing realtime/frontier tool reasoning.
4. Ask the user when ambiguity remains.

JEV may abstain at any point.

## Latency target

Shadow-mode objective:

- deterministic reflex: effectively immediate;
- JEV warm p50: <250 ms target;
- JEV hard budget: 800 ms;
- slower/uncertain -> fall through, never block realtime audio indefinitely.

These are experimental targets, not user-visible guarantees.

## Deictic control

Selection/pointer should resolve language such as:

- "show cameras near this"
- "verify this"
- "hide everything else for a second"
- "what changed here?"
- "follow that one"

The referent comes from explicit selected/pointer context, not model-inferred screen
coordinates.

## Prepare -> commit

For predictable expensive actions JEV may prepare without committing:

- pre-open source metadata
- resolve candidate entity ids
- warm the relevant panel/data
- precompute candidate actions

Only explicit user intent commits visible/destructive state.

## Verification

Every executed action returns a typed outcome. JEV may perform a bounded
post-action "done?" classification, but truth comes from the action owner.

Never confirm from intent alone.

## Shadow experiment

First implementation has **no authority**.

Record:

- utterance/input state
- deterministic route
- JEV route/confidence
- production route/action
- agreement/disagreement
- latency
- eventual action result

No user-facing behavior changes until the route is calibrated.

## Success criteria

Promote only if:

- safe-coverage improves without increasing wrong actions;
- p95 control latency remains bounded;
- abstention catches ambiguous cases;
- exact commands do not become slower;
- audio interruption/yield behavior is unchanged;
- no second competing voice state machine appears.

## Non-goals

- replacing realtime audio;
- giving JEV direct DOM mutation;
- letting model confidence authorize sensitive actions;
- always-on screenshot analysis;
- learning hidden user behavior without explicit bounded signals.
