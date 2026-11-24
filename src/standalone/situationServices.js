/**
 * The situation room's data services, loaded the first time situation mode
 * needs them: the whole tool catalog (situation cards ask tools voice leaves
 * to the layers, such as aircraft_in_area), the news feed the News layer
 * reads, and a geocoder.
 *
 * Place names resolve through the server's geocoder when it has a key and
 * through the keyless Photon geocoder (OpenStreetMap) the search box already
 * uses when it does not, so cards work on a server without a Google key.
 */

let pending = null;

/** `{ catalog, news, geocode }`, built once. */
export function loadSituationServices() {
  pending ??= Promise.all([
    import('../tools/index.js'),
    import('../tools/services.js'),
    import('../layers/news/source.js'),
    import('../keylessGeocoder.js'),
  ]).then(
    ([
      { composeCatalog, coreTools },
      { createToolServices },
      { createNewsSource },
      { geocodeKeylessWithOutcome },
    ]) => {
      const fetchImpl = (...args) => globalThis.fetch(...args);
      const services = createToolServices({
        fetchImpl,
        appUrl: new URL(globalThis.document.baseURI).origin,
      });
      const keys = createKeyStatus({ fetchImpl });
      const geocode = createSituationGeocoder({
        server: services.places,
        // Skip the server geocoder when the server says it has no key: its
        // refusal would only add a failed request.
        serverAvailable: async () =>
          (await keys())?.GOOGLE_MAPS_API_KEY !== false,
        keyless: (query, options) =>
          geocodeKeylessWithOutcome(query, { ...options, fetchImpl }),
      });
      return {
        catalog: composeCatalog({
          tools: coreTools,
          services: {
            ...services,
            // Tools resolve place names the same way the cards do.
            places: {
              async resolve(name, { signal } = {}) {
                const place = await geocode(name, { signal });
                return place
                  ? {
                      name: place.label,
                      bounds: place.bounds,
                      point: { lat: place.lat, lon: place.lon },
                    }
                  : null;
              },
            },
          },
        }),
        news: createNewsSource({ fetchImpl }),
        geocode,
        keys,
      };
    },
  );
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

const POINT_PAD_DEG = 0.25;

/**
 * A geocoder answering `{ label, lat, lon, bounds, geocoder }` or null: the
 * server's first, then the keyless one. Answers are kept for the session.
 */
export function createSituationGeocoder({
  server,
  keyless,
  serverAvailable = async () => true,
  cacheSize = 100,
}) {
  const cache = new Map();
  async function resolve(name, { signal } = {}) {
    const key = String(name || '')
      .trim()
      .toLowerCase();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let place = null;
    try {
      const found = (await serverAvailable())
        ? await server?.resolve?.(name, { signal })
        : null;
      if (found?.point)
        place = {
          label: found.name || name,
          lat: found.point.lat,
          lon: found.point.lon,
          bounds: found.bounds,
          geocoder: 'Google Geocoding',
        };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (!place && keyless) {
      const { place: found } = await keyless(name, { signal });
      if (found)
        place = {
          label: found.label || found.name || name,
          lat: found.lat,
          lon: found.lng,
          bounds: found.viewport
            ? {
                west: found.viewport.southwest.lng,
                south: found.viewport.southwest.lat,
                east: found.viewport.northeast.lng,
                north: found.viewport.northeast.lat,
              }
            : {
                west: found.lng - POINT_PAD_DEG,
                south: found.lat - POINT_PAD_DEG,
                east: found.lng + POINT_PAD_DEG,
                north: found.lat + POINT_PAD_DEG,
              },
          geocoder: 'OpenStreetMap (Photon)',
        };
    }
    if (place) {
      cache.set(key, place);
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    }
    return place;
  }
  return resolve;
}

const KEY_STATUS_MS = 5 * 60_000;

/**
 * Which server keys are set, by environment variable (`{ AISSTREAM_API_KEY:
 * false, ... }`), from the setup status the key-setup chip reads; null where
 * the server does not offer it (a production build, a remote visitor). Lets
 * a source the server has no key for read "needs key" without a request
 * that can only fail.
 */
export function createKeyStatus({ fetchImpl, now = () => Date.now() }) {
  let cached = null;
  let at = 0;
  return async function keys() {
    if (cached !== null && now() - at < KEY_STATUS_MS) return cached;
    at = now();
    try {
      const response = await fetchImpl('/api/setup/status', {
        cache: 'no-store',
      });
      if (!response.ok) return (cached = {});
      const status = await response.json();
      const out = {};
      for (const key of status?.keys ?? [])
        for (const name of key.envVars ?? []) out[name] = key.set === true;
      cached = out;
    } catch {
      cached = {};
    }
    return cached;
  };
}
