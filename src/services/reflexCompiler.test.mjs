import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mineReflexCandidates,
  prepareReflex,
  reflexDemotionReason,
  validatePreparedReflex,
} from './reflexCompiler.js';

function episode(id, overrides = {}) {
  return {
    receiptId: id,
    outcome: 'verified_success',
    sourceStateFingerprint: 'world:a',
    capabilityRevision: 'caps:1',
    steps: [
      { action: 'select_imagery' },
      { action: 'focus_nearest_cctv' },
    ],
    undoWithinWindow: false,
    userOverride: false,
    ...overrides,
  };
}

test('candidate miner learns only repeated verified semantic sequences', () => {
  const candidates = mineReflexCandidates(
    [
      episode('a'),
      episode('b'),
      episode('c'),
      episode('undo', { undoWithinWindow: true }),
      episode('failed', { outcome: 'failed' }),
    ],
    { minVerified: 3 },
  );

  assert.deepEqual(candidates, [
    {
      sequence: 'select_imagery>focus_nearest_cctv',
      verifiedCount: 3,
      actions: ['select_imagery', 'focus_nearest_cctv'],
      sourceReceiptIds: ['a', 'b', 'c'],
    },
  ]);
});

test('prepare is immutable and validation fails closed on stale state', () => {
  const steps = [
    { action: 'select_imagery', args: { layer: 'recent-imagery' } },
    { action: 'focus_nearest_cctv' },
  ];
  const prepared = prepareReflex({
    routineId: 'hazard-imagery-cctv',
    sourceStateFingerprint: 'world:a',
    capabilityRevision: 'caps:1',
    steps,
    preparedAt: 1000,
    ttlMs: 5000,
  });

  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.steps), true);
  assert.equal(
    validatePreparedReflex(prepared, {
      sourceStateFingerprint: 'world:a',
      capabilityRevision: 'caps:1',
      now: 2000,
      requiredInputs: [{ id: 'camera-1', freshness: 'observed' }],
    }).ok,
    true,
  );
  assert.deepEqual(
    validatePreparedReflex(prepared, {
      sourceStateFingerprint: 'world:b',
      capabilityRevision: 'caps:1',
      now: 2000,
    }),
    { ok: false, reason: 'stale_state' },
  );
  assert.deepEqual(
    validatePreparedReflex(prepared, {
      sourceStateFingerprint: 'world:a',
      capabilityRevision: 'caps:1',
      now: 2000,
      requiredInputs: [{ id: 'camera-1', freshness: 'unavailable' }],
    }),
    {
      ok: false,
      reason: 'input_unavailable',
      input: 'camera-1',
    },
  );
});

test('prepared work expires and capability drift blocks commit', () => {
  const prepared = prepareReflex({
    routineId: 'hazard-imagery-cctv',
    sourceStateFingerprint: 'world:a',
    capabilityRevision: 'caps:1',
    steps: [{ action: 'focus_nearest_cctv' }],
    preparedAt: 1000,
    ttlMs: 500,
  });

  assert.deepEqual(
    validatePreparedReflex(prepared, {
      sourceStateFingerprint: 'world:a',
      capabilityRevision: 'caps:1',
      now: 1500,
    }),
    { ok: false, reason: 'expired' },
  );
  assert.deepEqual(
    validatePreparedReflex(
      prepareReflex({
        routineId: 'hazard-imagery-cctv',
        sourceStateFingerprint: 'world:a',
        capabilityRevision: 'caps:1',
        steps: [{ action: 'focus_nearest_cctv' }],
        preparedAt: 1000,
        ttlMs: 5000,
      }),
      {
        sourceStateFingerprint: 'world:a',
        capabilityRevision: 'caps:2',
        now: 1200,
      },
    ),
    { ok: false, reason: 'capability_drift' },
  );
});

test('drift and repeated operator correction demote routines', () => {
  assert.equal(reflexDemotionReason({ schemaChanged: true }), 'schema_drift');
  assert.equal(
    reflexDemotionReason({ capabilityChanged: true }),
    'capability_drift',
  );
  assert.equal(
    reflexDemotionReason({ verifierFailures: 2 }),
    'verifier_failures',
  );
  assert.equal(
    reflexDemotionReason({ undoCount: 1, overrideCount: 1 }),
    'operator_override',
  );
  assert.equal(reflexDemotionReason({ undoCount: 1 }), null);
});
