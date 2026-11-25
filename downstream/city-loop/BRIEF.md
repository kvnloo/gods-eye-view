# BRIEF: city loop v2 (round 0 = baseline)

**Owner decision 2026-11-22 (verbatim):** "yea i really like the wintercats inspo, lets start with that version
for the dreamloop & filter". This is a style direction with no SHA, recorded in `owner-verdicts.jsonl` as
`from_owner: true`.

## Targets (COPY vs INTENT)
| Element | Source | COPY | INTENT |
|---|---|---|---|
| Look: palette, softness, light | wintercats A1/A2 | — | warm LUT, soft AO/GI, tilt-shift, painterly low-poly |
| Game HUD minimalism | wintercats A1/A2 | — | thin dark top resource bar + bottom build tray, no dashboards |
| App shell, verbs, honesty | concepts-v1.jpg | GEV wordmark, rails, dock, attribution, verb wheel, AI chip | tethered verbs, EST labels |
| Per-beat target | AI postcard of the real capture | camera, layout, plot | the wintercats look on THIS place |
| Placement / build juice | wintercats A1 | — | a placement ghost that snaps, rise + dust, ticking chips |

Protected (never sacrificed for the look): the real place (photoreal geometry stays true), Google attribution,
the AI concept chip, EST labels.

## Beats (fixed)
district (far) · select (wheel) · reimagine (AI concept) · build (massing) · shadow (sun fit) · growth (NOW/5/15 YR)

## Arms captured in round 0
- **CAPTURE:** the app as-is on Google photoreal tiles.
- **COZY FILTER (arm a):** `filter/cozyValley.js`, a Cesium post chain (AO where supported, bloom, warm grade/LUT,
  saturation, soft posterise, tilt-shift, vignette) with an Original/Cozy compare wipe.
- **AI POSTCARD (arm b):** an img2img edit of each capture toward the wintercats frames. Target only, chipped
  `AI LOOK - NOT EVIDENCE`.

Round 1+ closes the gap between (a) and (b), in this order: post chain first, then an in-plot stylised low-poly
kit (diorama bubble) for built massing, then a placement ghost and build juice.
