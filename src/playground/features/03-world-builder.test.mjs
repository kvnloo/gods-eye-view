import assert from 'node:assert/strict';
import test from 'node:test';
import { createProposal, makeScenarioReceipt } from './03-world-builder.js';

test('proposals reject nonfinite and out-of-bounds locations', () => {
  assert.throws(() => createProposal({ scenario: 'A', type: 'park', lat: Infinity, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'C', type: 'park', lat: 0, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'B', type: 'other', lat: 0, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'B', type: 'bridge', lat: 0, lon: -181 }));
});

test('receipts distinguish hypothetical branches and never claim modelled outcomes', () => {
  const a = createProposal({ scenario: 'A', type: 'park', lat: 30.26720009, lon: -97.74 });
  const b = createProposal({ scenario: 'B', type: 'cooling-center', lat: 30.26, lon: -97.7 });
  const receipt = makeScenarioReceipt([a, b], '2026-10-16T00:00:00Z');
  assert.equal(receipt.modeledOutcomes, false);
  assert.equal(receipt.scenarios.A[0].lat, 30.2672);
  assert.deepEqual(receipt.scenarios.B, [b]);
  assert.match(receipt.provenance, /hypothetical/);
});
