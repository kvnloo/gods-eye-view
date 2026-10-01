# A22 / Autostrada del Brennero CCTV evidence packet

Factory protocol: `oss-factory:v1`
Status: `REVISE`
Dedupe key: `gods-eye-view:a22-cctv:source-pack`
Upstream issue: https://github.com/bilawalsidhu/gods-eye-view/issues/155
Base SHA: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
Branch: `feat/a22-cctv`

## Current verdict

The direct-media hypothesis is substantially supported, but the complete 13-camera catalog is not yet authoritative enough to promote.

The operator publishes periodic first-party JPEG stills under:

`https://www.autobrennero.it/WebCamImg/km<marker>.jpg`

The official webcam page lists 13 named cameras and explicitly says the images are single still frames refreshed at regular intervals for privacy/security reasons. This matches GEV's existing still-image CCTV contract.

Do **not** invent the remaining camera identity/coordinate mapping from motorway kilometre markers. Promotion should wait until every included JPEG is tied to an operator-published camera identity/location.

## Official sources

Webcam page:

https://www.autobrennero.it/it/informazioni-per-il-viaggio/webcam/

Webcam semantics:

https://www.autobrennero.it/en/on-the-road/webcam/info-webcam/

The official page currently lists:

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

For Brennero the same page publishes:

- `Brennero/Brenner (BZ) | Km 1`
- `a destra carr. SUD (dir.Modena)`
- first-party frame `https://www.autobrennero.it/WebCamImg/km1.jpg`

## Executed media evidence — 2026-10-01

Multiple first-party `WebCamImg` JPEGs were directly reachable during the evidence sweep, including:

- `km1.jpg`
- `km68.jpg`
- `km77.jpg`
- `km100.jpg`
- `km129.jpg`
- `km138.jpg`
- `km159.jpg`
- `km205.jpg`
- `km313.jpg`

This establishes that Brennero is not a one-off endpoint and that a stable operator-hosted JPEG family exists across the corridor.

Only camera identities explicitly supported by operator evidence should be committed to a curated catalog. The numeric suffix is useful evidence, not sufficient identity or coordinate authority by itself.

## Reuse / attribution evidence

Autostrada del Brennero's published site notice states that site information, images and logos are its property and that reproduction is allowed when the relevant content is reproduced integrally and the source and extraction date are specified.

That is materially more permissive than a generic all-rights-reserved page, but this packet does not independently interpret whether a continuously refreshed third-party runtime proxy of webcam frames satisfies every condition.

The operator also has a separate multimedia-archive authorization process. Treat archive-media rules and live-webcam/site-content rules as potentially distinct; do not conflate them.

Before promotion, the implementation should preserve clear source attribution and extraction/observation time, and the PR should quote/link the exact operator notice relied upon.

## Remaining gate

Resolve the complete promoted subset with authoritative evidence for each camera:

1. exact official JPEG URL;
2. exact operator-published camera name;
3. operator-published motorway km / location description;
4. latitude / longitude from an authoritative source if available;
5. published direction/carriageway text, otherwise low-confidence heading;
6. fresh-session access behavior and response media type;
7. observed refresh cadence;
8. source/date attribution required by the operator's reproduction notice.

If all 13 cannot be resolved cleanly, promote a smaller curated subset rather than filling gaps heuristically.

## Constraints

- Do not invent coordinates from motorway km markers.
- Do not scrape third-party mirrors when an operator source exists.
- Do not infer heading unless the operator text is unambiguous.
- Keep frames on the official `www.autobrennero.it` host.
- Do not archive or vendor frames.
- Preserve the operator warning that periodic stills are not suitable for precise realtime traffic-state inference.

## Promotion shape after gate

- small curated source pack;
- official-host allowlist only;
- source + observation/extraction time visible in attribution;
- low-confidence heading where facing is not explicit;
- refresh cadence matched to upstream;
- focused source-contract tests;
- `DATA_SOURCES.md`, `CURRENT-STATE.md`, `CHANGELOG.md`;
- repository browser/tracking gates before upstream promotion.
