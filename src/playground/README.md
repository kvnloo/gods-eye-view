# Planet Playground

Optional EXPLORE panel built on the existing GEV controllers; no separate map or feed.

## Independent lanes

Each `features/NN-name.js` exports `feature = { id, title, mount({ root, services }) }`.
The mount function renders inside the provided panel and may return a cleanup callback.
The shell owns switching, keyboard dismissal and application-lifetime teardown.
Features must release their own event listeners, Cesium entities, timers, and opt-in connections.
The shell removes launcher, tab, close and keyboard handlers on host teardown;
retained detached controls cannot remount a mode and repeat disposal is inert.
Closed, still-connected tabs must also be inert: script-activated hidden mode controls
cannot join a local room or recreate What-if resources; reopening preserves
normal explicit selection. This guard has source-V8/synthetic DOM evidence only.
Feature cleanup failures are logged and cannot strand tab switching, close, or host teardown; a transient mount failure can be retried. The feature still owns releasing any resources it failed to clean. This has only synthetic DOM regression coverage, not full-app browser proof.

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
Join/identical view packets must not recreate it. While focused on peer A,
have another tab join, send a different peer view, and leave: peer A's action
must remain the same focused DOM control. A new view from peer A must transfer
keyboard focus to its updated Visit view button only if the old button was
focused; updates must not steal focus from other controls. Leave removes its
own action. If the focused peer leaves, expires or the local room disconnects,
focus must move to the non-action room status (not Send coarse view); focus on
other controls must remain unchanged, and feature teardown cannot steal focus.
Native two-tab keyboard/mobile proof remains outstanding; the
keyed-row regression uses a synthetic DOM.
Abruptly
terminate one tab without Leave and confirm the survivor eventually removes
its stale presence (75 seconds without valid packets, checked by the next
heartbeat; background timer throttling can delay this). A second **Join** for the same normalized room preserves its channel, peer
membership and active heartbeat: it must not send a false Leave/Join or reset
focused peer actions. Editing the room code and joining a **different** room
still explicitly leaves the old room. Leave, actual room switch and feature
teardown must clear their timers and peers. Presence is only an
unverified local-tab liveness hint, never authenticated or durable membership.

Room invites are **room-only by default**: the copied URL retains the app
origin/path and adds only `gevRoom`, stripping unrelated query parameters,
credentials and the scene/map fragment. The unchecked-by-default **Include
current scene** option includes only recognized GEV share-link fragment
fields after explicit consent, and only when finite in-range camera lat/lon
are present. Unrelated hash keys (including tokens) are discarded; an invalid
or incomplete scene yields a room-only link with an explicit notice. Even valid
scene fragments can disclose map location; this is not room identity or municipal
approval. Test with synthetic `?token=query-canary#lat=40.1&lon=-88.1&map=photoreal&access_token=hash-canary`:
room-only copy must contain no camera/hash/query canaries, while consented
copy retains only the recognized camera/map fields and no hash/query tokens.
No real location or secret is required for this test.
The scene opt-in is **one-shot per copied invitation**: Copy immediately
unchecks it, even if clipboard access stalls or fails. Another Copy (or
a changed room) cannot inherit a previous scene/location disclosure without
a new explicit check. This behavior still needs full-app browser QA.

Overlapping copies serialize clipboard requests, but a superseded Copy that
has **not started** never touches the clipboard: a rapid room-only Copy
cancels an earlier queued scene-inclusive request before it can disclose a
location, even transiently. A clipboard call already underway cannot be
revoked; the later room-only intent still writes last. Only the latest Copy
reports status; teardown abandons queued work. This was tested in an isolated
synthetic V8 clipboard adapter only; native Node 24/26 and real browser
permission/two-tab QA remain outstanding.

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
