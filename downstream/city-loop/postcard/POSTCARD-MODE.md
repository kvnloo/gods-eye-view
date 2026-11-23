# Cozy postcard mode (fork-only prototype, `?postcard=1`)

Status: prototype on `exp/city-postcard` (from `exp/city-loop-r1` ae18d44). Not upstream, not in any build.

## What it does

1. A **Cozy postcard** button (bottom right) appears only when the page has `?postcard=1` **and** the
   city builder runs on the Vite dev server (`canLocal = import.meta.env.DEV`, the same gate the #312
   concept bridge uses).
2. Click: the current view is captured with the city builder's own `captureCityReference()` (Cesium
   canvas only, so the DOM HUD is not in the capture; max 960x640, JPEG <= 600 kB; no camera move).
3. The capture plus a prompt is POSTed to the existing local image bridge `POST /api/city-concept`
   (`server/standalone/city-concept.js` -> `scripts/city-concept-server.py` -> the ChatGPT-subscription
   `comfyui-codex-image` generator). Same request shape as concepts: `{prompt, image}`; answer
   `{provider: 'local', image}` (data URL <= 600 kB), validated before display.
4. The answer is shown over the capture in a modal frame with a **compare wipe** (slider; left of the
   line = capture, right = AI look) and an amber **`AI LOOK · NOT EVIDENCE`** chip. Esc or x closes it.
5. Nothing is stored: no record, no download, no change to the live map. The postcard is a look, never a
   plan, a measurement or an approval.

## Prompt and facts

- `src/data/cityPostcard.js` builds the prompt. The style block follows the wintercats direction
  (painterly low-poly, vivid greens, teal water, cream/terracotta, soft GI, haze, tilt-shift) and says
  "NOT a photograph and NOT a photo of a miniature model" (round-1 targets read as tilt-shift miniatures).
- When a massing block is shown, its countables come from the app's own model
  (`window.__gevCityMassing.snapshot().massing`, i.e. `plotMassing()`): storeys incl. ground floor, upper
  floors, height, footprint side, plot side, setback. `postcardFacts()` refuses an inconsistent model
  (height != storeys x storey height, non-integer storeys, footprint not inside the plot) and the prompt
  then omits the block rather than describing it wrongly. Nothing is typed in by hand.

## Errors (fixed strings, never provider text)

| bridge status | message |
|---|---|
| 404 / 403 (not the dev server, bridge disabled, or not loopback) | Postcard needs the local image bridge (dev server with GEV_CITY_CONCEPT_LOCAL=1). |
| 409 | The image bridge is busy; try again in a moment. |
| capture failed | Could not capture this view yet; wait for the map to finish loading. |
| anything else | The postcard could not be made. |

## Cost

- Route: the existing bridge, i.e. the ChatGPT **subscription** image tool. No API key, no per-image
  charge; each postcard uses subscription image allowance (~45-60 s per image in the arm-4 target runs).
- **No paid API is wired.** A metered route (OpenAI Images API gpt-image high ~$0.21/1024 image, or FLUX 3
  Klein API ~$0.009/1K per the research lane) would need an owner decision, a key and a spend cap.

## Known limits / next

- The bridge takes one image, so the wintercats style references cannot be attached; the look comes from
  the prompt only. The arm-4 targets used two reference images and are closer to the look. Next step:
  let the bridge accept up to two fixed, server-side reference files (no client upload).
- The image model miscounts large repeated sets (it drew 20-21 of 25 growth blocks in every full-frame
  try) and invents what HUD panels hide. A count gate (VLM storey/row count on the plot crop, reroll on
  mismatch) belongs in the bridge before this is more than a toy.
- Google Map Tiles policy: a restyle of a photoreal capture must stay ephemeral and in-session (see
  loop-v3/research-generative/REPORT.md §4). This prototype stores nothing.
- Orbit-safe projection of the postcard onto depth is a separate tier (T2) and is not part of this.

## Files

- `src/data/cityPostcard.js` (pure: flag, facts, prompt, request, answer check, wipe, errors)
- `src/data/cityPostcard.test.mjs` (node:test, 7 tests)
- `src/standalone/cityPostcard.js` (DOM: button, overlay, wipe, chip; probe `window.__gevCityPostcard`)
- `src/ui/styles/city-postcard.css`
- `src/standalone/cityPlanningServices.js` (mount behind `canLocal && ?postcard=1`; destroy on unmount)

## Try it

```sh
GEV_CITY_CONCEPT_LOCAL=1 npm run dev
# open http://localhost:<port>/?welcome=0&massing=1&postcard=1 , pick a plot, press "Cozy postcard"
```
