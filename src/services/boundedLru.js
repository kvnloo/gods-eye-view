/** Estimate UTF-8 bytes for JSON-compatible cache values. */
function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Small instance-owned LRU with both entry and byte caps.
 *
 * Oversized values are returned to callers normally but are not retained.
 * Reads refresh recency. No TTL or stale policy is implied.
 */
export function createBoundedLru({
  maxEntries = 64,
  maxBytes = 1024 * 1024,
  measure = jsonBytes,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1)
    throw new TypeError('LRU maxEntries must be a positive integer');
  if (!Number.isFinite(maxBytes) || maxBytes < 1)
    throw new TypeError('LRU maxBytes must be positive');
  if (typeof measure !== 'function')
    throw new TypeError('LRU measure must be a function');

  const entries = new Map();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let sets = 0;
  let evictions = 0;
  let oversize = 0;

  function evictOldest() {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return false;
    const entry = entries.get(oldest);
    entries.delete(oldest);
    bytes -= entry.bytes;
    evictions += 1;
    return true;
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        misses += 1;
        return { hit: false, value: undefined };
      }
      hits += 1;
      entries.delete(key);
      entries.set(key, entry);
      return { hit: true, value: entry.value };
    },

    set(key, value) {
      const size = Number(measure(value));
      if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
        oversize += 1;
        return false;
      }
      sets += 1;
      const previous = entries.get(key);
      if (previous) {
        entries.delete(key);
        bytes -= previous.bytes;
      }
      entries.set(key, { value, bytes: size });
      bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) {
        if (!evictOldest()) break;
      }
      return entries.has(key);
    },

    clear() {
      entries.clear();
      bytes = 0;
    },

    getStats() {
      return {
        entries: entries.size,
        bytes,
        maxEntries,
        maxBytes,
        hits,
        misses,
        sets,
        evictions,
        oversize,
      };
    },
  };
}

export { jsonBytes as estimateJsonBytes };
