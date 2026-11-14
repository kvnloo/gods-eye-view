# Power Plants

The 147-record `power_plants.geojsonl` snapshot is generated from the
manually entered `PLANTS` array in `scripts/generate-power-plants.mjs`.
It is **not** a documented extract of the World Resources Institute Global
Power Plant Database or OpenStreetMap. The original layer was contributed by
viji5626.

- **Source:** Contributor-compiled reference list (not an OSM/WRI import).
- **Identifiers:** `id` is a local sequence number, not an OpenStreetMap ID.
- **Fields:** Facility name, location, fuel, reported MW capacity, operator and
  country. OSM-style `tags` are a local schema convention, not OSM source data.
- **Provenance and reuse:** No upstream record-level citations or third-party
  dataset license grants have been substantiated for this compilation. Do not
  treat it as an ODbL 1.0 or WRI CC BY 4.0 extract.

Coordinates, owners, plant status and reported MW values have not been
independently audited. Some facilities may be under construction or offline.
The values are not live output or proof of operating status.
