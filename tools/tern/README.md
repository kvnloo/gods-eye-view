# God's Eye View — native Tern context surface

Opt-in, read-only local presentation of the **existing** God's Eye View (GEV) browser's selection, camera and layer/feed state. Tern's Surface Protocol (TSP v1) renders the terminal UI; GEV still owns the Cesium scene, acquisition, selection and all globe actions. This is independent of the planned ACP bridge ([#252](https://github.com/kvnloo/gods-eye-view/issues/252)).

## Install and run

Requirements: this repo's supported Node.js (24.14+ or 26+), local GEV browser, and optionally a terminal running [Tern](https://github.com/stencil-hq/tern). No cloud service or API credential is needed for the relay itself. The browser's usual map/source requirements still apply.

In separate terminals, from the repo root:

~~~sh
npm ci
npm run dev
~~~

~~~sh
npm --prefix tools/tern ci
npm --prefix tools/tern start
~~~

The second command prints **one private localhost URL**. Open that exact URL in your *local* GEV browser, select an aircraft, vessel, or other entity, and watch its provenance and current layer/feed state appear in Tern. The URL's ephemeral 256-bit token is removed from the browser address bar immediately during startup. Do not share the link or leave it in a terminal recording. By default it points to GEV at http://localhost:4173/; use --app-url http://127.0.0.1:4173/ when the browser uses that host. --port 0 (default) picks an ephemeral loopback relay port.

Tern mode opens a **native semantic surface** with main for entity/camera/layer readouts, dock for local controls when advertised, and an optional layer for help only when aside is advertised. The r/p/h keys and native buttons request a new read-only snapshot, pause/resume **terminal presentation**, and show help. q, Escape or Ctrl+C exits. TSP handling is delegated to @stencil-hq/tern 0.1.0, including hello negotiation, supported node kinds, frame size/chunking, atomic diffs, ACK/credits, latest-frame coalescing, and tty restoration.

Without Tern, the exact same command prints readable text and updates to stdout, with no raw TSP views. Test explicitly:

~~~sh
TERN_TSP=0 npm --prefix tools/tern start
~~~

Type q + Enter or press Ctrl+C. The fallback still requires opening the printed browser URL to receive live context. Only transient socket failures reconnect (at most six attempts, with capped backoff). An authenticated second tab explicitly supersedes the first (WebSocket code 4001) and permanently disposes its subscriptions/reconnect loop. Relay stop explicitly revokes the active tab (code 4002), with bounded close/terminate cleanup, so an old tab cannot attach to a new process reusing the port. A new owner or disconnect clears the former snapshot immediately, including during pause. Pause freezes visible presentation; resume asks the current owner for a fresh snapshot.

## Security / data limits

- The WebSocket binds to **127.0.0.1 only**, requires a matching exact browser Origin and the random per-run URL token, and caps inbound UTF-8 JSON messages at 64 KiB. No network listener is opened when the CLI is off. The browser opt-in works only on localhost/127.0.0.1.
- The browser sends bounded summaries from its existing context store, isContextRecordActive, dataManager.getAll / layerSnapshots, and Cesium camera. Reads never clear a selected entity merely because it is temporarily hidden by horizon/LOD or the layer is disabled. No extra feed polling, scene copy, imported Node module or independent selection owner runs in browser code.
- Browser-to-terminal messages are data only. Terminal-to-browser messages are exactly {"type":"snapshot-request"}; **no** setEnabled, navigation, cameras, arbitrary commands or permissions are exposed. Future globe mutations need GEV's reviewed typed action schemas, original owner execution and explicit confirmation, not a new bridge handler.
- Feed state (STALE, PARTIAL, FALLBACK, DEGRADED, etc.) and original source labels are shown explicitly. Selected records also carry their existing bounded `properties.status` (for example, tracked aircraft coasting on missed polls) separately from the last context refresh. `updatedAt` describes **GEV context refresh**, not the source observation's age. Feed last-update, browser capture and relay receive ages advance with the presentation clock even if messages stall; the ticker does not fetch or subscribe to any provider. Counts reflect **loaded data only**, not complete, current or verified worldwide coverage. Missing timestamps remain unknown, not proof of freshness. The globe stays in the browser.
- The printed URL grants local access to a read-only view of your browser context. Avoid recording/screenshotting the token. **Do not upload** raw TERN_TSP_RECORD files without redaction; they may contain data from the selected view.
- This design has no ACP dependency. The [ACP bridge proposal](https://github.com/kvnloo/gods-eye-view/issues/252) will use separate lifecycle, subprocess and permission owners.


## Actual-browser acceptance (no relay credentials or private feed required)

Use the same hostname at both ends: in terminal one run `npm run dev -- --host localhost --port 4173 --strictPort`; in a local Tern pane run `npm --prefix tools/tern start`. After the **one-time private link** appears on stderr, open it in a browser on that machine. Do not put it in an issue, console recording, or screenshot. No token is required for the sidecar's own connection beyond this ephemeral local link. A map provider or individual GEV feed may independently need its usual key; **do not enter credentials merely for this test**. If a globe cannot initialize without one, report that limitation rather than claiming live acceptance.

On an available keyless public layer (for example, Flights when the configured public feed is available), select/track a genuine displayed entity using GEV's existing UI. In browser DevTools, use this read-only witness to compare the *actual GEV owner record* to native main/dock and plaintext output:

~~~js
const s = window.__gevContextStore;
const r = s?.entities.get(s.selectedEntityId);
console.table({
  selectedId: s?.selectedEntityId,
  recordId: r?.id,
  layer: r?.layerId,
  source: r?.source,
  observationStatus: r?.properties?.status ?? 'not reported',
  contextRefreshedAt: r?.updatedAt ?? null,
});
~~~

Check exact ID/layer/source/status against the Tern selected readout; check layer feed state (including PARTIAL or STALE if genuinely reported), camera changes, and visibly advancing capture/receive ages when the browser stalls. This witness only confirms projection of an existing GEV selection; it does **not** attest aircraft positions, whole-world coverage, observation age, or correctness of the upstream feed. If no selectable public entity is actually available, mark the **live selection gate pending**. Synthetic SDK/protocol tests do not substitute for it.

Open the same one-time private attach link in a second local browser tab: it becomes owner, the first stops reconnecting, and the old selection clears until the second publishes. Pause with `p`, change selection, verify no visible advance; resume with `p`, verify a fresh request. Quit with `q` (or Ctrl+C) and confirm the browser does not reconnect to a reused relay port. Repeat with `TERN_TSP=0 npm --prefix tools/tern start` and redirected stdout: no TSP/APC/escape bytes or bearer URL in stdout; the private link is printed to stderr once. Never publish the URL or raw TSP trace.

The frozen sidecar dependencies are committed in `tools/tern/package-lock.json`; use `npm --prefix tools/tern ci`, not `install`, for acceptance and CI. CI on Node 24.14.0 and 26.x installs both locks and explicitly runs browser bridge and sidecar tests without importing TSP/Node dependencies into browser production graphs. This connector-only work has **not** run npm, unit tests, build, or MBP/native Tern acceptance.

## Gates for OMP

~~~sh
npm ci
npm --prefix tools/tern ci
node --test src/tern/browserBridge.test.mjs
npm --prefix tools/tern test
npm run check:boundaries
npm test
npm run format:check
npm run build
~~~

Manually, in real Tern, capture a local TSP trace with TERN_TSP_RECORD only in a disposable, private test directory; verify one real selection, stale/fallback health, camera moves, button and keyboard actions, accelerated feed bursts, disconnect/reconnect, browser tab replacement, non-Tern fallback, and Ctrl+C teardown. Inspect and redact any trace before sharing. **These commands and native acceptance have not been executed by this connector-only change.**

## Provenance

- [Bilawal Sidhu](https://github.com/bilawalsidhu) and God's Eye View contributors created the underlying globe, state owners, layer sources and action system.
- [Stencil Labs' Tern SDK contributors](https://github.com/stencil-hq/tern-sdk) authored the TSP protocol and TypeScript SDK, including its negotiated handshake and frame/credit semantics.
- [NousResearch Hermes contributors](https://github.com/NousResearch/hermes-agent) and the downstream [Hermes × Tern work](https://github.com/kvnloo/hermes-tern) informed the surface adapter's use of the SDK, fallbacks and terminal ownership boundaries.

This is a downstream experimental implementation of [GEV #251](https://github.com/kvnloo/gods-eye-view/issues/251), not upstream-promotion evidence.
