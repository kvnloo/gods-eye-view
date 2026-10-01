import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoundedLru } from './boundedLru.js';

test('bounded LRU refreshes recency and evicts the oldest entry', () => {
  const cache = createBoundedLru({
    maxEntries: 2,
    maxBytes: 100,
    measure: () => 10,
  });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.deepEqual(cache.get('a'), { hit: true, value: 1 });
  cache.set('c', 3);

  assert.equal(cache.get('b').hit, false);
  assert.deepEqual(cache.get('a'), { hit: true, value: 1 });
  assert.deepEqual(cache.get('c'), { hit: true, value: 3 });
});

test('byte cap evicts until retained values fit', () => {
  const cache = createBoundedLru({
    maxEntries: 10,
    maxBytes: 12,
    measure: (value) => value.bytes,
  });
  cache.set('a', { bytes: 5 });
  cache.set('b', { bytes: 5 });
  cache.set('c', { bytes: 5 });

  assert.equal(cache.get('a').hit, false);
  assert.equal(cache.getStats().bytes, 10);
  assert.equal(cache.getStats().entries, 2);
});

test('an oversized value is never retained or allowed to evict good entries', () => {
  const cache = createBoundedLru({
    maxEntries: 4,
    maxBytes: 10,
    measure: (value) => value.bytes,
  });
  cache.set('good', { bytes: 4 });
  assert.equal(cache.set('huge', { bytes: 20 }), false);
  assert.equal(cache.get('good').hit, true);
  assert.equal(cache.get('huge').hit, false);
});

test('replacement updates byte accounting', () => {
  const cache = createBoundedLru({
    maxEntries: 4,
    maxBytes: 20,
    measure: (value) => value.bytes,
  });
  cache.set('same', { bytes: 8 });
  cache.set('same', { bytes: 3 });
  assert.deepEqual(cache.getStats(), {
    entries: 1,
    bytes: 3,
    maxEntries: 4,
    maxBytes: 20,
    hits: 0,
    misses: 0,
    sets: 2,
    evictions: 0,
    oversize: 0,
  });
});

test('diagnostics count hits, misses, evictions and oversized skips', () => {
  const cache = createBoundedLru({
    maxEntries: 1,
    maxBytes: 10,
    measure: (value) => value.bytes,
  });
  cache.get('missing');
  cache.set('a', { bytes: 4 });
  cache.get('a');
  cache.set('b', { bytes: 4 });
  cache.set('huge', { bytes: 50 });
  assert.deepEqual(cache.getStats(), {
    entries: 1,
    bytes: 4,
    maxEntries: 1,
    maxBytes: 10,
    hits: 1,
    misses: 1,
    sets: 2,
    evictions: 1,
    oversize: 1,
  });
});
