import { createPlanningConceptGenerator } from '../data/planningConceptGenerator.js';
import { createCityBuilder } from '../ui/cityBuilder.js';
import { useCommunityPlanningStore } from '../ui/stores/communityPlanning.js';
import { useCityPlayStore } from '../ui/stores/cityPlay.js';
import { mountCityPlay } from './cityPlay.js';
import { massingFlag } from '../data/cityMassing.js';
import { mountCityMassing } from './cityMassing.js';
import { useSceneSharingStore } from '../ui/stores/sceneSharing.js';
import { applicationPinia } from '../ui/vueRuntime.js';
import { renderFreshCesiumFrame } from '../voice/realtimeViewport.js';

// Public product citations, never provider request URLs or credential-bearing resources.
const SOURCE_CITATIONS = Object.freeze({
  photoreal: [
    'https://developers.google.com/maps/documentation/tile/3d-tiles',
    'Google Maps',
  ],
  'bing-aerial': ['https://www.bing.com/maps', 'Bing Maps via Cesium ion'],
  'bing-labels': ['https://www.bing.com/maps', 'Bing Maps via Cesium ion'],
  'esri-imagery': [
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    'Esri World Imagery',
  ],
  osm: [
    'https://www.openstreetmap.org/copyright',
    'OpenStreetMap contributors',
  ],
});
const degrees = (radians) => radians * (180 / Math.PI);
const FRESH_FRAME_ATTEMPTS = 4;
// [JPEG quality, frame scale] attempts, best first.
const CAPTURE_STEPS = [
  [0.78, 1],
  [0.62, 1],
  [0.62, 0.75],
  [0.5, 0.6],
];

function captureFailure() {
  return new Error('City reference capture unavailable');
}

function readView(viewer) {
  const camera = viewer?.camera;
  const position = camera?.positionCartographic;
  if (
    ![
      position?.latitude,
      position?.longitude,
      position?.height,
      camera?.heading,
      camera?.pitch,
      camera?.roll,
    ].every(Number.isFinite)
  )
    throw captureFailure();
  const pose = {
    lat: degrees(position?.latitude),
    lon: degrees(position?.longitude),
    alt: position?.height,
    heading: degrees(camera?.heading),
    pitch: degrees(camera?.pitch),
    roll: degrees(camera?.roll),
  };
  const rectangle = camera?.computeViewRectangle?.(
    viewer.scene.globe?.ellipsoid,
  );
  const extent = rectangle && [
    rectangle.west,
    rectangle.south,
    rectangle.east,
    rectangle.north,
  ];
  if (!extent || !extent.every(Number.isFinite)) throw captureFailure();
  const bounds = extent.map(degrees);
  if (
    !Object.values(pose).every(Number.isFinite) ||
    Math.abs(pose.lat) > 90 ||
    Math.abs(pose.lon) > 180 ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -90 ||
    bounds[3] > 90 ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    throw captureFailure();
  return { camera: pose, bounds };
}

// The selected map's [id, url, name], or null when no cited map is established.
function activeCitation(mapStackController) {
  const state = mapStackController?.getState?.();
  const descriptor = state?.activeStack;
  const citation =
    descriptor && Object.hasOwn(SOURCE_CITATIONS, descriptor.id)
      ? SOURCE_CITATIONS[descriptor.id]
      : null;
  // A switch in progress does not establish which source supplied the pixels.
  if (!citation || state.status !== 'ready' || state.activeId !== descriptor.id)
    return null;
  return [descriptor.id, ...citation];
}

function readSources(mapStackController, capturedAt) {
  const citation = activeCitation(mapStackController);
  if (!citation) return [];
  return [
    {
      id: citation[0],
      revision: `Captured at ${capturedAt}`,
      url: citation[1],
      attribution: `${citation[2]} (unverified; selected map source only)`,
      license: 'Unverified; provider terms apply',
    },
  ];
}

/** Capture only the supplied viewer's current view. No camera move, freeze, or transfer. */
export async function captureCityReference({
  viewer,
  mapStackController,
  now = () => new Date().toISOString(),
  renderFrame = renderFreshCesiumFrame,
  createCanvas = () => document.createElement('canvas'),
}) {
  try {
    const source = viewer?.scene?.canvas;
    if (!source) throw captureFailure();
    // A frame can miss the bounded fresh-render wait while photoreal tiles
    // stream in after a flight; try a few frames before refusing.
    let fresh = false;
    for (let attempt = 0; attempt < FRESH_FRAME_ATTEMPTS && !fresh; attempt++)
      fresh = await renderFrame(viewer);
    if (!fresh) throw captureFailure();
    const { width, height } = source;
    if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0)
      throw captureFailure();
    const view = readView(viewer);
    const capturedAt = now();
    const sources = readSources(mapStackController, capturedAt);
    const scale = Math.min(1, 960 / width, 640 / height);
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw captureFailure();
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    let luminance = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 8) continue;
      visible++;
      luminance +=
        pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    }
    if (!visible || luminance / visible < 2) throw captureFailure();
    // Detailed photoreal frames can exceed the stored-image limit at the first
    // setting; step quality, then size, down before refusing the capture.
    const base = [canvas.width, canvas.height];
    let image = null;
    for (const [quality, shrink] of CAPTURE_STEPS) {
      if (shrink !== 1) {
        canvas.width = Math.max(1, Math.floor(base[0] * shrink));
        canvas.height = Math.max(1, Math.floor(base[1] * shrink));
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
      }
      image = canvas.toDataURL('image/jpeg', quality);
      if (
        typeof image !== 'string' ||
        !image.startsWith('data:image/jpeg;base64,')
      )
        throw captureFailure();
      if (image.length <= 600_000) break;
    }
    if (image.length > 600_000) throw captureFailure();
    return { ...view, sources, capturedAt, image };
  } catch {
    // The owner translates a fixed error key. Canvas/provider error text is not UI.
    throw captureFailure();
  }
}

/** One mounted owner's write lease. Other tabs can still read and export. */
export function createCityBrowserStorage({
  storage = globalThis.localStorage,
  locks = globalThis.navigator?.locks,
} = {}) {
  const abort = new AbortController();
  let writable = false;
  const released = new Promise((resolve) => {
    abort.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  try {
    // Web Locks forbids a request signal with ifAvailable. Abort instead invalidates
    // pending grants and resolves the held lease, including grants after teardown.
    Promise.resolve(
      locks?.request(
        'godsEyeView.cityBuilder.v1',
        { ifAvailable: true },
        async (lock) => {
          writable = Boolean(lock) && !abort.signal.aborted;
          if (writable) {
            await released;
            writable = false;
          }
        },
      ),
    ).catch(() => {
      writable = false;
    });
  } catch {
    writable = false;
  }
  return {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      if (!writable || abort.signal.aborted)
        throw new Error('storage unavailable');
      storage.setItem(key, value);
    },
    destroy() {
      writable = false;
      abort.abort();
    },
  };
}

function downloadDocument(text, filename) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Connect the framework-free owner to this application's stores and browser services. */
export function mountCityBuilder(options = {}) {
  const {
    scene,
    pinia = applicationPinia(),
    store = useCommunityPlanningStore(pinia),
    sharing = useSceneSharingStore(pinia),
    playStore = useCityPlayStore(pinia),
    captureReference = () =>
      captureCityReference({
        viewer: scene?.viewer,
        mapStackController: scene?.mapStackController,
      }),
    storage = createCityBrowserStorage(),
    generator = createPlanningConceptGenerator,
    download = downloadDocument,
    uid,
    canLocal = import.meta.env?.DEV === true,
  } = options;
  const ownsStorage = options.storage === undefined;
  let controls = null;
  let disposed = false;
  let preview = null;
  let launcher = null;
  let play = null;
  let playView = null;
  const current = () => !disposed && (!controls || store.controls === controls);
  const owner = createCityBuilder({
    publish(next) {
      if (!controls) preview = next;
      else if (current()) store.publish(next);
    },
    offerLauncher(next) {
      if (!controls) launcher = next;
      else if (current()) store.offerLauncher(next);
    },
    captureReference() {
      if (!current()) throw captureFailure();
      return captureReference();
    },
    storage: {
      getItem: (key) => (current() ? storage.getItem(key) : null),
      setItem: (key, value) => {
        if (current()) storage.setItem(key, value);
      },
    },
    generator(options) {
      if (!current()) throw new Error('City builder owner unavailable');
      return generator(options);
    },
    download(...args) {
      if (current()) return download(...args);
    },
    sharingDialogOpen: () => !current() || Boolean(sharing.dialog),
    uid,
    canLocal,
    publishPlay(next) {
      playView = next;
      if (current()) play?.receive(next);
    },
  });
  controls = owner;
  // Play mode needs a live globe; without one the records dialog still works.
  if (scene?.viewer)
    play = mountCityPlay({
      viewer: scene.viewer,
      builder: owner,
      store: playStore,
      mapSource: () => activeCitation(scene.mapStackController)?.[2] ?? null,
    });
  play?.receive(playView);
  // Massing v0 follows the selected plot, only behind ?massing=1 (default off).
  const massing =
    play && massingFlag(globalThis.location?.search)
      ? mountCityMassing({ viewer: scene.viewer, store: playStore })
      : null;
  store.connect(controls);
  store.publish(preview);
  store.offerLauncher(launcher);
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      massing?.destroy();
      play?.destroy();
      owner.destroy();
    } finally {
      if (ownsStorage) storage.destroy?.();
      if (store.controls === controls) {
        store.publish(null);
        store.offerLauncher(null);
        store.connect(null);
      }
    }
  };
}
