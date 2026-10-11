# RFC — Mobile Field Runtime and GEV Remote

Status: downstream experiment
Date: 2026-09-29
Parent: #103
Issues: #108, #109

## TL;DR

Support two complementary mobile paths.

**Direct Mobile**
runs GEV locally with a lightweight map/render profile and touch-first shell.

**GEV Remote**
keeps heavy rendering, provider connections and credentials on a desktop host,
while the phone receives a bounded state/control surface and optional low-latency
video.

Neither path replaces the other.

## Direct Mobile

The globe stays primary.

Desktop rail stacks collapse into:
- top status strip;
- full-screen map;
- one bottom sheet;
- compact selected-object surface;
- explicit layer/search/action launchers.

Requirements:
- >=44 px touch targets;
- safe-area handling;
- no hover-only action;
- no pointer-precision assumption;
- bounded ambient labels/cards;
- lazy media thumbnails;
- portrait and landscape;
- reduced motion support;
- keyboard/desktop behavior unchanged above the mobile breakpoint.

Reuse the attention/ownership work in #53 rather than creating a second state
system for mobile.

## Mobile information ladder

At constrained widths:
1. selected/critical;
2. current task/action;
3. freshness/provenance;
4. compact active-layer status;
5. ambient detail only when budget remains.

Do not simply scale the desktop UI smaller.

## GEV Remote

Desktop host owns:
- canonical application state;
- provider credentials;
- live data connections;
- expensive Cesium rendering;
- optional hardware video encoding.

Phone owns:
- paired session;
- touch/voice commands;
- compact current state;
- selected details;
- alerts;
- optional decoded video viewport.

A bounded typed action/state protocol is preferred over DOM mirroring.

## Pairing/security

LAN-first prototype:
- explicit one-time pairing;
- scoped expiring token;
- authenticated origin/session;
- no provider secret leaves the host;
- no anonymous remote-control endpoint;
- read-only status surface before write authority.

## Streaming

Treat Sunshine/Moonlight as the external baseline.

A native GEV stream should only exist if its integration with GEV state/control
beats generic desktop streaming for the field workflow.

WebRTC is a candidate, not a requirement.

## Failure behavior

If the remote stream disappears:
- retain last bounded state with a disconnected marker;
- controls that require host authority disable;
- direct lightweight map/state may remain available if its own sources exist;
- never present stale remote pixels/state as current.

## First experiments

1. responsive bottom-sheet shell (#108);
2. explicit potato render profile (#104);
3. read-only paired `/remote` status/control prototype (#109);
4. compare task latency against generic Sunshine/Moonlight;
5. add video only if the state/control prototype proves useful.
