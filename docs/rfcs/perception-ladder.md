# RFC — Minimum-Sufficient Perception Ladder

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV agents should inspect the **minimum sufficient evidence** needed for the
current decision instead of defaulting to the full framebuffer, DOM, context
store, and model.

Escalation ladder:

```
typed app state
  -> World Packet
  -> selected/source record
  -> scoped spatial query
  -> region/crop
  -> fresh viewport image
  -> stronger multimodal reasoning
```

Stop as soon as the decision is supported.

## Why

For many actions GEV already knows the exact semantic state:

- selected entity id/layer;
- layer stats/freshness;
- camera coordinates;
- typed action vocabulary;
- panel/context owner.

Sending a screenshot to infer those facts is slower and less reliable.

Conversely, some tasks genuinely require visual evidence. The ladder preserves
that escape hatch.

## Request contract

A consumer asks for evidence by purpose:

```js
{
  questionKind,
  requiredFields,
  spatialScope,
  temporalScope,
  maxLatencyMs,
  maxBytes,
  maxModelTier
}
```

The resolver returns the cheapest sufficient bundle or abstains/escalates.

## Missed vs wasted perception

Track two failure classes separately:

- **missed perception** — lower tier lacked necessary evidence;
- **wasted perception** — higher tier was invoked although lower-tier evidence
  was already sufficient.

Optimizing only one creates the other.

## Visual escalation

When vision is required:

- prefer a referent-centered crop/region;
- request a fresh rendered frame only when stale visual state could matter;
- attach the structured referent beside the image;
- keep capture bounded and revocable.

## Relationship to voice/JEV

- World Packet (#42) is the default structured tier.
- JEV shadow router (#43) can request escalation instead of guessing.
- local STT sideband (#63) supplies spoken semantic input, not visual state.
- existing Realtime viewport screenshot remains the high-cost visual tier.

## Metrics

- tier chosen;
- decision accuracy;
- escalation rate;
- missed vs wasted perception;
- tokens/bytes;
- p50/p95 decision latency.

## Stop condition

Do not build a generic framework until two consumers demonstrate the same
escalation contract.
