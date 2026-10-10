# RFC — Attention Governor

Status: downstream experiment
Date: 2026-09-28

## TL;DR

GEV should not treat every live update as equally worthy of the user's attention.

Introduce a presentation-only **Attention Governor** that decides whether a
change should:

- stay silent;
- update ambient chrome;
- enter the What Changed stream;
- surface as a bounded suggestion;
- enter the exception tray.

It never changes source truth, layer enablement, or action authority.

## Why

Across GEV, live layers, agents, voice, prepared actions, and background work can
all produce valid state changes. Without a common attention policy, every feature
is tempted to add its own toast, badge, pulse, panel, or notification.

The result is locally reasonable and globally noisy.

## Inputs

The governor consumes typed presentation metadata only:

```js
{
  eventId,
  owner,
  kind,
  novelty,
  contradiction,
  freshnessTransition,
  taskRelevance,
  blocking,
  reversible,
  expiresAt,
  activeReferent,
  userFocusState
}
```

No model-generated "importance" score is authoritative.

## Outputs

```js
{
  disposition:
    'silent' |
    'ambient' |
    'activity' |
    'suggest' |
    'exception',
  reasonCode,
  expiresAt
}
```

## Core rules

1. Explicit user focus outranks background novelty.
2. A repeated unchanged update decays toward silence.
3. Contradiction/freshness failure may escalate presentation, but never semantic
   severity beyond the source owner's contract.
4. Automatic work cannot steal keyboard focus.
5. A deferred event may expire without ever surfacing.
6. Exception presentation is bounded and deduplicated.
7. Quiet mode changes presentation thresholds, not data acquisition.

## Interruption budget

Treat interruptive surfaces as a scarce budget.

Example experimental policy:

- max one new exception card at a time;
- suggestions coalesce by referent/action family;
- low-value background changes wait while voice/tool execution owns attention;
- expired preparation completions disappear instead of nagging.

## Relationship to current UX work

- #38 What Changed is one output channel.
- #61 exception tray is one output channel.
- #62 next-action shelf is one output channel.
- #50 quiet mode modifies policy.
- #44 voice state supplies focus/interaction ownership signals.

The governor is the arbitration layer between them.

## Metrics

- number of unsolicited surfaces/minute;
- focus displacement;
- dismissed/ignored suggestion rate;
- missed blocking state;
- correction/undo rate;
- time to notice genuinely important failures;
- duplicate surface rate.

## Stop condition

If a deterministic policy cannot outperform simple owner-local presentation on
two unrelated features, do not centralize it.
