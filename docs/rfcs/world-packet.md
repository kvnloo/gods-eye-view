# RFC — Deterministic World Packet

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV has rich state, but each consumer currently decides how much of it to inspect.

Create one bounded, deterministic **World Packet** for voice, agents, compact HUD
summaries, and debugging.

It is a view of existing truth, not a new truth owner.

## Shape

```js
{
  generatedAt,
  camera,
  selected,
  tracked,
  activeContext,
  panels,
  layers: [
    {
      id,
      enabled,
      count,
      loading,
      freshness,
      error,
      source
    }
  ],
  nearby: [],
  materialChanges: [],
  limitations: []
}
```

## Principles

- deterministic for the same application state;
- bounded by explicit item/byte budgets;
- preserve unknown vs false/zero;
- preserve freshness/provenance;
- selected/tracked context outranks arbitrary nearby density;
- no model call required;
- no execution authority.

## Relationship to existing work

This is intentionally narrower than a full evidence/reality-state context builder.
It packages the **current interactive application state** for low-latency consumers.

Existing `get_current_view_state`, `get_entity_context`, layer stats, and share
state are candidate inputs.

## Budget

Initial target:

- <= 8 KiB serialized default packet;
- <= 12 nearby/selected records;
- one record per active layer by default;
- material changes bounded by time/count;
- large raw metadata remains behind explicit retrieval.

## Consumers

1. Realtime voice tool preamble.
2. JEV route classification.
3. "What am I looking at?" compact HUD.
4. MCP/agent read-only world-state endpoint.
5. QA receipts for reproducible interaction tests.

## Material changes

A packet may optionally carry stable-id deltas:

```
entity added
entity removed
source stale/live transition
selection changed
advisory/version changed
panel/context ownership changed
```

Do not infer semantic importance from raw update count alone.

## Acceptance criteria

- deterministic fixture tests;
- unknown stays unknown;
- stale/partial state survives compression;
- no source-specific branching in consumers;
- selected entity remains stable across unrelated refreshes;
- packet generation performs no network/model call;
- packet build stays below a small measured CPU budget.

## Stop condition

If consumers still need direct access to many bespoke globals, fix ownership first
instead of turning World Packet into a dump of the entire runtime.
