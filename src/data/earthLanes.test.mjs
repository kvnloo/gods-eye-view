import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecord, laneOfType, transition } from './earthLanes.js';

// HUM-08 (#145): four lanes, four allowed transitions, five forbidden ones.
const at = '2026-11-13T09:00:00.000Z';
const BASIS = {
  fork: { kind: 'fork', by: 'planner-1', at },
  commitment: {
    kind: 'commitment',
    externalId: 'SFMTA-2026-014',
    owner: 'SFMTA',
    at,
  },
  evidence: {
    kind: 'evidence',
    source: 'https://example.org/after-imagery/2027-03',
    observedAt: '2027-03-01T00:00:00.000Z',
    at,
  },
  validation: {
    kind: 'validation',
    validator: 'survey-team',
    evidence: 'https://example.org/survey/88',
    at,
  },
};
const observed = () =>
  createRecord({
    lane: 'observed',
    type: 'evidence',
    source: 'Esri World Imagery',
  });
const possible = (type) => createRecord({ lane: 'possible', type });
const coordinated = () =>
  transition(possible('proposal'), {
    to: 'coordinated',
    basis: BASIS.commitment,
  });
const measured = () =>
  transition(coordinated(), { to: 'measured', basis: BASIS.evidence });
const refuses = (run, code) =>
  assert.throws(run, (error) => {
    assert.equal(error.name, 'EarthLaneError');
    assert.equal(error.code, code);
    return true;
  });

// --- allowed -----------------------------------------------------------------
test('allowed: Observed -> Possible by explicit fork', () => {
  const base = observed();
  const fork = transition(base, { to: 'possible', basis: BASIS.fork });
  assert.equal(fork.lane, 'possible');
  assert.equal(laneOfType(fork.type), 'possible');
  assert.deepEqual(fork.receipts, [
    { from: 'observed', to: 'possible', basis: BASIS.fork },
  ]);
  // The fork never changes the observation it came from.
  assert.deepEqual(base, observed());
  assert.ok(Object.isFrozen(base) && Object.isFrozen(fork));
  // "Explicit": a fork without an author or a time is refused.
  refuses(
    () => transition(base, { to: 'possible', basis: { kind: 'fork' } }),
    'basis',
  );
  refuses(() => transition(base, { to: 'possible' }), 'basis');
});

test('allowed: Possible -> Coordinated by real external commitment', () => {
  const next = coordinated();
  assert.equal(next.lane, 'coordinated');
  assert.equal(next.type, 'commitment');
  assert.equal(next.receipts.at(-1).basis.externalId, 'SFMTA-2026-014');
  // "Real external": no external id or no owner is not a commitment.
  for (const basis of [
    { kind: 'commitment', owner: 'SFMTA', at },
    { kind: 'commitment', externalId: 'SFMTA-2026-014', at },
    BASIS.fork,
  ])
    refuses(
      () => transition(possible('proposal'), { to: 'coordinated', basis }),
      'basis',
    );
});

test('allowed: Coordinated -> Measured by new evidence', () => {
  const next = measured();
  assert.equal(next.lane, 'measured');
  assert.equal(next.type, 'outcome');
  assert.equal(next.receipts.length, 2);
  assert.equal(next.receipts.at(-1).basis.source, BASIS.evidence.source);
  refuses(
    () =>
      transition(coordinated(), {
        to: 'measured',
        basis: { kind: 'evidence', source: BASIS.evidence.source, at },
      }),
    'basis',
  );
});

test('allowed: Measured -> Observed by validated claim', () => {
  const next = transition(measured(), {
    to: 'observed',
    basis: BASIS.validation,
  });
  assert.equal(next.lane, 'observed');
  assert.equal(next.type, 'evidence');
  assert.deepEqual(
    next.receipts.map((r) => `${r.from}>${r.to}`),
    ['possible>coordinated', 'coordinated>measured', 'measured>observed'],
  );
  // A claim nobody validated, or validated against nothing, stays Measured.
  refuses(
    () =>
      transition(measured(), {
        to: 'observed',
        basis: { kind: 'validation', validator: 'survey-team', at },
      }),
    'basis',
  );
});

// --- forbidden ---------------------------------------------------------------
test('forbidden: desired -> observed', () => {
  refuses(
    () =>
      transition(possible('desire'), {
        to: 'observed',
        basis: BASIS.validation,
      }),
    'transition',
  );
  refuses(
    () => createRecord({ lane: 'observed', type: 'desire', source: 'wish' }),
    'type',
  );
});

test('forbidden: simulated -> completed', () => {
  // Completion is a Measured outcome; a simulation cannot reach it, whatever it offers.
  for (const basis of [BASIS.evidence, BASIS.commitment, BASIS.validation])
    refuses(
      () => transition(possible('simulation'), { to: 'measured', basis }),
      'transition',
    );
  refuses(() => createRecord({ lane: 'measured', type: 'outcome' }), 'lane');
});

test('forbidden: funded -> successful', () => {
  // Money committed is not an outcome: only new evidence moves it to Measured.
  const funded = coordinated();
  refuses(
    () => transition(funded, { to: 'measured', basis: BASIS.commitment }),
    'basis',
  );
  refuses(() => transition(funded, { to: 'measured' }), 'basis');
  refuses(
    () => transition(funded, { to: 'observed', basis: BASIS.validation }),
    'transition',
  );
});

test('forbidden: user annotation -> authoritative fact', () => {
  refuses(
    () =>
      transition(possible('annotation'), {
        to: 'observed',
        basis: BASIS.validation,
      }),
    'transition',
  );
  // An Observed record must name its source; an annotation has none.
  refuses(() => createRecord({ lane: 'observed', type: 'annotation' }), 'type');
  refuses(() => createRecord({ lane: 'observed', type: 'evidence' }), 'source');
});

test('forbidden: model prediction -> observed evidence', () => {
  refuses(
    () =>
      transition(possible('prediction'), {
        to: 'observed',
        basis: BASIS.evidence,
      }),
    'transition',
  );
  refuses(
    () =>
      createRecord({ lane: 'observed', type: 'prediction', source: 'model' }),
    'type',
  );
  assert.equal(laneOfType('prediction'), 'possible');
  assert.equal(laneOfType('estimate'), 'possible');
});
