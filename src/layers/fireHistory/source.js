import { readResponseJsonCapped } from '../../sources/httpBody.js';

const CATALOG_MAX_BYTES = 512 * 1024;
const EVENT_MAX_BYTES = 32 * 1024 * 1024;

function eventId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[a-z][a-z0-9-]{1,63}$/.test(id) ? id : null;
}

function normalizeCatalog(payload) {
  if (!payload || !Array.isArray(payload.events))
    throw new Error('Malformed fire-history catalog');
  const ids = new Set();
  const events = [];
  for (const event of payload.events) {
    const id = eventId(event?.id);
    if (!id || ids.has(id) || typeof event?.name !== 'string')
      throw new Error('Malformed fire-history catalog');
    ids.add(id);
    events.push({ ...event, id });
  }
  return {
    hasKey: Boolean(payload.hasKey),
    events,
  };
}

function normalizeEventPayload(payload, requestedId) {
  if (!payload || typeof payload !== 'object')
    throw new Error('Malformed fire-history snapshot');
  const id = eventId(payload.event?.id);
  if (
    !id ||
    id !== requestedId ||
    !Array.isArray(payload.fires) ||
    !Array.isArray(payload.windows) ||
    !Number.isFinite(Number(payload.fetchedAt)) ||
    typeof payload.complete !== 'boolean'
  )
    throw new Error('Malformed fire-history snapshot');

  return {
    event: { ...payload.event, id },
    fetchedAt: Number(payload.fetchedAt),
    complete: payload.complete,
    windows: payload.windows,
    count: payload.fires.length,
    fires: payload.fires,
  };
}

/**
 * Portable browser source for the same-origin Historic Fires archive provider.
 *
 * Acquisition, caching, retry/backoff and event allowlisting remain server
 * responsibilities. This source only bounds/validates the response before a
 * layer may adopt it.
 */
export function createFireHistorySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = '/api/fire-history',
} = {}) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  if (!base) throw new TypeError('fire-history endpoint is required');

  return {
    async listEvents({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(base, {
        signal,
        cache: 'no-store',
      });
      const payload = await readResponseJsonCapped(
        response,
        CATALOG_MAX_BYTES,
        signal,
      );
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(`Fire history catalog HTTP ${response.status}`);
      return normalizeCatalog(payload);
    },

    async getEvent(id, { signal } = {}) {
      const requestedId = eventId(id);
      if (!requestedId) throw new TypeError('valid historical fire event id required');
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `${base}/${encodeURIComponent(requestedId)}`,
        {
          signal,
          cache: 'no-store',
        },
      );

      if (response.status === 503) {
        let payload = null;
        try {
          payload = await readResponseJsonCapped(
            response,
            CATALOG_MAX_BYTES,
            signal,
          );
        } catch {
          // Status remains authoritative unless this is the explicit no-key shape.
        }
        signal?.throwIfAborted();
        if (payload?.error === 'no_key')
          return { keyRequired: true, eventId: requestedId };
        throw new Error('Fire history archive HTTP 503');
      }

      const payload = await readResponseJsonCapped(
        response,
        EVENT_MAX_BYTES,
        signal,
      );
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(`Fire history archive HTTP ${response.status}`);
      return normalizeEventPayload(payload, requestedId);
    },
  };
}
