- Merge DeFlock's US/Canada camera tiles into the existing mapped ALPR feed,
  deduplicating OSM nodes and way centroids while retaining healthy sources when
  another feed or country is unavailable. Keep bounded viewport requests, marker
  limits and OSM attribution (dylanmaniatakes, #1537).
- Treat 404 responses from empty existing-feed camera detail tiles as empty
  coverage, not partial unavailability (dylanmaniatakes, review by THEtheChad;
  follow-up by kvnloo, #1537).
