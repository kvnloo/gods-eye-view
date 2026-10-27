# Planet Playground

Optional EXPLORE panel built on the existing GEV controllers; no separate map or feed.

## Independent lanes

Each `features/NN-name.js` exports `feature = { id, title, mount({ root, services }) }`.
The mount function renders inside the provided panel and may return a cleanup callback.
The shell owns switching, keyboard dismissal and application-lifetime teardown.
Features must release their own event listeners, Cesium entities, timers, and opt-in connections.

- **01 Expeditions** — existing Nepal evidence scene; fire and traffic layer scout views
- **02 Time Machine** — authored SceneDirector clock only
- **03 What-if** — reversible A/B proposals, labeled hypothetical; no modeled outcomes
- **04 Multiplayer** — opt-in same-origin tab broadcast, presence-only heartbeat while joined, not a remote presence server
- **05 Toybox** — existing GLSL looks and explicit camera trips

## Verification

Use Node.js 24.14 or 26:

```sh
npm ci
npm run format:check
npm run check:boundaries
npm test
npm run build
npm run dev
```

In a browser, select EXPLORE, visit all five tabs, launch the Nepal scene,
seek its authored timeline, add/undo a hypothetical marker, join the same room
in two same-origin tabs (no automatic camera sharing), and choose a sensor look.
Also verify Escape, mobile layout, and `?embed=1` without a launcher.
For local rooms, keep two tabs idle across multiple 15-second heartbeats: both
should remain visible without automatically sending camera views. Abruptly
terminate one tab without Leave and confirm the survivor eventually removes
its stale presence (75 seconds without valid packets, checked by the next
heartbeat; background timer throttling can delay this). Leave, room switch
and feature teardown must clear their timers and peers. Presence is only an
unverified local-tab liveness hint, never authenticated or durable membership.

**Not implemented:** remote internet rooms, global time travel, SUMO/PyPSA
impact forecasts, operational disaster guidance. Keep provenance and simulated
states explicitly separated.
