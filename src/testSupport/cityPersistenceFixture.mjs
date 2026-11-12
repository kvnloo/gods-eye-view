/**
 * The one shared City builder persistence fixture (#302, council c4b): an
 * unplaced project plus placed alternatives (a walk-access site and a play-mode
 * plot) run through the real create -> save -> reload -> reselect path. Lanes
 * that add saved keys (zoning, access, co-op) assert against it, and
 * `cityDocumentSavedKeys.txt` pins every saved key as a sorted `path: type`.
 */
import { createCityBuilder } from '../ui/cityBuilder.js';
import { createPlanningConceptGenerator } from '../data/planningConceptGenerator.js';
import { snapPlot } from '../data/cityPlot.js';
import {
  carouselCards,
  createPlayState,
  playReducer,
  plotAlternatives,
  resumeAlternative,
} from '../ui/cityPlayModel.js';

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
export const PERSISTENCE_PLOT = snapPlot({ lat: 37.8007, lon: -122.4103 });

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
    publishPlay: (view) => (sink.play = view),
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

/** Create, save, reload and reselect through the real builder and play reducer. */
export async function runCityPersistenceRoundTrip() {
  const storage = memoryStorage();
  const first = {};
  const builder = builderOn(storage, first);
  builder.open();
  await builder.start({ title: 'Persistence fixture' });
  author(builder, 'Unplaced pocket park', '');
  author(builder, 'Park on site A', 'site-a');
  builder.close();
  const placedId = await builder.reimagine({
    plot: PERSISTENCE_PLOT,
    kind: 'plaza',
  });
  // Version 2 of the placed world, with its own concept.
  await builder.reroll(placedId);
  const saved = storage.value;
  builder.destroy();

  const second = {};
  const reloaded = builderOn(storage, second);
  const { alternatives } = second.play;
  const { lat, lon, alt } = PERSISTENCE_REFERENCE.camera;
  const resume = resumeAlternative(alternatives, { lat, lon, height: alt });
  const entered = playReducer(createPlayState(), { type: 'enter' });
  const state = playReducer(entered, {
    type: 'resume',
    plot: resume.site.plot,
    id: resume.id,
  });
  const reselected = {
    state,
    alternatives: plotAlternatives(alternatives, state.plot.id),
    cards: carouselCards(alternatives, state.plot.id, {
      focusId: state.focusId,
    }),
    reopened: playReducer(state, { type: 'select', plot: state.plot }),
  };
  reloaded.destroy();
  return {
    saved,
    placedId,
    before: first.play,
    after: second.play,
    afterSaved: storage.value,
    reselected,
  };
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
