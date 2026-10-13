import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptDorRoadStatusRecord } from './dorRoadStatus.js';
import { evaluateDisasterRouteSupport } from './disasterAccess.js';

const DOR_FIXTURE = Object.freeze({
  id: 966,
  roadRefNumber: 'NH03',
  linkCode: 'NH03-084',
  location: 'Sikhar Municipality-08, Ghopghat, CH 31+000 to 36+000',
  closureType: 'PARTIAL_OPEN',
  openDate: 'October 9th, 2026 4:10PM',
  lastUpdatedBy: 'Road Division Doti',
});

test('public DoR fixture preserves section identity, source and unknown freshness', () => {
  const result = adaptDorRoadStatusRecord(DOR_FIXTURE);
  assert.equal(result.id, 'nepal-dor:NH03-084');
  assert.equal(result.state, 'degraded');
  assert.equal(result.determination, 'declared');
  assert.equal(result.freshness, 'unknown');
  assert.equal(result.observedAt, null);
  assert.equal(result.receivedAt, null);
  assert.equal(result.provenance.publisher, 'Road Division Doti');
  assert.equal(result.provenance.localDateText, DOR_FIXTURE.openDate);
  assert.equal(result.provenance.timeZone, 'unverified');
  assert.equal(result.provenance.reuseRights, 'unverified');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.provenance));
});

test('historical partial-open or open declarations never imply current route support', () => {
  for (const closureType of ['PARTIAL_OPEN', 'OPEN', 'CLOSED']) {
    const segment = adaptDorRoadStatusRecord({ ...DOR_FIXTURE, closureType });
    const result = evaluateDisasterRouteSupport(
      { id: 'fixture-relief-route', segmentIds: [segment.id] },
      [segment],
    );
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, [`unknown-access:${segment.id}`]);
  }
});

test('unknown status stays unknown; no optimistic state coercion', () => {
  const result = adaptDorRoadStatusRecord({
    ...DOR_FIXTURE,
    closureType: 'OPEN_FOR_LIGHT_VEHICLES_ONLY',
  });
  assert.equal(result.state, 'unknown');
});

test('wrong or missing section identity and publisher reject the record', () => {
  for (const overrides of [
    { roadRefNumber: 'NH02' },
    { linkCode: 'NH03' },
    { linkCode: 'NH03-../083' },
    { id: null },
    { lastUpdatedBy: '' },
  ]) {
    assert.equal(adaptDorRoadStatusRecord({ ...DOR_FIXTURE, ...overrides }), null);
  }
});

test('road-level name never auto-matches a specific closure segment', () => {
  const segment = adaptDorRoadStatusRecord(DOR_FIXTURE);
  const route = { id: 'fixture-route', segmentIds: ['nepal-dor:NH03'] };
  const result = evaluateDisasterRouteSupport(route, [segment]);
  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['missing-access:nepal-dor:NH03']);
});

test('no network or location lookup occurs during adaptation', () => {
  const fixture = { ...DOR_FIXTURE, coordinates: [85.2, 27.6] };
  const normalized = adaptDorRoadStatusRecord(fixture);
  assert.equal('coordinates' in normalized, false);
  assert.equal('geometry' in normalized, false);
  assert.equal(normalized.freshness, 'unknown');
});
