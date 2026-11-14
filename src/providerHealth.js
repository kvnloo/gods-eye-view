import { layerFeedState } from './data/feedState.js';

const HEALTH_LABELS = Object.freeze({
  nominal: 'LIVE',
  loading: 'LOADING',
  degraded: 'DEGRADED',
  stale: 'STALE',
  fallback: 'FALLBACK',
  unavailable: 'UNAVAILABLE',
  off: 'OFF',
  'key-required': 'KEY REQUIRED',
});

/** Keep unknown or invalid provider counts distinct from an observed zero. */
function recordCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function formatAge(timestamp, now) {
  if (!Number.isFinite(timestamp)) return 'never';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Build a compact, UI-ready health snapshot from DataLayerManager rows. */
export function buildProviderHealthRows(layers, now = Date.now()) {
  return (Array.isArray(layers) ? layers : [])
    .filter((layer) => layer && layer.showInTogglePanel !== false)
    .map((layer) => {
      const stats = layer.stats || {};
      const keyRequired =
        stats.keyRequired === true || stats.missingKey === true;
      const state = !layer.enabled
        ? 'off'
        : keyRequired
          ? 'key-required'
          : layerFeedState(stats);
      return {
        id: String(layer.id),
        name: String(layer.name || layer.id),
        source: String(stats.source || layer.source || 'unknown'),
        state,
        label: HEALTH_LABELS[state] || state.toUpperCase(),
        detail:
          stats.error ||
          stats.lastError ||
          stats.loadingLabel ||
          formatAge(stats.lastUpdate, now),
        updated: formatAge(stats.lastUpdate, now),
        count: recordCount(stats.count),
        retryInSec: Number.isFinite(Number(stats.retryInSec))
          ? Number(stats.retryInSec)
          : null,
        keyRequired,
      };
    });
}

export { HEALTH_LABELS };
