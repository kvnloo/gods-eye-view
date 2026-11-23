// FORK-ONLY experiment (exp/city-loc-green, city dream loop v3 location lane):
// ?cityLoc=<key> picks the QA location for the ?look=diorama district: its
// plot (the capture harness reads it too) and its OSM fixture. Pure data, no
// Cesium, so node scripts can import it.
//
// Fixtures: public/city-diorama/<key>.osm.json, (c) OpenStreetMap
// contributors, ODbL 1.0 (see public/city-diorama/README.md).
// Ground: no location carries terrain heights. Every one, North Beach
// included, samples Cesium World Terrain in the page at run time (streamed
// from ion, kept in memory, never stored); the ion terms do not allow storing
// sampled heights in the repo (loop-v3/licence/REPORT.md, item 1).
export const CITY_LOCATIONS = Object.freeze({
  northbeach: Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'North Beach, San Francisco (Washington Square)',
    plot: 'plot-n105201-126637',
    fixture: '/city-diorama/north-beach-r700.osm.json',
  }),
  // kept as an alias from exp/city-loc-green, where only this key sampled live
  'northbeach-live': Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'North Beach, San Francisco (Washington Square)',
    plot: 'plot-n105201-126637',
    fixture: '/city-diorama/north-beach-r700.osm.json',
  }),
  presidio: Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'Presidio Main Post / Crissy Marsh, San Francisco',
    plot: 'plot-n105200-126533',
    fixture: '/city-diorama/presidio.osm.json',
  }),
  sausalito: Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'Sausalito waterfront (Dunphy Park)',
    plot: 'plot-n105367-126364',
    gridPlot: 'plot-sausalito-0-0',
    gridOppositePlot: 'plot-sausalito-3-3',
    fixture: '/city-diorama/sausalito.osm.json',
  }),
});

export const DEFAULT_CITY_LOCATION = 'northbeach';
// exp/city-loop-v4: ?city=hero is the v3 preset at this location, for the
// "build a park for my neighborhood" journey (Dunphy Park lawn on Bridgeway).
export const HERO_CITY_LOCATION = 'sausalito';

/** The location named by `?cityLoc=` (default North Beach, Sausalito under `?city=hero`); null for an unknown key. */
export function cityLocation(search = '') {
  const q = new URLSearchParams(search ?? '');
  const key =
    q.get('cityLoc') ??
    (q.get('city') === 'hero' ? HERO_CITY_LOCATION : DEFAULT_CITY_LOCATION);
  const loc = CITY_LOCATIONS[key];
  return loc ? { key, ...loc } : null;
}
