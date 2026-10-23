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
npm --prefix tools/tern install
npm --prefix tools/tern start
~~~

The second command prints **one private localhost URL**. Open that exact URL in your *local* GEV browser, select an aircraft, vessel, or other entity, and watch its provenance and current layer/feed state appear in Tern. The URL's ephemeral 256-bit token is removed from the browser address bar immediately during startup. Do not share the link or leave it in a terminal recording. By default it points to GEV at http://localhost:4173/; use --app-url http://127.0.0.1:4173/ when the browser uses that host. --port 0 (default) picks an ephemeral loopback relay port.

Tern mode opens a **native semantic surface** with main for entity/camera/layer readouts, dock for local controls when advertised, and an optional layer for help only when aside is advertised. The r/p/h keys and native buttons request a new read-only snapshot, pause/resume **terminal presentation**, and show help. q, Escape or Ctrl+C exits. TSP handling is delegated to @stencil-hq/tern 0.1.0, including hello negotiation, supported node kinds, frame size/chunking, atomic diffs, ACK/credits, latest-frame coalescing, and tty restoration.

Without Tern, the exact same command prints readable text and updates to stdout, with no raw TSP views. Test explicitly:

~~~sh
TERN_TSP=0 npm --prefix tools/tern start
~~~

Type q + Enter or press Ctrl+C. The fallback still requires opening the printed browser URL to receive live context. Reconnection of a closed browser socket is automatic; a replaced tab invalidates the previous socket's updates. A newer browser selection replaces the previous selection; no cached selection is narrated after its owner removes it.

## Security / data limits

- The WebSocket binds to **127.0.0.1 only**, requires a matching exact browser Origin and the random per-run URL token, and caps inbound UTF-8 JSON messages at 64 KiB. No network listener is opened when the CLI is off. The browser opt-in works only on localhost/127.0.0.1.
- The browser sends small, bounded summaries from its existing getSelectedEntityContext, dataManager.getAll / layerSnapshots, and Cesium camera. No extra feed polling, scene copy, imported Node module or independent selection owner runs in browser code.
- Browser-to-terminal messages are data only. Terminal-to-browser messages are exactly {"type":"snapshot-request"}; **no** setEnabled, navigation, cameras, arbitrary commands or permissions are exposed. Future globe mutations need GEV's reviewed typed action schemas, original owner execution and explicit confirmation, not a new bridge handler.
- Feed state (STALE, FALLBACK, DEGRADED, etc.) and original source labels are shown explicitly. Counts reflect **loaded data only**, not complete, current or verified worldwide coverage. Some layers report no last-updated timestamp; that is not a freshness guarantee. The globe stays in the browser.
- The printed URL grants local access to a read-only view of your browser context. Avoid recording/screenshotting the token. **Do not upload** raw TERN_TSP_RECORD files without redaction; they may contain data from the selected view.
- This design has no ACP dependency. The [ACP bridge proposal](https://github.com/kvnloo/gods-eye-view/issues/252) will use separate lifecycle, subprocess and permission owners.

## Gates for OMP

~~~sh
npm ci
npm --prefix tools/tern install
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
