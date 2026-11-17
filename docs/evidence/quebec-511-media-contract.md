# Québec 511 media-contract evidence packet

Factory protocol: `oss-factory:v1`  
Status: `REVISE`  
Dedupe key: `gods-eye-view:quebec-511:media-contract`  
Upstream issue: https://github.com/bilawalsidhu/gods-eye-view/issues/445  
Base SHA: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`  
Branch: `feat/quebec-511-cctv`

## Current verdict

The technical media blocker is resolved: Québec 511 publishes stable, direct JPEG paths for camera images.

Promotion is still blocked by the service's current usage terms. The public Québec 511 terms say platform content must not be used for a purpose other than that for which the service was designed. The separate CC BY 4.0 dataset license covers the camera catalog/geometry, but this evidence does not establish that the camera imagery itself may be republished or proxied by a third-party application.

Do **not** promote a GEV camera proxy until the image-reuse rights are clarified or permission is obtained.

## Executed media evidence — 2026-10-01

Official camera listing:

https://www.quebec511-mtl.transports.gouv.qc.ca/fr/Diffusion/EtatReseau/Camera.aspx?Id=40&Type=2

Three Montréal A-40 cameras exposed these image paths:

| Camera | Stable direct-media path |
| --- | --- |
| A-40, Île-aux-Tourtes / Sainte-Anne-de-Bellevue | `/Images/Cameras/Montreal/cam/0400406.jpg` |
| A-40 at Autoroute 13 | `/Images/Cameras/Montreal/cam/0400609.jpg` |
| A-40, Charles-De Gaulle bridge / Montréal side | `/Images/Cameras/Montreal/cam/0400924.jpg` |

The page appended a changing cache-buster query to each JPEG. Two independent page fetches produced the same three paths with different query values and visibly updated image contents.

First observed query generation:

- `0400406.jpg?639246579600000000=`
- `0400609.jpg?639246579600000000=`
- `0400924.jpg?639246579600000000=`

Later page fetch:

- `0400406.jpg?639264744600000000=`
- `0400609.jpg?639264744600000000=`
- `0400924.jpg?639264744600000000=`

This strongly supports a stable path + disposable cache-buster contract rather than a signed/session-specific media URL.

The official Québec 511 FAQ also states that camera imagery is refreshed every 2–4 minutes.

## What is now established

- The official viewer is not the only usable surface; direct JPEG assets exist.
- The media URLs are first-party Québec 511 / MTMD URLs.
- Camera asset identity is stable across refreshes.
- The cache-buster changes independently of the stable JPEG path.
- At least three independent cameras use the same URL shape.
- No login, signed token, or per-camera temporary media URL appeared in the tested page flow.

## What remains unproven

A browser/network capture should still confirm whether a server-side fetch requires any relevant cookie, Referer, Origin, or other header. The evidence above did not expose such a requirement, but it did not record raw response/request headers.

More importantly, reuse rights remain unresolved.

Québec 511's current Terms of Use state that the platforms/content may not be modified or used for a purpose other than that for which they were designed. The privacy policy confirms the traffic-camera images are transient and are published on Québec 511 to inform road users.

Therefore public accessibility is **not** being treated as permission to proxy or redistribute the images through GEV.

## Safe next step

Keep the official WFS/GeoJSON catalog and CC BY 4.0 geometry/provenance work.

For imagery, do one of:

1. obtain an explicit MTMD reuse permission/license for camera imagery in third-party applications;
2. find a separate officially licensed redistribution surface/API whose terms permit this use; or
3. keep Québec 511 link-only in GEV rather than proxying the images.

Do not bypass access controls, scrape private endpoints, or infer image-reuse rights from the catalog license.

## Original worker assignment

The official Québec 511 / MTMD WFS remains the source for camera identity and geometry:

`https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson`

Preserve negative results and separate executed evidence from inference.
