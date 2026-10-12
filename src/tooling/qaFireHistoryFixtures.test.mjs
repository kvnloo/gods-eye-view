import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRE_HISTORY_QA_EVENTS,
  fireHistoryFixtureReply,
} from '../../scripts/qa-fire-history.mjs';

test('fixture catalog is bounded to reviewed historical IDs', () => {
  const reply = fireHistoryFixtureReply('/api/fire-history');
  assert.equal(reply.status, 200);
  assert.equal(reply.payload.hasKey, true);
  assert.deepEqual(reply.payload.events.map((event) => event.id), [
    'camp-fire-2018',
    'lahaina-2023',
  ]);
  assert.equal(FIRE_HISTORY_QA_EVENTS.length, 2);
});

test('fixture archive explicitly carries partial evidence', () => {
  const reply = fireHistoryFixtureReply('/api/fire-history/camp-fire-2018');
  assert.equal(reply.status, 200);
  assert.equal(reply.payload.complete, false);
  assert.equal(reply.payload.fires.length, 2);
  assert.ok(reply.payload.windows.some((window) => window.ok === false));
});

test('missing key stays explicit and unknown requests never go live', () => {
  assert.deepEqual(fireHistoryFixtureReply('/api/fire-history/lahaina-2023'), {
    status: 503,
    payload: { error: 'no_key' },
  });
  assert.deepEqual(fireHistoryFixtureReply('/api/fire-history/unknown-event'), {
    status: 404,
    payload: { error: 'unknown_fixture_event' },
  });
});
