/**
 * The one shared City builder persistence fixture: an unplaced possible world
 * and one placed on a walk-access site (with a second version and a labelled
 * concept) go through the real builder's create -> save -> reload path. Slices that add saved keys assert against it,
 * and `cityDocumentSavedKeys.txt` pins every saved key as a sorted `path: type`.
 */
import { createCityBuilder } from '../ui/cityBuilder.js';
import { createPlanningConceptGenerator } from '../data/planningConceptGenerator.js';

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

function memoryStorage() {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

function builderOn(storage, sink) {
  return createCityBuilder({
    publish: (view) => (sink.view = view),
    offerLauncher: () => {},
    captureReference: async () => PERSISTENCE_REFERENCE,
    storage,
    generator: (options) =>
      createPlanningConceptGenerator({
        ...options,
        now: () => PERSISTENCE_REFERENCE.capturedAt,
      }),
    download: () => {},
    uid: () => 'city-persistence',
  });
}

function author(builder, title, site) {
  builder.newAlternative();
  builder.editField('title', title);
  builder.editField('description', `${title} for the persistence fixture.`);
  builder.editField('site', site);
  builder.saveAlternative();
}

/** Create, save and reload through the real builder. */
export async function runCityPersistenceRoundTrip() {
  const storage = memoryStorage();
  const first = {};
  const builder = builderOn(storage, first);
  builder.open();
  await builder.start({ title: 'Persistence fixture' });
  author(builder, 'Unplaced pocket park', '');
  author(builder, 'Park on site A', 'site-a');
  // Version 2 of the second world, with its own concept.
  builder.editAlternative('world-2');
  builder.editField('kind', 'plaza');
  builder.saveAlternative();
  await builder.imagine('world-2');
  const saved = storage.value;
  const before = first.view.city;
  builder.destroy();

  const second = {};
  const reloaded = builderOn(storage, second);
  reloaded.open();
  const after = second.view.city;
  reloaded.destroy();
  return { saved, before, after, afterSaved: storage.value };
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
