import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENERGY_METRICS,
  annualAveragePowerW,
  hoursInCalendarYear,
  normalizeEnergyObservation,
  normalizeEnergySnapshot,
  saganKardashevIndex,
  sameComparableMetric,
  worldKardashevEstimate,
} from './model.js';

// Synthetic quantities only. The publisher URL describes the intended dataset,
// not a claim that its particular local-authority row equals these values.
const BASE = Object.freeze({
  schemaVersion: 1,
  area: {
    id: 'GSS:E09000001',
    type: 'local_authority',
    boundaryDataset: 'ONS LAD2024',
    boundaryRevision: '2024-12',
  },
  metric: 'total_final_energy',
  calendarYear: 2024,
  annualTWh: 1,
  status: 'official_estimate',
  geographyCoverage: 'complete',
  source: {
    publisher: 'UK DESNZ',
    url: 'https://www.gov.uk/government/statistics/total-final-energy-consumption-at-regional-and-local-authority-level-2005-to-2024',
    datasetVersion: '2026-07-30',
    releasedAt: '2026-07-30',
    licence: 'OGL',
    attribution: 'Contains public sector information licensed under the OGL',
  },
});

const another = (patch = {}) => ({
  ...BASE,
  area: { ...BASE.area, id: 'GSS:E09000002' },
  ...patch,
});

const world = (patch = {}) => ({
  ...BASE,
  area: {
    id: 'WORLD',
    type: 'world',
    boundaryDataset: 'whole-earth',
    boundaryRevision: 'v1',
  },
  metric: 'primary_energy_supply',
  calendarYear: 2025,
  source: {
    publisher: 'Synthetic test fixture',
    url: 'https://example.com/energy-test-fixture',
    datasetVersion: 'test-v1',
    releasedAt: '2026-01-01',
    licence: 'synthetic-test-only',
    attribution: 'Synthetic test values; not an observed world energy source',
  },
  ...patch,
});

test('explicit allowed energy quantities have distinct metric names', () => {
  assert.deepEqual(ENERGY_METRICS, [
    'total_final_energy',
    'primary_energy_supply',
    'electricity_consumption',
  ]);
  assert.ok(Object.isFrozen(ENERGY_METRICS));
});

test('2024 leap year and 2025 ordinary year use actual calendar hours', () => {
  assert.equal(hoursInCalendarYear(2024), 8784);
  assert.equal(hoursInCalendarYear(2025), 8760);
  assert.equal(hoursInCalendarYear(2000), 8784);
  assert.equal(hoursInCalendarYear(2100), 8760);
});

test('invalid calendar years fail closed without rounding or coercion', () => {
  for (const year of [null, '', '2024', 2024.5, 0, 1700, 2200, NaN]) {
    assert.equal(hoursInCalendarYear(year), null);
    assert.equal(annualAveragePowerW(1, year), null);
  }
});

test('annual TWh maps to a derived average, never a live rate', () => {
  assert.equal(annualAveragePowerW(1, 2024), 1e12 / 8784);
  assert.equal(annualAveragePowerW(1, 2025), 1e12 / 8760);
  assert.equal(annualAveragePowerW(0, 2025), 0);
});

test('invalid energy amounts never silently become zero', () => {
  for (const amount of [null, undefined, '', '0', '1', false, -1, NaN, Infinity]) {
    assert.equal(annualAveragePowerW(amount, 2024), null);
  }
});

test('a finite but overflowing multiplication yields unavailable', () => {
  assert.equal(annualAveragePowerW(Number.MAX_VALUE, 2024), null);
});

test('Sagan reference powers map to Type I, II, III', () => {
  assert.equal(saganKardashevIndex(1e16), 1);
  assert.equal(saganKardashevIndex(1e26), 2);
  assert.equal(saganKardashevIndex(1e36), 3);
});

test('Sagan interpolation rejects zero, negative and invalid power', () => {
  for (const input of [0, -1, null, undefined, NaN, Infinity, '1e16']) {
    assert.equal(saganKardashevIndex(input), null);
  }
});

test('one observed zero is retained, not conflated with missing', () => {
  const row = normalizeEnergyObservation({ ...BASE, annualTWh: 0 });
  assert.equal(row.annualTWh, 0);
  assert.equal(row.status, 'official_estimate');
  assert.equal(annualAveragePowerW(row.annualTWh, row.calendarYear), 0);
});

test('missing/suppressed observation keeps null with an explicit state', () => {
  const missing = normalizeEnergyObservation({
    ...BASE, status: 'missing', annualTWh: null,
  });
  assert.equal(missing.annualTWh, null);
  assert.equal(missing.status, 'missing');
  assert.equal(annualAveragePowerW(missing.annualTWh, 2024), null);
});

test('missing cannot masquerade as recorded zero or nonzero amount', () => {
  for (const annualTWh of [0, 1, '', NaN]) {
    assert.equal(normalizeEnergyObservation({
      ...BASE, status: 'missing', annualTWh,
    }), null);
  }
});

test('all non-missing states require explicit valid numerical amounts', () => {
  for (const annualTWh of [null, undefined, '', '1', -1, NaN, Infinity]) {
    for (const status of ['official_estimate', 'measured', 'modeled']) {
      assert.equal(normalizeEnergyObservation({ ...BASE, annualTWh, status }), null);
    }
  }
});

test('normalization copies immutable typed source and geography metadata', () => {
  const original = { ...BASE, area: { ...BASE.area }, source: { ...BASE.source } };
  const row = normalizeEnergyObservation(original);
  original.area.id = 'GSS:E09000002';
  original.source.datasetVersion = 'different';
  assert.equal(row.area.id, BASE.area.id);
  assert.equal(row.source.datasetVersion, BASE.source.datasetVersion);
  assert.ok(Object.isFrozen(row));
  assert.ok(Object.isFrozen(row.area));
  assert.ok(Object.isFrozen(row.source));
});

test('missing source or unattributed dataset is never accepted', () => {
  assert.equal(normalizeEnergyObservation({ ...BASE, source: null }), null);
  for (const key of ['publisher', 'datasetVersion', 'licence', 'attribution', 'url']) {
    assert.equal(normalizeEnergyObservation({
      ...BASE, source: { ...BASE.source, [key]: '' },
    }), null);
  }
});

test('unsafe or invalid source URLs are refused', () => {
  for (const url of [
    'javascript:alert(1)', 'http://example.com',
    'https://u:p@example.com/a', 'not-a-url',
  ]) {
    assert.equal(normalizeEnergyObservation({
      ...BASE, source: { ...BASE.source, url },
    }), null);
  }
});

test('source publication requires real ISO calendar date', () => {
  for (const releasedAt of ['2024-02-30', '2026-2-7', 'garbage', null]) {
    assert.equal(normalizeEnergyObservation({
      ...BASE, source: { ...BASE.source, releasedAt },
    }), null);
  }
});

test('area key must match declared supported administrative scope', () => {
  for (const area of [
    { ...BASE.area, id: 'London' },
    { ...BASE.area, id: 'GSS:E0900000' },
    { ...BASE.area, id: 'ISO3:GBR' },
    { ...BASE.area, boundaryRevision: '' },
    { ...BASE.area, type: 'city' },
    { ...world().area, id: 'GSS:E09000001' },
    { ...world().area, type: 'country' },
  ]) {
    assert.equal(normalizeEnergyObservation({ ...BASE, area }), null);
  }
  assert.ok(normalizeEnergyObservation({ ...BASE }));
  assert.ok(normalizeEnergyObservation(world()));
  assert.ok(normalizeEnergyObservation({ ...BASE, area: {
    ...BASE.area, id: 'ISO3:GBR', type: 'country',
  } }));
});

test('metric and epistemic status vocabulary is closed', () => {
  assert.equal(normalizeEnergyObservation({ ...BASE, metric: 'emissions' }), null);
  assert.equal(normalizeEnergyObservation({ ...BASE, status: 'live' }), null);
  assert.equal(normalizeEnergyObservation({
    ...BASE, geographyCoverage: 'inferred',
  }), null);
});

test('pure batch validation rejects duplicate area/metric/year, even across revisions', () => {
  const revision = another({
    area: { ...BASE.area },
    source: { ...BASE.source, datasetVersion: '2026-08-01' },
  });
  assert.equal(normalizeEnergySnapshot([BASE, revision]), null);
  assert.equal(normalizeEnergySnapshot([BASE, BASE]), null);
});

test('pure batch validation fails atomically on malformed records', () => {
  assert.equal(normalizeEnergySnapshot(null), null);
  assert.equal(normalizeEnergySnapshot([BASE, { ...BASE, annualTWh: '' }]), null);
  const rows = normalizeEnergySnapshot([BASE, another()]);
  assert.equal(rows.length, 2);
  assert.ok(Object.isFrozen(rows));
});

test('only same-year, same-source, same-level, complete coverage compares', () => {
  assert.equal(sameComparableMetric(BASE, another()), true);
  assert.equal(sameComparableMetric(BASE, another({ calendarYear: 2023 })), false);
  assert.equal(sameComparableMetric(BASE, another({ metric: 'electricity_consumption' })), false);
  assert.equal(sameComparableMetric(BASE, another({
    source: { ...BASE.source, datasetVersion: '2027-01-01' },
  })), false);
  assert.equal(sameComparableMetric(BASE, another({ geographyCoverage: 'partial' })), false);
});

test('different administrative levels or geography vintages do not compare', () => {
  assert.equal(sameComparableMetric(BASE, another({
    area: { ...BASE.area, id: 'GSS:E12000001', type: 'region' },
  })), false);
  assert.equal(sameComparableMetric(BASE, another({
    area: { ...BASE.area, boundaryRevision: '2023-12' },
  })), false);
});

test('modeled, missing and differently classified readings do not compare', () => {
  assert.equal(sameComparableMetric(BASE, another({ status: 'modeled' })), false);
  assert.equal(sameComparableMetric(BASE, another({
    status: 'missing', annualTWh: null,
  })), false);
  assert.equal(sameComparableMetric(BASE, another({ status: 'measured' })), false);
});

test('Kardashev display is restricted to world primary-energy observations', () => {
  const typeIAnnualTWh = (1e16 / 1e12) * 8760;
  const observed = world({ annualTWh: typeIAnnualTWh });
  const value = worldKardashevEstimate(observed);
  assert.equal(value.index, 1);
  assert.equal(value.kind, 'educational_annual_average');
  assert.equal(value.averagePowerW, 1e16);
  assert.ok(Object.isFrozen(value));
  assert.equal(worldKardashevEstimate(BASE), null);
  assert.equal(worldKardashevEstimate({
    ...observed, area: { ...BASE.area },
  }), null);
  assert.equal(worldKardashevEstimate({
    ...observed, metric: 'electricity_consumption',
  }), null);
});

test('planetary partial coverage is explicit, never silently complete', () => {
  const record = world({
    annualTWh: 200000, geographyCoverage: 'partial',
  });
  const result = worldKardashevEstimate(record);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.source.publisher, 'Synthetic test fixture');
  assert.equal(worldKardashevEstimate(world({ annualTWh: 0 })), null);
  assert.equal(worldKardashevEstimate(world({
    annualTWh: null, status: 'missing',
  })), null);
  assert.equal(worldKardashevEstimate(world({ status: 'modeled' })), null);
});
