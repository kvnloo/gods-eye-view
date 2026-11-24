/**
 * Per-source status for the top bar: live, stale, needs key, down or not yet
 * checked. A source is judged by its last answer: when it came, whether the
 * source said its data was stale, and whether the server lacks its key.
 * Nothing here invents a status a source did not report. Pure.
 */

import { msg } from '../i18n/index.js';
import { neededKey } from './cardModels.js';

/** The sources the situation room polls, in top-bar order. */
export const SITUATION_SOURCES = Object.freeze([
  { id: 'news', label: msg('NEWS'), provider: 'GDELT', staleMs: 30 * 60_000 },
  {
    id: 'quakes',
    label: msg('QUAKES'),
    provider: 'USGS',
    staleMs: 10 * 60_000,
  },
  { id: 'aircraft', label: msg('AIR'), provider: 'ADS-B', staleMs: 5 * 60_000 },
  {
    id: 'vessels',
    label: msg('SEA'),
    provider: 'AISStream',
    staleMs: 15 * 60_000,
  },
  {
    id: 'fires',
    label: msg('HOTSPOTS'),
    provider: 'NASA FIRMS',
    staleMs: 6 * 3_600_000,
  },
  {
    id: 'perimeters',
    label: msg('PERIMETERS'),
    provider: 'WFIGS',
    staleMs: 6 * 3_600_000,
  },
  {
    id: 'storms',
    label: msg('STORMS'),
    provider: 'NHC · JTWC',
    staleMs: 6 * 3_600_000,
  },
  {
    id: 'satellites',
    label: msg('SATS'),
    provider: 'CelesTrak',
    staleMs: 24 * 3_600_000,
  },
  {
    id: 'cameras',
    label: msg('CAMERAS'),
    provider: 'GEV CCTV',
    staleMs: 24 * 3_600_000,
  },
]);

export const SOURCE_STATES = Object.freeze([
  'live',
  'stale',
  'needs-key',
  'down',
  'pending',
]);

/**
 * Record one poll's outcome. `previous` is the last record, kept so a failed
 * refresh still shows when the source last answered.
 */
export function recordPoll(
  previous,
  { ok, at, error, count = null, stale = false, observedAt = null },
) {
  if (ok)
    return {
      ok: true,
      at,
      lastOkAt: at,
      observedAt: observedAt ?? at,
      count,
      stale: stale === true,
      error: null,
      needsKey: null,
    };
  return {
    ...(previous ?? {}),
    ok: false,
    at,
    error: String(error?.message || error || 'error').slice(0, 160),
    needsKey: neededKey(error),
  };
}

/** The displayed status of every source at `now`. */
export function sourceStatuses(records, now) {
  return SITUATION_SOURCES.map((source) => {
    const record = records?.[source.id];
    let state = 'pending';
    if (record) {
      if (record.needsKey) state = 'needs-key';
      else if (!record.ok && !record.lastOkAt) state = 'down';
      else if (
        record.stale ||
        !record.ok ||
        now - (record.observedAt ?? record.lastOkAt) > source.staleMs
      )
        state = 'stale';
      else state = 'live';
    }
    return {
      id: source.id,
      label: source.label,
      provider: source.provider,
      state,
      count: record?.ok ? record.count : null,
      lastOkAt: record?.lastOkAt ?? null,
      observedAt: record?.observedAt ?? null,
      needsKey: record?.needsKey ?? null,
      error: record?.ok === false ? record.error : null,
    };
  });
}

/** One line of what is missing, for the brief's unknowns and the agent. */
export function missingSources(statuses) {
  return statuses
    .filter((status) => status.state === 'needs-key' || status.state === 'down')
    .map((status) => ({
      id: status.id,
      provider: status.provider,
      state: status.state,
      needsKey: status.needsKey,
    }));
}
