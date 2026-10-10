# RFC — Multimodal Flow: Voice + Touch + Keyboard + Pointer

Status: downstream experiment
Date: 2026-09-28

## Thesis

Use each modality for what it compresses best:

- **voice**: high-entropy intent;
- **pointer/touch**: referent and bounded choices;
- **keyboard**: fast exact commands/navigation;
- **background agents**: preparation/retrieval that does not steal focus.

All modalities resolve into the same typed application actions.

## Interaction examples

```
click wildfire -> "verify this" -> evidence chooser
hover/select aircraft -> "follow that one"
Cmd/Ctrl+K -> "radar global" -> exact action candidate
voice -> "compare this with yesterday" -> prepare imagery comparison
```

## One active referent

Deictic commands resolve in order:

1. explicit selected entity
2. active pointer/hover target when interaction contract allows it
3. tracked subject
4. explicit view scope
5. ask for clarification

Never choose a hidden stale context merely because it exists.

## No focus theft

Background work may:

- update a small status indicator;
- prepare results;
- cache metadata;
- append to a bounded activity stream.

It may not:

- open a panel;
- move keyboard focus;
- move the camera;
- change selection;
- play media;

without an explicit owning action.

## Undo over confirmation

For reversible presentation/navigation actions prefer:

```
act -> immediate feedback -> short undo affordance
```

Reserve confirmation for expensive, destructive, privacy-sensitive, or externally
observable actions.

## Interruptions

Realtime voice interruption should stop/yield speech without automatically
cancelling unrelated background application work.

Track separately:

- audio speaking state
- conversational turn state
- application action state
- background task state

## Command palette

A keyboard palette should search the same action vocabulary used by voice.

Candidate groups:

- Go to
- Track/select
- Layers
- Panels
- Context modes
- HUD/styles
- Evidence actions
- Scene controls

Palette selection calls typed action owners; it does not click arbitrary DOM nodes.

## Learning

Only explicit successful actions may teach bounded preferences.

Examples:

- preferred evidence action;
- preferred HUD layout;
- common panel/action sequence.

Prediction may reorder/surface suggestions. It must not silently execute.

## Accessibility

- full keyboard path;
- visible focus;
- reduced-motion compatible;
- scalable text;
- state is not color-only;
- realtime voice always has a non-audio visible state indicator.

## Metrics

- actions completed per interaction
- correction/undo rate
- focus displacement
- modal/panel churn
- voice clarification rate
- selection/referent mistakes
- first-feedback latency
