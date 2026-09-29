# Reflex Compiler

Status: downstream RFC / bounded experiment  
Tracking: #75  
Parents: #24, #53

## TL;DR

Compile **verified repeated GEV workflows** into deterministic shortcuts, but keep prediction, preparation, and execution authority separate.

The control loop is:

```text
observe
  -> predict
  -> prepare
  -> validate
  -> commit
  -> verify
  -> learn
```

Preparation may be speculative and cheap. **Commit is never speculative.** A compiled reflex only executes after current state, capability, freshness, and user-authority checks still pass.

The first experiment is one fully reversible workflow:

```text
selected hazard
  -> open/select supporting imagery
  -> focus nearest relevant CCTV
```

## Why

Repeated successful interaction sequences currently cost the same reasoning and UI work every time.

The goal is not keystroke replay. It is to learn a small deterministic program from repeated **action/result receipts**:

```text
candidate
  -> suggestion
  -> confirmed macro
  -> verified reflex
  -> drift demotion / retirement
```

This reuses the Workspace-Copilot principle that likely future work can be prepared before it is committed, while the real action owner remains authoritative.

## State and authority model

### Observe

Read state from existing GEV owners only.

Inputs may include:

- selection / tracked entity;
- current World Packet fingerprint/revision;
- enabled layers;
- camera/view state;
- available actions/capabilities;
- source freshness/provenance;
- prior verified action/result receipts.

Do not reconstruct authority from UI text.

### Predict

A predictor may propose the likely next bounded action or sequence.

Prediction is advisory:

```text
prediction = {
  sequenceId,
  confidence,
  expectedBenefit,
  requiredCapabilities,
  sourceStateFingerprint
}
```

A prediction cannot mutate GEV.

### Prepare

Preparation may do reversible/non-authoritative work early:

- resolve candidate imagery;
- resolve nearest relevant camera;
- warm deterministic lookups;
- precompute camera target/layout;
- validate action schemas;
- build an execution plan.

Preparation must not:

- change selection;
- move the camera;
- enable/disable authoritative layers;
- dispatch external side effects;
- silently commit a workflow.

Prepared work is revision-bound:

```text
PreparedReflex {
  sourceStateFingerprint
  capabilityRevision
  preparedAt
  expiresAt
  steps[]
}
```

If state/capabilities drift, discard or rebuild it.

### Validate

Immediately before commit, verify:

- the referenced entity still exists;
- required feeds are not unavailable;
- any freshness precondition still passes;
- action schemas/capabilities still match;
- the current World Packet fingerprint satisfies the prepared preconditions;
- user confirmation/authority is still valid;
- the routine has not been demoted or disabled.

Unknown or stale authority-bearing state fails closed.

### Commit

Commit through existing GEV application/action owners.

The Reflex Compiler does **not** get a privileged mutation API.

Each step is a typed action with explicit:

```text
preconditions
action
expected postcondition
verifier
optional compensation / undo
```

The executor stops on the first failed precondition or verifier.

### Verify

Success is an observed outcome, not “the action function returned”.

For each step record:

```text
action id
input
pre-state fingerprint
post-state fingerprint
observed result
verifier result
latency
undo / override
```

Only verified episodes train/promote a routine.

## Confidence thresholds

Keep the thresholds separate.

```text
observe only
    < prepare threshold
prepare silently
    < suggestion threshold
suggest to user
    < confirmed-macro threshold
eligible for confirmed macro
```

Do not let one probability control all four behaviors.

Preparation may use a lower threshold because it has no mutation authority.

Suggestion must be less noisy.

Macro/reflex authority requires explicit confirmation plus repeated verified success.

Initial numeric thresholds are experimental; measure precision and interruption cost before pinning defaults.

## Promotion lifecycle

### Candidate

A repeated verified sequence is detected.

Minimum evidence:

- same semantic action sequence;
- compatible preconditions;
- compatible capability/schema revision;
- independently verified successful outcomes.

### Suggestion

GEV may offer:

> You often open imagery and then the nearest CCTV for this kind of hazard. Save as a shortcut?

No automatic authority.

### Confirmed macro

User explicitly accepts the bounded sequence.

The macro stores semantic actions, not screen coordinates.

### Reflex

After additional verified use, the macro may become eligible for lower-friction invocation where existing GEV authority permits it.

“Reflex” still means deterministic execution with current-state validation. It does not mean bypassing permission or verification.

### Demotion

Immediately demote/disable on:

- action schema change;
- capability revision mismatch;
- changed source/freshness semantics;
- repeated verifier failure;
- repeated undo/override;
- user rejection;
- missing owner/action;
- materially changed workflow behavior.

A demoted routine returns to suggestion/candidate state; it does not silently repair itself into new authority.

## First experiment

Workflow:

```text
selected hazard
  -> choose supporting imagery
  -> focus nearest relevant CCTV
```

Why this one:

- already maps onto existing GEV concepts;
- fully reversible;
- no external write;
- clear observable postconditions;
- useful enough to repeat;
- short enough to inspect manually.

### Preconditions

- selected entity is still the same hazard;
- imagery action is available;
- CCTV candidate exists and is not unavailable;
- packet/state fingerprint is compatible with the prepared plan.

### Postconditions

1. requested imagery/context is visible/selected;
2. expected CCTV is active/focused;
3. selected hazard/context remains recoverable;
4. Back/undo restores the prior view/selection.

### Abort behavior

If any precondition or verifier fails:

- stop;
- preserve last verified state;
- report the failed step;
- do not execute later steps;
- discard stale preparation.

## Episode receipt

Store a compact receipt, not the raw UI event stream:

```json
{
  "routine": "hazard-imagery-cctv",
  "routineRevision": 1,
  "sourceStateFingerprint": "...",
  "capabilityRevision": "...",
  "steps": [
    {
      "action": "select_imagery",
      "verified": true,
      "latencyMs": 42
    }
  ],
  "outcome": "verified_success",
  "undoWithinWindow": false,
  "userOverride": false
}
```

Raw pointer/mouse/keystroke history is not the learned program.

## Metrics

Measure:

- interactions removed;
- end-to-end latency saved;
- preparation hit rate;
- preparation waste rate;
- suggestion precision;
- verified success rate;
- verifier failure rate;
- undo rate;
- override/rejection rate;
- model calls avoided;
- stale-preparation rejection count.

Primary goal: **time to correct verified result**, not number of macros created.

## Safety / correctness invariants

1. Prediction never grants action authority.
2. Preparation never mutates authoritative GEV state.
3. Commit revalidates current state.
4. Existing action owners remain the only mutation path.
5. Every promoted episode has a verified outcome.
6. Stale preparation cannot execute.
7. Unknown/unavailable inputs never become implicit success.
8. Semantic routine identity does not imply permission.
9. Repeated user override reduces, rather than increases, automation.
10. No background routine silently learns new actions into an existing confirmed macro.

## Implementation slices

1. Define the receipt + compiled-routine schema.
2. Add one deterministic in-memory candidate miner over verified receipts.
3. Implement prepare/validate for the hazard -> imagery -> CCTV workflow.
4. Add a suggestion-only UI surface.
5. Add explicit user confirmation and macro persistence.
6. Add execution through existing action runner + postcondition verifier.
7. Add drift/undo demotion.
8. Run A/B with the macro disabled vs enabled.

Do not build a generic workflow language before this one sequence demonstrates reuse.

## Acceptance

The first slice is successful when:

- the same semantic 3-step workflow is recognized from verified episodes;
- preparation performs zero mutations;
- a stale source-state fingerprint blocks commit;
- an unavailable CCTV blocks the CCTV step;
- user confirmation is required before macro authority;
- execution uses existing action owners;
- every step has a postcondition verifier;
- one failed step prevents later actions;
- undo/override is recorded;
- schema/capability drift demotes the routine;
- measured interaction/model-call savings do not reduce verified success.

## Non-goals

- arbitrary desktop macro recorder;
- keystroke replay;
- self-modifying hot-path policy;
- bypassing GEV action owners;
- universal workflow DSL;
- autonomous macro creation without user confirmation.
