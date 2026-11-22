import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runCityPersistenceRoundTrip,
  savedKeySnapshot,
} from '../testSupport/cityPersistenceFixture.mjs';

test('shared fixture: create, save and reload round-trip every saved key', async () => {
  const run = await runCityPersistenceRoundTrip();
  // Reload reads the saved bytes and never rewrites them.
  assert.equal(run.afterSaved, run.saved);
  assert.deepEqual(run.after.alternatives, run.before.alternatives);
  assert.equal(run.after.persisted, true);
  assert.equal(run.after.error, null);
  const byId = Object.fromEntries(run.after.alternatives.map((a) => [a.id, a]));
  assert.equal(byId['world-1'].concept, null);
  assert.equal(byId['world-2'].revision, 2);
  assert.equal(byId['world-2'].concept.provider, 'fixture');
});

test('saved keys match the committed sorted path: type snapshot', async () => {
  const run = await runCityPersistenceRoundTrip();
  const committed = readFileSync(
    new URL('../testSupport/cityDocumentSavedKeys.txt', import.meta.url),
    'utf8',
  );
  // A new saved key (zoning, access, co-op) must update this file on purpose.
  assert.equal(savedKeySnapshot(run.saved), committed);
});
