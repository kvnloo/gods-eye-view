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
    // the fixture centre [lon, lat]
    anchor: [-122.41021134056297, 37.801473230326984],
    gridPlot: 'plot-northbeach-8-11',
    gridOppositePlot: 'plot-northbeach-11-14',
    // i18n-ignore: a proper place name, shown untranslated (translate="no") like any geocoded name.
    place: 'San Francisco',
    fixture: '/city-diorama/north-beach-r700.osm.json',
  }),
  // kept as an alias from exp/city-loc-green, where only this key sampled live
  'northbeach-live': Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'North Beach, San Francisco (Washington Square)',
    plot: 'plot-n105201-126637',
    // the fixture centre [lon, lat]
    anchor: [-122.41021134056297, 37.801473230326984],
    gridPlot: 'plot-northbeach-8-11',
    gridOppositePlot: 'plot-northbeach-11-14',
    // i18n-ignore: a proper place name, shown untranslated (translate="no") like any geocoded name.
    place: 'San Francisco',
    fixture: '/city-diorama/north-beach-r700.osm.json',
  }),
  presidio: Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'Presidio Main Post / Crissy Marsh, San Francisco',
    plot: 'plot-n105200-126533',
    // the fixture centre [lon, lat]
    anchor: [-122.45778641158287, 37.80111390585699],
    gridPlot: 'plot-presidio-5-5',
    gridOppositePlot: 'plot-presidio-10-8',
    // i18n-ignore: a proper place name, shown untranslated (translate="no") like any geocoded name.
    place: 'San Francisco',
    fixture: '/city-diorama/presidio.osm.json',
  }),
  sausalito: Object.freeze({
    // i18n-ignore: QA location name for the fork-only harness (manifests, logs), not UI text.
    label: 'Sausalito waterfront (Dunphy Park)',
    plot: 'plot-n105367-126364',
    // the fixture centre [lon, lat]
    anchor: [-122.48788513443384, 37.86112109234639],
    gridPlot: 'plot-sausalito-0-0',
    gridOppositePlot: 'plot-sausalito-3-3',
    // i18n-ignore: a proper place name, shown untranslated (translate="no") like any geocoded name.
    place: 'Sausalito',
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

const M = 111_320;
/** How far from its anchor plot a location's own place name holds (its fixture radius). */
export const PLACE_METERS = 760;

/**
 * The place the HUD names for a point (q03): the place of the QA location
 * whose fixture holds it (Dunphy Park is in Sausalito, not the most populous
 * city within 12 km), else the name of the city `nearest` found AT the point
 * (not at the camera), else null, which the HUD shows as a dash. Pure.
 */
export function cityPlaceName(point, { nearest = null } = {}) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  for (const location of Object.values(CITY_LOCATIONS)) {
    const [lon, lat] = location.anchor;
    const kx = M * Math.cos((lat * Math.PI) / 180);
    if (
      Math.hypot((point.lon - lon) * kx, (point.lat - lat) * M) <= PLACE_METERS
    )
      return location.place ?? null;
  }
  return nearest?.name ?? null;
}
