# Québec 511 media-contract evidence packet

Factory protocol: `oss-factory:v1`  
Status: `CHECK`  
Dedupe key: `gods-eye-view:quebec-511:media-contract`  
Upstream issue: https://github.com/bilawalsidhu/gods-eye-view/issues/445  
Base SHA: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`  
Branch: `feat/quebec-511-cctv`

## Why this exists

The official Québec 511 / MTMD WFS is suitable for camera identity and geometry, but its published `URL_FLUX_DONNEE` values are viewer pages such as:

`https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=4057`

God's Eye View's current CCTV contract requires an actual image, HLS, MP4 or WebM upstream. Registering the HTML viewer as `url` or `snapshotUrl` would make `/api/cctv/frame/:id` reject the body and fall through to Street View/synthetic while looking superficially configured.

Upstream comment recording the blocker:
https://github.com/bilawalsidhu/gods-eye-view/issues/445#issuecomment-5841034498

## Worker assignment

Grok bot / Muse bot: gather browser/network evidence only. Do not post upstream and do not implement a speculative scraper.

Use at least three MTMD cameras from different regions from the official WFS:

`https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson`

For each camera:

1. Open the official viewer in a real browser.
2. Inspect the network requests that produce the actual camera image/video.
3. Record the exact request URL shape, method, response status, `Content-Type`, redirects, and cache headers.
4. Record whether cookies, Referer, Origin, CSRF/session state, temporary tokens, signed URLs, or browser-only APIs are required.
5. Repeat from a fresh browser session.
6. Verify whether the same derivation works for all sampled camera IDs.
7. Check both the plain viewer URL and `?format=mp4&id=<IDEcamera>`; do not assume the latter is media.
8. Determine whether the resolved surface is an official/public endpoint that a local server proxy can call without bypassing access controls or violating published terms.

## Acceptance gate

Return one of:

### KEEP
A stable official direct-media contract exists. Supply a compact evidence table plus reproducible requests for >=3 cameras and identify the safe allowlist/URL derivation for GEV.

### REVISE
Media is available but requires bounded, legitimate session/token negotiation. Document the exact lifecycle and the smallest safe server-side design.

### KILL
No stable/direct media contract exists, or access depends on unsupported scraping/private/authenticated behavior. Recommend explicit link-only semantics instead; do not fake a camera feed.

## Evidence rules

- Preserve negative results.
- Separate what was executed from what was inferred.
- Do not call an HTML 200 response a working media feed.
- Do not bypass authentication, anti-bot controls, or access restrictions.
- Do not create an upstream PR/comment; this draft PR is the downstream control plane.
- Return exact URLs/headers only when they are public and non-secret.
