/**
 * How fresh a reading is, from the time its source observed it. The bands
 * are per source kind: a live aircraft position goes stale in minutes, a
 * mapped fire perimeter in a day.
 */

/** Ages (ms) under which a reading counts as live, then recent. */
export const FRESHNESS_BANDS = Object.freeze({
  live: Object.freeze({ live: 2 * 60_000, recent: 15 * 60_000 }),
  feed: Object.freeze({ live: 15 * 60_000, recent: 2 * 3_600_000 }),
  daily: Object.freeze({ live: 3 * 3_600_000, recent: 36 * 3_600_000 }),
  catalog: Object.freeze({ live: 24 * 3_600_000, recent: 7 * 86_400_000 }),
});

/** Epoch ms of an ISO time or a number, or NaN. */
export function timeMs(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * `{ state, ageMs }` where state is `live`, `recent`, `stale` or `unknown`.
 * A source that marks its own data stale is stale whatever its age says.
 */
export function freshness(observedAt, now, band = 'feed', { stale } = {}) {
  const at = timeMs(observedAt);
  if (!Number.isFinite(at)) return { state: 'unknown', ageMs: null };
  const ageMs = Math.max(0, now - at);
  if (stale === true) return { state: 'stale', ageMs };
  const limits = FRESHNESS_BANDS[band] ?? FRESHNESS_BANDS.feed;
  const state =
    ageMs <= limits.live ? 'live' : ageMs <= limits.recent ? 'recent' : 'stale';
  return { state, ageMs };
}

/** "45 s", "12 min", "3 h", "2 d": a compact age for a 10-foot screen. */
export function compactAge(ageMs) {
  if (!Number.isFinite(ageMs)) return null;
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 90) return { value: Math.max(0, seconds), unit: 's' };
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return { value: minutes, unit: 'min' };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { value: hours, unit: 'h' };
  return { value: Math.round(hours / 24), unit: 'd' };
}

/** "04:01Z": the UTC clock time of an ISO time, or null. */
export function utcClock(value) {
  const at = timeMs(value);
  if (!Number.isFinite(at)) return null;
  return `${new Date(at).toISOString().slice(11, 16)}Z`;
}
