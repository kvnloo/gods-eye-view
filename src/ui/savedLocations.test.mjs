import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SAVED_LOCATIONS,
  SAVED_LOCATIONS_STORAGE_KEY,
  createSavedLocation,
  loadSavedLocations,
  normalizeSavedLocation,
  persistSavedLocations,
  removeSavedLocation,
  upsertSavedLocation,
} from './savedLocations.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    read: (key) => data.get(key) ?? null,
  };
}

const record = (id = 'a') => ({
  id,
  label: 'Austin',
  action: 'fly_to_location',
  args: {
    latitude: 30.2672,
    longitude: -97.7431,
    rangeM: 1200,
    viewMode: 'close',
  },
  createdAt: 1,
});

test('saved locations persist only typed fly_to_location arguments', () => {
  assert.deepEqual(normalizeSavedLocation(record()), record());
  assert.equal(
    normalizeSavedLocation({
      ...record(),
      action: 'set_panel_open',
    }),
    null,
  );
  assert.equal(
    normalizeSavedLocation({
      ...record(),
      args: { ...record().args, latitude: 91 },
    }),
    null,
  );
  assert.equal(
    normalizeSavedLocation({
      ...record(),
      args: { ...record().args, longitude: -181 },
    }),
    null,
  );
  assert.equal(
    normalizeSavedLocation({
      ...record(),
      args: { ...record().args, rangeM: 99 },
    }),
    null,
  );
  assert.equal(
    normalizeSavedLocation({
      ...record(),
      args: { ...record().args, viewMode: 'cinematic' },
    }),
    null,
  );
});

test('creation injects identity/time and still passes the persisted contract', () => {
  assert.deepEqual(
    createSavedLocation(
      {
        label: '  Austin  ',
        args: { latitude: 30, longitude: -97, rangeM: 1000 },
      },
      { idFactory: () => 'saved-austin', now: () => 1234 },
    ),
    {
      id: 'saved-austin',
      label: 'Austin',
      action: 'fly_to_location',
      args: { latitude: 30, longitude: -97, rangeM: 1000 },
      createdAt: 1234,
    },
  );
});

test('storage is bounded and malformed or blocked storage fails closed', () => {
  const store = memoryStorage();
  let items = [];
  for (let index = 0; index < MAX_SAVED_LOCATIONS + 3; index += 1)
    items = upsertSavedLocation(items, record(String(index)));
  assert.equal(items.length, MAX_SAVED_LOCATIONS);
  assert.equal(persistSavedLocations(items, store), true);
  assert.equal(loadSavedLocations(store).length, MAX_SAVED_LOCATIONS);
  assert.ok(store.read(SAVED_LOCATIONS_STORAGE_KEY));

  const malformed = memoryStorage({
    [SAVED_LOCATIONS_STORAGE_KEY]: '{broken',
  });
  assert.deepEqual(loadSavedLocations(malformed), []);

  const blocked = {
    getItem() {
      throw new DOMException('blocked', 'SecurityError');
    },
    setItem() {
      throw new DOMException('blocked', 'SecurityError');
    },
  };
  assert.deepEqual(loadSavedLocations(blocked), []);
  assert.equal(persistSavedLocations(items, blocked), false);
});

test('upsert and remove preserve stable ids and normalize persisted rows', () => {
  let items = [record('a'), record('b')];
  items = upsertSavedLocation(items, {
    ...record('a'),
    label: 'Austin Updated',
  });
  assert.deepEqual(
    items.map((item) => [item.id, item.label]),
    [
      ['a', 'Austin Updated'],
      ['b', 'Austin'],
    ],
  );
  assert.deepEqual(
    removeSavedLocation(items, 'b').map((item) => item.id),
    ['a'],
  );
});

test('coordinate and range arguments reject coercible nonnumbers', () => {
  for (const field of ['latitude', 'longitude', 'rangeM']) {
    for (const invalid of [null, '', '30.2672', true, false, NaN, Infinity]) {
      const args = { ...record().args, [field]: invalid };
      // Optional rangeM treats null as absent, unlike required coordinates.
      if (field === 'rangeM' && invalid === null) {
        assert.deepEqual(normalizeSavedLocation({ ...record(), args })?.args, {
          latitude: 30.2672,
          longitude: -97.7431,
          viewMode: 'close',
        });
      } else {
        assert.equal(
          normalizeSavedLocation({ ...record(), args }),
          null,
          `${field} must reject ${String(invalid)}`,
        );
      }
    }
  }
  assert.equal(
    createSavedLocation(
      { label: 'Invalid', args: { latitude: '30', longitude: -97 } },
      { idFactory: () => 'x', now: () => 42 },
    ),
    null,
  );
  assert.equal(
    normalizeSavedLocation({ ...record(), createdAt: '123' })?.createdAt,
    0,
  );
});

test('stored duplicates keep the first valid id across all CRUD paths', () => {
  const original = record('a');
  const stale = { ...original, label: 'Stale duplicate' };
  const other = record('b');
  const store = memoryStorage({
    [SAVED_LOCATIONS_STORAGE_KEY]: JSON.stringify([
      { ...original, args: { ...original.args, latitude: null } },
      original,
      stale,
      other,
      other,
    ]),
  });
  const loaded = loadSavedLocations(store);
  assert.deepEqual(
    loaded.map(({ id, label }) => [id, label]),
    [
      ['a', 'Austin'],
      ['b', 'Austin'],
    ],
  );
  const upserted = upsertSavedLocation([original, stale, other, other], {
    ...other,
    label: 'Updated b',
  });
  assert.deepEqual(
    upserted.map(({ id, label }) => [id, label]),
    [
      ['b', 'Updated b'],
      ['a', 'Austin'],
    ],
  );
  assert.deepEqual(
    removeSavedLocation([original, stale, other, other], 'b').map(
      ({ id }) => id,
    ),
    ['a'],
  );
  assert.equal(
    persistSavedLocations([stale, original, other, other], store),
    true,
  );
  assert.deepEqual(
    loadSavedLocations(store).map(({ id, label }) => [id, label]),
    [
      ['a', 'Stale duplicate'],
      ['b', 'Austin'],
    ],
  );
});

test('unique storage capacity is counted after rejecting duplicates', () => {
  const store = memoryStorage({
    [SAVED_LOCATIONS_STORAGE_KEY]: JSON.stringify([
      ...Array.from({ length: 50 }, () => record('repeated')),
      ...Array.from({ length: MAX_SAVED_LOCATIONS }, (_, index) =>
        record(`unique-${index}`),
      ),
    ]),
  });
  const loaded = loadSavedLocations(store);
  assert.equal(loaded.length, MAX_SAVED_LOCATIONS);
  assert.deepEqual(
    loaded.map(({ id }) => id),
    [
      'repeated',
      ...Array.from(
        { length: MAX_SAVED_LOCATIONS - 1 },
        (_, index) => `unique-${index}`,
      ),
    ],
  );
});

test('remove backfills the unique limit after excluding a saved id', () => {
  const rows = Array.from({ length: MAX_SAVED_LOCATIONS + 1 }, (_, index) =>
    record(String(index)),
  );
  const withoutFirst = removeSavedLocation(rows, '0');
  assert.equal(withoutFirst.length, MAX_SAVED_LOCATIONS);
  assert.equal(withoutFirst[0].id, '1');
  assert.equal(withoutFirst.at(-1).id, String(MAX_SAVED_LOCATIONS));
});
