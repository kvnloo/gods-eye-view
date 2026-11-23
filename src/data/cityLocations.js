// FORK-ONLY experiment (exp/city-loc-green, city dream loop v3 location lane):
// ?cityLoc=<key> picks the QA location for the ?look=diorama district: its
// plot (the capture harness reads it too) and its OSM fixture. Pure data, no
// Cesium, so node scripts can import it.
//
// Fixtures: public/city-diorama/<key>.osm.json, (c) OpenStreetMap
// contributors, ODbL 1.0 (see public/city-diorama/README.md).
// Ground: `ground: null` means the page samples Cesium World Terrain at run
// time (streamed from ion, never stored); the ion terms do not allow storing
// sampled heights in the repo (loop-v3/licence/REPORT.md, item 1).
export const CITY_LOCATIONS = Object.freeze({
  northbeach: Object.freeze({
    label: 'North Beach, San Francisco (Washington Square)',
    plot: 'plot-n105201-126637',
    fixture: '/city-diorama/north-beach-r700.osm.json',
    // legacy baked file from exp/city-look-diorama; ?cityLoc=northbeach-live samples at run time instead
    ground: '/city-diorama/north-beach-r700.ground.json',
  }),
  'northbeach-live': Object.freeze({
    label: 'North Beach, San Francisco (Washington Square), terrain sampled live',
    plot: 'plot-n105201-126637',
    fixture: '/city-diorama/north-beach-r700.osm.json',
    ground: null,
  }),
  presidio: Object.freeze({
    label: 'Presidio Main Post / Crissy Marsh, San Francisco',
    plot: 'plot-n105200-126533',
    fixture: '/city-diorama/presidio.osm.json',
    ground: null,
  }),
  sausalito: Object.freeze({
    label: 'Sausalito waterfront (Dunphy Park)',
    plot: 'plot-n105367-126364',
    fixture: '/city-diorama/sausalito.osm.json',
    ground: null,
  }),
});

export const DEFAULT_CITY_LOCATION = 'northbeach';

/** The location named by `?cityLoc=` (default North Beach); null for an unknown key. */
export function cityLocation(search = '') {
  const key = new URLSearchParams(search ?? '').get('cityLoc') ?? DEFAULT_CITY_LOCATION;
  const loc = CITY_LOCATIONS[key];
  return loc ? { key, ...loc } : null;
}
