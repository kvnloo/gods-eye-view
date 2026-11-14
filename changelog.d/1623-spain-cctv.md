- Spain's DGT road cameras join the CCTV mesh: the national DATEX II camera
  document is read at runtime, so the pack stays keyless and never ships a
  scraped snapshot (T3mpux, #1623).
- Duplicate DGT frame URLs at distant published locations are omitted instead
  of projecting conflicting camera anchors; nearby aliases share one source.
