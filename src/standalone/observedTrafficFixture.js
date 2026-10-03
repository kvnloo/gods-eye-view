import { createObservedTrafficSource } from '../layers/traffic/observed.js';

export const OBSERVED_TRAFFIC_FIXTURE_PARAM = 'observedTraffic';
export const OBSERVED_TRAFFIC_FIXTURE_MODE = 'fixture';
export const OBSERVED_TRAFFIC_FIXTURE_CORRIDOR = 'sr90-imperial';

const DEFAULT_CAMERA_LIMIT = 4;
const STALE_OFFSET_MS = 8 * 60 * 1000;
const FRESH_OFFSET_MS = 20 * 1000;
const CORRIDOR_TOKENS =
  /\b(?:sr\s*[- ]?90|imperial|la habra|brea|yorba linda|fullerton|anaheim)\b/i;

function validCamera(camera) {
  return Boolean(
    camera &&
    typeof camera.id === 'string' &&
    camera.id &&
    Number.isFinite(Number(camera.lat)) &&
    Number.isFinite(Number(camera.lon)),
  );
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cameraSort(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

function fixtureCameraScore(camera) {
  const text = [camera.name, camera.city, camera.provider, camera.id]
    .filter(Boolean)
    .join(' ');
  if (CORRIDOR_TOKENS.test(text)) return 0;
  if (String(camera.provider || '').toLowerCase() === 'caltrans') return 1;
  return 2;
}

/**
 * Choose real loaded cameras for the bounded corridor fixture.
 *
 * Named SR-90 / Imperial Highway-area Caltrans rows win when present. If that
 * exact public-data cohort is absent under the current catalog cap, the demo
 * falls back to other loaded Caltrans rows, then any loaded camera, so the QA
 * path still exercises the same presentation contract without inventing IDs.
 */
export function selectObservedTrafficFixtureCameras(
  cameras,
  { limit = DEFAULT_CAMERA_LIMIT } = {},
) {
  const cap = Math.max(1, Math.min(8, Math.floor(Number(limit) || 0)));
  return (Array.isArray(cameras) ? cameras : [])
    .filter(validCamera)
    .sort(
      (a, b) =>
        fixtureCameraScore(a) - fixtureCameraScore(b) || cameraSort(a, b),
    )
    .slice(0, cap)
    .map((camera) => ({
      id: camera.id,
      name: String(camera.name || camera.id),
      city: String(camera.city || ''),
      provider: String(camera.provider || ''),
      lat: Number(camera.lat),
      lon: Number(camera.lon),
    }));
}

export function observedTrafficFixtureRequested(
  search = typeof globalThis.location?.search === 'string'
    ? globalThis.location.search
    : '',
) {
  const params = new URLSearchParams(String(search || ''));
  return (
    String(params.get(OBSERVED_TRAFFIC_FIXTURE_PARAM) || '').toLowerCase() ===
    OBSERVED_TRAFFIC_FIXTURE_MODE
  );
}

function countsForCamera(camera) {
  const seed = stableHash(camera.id);
  const car = 12 + (seed % 11);
  const heavyVehicle = 2 + ((seed >>> 4) % 5);
  const motorbike = (seed >>> 8) % 4;
  return { car, heavyVehicle, motorbike };
}

function rateForCounts(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Math.max(1, Math.round((total / 5) * 10) / 10);
}

function recordForCamera(camera, index, now) {
  const stale = index === 1;
  const observedAt =
    now - (stale ? STALE_OFFSET_MS : FRESH_OFFSET_MS + index * 5_000);
  const counts = countsForCamera(camera);
  return {
    id: `fixture:${camera.id}`,
    sourceId: 'gev-corridor-fixture',
    cameraId: camera.id,
    observedAt,
    windowStart: observedAt - 5 * 60 * 1000,
    windowEnd: observedAt,
    geometry: {
      type: 'intersection',
      coordinates: [camera.lon, camera.lat],
    },
    flow: {
      vehiclesPerMin: rateForCounts(counts),
      counts,
    },
    movements: [],
    quality: {
      status: 'synthetic-fixture',
    },
    provenance: {
      source: 'GEV synthetic corridor fixture',
      method: 'synthetic-fixture',
    },
  };
}

/**
 * Build deterministic synthetic observations for real loaded camera IDs.
 *
 * The fourth selected camera is intentionally omitted, producing UNKNOWN in
 * the CCTV presentation. The second record is intentionally stale. This gives
 * one no-network fixture a bounded fresh/partial/stale/missing state surface.
 */
export function buildObservedTrafficFixtureSnapshot(
  cameras,
  { now = Date.now() } = {},
) {
  const selected = selectObservedTrafficFixtureCameras(cameras);
  const records = selected
    .slice(0, 3)
    .map((camera, index) => recordForCamera(camera, index, now));
  return {
    source: 'GEV corridor fixture',
    partial: false,
    records,
  };
}

export function createObservedTrafficCorridorFixtureSource({
  clock = () => Date.now(),
} = {}) {
  return createObservedTrafficSource({
    label: 'GEV corridor fixture',
    read(query = {}) {
      return buildObservedTrafficFixtureSnapshot(query.cameras, {
        now: clock(),
      });
    },
  });
}

/**
 * One-shot demo controller. CCTV remains the catalog owner; Traffic remains the
 * observation owner. The fixture only waits for CCTV's real catalog, refreshes
 * Traffic once, and selects the first measured camera for inspection.
 */
export function installObservedTrafficCorridorFixture({
  catalog,
  dataManager,
  signal = null,
} = {}) {
  const cctv = catalog?.get?.('cctv');
  const traffic = catalog?.get?.('traffic');
  if (
    !cctv?.subscribe ||
    !traffic?.refreshObservedTraffic ||
    !dataManager?.setEnabled
  )
    return () => {};
  if (signal?.aborted) return () => {};

  let disposed = false;
  let launched = false;
  let unsubscribe = () => {};

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    signal?.removeEventListener?.('abort', cleanup);
  };

  const maybeLaunch = (state) => {
    if (disposed || launched || signal?.aborted) return;
    const cameras = selectObservedTrafficFixtureCameras(state?.cameras);
    if (!cameras.length) return;
    launched = true;
    void traffic
      .refreshObservedTraffic(
        {
          corridorId: OBSERVED_TRAFFIC_FIXTURE_CORRIDOR,
          cameras,
        },
        { signal },
      )
      .then(() => {
        if (disposed || signal?.aborted) return;
        cctv.selectCamera?.(cameras[0].id, { focus: false });
        cctv.setCardPresentationOptions?.({ activeCameraCardEnabled: true });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError')
          console.warn('[Observed traffic fixture] refresh failed');
      });
  };

  unsubscribe = cctv.subscribe(maybeLaunch);
  signal?.addEventListener?.('abort', cleanup, { once: true });

  const enable = (layerId) =>
    Promise.resolve(
      dataManager.setEnabled(layerId, true, { origin: 'programmatic' }),
    ).catch((error) => {
      if (!signal?.aborted)
        console.warn(`[Observed traffic fixture] ${layerId} enable failed`);
      return false;
    });
  void enable('traffic');
  void enable('cctv');

  return cleanup;
}
