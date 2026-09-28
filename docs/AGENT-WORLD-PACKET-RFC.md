# Agent World Packet RFC

Status: downstream experiment

## Goal

Turn God's Eye View into a low-latency world-state substrate that agents can consume without coupling upstream to Jev, z0intelligence, Ollama, MCP, or any specific model stack.

## Existing seams

- `get_current_view_state` already returns camera, controls, context/cockpit state, tracked entities, layer health/count/source/freshness, and feed provenance.
- `get_entity_context` already adds selected/in-view entity context plus scene context.
- `analyst_query` already supports bounded queries over loaded client data.
- `gods-eye-view/application` exposes composable scene, controls, data, and tools constructors.
- `gods-eye-view/voice/actions` already exports the application action runner.

## Design

### Layer 1: GEV World Packet

Create a first-class model-free application boundary, initially proposed as `gods-eye-view/agent/world-state`.

Fast path:

```js
getWorldPacket({ viewer, dataManager, styleManager, sceneDirector })
```

Enriched path:

```js
getEntityPacket({ viewer, dataManager, styleManager, placeSearch, scope, limit })
```

The fast packet must reuse the semantics of `get_current_view_state`; it must not create a competing representation.

Core fields:

```text
schemaVersion
generatedAt
camera / view
controls
context mode
cockpit
scene playback
tracked entities
layers[]: id, enabled, lifecycle/feed state, count, error, source, lastUpdate
feedProvenance
```

### Layer 2: optional local intelligence

Keep all model/framework integrations out of the core boundary:

```text
GEV World Packet
  -> deterministic filter/compression
  -> optional Jev verify
  -> optional local SLM router
  -> MCP / arbitrary agent consumer
```

z0/Jev integration should initially live downstream and consume the public packet.

## Latency experiment

- fast packet performs zero network requests
- measure 1000 warm reads
- record p50 / p95 / p99 and serialized byte size
- mutation cases for large layer counts, stale feeds, errors, empty feeds
- stale/unavailable must remain distinct from empty
- every live claim retains source/freshness/provenance
- no UI text scraping where a state owner exists
- adding an agent consumer must not increase idle render work
- do not invent a target latency before measuring current behavior

## First implementation wave

1. Extract current-view packet construction from `src/voice/gevActions.js` with no behavior change.
2. Make voice `get_current_view_state` delegate to the extracted builder.
3. Add parity tests between the existing tool result and the public packet builder.
4. Add a micro-benchmark / allocation guard.
5. Add the package export.
6. Build one non-voice consumer downstream.
7. Only then prototype Jev verification.

## Upstream stop conditions

Do not propose upstream until:

- voice/tool behavior is unchanged
- packet latency and size are measured
- at least one non-voice consumer works
- the API contains no z0/Jev-specific vocabulary
- provenance and failure semantics survive compression