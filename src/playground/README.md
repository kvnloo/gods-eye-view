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
should remain visible without automatically sending camera views. With a received
coarse peer view visible, keyboard-focus **Visit view** in one tab, then wait
for a heartbeat from the other. Focus must stay on the same control; repeated
Join/identical view packets must not recreate it. A changed coarse view must
update the action, and Leave must remove it. This requires real two-tab keyboard
and mobile verification; the focused regression runs only in a synthetic DOM.
Abruptly
terminate one tab without Leave and confirm the survivor eventually removes
its stale presence (75 seconds without valid packets, checked by the next
heartbeat; background timer throttling can delay this). Leave, room switch
and feature teardown must clear their timers and peers. Presence is only an
unverified local-tab liveness hint, never authenticated or durable membership.

Room invites are **room-only by default**: the copied URL retains the app
origin/path and adds only `gevRoom`, stripping unrelated query parameters,
credentials and the scene/map fragment. The unchecked-by-default **Include
current scene** option preserves only the existing URL fragment after explicit
consent; it may disclose a map position, never grants room identity or municipal
approval. Test with a synthetic `?token=canary#map=canary`: room-only copy must
contain neither canary and explicit scene copy must contain only the hash canary.
No real location or secret is required for this test.
The scene opt-in is **one-shot per copied invitation**: Copy immediately
unchecks it, even if clipboard access stalls or fails. Another Copy (or
a changed room) cannot inherit a previous scene/location disclosure without
a new explicit check. This behavior still needs full-app browser QA.

While joined, Copy room link always uses the actively joined room, even if the editable
room-code field has changed. After Leave, the field can prepare a different
room invite; entering a code does not silently switch a joined channel.

Local-room messaging is best-effort: if posting Join is denied, no membership
is announced; a denied reply, heartbeat or coarse-view send disconnects rather
than claiming the view was shared. Failed departure/close must still release
the local channel, heartbeat and peer list. Only an explicit Join retries.
The denial regressions use synthetic channels, not a real browser.

A received peer's **Visit view** button navigates only on an explicit
click. If its Cesium Scene camera was destroyed or became unavailable while
the peer row remained visible, navigation must fail closed without throwing,
sending a local camera view, or leaving the room. A valid later click can
still navigate to the coarse peer view; live two-tab/browser proof is pending.

**Not implemented:** remote internet rooms, global time travel, SUMO/PyPSA
impact forecasts, operational disaster guidance. Keep provenance and simulated
states explicitly separated.
