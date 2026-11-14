- Enforce Sentinel-2 Latest's daily Copernicus request budget when tiles and
  scene lookups share a pending OAuth mint, including 401 retries. Exhausted
  requests return a quota response or cached stale tile without an extra
  Process/Catalog call; budget file initialization and writes are serialized.
  Preserves Paulemad2002's original Sentinel-2 contribution.
