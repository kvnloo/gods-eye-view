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

test('saved location arguments use numeric schema types without coercion', () => {
  const invalid = [
    ['latitude', null],
    ['latitude', ''],
    ['latitude', true],
    ['latitude', '30.2'],
    ['longitude', null],
    ['longitude', ''],
    ['longitude', false],
    ['longitude', '-97.7'],
    ['rangeM', '1200'],
    ['rangeM', true],
  ];
  for (const [key, value] of invalid) {
    const item = { ...record(), args: { ...record().args, [key]: value } };
    assert.equal(normalizeSavedLocation(item), null, `${key}: ${String(value)}`);
  }
  assert.deepEqual(normalizeSavedLocation(record()), record());
});

test('load, persist, upsert and remove collapse duplicate ids deterministically', () => {
  const store = memoryStorage({
    [SAVED_LOCATIONS_STORAGE_KEY]: JSON.stringify([
      record('a'),
      { ...record('a'), label: 'Duplicate' },
      record('b'),
    ]),
  });
  const loaded = loadSavedLocations(store);
  assert.deepEqual(loaded.map((item) => item.id), ['a', 'b']);
  assert.equal(loaded[0].label, 'Austin');
  const upserted = upsertSavedLocation(
    [record('a'), record('a'), record('b')],
    record('c'),
  );
  assert.deepEqual(upserted.map((item) => item.id), ['c', 'a', 'b']);
  assert.deepEqual(
    removeSavedLocation([record('a'), record('a'), record('b')], 'b').map(
      (item) => item.id,
    ),
    ['a'],
  );
  assert.equal(
    persistSavedLocations([record('a'), record('a'), record('b')], store),
    true,
  );
  assert.deepEqual(
    loadSavedLocations(store).map((item) => item.id),
    ['a', 'b'],
  );
});


test('blocked storage method lookup fails closed without throwing', () => {
  const blocked = {
    getItem: () => null,
    get setItem() {
      throw new DOMException('not allowed', 'SecurityError');
    },
  };
  assert.equal(persistSavedLocations([record('a')], blocked), false);
  assert.deepEqual(loadSavedLocations(blocked), []);
});
