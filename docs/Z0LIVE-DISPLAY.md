# z0live display bridge

Opt-in. A [z0live](https://github.com/kvnloo/z0live) desktop broker can drive
this globe from a voice call on a phone, or from one of its agents. The page
registers as the broker's `gev` display. It then runs each command it receives
through the same action runner the typed chat, the omnibar and the voice
session use. Without the `z0live` parameter nothing here runs.

## Open it

1. Pair a device on the broker for the display (`z0live pair gev-display`).
2. Start the app with the broker origin allowed in its Content-Security-Policy.
   A loopback broker uses plain http, which `connect-src` otherwise refuses:

   ```sh
   GEV_Z0LIVE_ORIGINS=http://127.0.0.1:8791 npm run dev
   ```

   `GEV_Z0LIVE_ORIGINS` takes comma-separated bare http(s) origins. It widens
   `connect-src` only, on the dev and preview servers.

3. Add the app's origin (e.g. `http://localhost:4173`) to the broker's
   `Z0LIVE_CORS_ORIGINS`.
4. Open the page once with the token in the fragment:

   ```text
   http://localhost:4173/?z0live=http%3A%2F%2F127.0.0.1%3A8791#z0live_token=<device token>
   ```

   The token moves to `localStorage` (`gev.z0live.token`) and leaves the
   address at once. After that, `?z0live=<broker URL>` alone is enough. The
   token travels only as a bearer header to the broker and is never logged.

## Protocol

All requests carry `Authorization: Bearer <device token>`.

| Request                           | Body / stream                                           | Notes                                               |
| --------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `POST /v1/displays/register`      | `{display:"gev", tools:[{name, description}], context}` | On load and after a broker restart                  |
| `POST /v1/displays/gev/heartbeat` | `{}`                                                    | Every 5 s; a display is gone after 15 s without one |
| `GET /v1/displays/gev/inbox`      | SSE `event: command`, `data: {id, action, args}`        | Read with `fetch`, so the token stays in a header   |
| `POST /v1/displays/gev/result`    | `{id, ok, output}`                                      | Once per command                                    |
| `POST /v1/displays/gev/context`   | `{context}`                                             | When the view changes, at most once a second        |

`context` is compact: camera latitude, longitude and height, visual style,
enabled layer ids, up to five tracked entities and whether the cockpit is on.

Commands run one at a time, in arrival order, each with an 11 s limit. `ok`
is true only when the runner's result reports success. A result with
`ok:false`, `error`, `refused`, `cancelled` or `unavailable` is reported as a
failure, with the runner's own words in `output`. An action outside the
registered list is refused without running.

## Actions offered

`z0liveDisplayTools()` in `src/voice/z0liveDisplay.js` lists the actions and a
one-line description of each: camera moves (`fly_to_location`, `zoom_to_globe`,
`adjust_camera_zoom`, `move_camera`, `frame_overhead`), layers and looks
(`set_layer_visibility`, `set_visual_style`, `set_map_stack`,
`set_context_mode`, `set_hud`), tracking and selection, read-only queries
(`get_current_view_state`, `get_entity_context`, `analyst_query`), areas and
annotations, CCTV, scenes and pass predictions. Settings that only make sense
at the screen stay local: the voice timeout, the voice panel and Radio, whose
handoff waits for a spoken confirmation.

## Check it

`node --test src/voice/z0liveDisplay.test.mjs` covers configuration, the SSE
parser, result semantics, re-registration and refusal with a fake broker.

`scripts/qa-z0live-display.mjs` is the end-to-end check. It needs a running
app and a broker on a test data directory. It opens the page headless, has
the broker fly the globe to Tokyo, and checks the camera position. With
`SESSION_ID` it also flies to Sydney through the phone's `POST /v1/tools/globe`
route. The script's header lists its inputs.
