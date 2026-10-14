import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEnergyBoundary,
  resolveEnergySelection,
} from './selection.js';

// Entirely synthetic quantities. The GSS-like ID is an illustrative key only.
const SOURCE = Object.freeze({
  publisher: 'Synthetic Energy Fixture',
  url: 'https://example.org/annual-energy',
  datasetVersion: 'test-r1',
  releasedAt: '2026-08-01',
  licence: 'synthetic-only',
  attribution: 'Synthetic values; not official consumption measurements',
});
const BOUNDARY = Object.freeze({
  type: 'local_authority',
  code: 'E09000001',
  codeField: 'LAD24CD',
  dataset: 'ONS LAD2024',
  revision: '2024-12',
  name: 'Example local authority',
});
const ROW = Object.freeze({
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
  source: SOURCE,
});
const query = (patch = {}) => ({
  boundary: BOUNDARY,
  observations: [ROW],
  metric: 'total_final_energy',
  calendarYear: 2024,
  sourceRevision: 'test-r1',
  ...patch,
});

test('matching ONS boundary and source produce a nonlive readout', () => {
  const result = resolveEnergySelection(query());
  assert.equal(result.state, 'ready');
  assert.equal(result.area.id, 'GSS:E09000001');
  assert.equal(result.area.name, BOUNDARY.name);
  assert.equal(result.metric, 'total_final_energy');
  assert.equal(result.calendarYear, 2024);
  assert.equal(result.annualTWh, 1);
  assert.equal(result.averagePowerGW, 1000 / 8784);
  assert.equal(result.live, false);
  assert.equal(result.counterKind, 'annual_average_equivalent_not_live');
  assert.equal(result.source.publisher, SOURCE.publisher);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.area));
});

test('explicit measured zero remains zero, not unavailable', () => {
  const result = resolveEnergySelection(query({
    observations: [{ ...ROW, annualTWh: 0 }],
  }));
  assert.equal(result.state, 'ready');
  assert.equal(result.annualTWh, 0);
  assert.equal(result.averagePowerGW, 0);
});

test('missing and invalid numeric values never yield a zero counter', () => {
  for (const row of [
    { ...ROW, status: 'missing', annualTWh: null },
    { ...ROW, annualTWh: null },
    { ...ROW, annualTWh: '' },
    { ...ROW, annualTWh: NaN },
  ]) {
    const result = resolveEnergySelection(query({ observations: [row] }));
    assert.equal(result.state, 'unavailable');
    assert.equal(result.averagePowerGW, null);
    assert.equal(result.live, false);
  }
});

test('unverified boundaries cannot match by name', () => {
  for (const boundary of [
    null,
    {},
    { ...BOUNDARY, code: 'London' },
    { ...BOUNDARY, code: 'E09000002', codeField: 'LAD23CD' },
    { ...BOUNDARY, code: 'E0900000' },
    { ...BOUNDARY, dataset: 'Natural Earth' },
    { ...BOUNDARY, revision: '2023-12' },
    { ...BOUNDARY, name: '' },
  ]) {
    assert.equal(normalizeEnergyBoundary(boundary), null);
    const result = resolveEnergySelection(query({ boundary }));
    assert.equal(result.reason, 'boundary-unverified');
  }
});

test('different area codes never reuse the previous selection', () => {
  const boundary = { ...BOUNDARY, code: 'E09000002' };
  const result = resolveEnergySelection(query({ boundary }));
  assert.equal(result.reason, 'observation-missing');
  assert.equal(result.annualTWh, null);
  assert.equal(result.averagePowerGW, null);
  assert.equal(result.area.id, 'GSS:E09000002');
});

test('year change refuses to recycle 2024 as 2025 data', () => {
  const result = resolveEnergySelection(query({ calendarYear: 2025 }));
  assert.equal(result.reason, 'observation-missing');
  assert.equal(result.averagePowerGW, null);
});

test('distinct 2023 annual sample uses 8760 hours', () => {
  const row = { ...ROW, calendarYear: 2023 };
  const result = resolveEnergySelection(query({
    calendarYear: 2023,
    observations: [row],
  }));
  assert.equal(result.state, 'ready');
  assert.equal(result.averagePowerGW, 1000 / 8760);
});

test('different metrics never inherit totals', () => {
  const result = resolveEnergySelection(query({
    metric: 'electricity_consumption',
  }));
  assert.equal(result.reason, 'observation-missing');
  assert.equal(result.averagePowerGW, null);
});

test('same area code with wrong boundary revision fails', () => {
  const row = { ...ROW, area: {
    ...ROW.area, boundaryRevision: '2023-12',
  } };
  const result = resolveEnergySelection(query({ observations: [row] }));
  assert.equal(result.reason, 'boundary-revision-mismatch');
});

test('boundary dataset mismatch cannot join same ID', () => {
  const row = { ...ROW, area: {
    ...ROW.area, boundaryDataset: 'unverified dataset',
  } };
  const result = resolveEnergySelection(query({ observations: [row] }));
  assert.equal(result.reason, 'boundary-revision-mismatch');
});

test('source revision change must refresh the selected measurement', () => {
  const result = resolveEnergySelection(query({ sourceRevision: 'test-r2' }));
  assert.equal(result.reason, 'source-revision-mismatch');
  assert.equal(result.annualTWh, null);
});

test('source revision is mandatory, not inferred from first record', () => {
  for (const sourceRevision of [null, '', ' ']) {
    const result = resolveEnergySelection(query({ sourceRevision }));
    assert.equal(result.reason, 'selector-incomplete');
  }
});

test('incomplete coverage cannot become a whole-area total', () => {
  for (const geographyCoverage of ['partial', 'unknown']) {
    const row = { ...ROW, geographyCoverage };
    const result = resolveEnergySelection(query({ observations: [row] }));
    assert.equal(result.reason, 'coverage-incomplete');
    assert.equal(result.averagePowerGW, null);
  }
});

test('modeled values require a separate simulated experience', () => {
  const result = resolveEnergySelection(query({
    observations: [{ ...ROW, status: 'modeled' }],
  }));
  assert.equal(result.reason, 'modeled-not-observed');
});

test('invalid or duplicated snapshots reject atomically', () => {
  for (const observations of [null, {}, [ROW, ROW], [ROW, null]]) {
    const result = resolveEnergySelection(query({ observations }));
    assert.equal(result.reason, 'snapshot-invalid');
    assert.equal(result.averagePowerGW, null);
  }
});

test('selection carries no geometry or network clients', () => {
  const result = resolveEnergySelection(query({
    boundary: { ...BOUNDARY, coordinates: [0, 0], geometry: {} },
  }));
  assert.equal(result.state, 'ready');
  assert.equal('geometry' in result.area, false);
  assert.equal('coordinates' in result.area, false);
  assert.equal('fetch' in result, false);
});
