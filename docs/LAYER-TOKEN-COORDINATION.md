# Coordinated layer-token allocation

Based on upstream main `85b1694bad5907e41b1394d0ea0beeddda7df39f`
(36 published reservations, including Wildlife Sightings `9` from #1591).
This is a coordination proposal until maintainers accept it. It does not
activate a layer, change the share codec, or allocate an alias.

| PR | Layer ID | Reserved token |
| --- | --- | --- |
| #1316 | `local-usgs-lakes` | `00` |
| #1316 | `local-usgs-springs` | `01` |
| #1316 | `local-usgs-water` | `02` |
| #1143 | `caba-traffic-enforcement` | `03` |
| #1583 | `shipwrecks` | `04` |
| #1584 | `air-accidents` | `05` |

All 36 published rows remain immutable; six new reservations fill the
contiguous `00`–`05` range. The resulting ledger has 42 rows and the next
free token is `06`. Reserve the batch before any feature lands, then keep
the complete ledger on each feature branch. Recheck the merge-time main:
any intervening published assignment takes precedence.

## Why the earlier proposal changed

radianx's first proposal at `2470b39f` placed USGS water at `9`.
Wildlife Sightings #1591 subsequently published that token. Byrd-IT
identified the collision in #1592 and updated #1316 to `02/00/01`;
the published wildlife mapping must not be reassigned.

River Levels #1565 was closed by asturksever on November 9 in favor
of the Data Library #1604. That library uses its own `lib=` share
format and ledger, not a core layer token. No `river-levels` row is
pre-reserved here: reserving it would permanently consume a scarce
core token for a withdrawn core-layer proposal. If a new core layer
is later accepted, it needs a new allocation against then-current main.

## Feature branch follow-through

- Byrd-IT (#1316): retain `00/01/02` (lakes/springs/water), and adopt the
  complete 42-row reservation ledger and its pin after reconciling main.
- radianx (#1143): replace provisional `6` with `03` in its registry,
  fixtures, CABA docs, and example share links. Published Sea Marks keeps `6`.
- IMBrandao (#1583/#1584): move provisional `9` to `04/05` in their
  registries, tests, docs, and example links. Published Wildlife keeps `9`.
  Their earlier preview links require regeneration.

Reservations are not active registry entries. At the inspected upstream main,
the registry has 36 layers and the application catalog 38; this ledger-only
change must not increase either count. If the four open PRs add all six core
layers, those counts become 42 and 44 respectively. Any intermediate
registry/catalog or voice-schema pin follows actual landed features, not
the reservation count. This add-on commit is based on #1592's older
head, whose runtime registry predates Wildlife; an upstream-main
reconciliation is still required before landing.

## Verification and compatibility

Run `node --test src/data/layerStateTokenLedger.test.mjs
src/data/layerState.test.mjs`, the token checker against the current
published main, format/boundaries/build, and the browser two-character
share fixture after rebase. The synthetic merge-order test checks all
24 orders of the four remaining feature PRs; it is not evidence that
their features were integrated or tested together.

Main's published links retain their meaning. Newly reserved but inactive
tokens remain invalid in enabled-layer payloads. CABA previews using `6`
and USGS/IMBrandao previews using `9` cannot retain their earlier
meaning under schema v2; regenerate links rather than inventing aliases.
Pre-reserving makes these six allocations permanent even if their
feature PRs are later withdrawn.
