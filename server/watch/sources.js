import { createUsgsEarthquakeSource } from '../../src/layers/earthquakes/source.js';
import { firmsProxy } from '../providers/firms.js';
import { acquisitionMsUtc } from '../../src/data/firmsCsv.js';

/** Adapt existing source/provider records; no Cesium, browser or inbound HTTP server. */
export function createWatchSources({ fetchImpl = globalThis.fetch, firmsService } = {}) {
  const usgs = createUsgsEarthquakeSource({ fetchImpl: (url, options = {}) => fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) });
  let fires;
  return {
    usgs: {
      intervalMs: 60000,
      async getSnapshot({ signal } = {}) {
        const rows = await usgs.getSnapshot({ signal });
        return rows.filter((r) => typeof r.usgsId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.usgsId)).map((r) => ({
          id: `usgs:${r.usgsId}`, source: 'USGS', observedAt: r.time, lat: r.lat, lon: r.lon, magnitude: r.mag, title: r.place || 'Earthquake', url: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(r.usgsId)}`,
        }));
      },
    },
    firms: {
      intervalMs: 1800000,
      async getSnapshot({ signal } = {}) {
        signal?.throwIfAborted();
        fires ||= firmsService || firmsProxy().api;
        const snapshot = await fires.getSnapshot();
        signal?.throwIfAborted();
        if (snapshot.stale || !Array.isArray(snapshot.fires) || !Number.isFinite(snapshot.fetchedAt) || Date.now() - snapshot.fetchedAt > 1800000) throw new Error('FIRMS snapshot not current');
        return snapshot.fires.filter((r) => r.satellite && r.instrument).map((r) => ({
          id: `firms:${r.satellite}:${r.instrument}:${r.acqDate}:${String(r.acqTime).padStart(4, '0')}:${r.lat}:${r.lon}`, source: 'NASA FIRMS', observedAt: acquisitionMsUtc(r.acqDate, r.acqTime), lat: r.lat, lon: r.lon, frp: r.frp, confidence: r.confidence, title: 'Active-fire detection', url: 'https://firms.modaps.eosdis.nasa.gov/map/',
        }));
      },
    },
  };
}
