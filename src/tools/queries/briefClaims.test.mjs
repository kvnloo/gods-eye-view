import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceClaim, claimRevisionCurrent } from '../../data/layerSnapshot.js';

test('claim kinds remain distinct through JSON serialization', () => {
  for (const kind of ['observed', 'declared', 'derived']) {
    const claim = evidenceClaim({ kind, status: 'present', count: 0, source: 'public-feed', revision: 'r1' });
    assert.deepEqual(JSON.parse(JSON.stringify(claim)), claim);
    assert.equal(claim.kind, kind);
    assert.equal(claim.count, 0);
  }
});

test('unknown, absent and stale never become observed zero', () => {
  for (const status of ['unknown', 'absent', 'stale']) {
    const claim = evidenceClaim({ kind: 'observed', status, count: 0 });
    assert.equal(claim.status, status);
    assert.equal(claim.count, null);
    assert.deepEqual(JSON.parse(JSON.stringify(claim)), claim);
  }
  assert.equal(evidenceClaim({ count: 0 }).kind, 'derived');
  assert.equal(evidenceClaim({ count: 0 }).status, 'unknown');
});

test('revision changes invalidate a dependent claim', () => {
  const claim = evidenceClaim({ kind: 'derived', status: 'present', source: 'feed', revision: 'v1' });
  assert.equal(claimRevisionCurrent(claim, { feed: 'v1' }), true);
  assert.equal(claimRevisionCurrent(claim, { feed: 'v2' }), false);
  assert.equal(claimRevisionCurrent(claim, {}), false);
  assert.equal(claimRevisionCurrent(evidenceClaim({ status: 'present' }), {}), false);
});
