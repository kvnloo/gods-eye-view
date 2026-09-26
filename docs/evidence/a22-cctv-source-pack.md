# A22 / Autostrada del Brennero CCTV evidence packet

Factory protocol: `oss-factory:v1`
Status: `CHECK`
Dedupe key: `gods-eye-view:a22-cctv:source-pack`
Upstream issue: https://github.com/bilawalsidhu/gods-eye-view/issues/155
Base SHA: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
Branch: `feat/a22-cctv`

## What is already verified

Official operator webcam page:
https://www.autobrennero.it/it/in-viaggio/webcam/

Official webcam note:
https://www.autobrennero.it/en/on-the-road/webcam/info-webcam/

The operator states that, for privacy/security reasons, its public webcams expose a single still frame refreshed at regular intervals rather than a realtime video stream. That matches GEV's existing still-image CCTV contract.

A direct operator-hosted JPEG is confirmed for the Brennero camera:

`https://www.autobrennero.it/WebCamImg/km1.jpg`

The official page currently lists 13 camera names:

- Brennero
- ADS Sciliar
- Bolzano Nord
- Egna
- Paganella Ovest
- Piedicastello Sud
- Nogaredo Ovest
- Affi
- Verona Nord
- Povegliano
- Ponte Po
- Reggiolo
- Stazione Raccordo A1

## Worker assignment

Grok bot / Muse bot: resolve the complete official camera contract for all 13 cameras. Do not post upstream.

For each camera, record:

1. exact official JPEG URL;
2. camera name exactly as published;
3. motorway km marker / descriptive location from the operator;
4. latitude / longitude from an authoritative source if the operator exposes it;
5. direction / carriageway text if published;
6. response status, `Content-Type`, redirects and cache headers;
7. whether the JPEG remains accessible in a fresh session with no cookies/referer;
8. observed refresh cadence from repeated requests over a bounded test window;
9. source/licence/terms evidence sufficient to decide whether runtime proxying is allowed.

## Important constraints

- Do not invent coordinates from motorway km markers.
- Do not scrape third-party webcam mirrors when the operator source exists.
- Do not infer camera heading from carriageway direction unless the source text unambiguously describes the camera's facing. If not, use GEV's low-confidence fallback.
- Frames must stay on the official `www.autobrennero.it` host.
- Do not archive or vendor frames.
- Preserve the operator's warning that these are periodic stills and are not suitable for precise realtime traffic-state inference.

## Acceptance gate

### KEEP
All 13 cameras have stable official JPEGs and sufficient authoritative position/terms evidence. Return a compact table and exact reproducible requests.

### REVISE
The JPEG contract is stable but some coordinates/terms require a smaller curated subset or explicit manual catalog.

### KILL
The direct media contract or reuse terms are not suitable for proxying.

## Expected implementation shape after KEEP

- curated or official-runtime loader under `server/providers/cctv/`;
- official-host allowlist only;
- low-confidence heading unless explicitly published;
- static frame refresh cadence matched to the upstream;
- attribution in `DATA_SOURCES.md` + in-app credits;
- `CCTV_A22_ENABLED` / bounded source control only if the runtime loader needs them;
- `CURRENT-STATE.md`, `CHANGELOG.md`, focused tests;
- required repo gates including `npm run test:track` and `scripts/qa-cctv-v2.mjs`.
