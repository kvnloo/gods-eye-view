# Open wildfire intelligence (v0)

This is a read-only evidence composition inside God's Eye View, not a new
upstream sensor feed, wildfire-detection model or dispatch system. It uses the
existing source-backed query catalog and returns an ordinary GEV globe view.

## Query

`get_wildfire_intelligence({ area: { lat: 36, lon: -120, radius_km: 50 }, limit: 10 })`

The MCP tool returns three **independent** sections:

| Section | Existing GEV query | What it means |
| --- | --- | --- |
| `detections` | `get_active_fires` | NASA FIRMS thermal detections; a hotspot alone is not a verified wildfire |
| `perimeters` | `get_fire_perimeters` | NIFC WFIGS mapped US incidents; outlines do not describe the current fire front |
| `cameras` | `find_cctv_cameras` | Public camera catalog metadata; proximity and heading do not establish visibility |

Each section retains the source's rows and timestamps, reports
`available | partial | stale | unavailable`, and distinguishes **zero records**
from an unavailable source. The default is 10 rows per source, maximum 25.
Truncated results include source-level `total` and `returned` counts. The
composite independently caps returned rows even if a child tool exceeds its
requested limit or forgets to mark additional matches as truncated. Invalid
source totals are treated as unavailable evidence, without hiding other sources.
Missing or key-gated FIRMS never blocks the keyless perimeter query.

The returned `view` frames the requested area and enables only the existing
GEV layers whose queries succeeded; no new Cesium layer or background polling
is installed. `next_checks` names existing imagery and selected-camera
inspection tools but never runs them automatically. Camera frames, proprietary
alerts and private sensor endpoints are not fetched by this composite.

## Provenance, limitations and rights

- Original provider attribution and source-specific record fields remain intact.
- Satellite rows carry acquisition metadata and snapshot fetch time when
  supplied; camera catalog rows **do not** claim frame timestamps or smoke.
- Unavailable, stale, trimmed and missing-satellite signals are visible. No
  single confidence score, cross-source deduplication, triangulation, smoke
  detection, safety certification or inferred road access is produced.
- WFIGS has US-only incident coverage. Zero records outside its coverage do
  **not** mean zero fires.
- This feature consumes no Pano AI data or code, and does not rely on a Pano
  API. A future licensed/provider-authorized detector can use a separate source
  adapter, with verification, provenance and data-rights checks.

## Validation and follow-up

`node --test src/tools/queries/wildfire.test.mjs` covers partial sources,
catalog interceptors, cancellation, non-leaking failures, bounded results and
MCP/voice exposure. Full repository tests, build, formatting and package
boundary gates still apply before promotion.

Next GEV-only increment: selected-hazard evidence cards that launch the
existing Recent Imagery and camera tools, aligned with upstream
[hazard handoff #797](https://github.com/bilawalsidhu/gods-eye-view/issues/797)
and downstream [evidence braid #56](https://github.com/kvnloo/gods-eye-view/issues/56).
Keep model-based detection and incident replay behind separate review and
appropriately licensed datasets.
