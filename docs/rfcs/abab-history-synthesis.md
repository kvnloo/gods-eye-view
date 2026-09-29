# ABAB History Synthesis — UX Patterns Recovered Across Projects

Date: 2026-09-28
Purpose: explain why the next GEV UX RFCs exist and which older ideas they compress.

## Method

The review alternated two passes:

- **A — recover** a recurring idea from prior projects/conversations;
- **B — challenge** whether it transfers into GEV without duplicating an existing
  owner or becoming a grand rewrite.

Ideas survived only when they reappeared across multiple projects/years and could
be expressed as a small, testable GEV control or interaction contract.

## Evolution

### 2023 — attention and future literacy

Early health/digital-twin work already treated software as a decision environment,
not merely a dashboard. The recurring questions were:

- how does the interface help someone understand consequences?
- how do we avoid retention/infinite-scroll mechanics that pull attention away
  from intended goals?
- how can a spatial/digital twin expose current state, trends, and possible futures?

GEV transfer:
- attention is a scarce resource;
- interruption should be governed;
- hypothetical state must remain visibly separate from observed state.

### 2024 — autonomous builder as observable project twin

The self-learning project builder combined:

- blueprint/project state;
- task dependency graphs;
- agent rosters;
- event streams;
- reusable skill libraries;
- adaptive curriculum;
- browser/sandbox/Unity digital-twin views;
- continuous testing and cost-aware model routing.

GEV transfer:
- one durable state can have many projections;
- execution needs receipts and observability;
- repeated successful procedures can become reusable skills/macros;
- event streams should show change rather than duplicate full state.

### 2025 — Flow View and living dashboards

The dashboard work moved from static pages toward:

- active-stage focus;
- agent clusters/hierarchy;
- stage-filtered logs;
- questlines/skill trees;
- XP/progress and blockers;
- drill-down only when needed;
- living/breathing visual state rather than permanently expanded controls.

GEV transfer:
- attention ownership should follow the current task;
- ambient/focus/detail projections should be explicit;
- capability discovery can be contextual rather than tutorial-heavy.

### Early/mid 2026 — Aural, PIPR, learning canvases, digital twins

Aural/PIPR/learning work repeatedly converged on:

- hide technical complexity while exposing trust;
- signal-flow/state diagrams rather than settings dumps;
- confidence/provenance/freshness visible near the claim;
- interfaces that teach while being used;
- adaptive difficulty and "next operation" rather than more explanation;
- predicted-vs-residual overlays;
- developer observability separated from calm user surfaces.

GEV transfer:
- show known/unknown/conflict and the next discriminating observation;
- maintain a quiet operator surface with a deeper lab/debug layer;
- branch hypothetical/simulated state instead of mixing it with live truth.

### September 2026 — Ripple, AODL, Workspace-Copilot, JEV, CUA

This period made the interaction loop much more concrete:

```
predict -> prepare -> surface -> commit -> verify -> learn
```

Recurring hard constraints:

- PREPARE can tolerate lower confidence than SURFACE;
- surface only when utility/confidence clears a high threshold;
- no focus stealing;
- speculative work must be discardable;
- explicit commit owns visible mutation;
- verify observed outcome rather than trusting intent;
- recurring stable workflows should compile toward deterministic routines;
- drift demotes routines;
- use structured/semantic evidence first and escalate to vision only when
  ambiguity requires it.

GEV transfer:
- Attention Governor;
- Reflex Compiler;
- Minimum-Sufficient Perception Ladder;
- Intervention Value Lab.

### Architecture/memory/z0archy — state estimates, packets, replay and forks

Later system-architecture work added:

- typed state/evidence graphs;
- stable identity + temporal validity;
- State Packets as bounded projections;
- observed vs inferred vs predicted vs counterfactual state;
- append-only history and deterministic replay;
- branching/counterfactual worlds;
- UI as projection rather than truth owner.

GEV transfer:
- World Packet (already tracked);
- Branchable Investigation Workspace;
- Resolution Lens over evidence gaps rather than another canonical truth layer.

## Ideas rejected as duplicates

The history review also recovered ideas that are already represented in the
current GEV UX wave, so they do not need new RFCs:

- semantic zoom / progressive disclosure -> #37 / upstream #815;
- command palette / universal intent -> #41 / upstream #813;
- change-first event stream -> #38 / upstream #814;
- prepare/commit -> #49 / #62;
- selected evidence braid -> #56;
- temporal comparison -> #55 / #60;
- JEV fast routing -> #43 / upstream #812;
- World/State Packet -> #42;
- explicit voice state -> #44 / upstream #817;
- foveated density -> #57.

## New survivors

Six ideas remained both recurrent and insufficiently represented:

1. **Attention Governor** — interruptibility as an explicit shared budget.
2. **Reflex Compiler** — verified repeated workflows compile toward deterministic shortcuts.
3. **Minimum-Sufficient Perception Ladder** — structured state first, vision only when needed.
4. **Resolution Lens** — known / unknown / conflict / next discriminating probe.
5. **Branchable Investigation Workspace** — disposable fork over live state, explicit commit/discard.
6. **Intervention Value Lab** — randomized withholding to measure causal value of proactive UI.

These are deliberately orthogonal: policy, learning/compilation, perception,
epistemic interaction, workspace/state branching, and measurement.

## Promotion principle

Do not merge these concepts as one platform rewrite.

Each RFC must first produce one small experiment with:
- an existing semantic owner;
- explicit acceptance/stop criteria;
- before/after or treatment/control evidence;
- zero silent authority expansion;
- independent deletability if the experiment fails.
