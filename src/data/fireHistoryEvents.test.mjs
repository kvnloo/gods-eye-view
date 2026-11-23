import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRecordsToEvent,
  firmsAreaSegment,
  normalizeFireEvent,
  normalizeFireEventCatalog,
  normalizeFirePerimeter,
  parseUtcDay,
  splitDateWindows,
} from './fireHistoryEvents.js';

const VALID = {
  id: 'camp-fire-2018',
  name: 'Camp Fire',
  region: 'Butte County',
  startDate: '2018-11-08',
  endDate: '2018-11-25',
  bbox: [-121.75, 39.65, -121.3, 39.95],
  sources: ['VIIRS_SNPP_SP', 'MODIS_SP'],
  burnedHa: 62053,
  references: [{ label: 'CAL FIRE', url: 'https://www.fire.ca.gov/x' }],
};

test('parseUtcDay accepts real calendar days only', () => {
  assert.equal(parseUtcDay('2018-11-08'), Date.UTC(2018, 10, 8));
  assert.ok(Number.isNaN(parseUtcDay('2018-02-31')));
  assert.ok(Number.isNaN(parseUtcDay('2018-11-8')));
});

test('normalizeFireEvent freezes a validated copy with an exclusive endMs', () => {
  const event = normalizeFireEvent(VALID);
  assert.ok(Object.isFrozen(event));
  assert.equal(event.startMs, Date.UTC(2018, 10, 8));
  assert.equal(event.endMs, Date.UTC(2018, 10, 26));
  assert.deepEqual([...event.sources], ['VIIRS_SNPP_SP', 'MODIS_SP']);
});

test('normalizeFireEvent rejects unsafe or meaningless definitions', () => {
  const reject = (patch) =>
    assert.equal(normalizeFireEvent({ ...VALID, ...patch }), null);
  reject({ id: '../etc' });
  reject({ name: '' });
  reject({ endDate: '2018-11-07' });
  reject({ bbox: [-121.3, 39.65, -121.75, 39.95] });
  reject({ sources: ['VIIRS_SNPP_NRT'] });
});

test('normalizeFireEventCatalog drops malformed and duplicate events', () => {
  const { events, rejected } = normalizeFireEventCatalog({
    events: [VALID, { ...VALID, name: '' }, VALID],
  });
  assert.equal(events.length, 1);
  assert.deepEqual(rejected, ['camp-fire-2018', 'camp-fire-2018']);
});

test('perimeter metadata is structured but owns no query construction', () => {
  assert.deepEqual(
    normalizeFirePerimeter({
      service: 'nifc-history',
      incident: 'CAMP',
      fireYear: '2018',
      unitId: 'CABTU',
    }),
    {
      service: 'nifc-history',
      incident: 'CAMP',
      fireYear: '2018',
      unitId: 'CABTU',
    },
  );
  assert.equal(
    normalizeFirePerimeter({
      service: 'wfigs',
      incident: "X' OR 1=1 --",
      state: 'US-CA',
      discoveredAfter: '2024-07-01',
    }),
    null,
  );
});

test('splitDateWindows never exceeds the FIRMS five-day cap', () => {
  assert.deepEqual(splitDateWindows('2018-11-08', '2018-11-25'), [
    { date: '2018-11-08', days: 5 },
    { date: '2018-11-13', days: 5 },
    { date: '2018-11-18', days: 5 },
    { date: '2018-11-23', days: 3 },
  ]);
  assert.deepEqual(splitDateWindows('2024-07-24', '2024-07-28', 30), [
    { date: '2024-07-24', days: 5 },
  ]);
});

test('firmsAreaSegment emits bounded-precision W,S,E,N', () => {
  assert.equal(
    firmsAreaSegment([-121.75, 39.65, -121.3, 39.95]),
    '-121.7500,39.6500,-121.3000,39.9500',
  );
});

test('filterRecordsToEvent clamps to box and inclusive day range', () => {
  const event = normalizeFireEvent(VALID);
  const inside = { lat: 39.8, lon: -121.5, acqDate: '2018-11-10' };
  const lastDay = { lat: 39.8, lon: -121.5, acqDate: '2018-11-25' };
  const spill = { lat: 39.8, lon: -121.5, acqDate: '2018-11-26' };
  assert.deepEqual(filterRecordsToEvent([inside, lastDay, spill], event), [
    inside,
    lastDay,
  ]);
});

test('event bounding boxes reject missing and coerced zero coordinates', () => {
  for (const invalid of [null, '', false, [], {}]) {
    assert.equal(
      normalizeFireEvent({ ...VALID, bbox: [invalid, -20, 20, 20] }),
      null,
    );
  }
  assert.deepEqual(
    normalizeFireEvent({ ...VALID, bbox: ['0', -20, 20, 20] })?.bbox,
    [0, -20, 20, 20],
  );
});

test('missing coordinates do not become equatorial fires', () => {
  const event = normalizeFireEvent({
    ...VALID,
    bbox: [-10, -10, 10, 10],
  });
  const valid = [
    { lat: 0, lon: 0, acqDate: '2018-11-10' },
    { lat: '0', lon: '1', acqDate: '2018-11-10' },
  ];
  const bad = [null, '', false, undefined].flatMap((invalid) => [
    { lat: invalid, lon: 1, acqDate: '2018-11-10' },
    { lat: 1, lon: invalid, acqDate: '2018-11-10' },
  ]);
  assert.deepEqual(filterRecordsToEvent([...bad, ...valid], event), valid);
});

test('nondecimal coordinate encodings do not become fire locations', () => {
  const event = normalizeFireEvent({ ...VALID, bbox: [-20, -20, 20, 20] });
  const admitted = [
    { lat: 0, lon: 0, acqDate: '2018-11-10' },
    { lat: '1.5e1', lon: '0', acqDate: '2018-11-10' },
  ];
  for (const coordinate of ['0x10', '0b10', '0o10', 'Infinity']) {
    assert.equal(
      normalizeFireEvent({ ...VALID, bbox: [coordinate, -20, 20, 20] }),
      null,
    );
    assert.deepEqual(
      filterRecordsToEvent(
        [{ lat: coordinate, lon: 0, acqDate: '2018-11-10' }, ...admitted],
        event,
      ),
      admitted,
    );
  }
});

test('burned hectares reject coerced values', () => {
  for (const invalid of [true, false, ['18'], '0x10', '0b10', '']) {
    assert.equal(
      normalizeFireEvent({ ...VALID, burnedHa: invalid })?.burnedHa,
      null,
    );
  }
  for (const [raw, expected] of [
    [0, null],
    [62053, 62053],
    ['12.5', 12.5],
    ['1e3', 1000],
  ]) {
    assert.equal(
      normalizeFireEvent({ ...VALID, burnedHa: raw })?.burnedHa,
      expected,
    );
  }
});
