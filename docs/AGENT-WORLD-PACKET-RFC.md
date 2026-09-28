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
## Humanitarian compute track

### Product question

Can the World Packet help coordinate humanitarian response by turning public
need/access/context data plus explicitly supplied resource capacity into bounded,
auditable candidate actions?

Do not build another crisis dashboard. Build the analysis-to-action handoff.

### Relief Packet

Layer a humanitarian packet on top of the generic World Packet:

```text
Relief Packet
  crisis
    event type / severity / affected geometry / observedAt / source
  need
    population / food-security phase / requested commodities / uncertainty
  access
    roads / route matrix / isochrones / known closures / freshness
  response
    operational presence / known facilities / explicitly supplied stock/capacity
  context
    curated situation reports / provenance / freshness
  gaps
    unmet need / unreachable areas / duplicate-response risk / missing evidence
```

### Candidate public sources

- GDACS: rapid-onset disaster alerts and geospatial event data.
- HDX HAPI: standardized humanitarian indicators, including IPC/CH acute food
  insecurity, WFP food prices, population/context, and operational presence.
- HOT/OpenStreetMap: roads, buildings and mapped humanitarian infrastructure.
- ReliefWeb: curated situation reports and disaster metadata.
- openrouteservice/VROOM: route matrices, isochrones and vehicle-routing
  optimization; keep the engine swappable/local where possible.

### First experiment: food distribution planning

Use a historical or synthetic crisis first. Given:

- affected admin areas and food-security estimates;
- one or more depots with explicit stock;
- a small vehicle fleet with explicit capacity/time windows;
- current or fixture road/access constraints;

produce:

- candidate delivery quantities per zone;
- candidate routes / fleet assignment;
- expected unmet need after the plan;
- areas excluded because evidence/access/capacity is unknown;
- provenance and timestamp for every input;
- a compact explanation of why each candidate allocation exists.

### Optimization objective

Prefer deterministic optimization over model judgement.

Candidate objective components:

```text
minimize
  weighted unmet need
  + delivery time
  + route/access risk
  + duplicate-response penalty
subject to
  stock
  vehicle capacity
  time windows
  route availability
  explicit organizational constraints
```

Fairness and priority weights must be explicit inputs/policy, not inferred by
a language model.

### Jev / local-intelligence role

Jev does not choose who receives aid. It can:

- verify that a proposed action is supported by the packet;
- detect missing/stale/conflicting evidence;
- check that the compact explanation matches the deterministic optimizer result;
- route ambiguous cases to a larger model or human reviewer;
- reject plans whose preconditions changed after optimization.

### Safety / humanitarian operating rules

- aggregate/admin-area planning first; no individual tracking;
- public or explicitly authorized data only;
- never infer stock, shelter capacity, road safety or organizational presence
  when the source is unknown;
- distinguish `unknown`, `zero`, `unreachable`, `stale`, and `not assessed`;
- recommendations are candidate plans until confirmed by the responsible
  humanitarian operator;
- preserve source license/attribution and timestamps through every packet;
- keep a receipt for every plan input and optimizer output.

### Suggested first benchmark

Reproduce a historical disaster-delivery problem such as the public
openrouteservice Cyclone Idai medical-goods example, then replace the fixture
need layer with HDX/HAPI-derived humanitarian indicators.

Compare:

1. naive nearest-first routing;
2. deterministic capacity-aware optimization;
3. robust optimization with one injected road outage;
4. the same plan after World/Relief Packet compression + Jev verification.

Measure total travel time, served need, unmet need, recompute latency, serialized
packet size, and whether stale/unknown inputs survive compression.

### Stop conditions before any live operational use

- historical/synthetic benchmark passes;
- missing-data mutations cannot silently become zero;
- route outage forces a replan rather than replaying the old dispatch;
- optimizer result is reproducible from its receipt;
- human-readable explanation is mechanically consistent with the result;
- no model is required for the core plan;