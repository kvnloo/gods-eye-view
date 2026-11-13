/**
 * The one shared City builder persistence fixture: a captured reference, two
 * possible worlds, a second version and a labelled concept go through the
 * document kernel's create -> serialize -> parse path. Slices that add saved
 * keys assert against it, and `cityDocumentSavedKeys.txt` pins every saved key
 * as a sorted `path: type`.
 */
import {
  addCityAlternative,
  attachCityConcept,
  createCityDocument,
  parseCityDocument,
  reviseCityAlternative,
  serializeCityDocument,
} from '../data/cityPlanningDocument.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';

export const PERSISTENCE_REFERENCE = Object.freeze({
  camera: {
    lat: 37.7953,
    lon: -122.4103,
    alt: 600,
    heading: 0,
    pitch: -45,
    roll: 0,
  },
  bounds: [-122.43, 37.78, -122.39, 37.82],
  sources: [
    {
      id: 'esri-imagery',
      revision: 'fixture-2026-11-12',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      attribution: 'Esri World Imagery',
      license: 'See the provider terms',
    },
  ],
  capturedAt: '2026-11-12T20:00:00.000Z',
  image,
});

const parameters = {
  kind: 'park',
  trees: 20,
  widthMeters: 2,
  shadePercent: 40,
};

/** Create, save and reload a project through the document kernel. */
export function runCityPersistenceRoundTrip() {
  let document = createCityDocument({
    id: 'city-persistence',
    title: 'Persistence fixture',
    reference: PERSISTENCE_REFERENCE,
  });
  for (const [id, title] of [
    ['world-1', 'Unplaced pocket park'],
    ['world-2', 'Plaza on the corner'],
  ])
    document = addCityAlternative(document, {
      id,
      title,
      description: `${title} for the persistence fixture.`,
      parameters,
    });
  document = reviseCityAlternative(document, 'world-2', 1, {
    title: 'Plaza on the corner',
    description: 'Version 2 of the plaza for the persistence fixture.',
    parameters: { ...parameters, kind: 'plaza' },
  });
  document = attachCityConcept(document, 'world-2', 2, {
    prompt: 'A plaza on the corner.',
    provider: 'fixture',
    generatedAt: PERSISTENCE_REFERENCE.capturedAt,
    sourceView: PERSISTENCE_REFERENCE,
    image,
  });
  const saved = serializeCityDocument(document);
  return { saved, afterSaved: serializeCityDocument(parseCityDocument(saved)) };
}

/** Every saved key as a sorted, unique `path: type` line; array items as `[]`. */
export function savedKeySnapshot(json) {
  const types = new Map();
  const walk = (value, path) => {
    const type =
      value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (path) types.set(path, (types.get(path) ?? new Set()).add(type));
    if (Array.isArray(value)) value.forEach((item) => walk(item, `${path}[]`));
    else if (type === 'object')
      for (const [key, item] of Object.entries(value))
        walk(item, path ? `${path}.${key}` : key);
  };
  walk(JSON.parse(json), '');
  return `${[...types]
    .map(([path, set]) => `${path}: ${[...set].sort().join('|')}`)
    .sort()
    .join('\n')}\n`;
}
