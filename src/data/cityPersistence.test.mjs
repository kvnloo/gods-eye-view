import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runCityPersistenceRoundTrip,
  savedKeySnapshot,
} from '../testSupport/cityPersistenceFixture.mjs';

test('shared fixture: create, save and reload round-trip every saved key', () => {
  const run = runCityPersistenceRoundTrip();
  // Reload reads the saved bytes and never rewrites them.
  assert.equal(run.afterSaved, run.saved);
});

test('saved keys match the committed sorted path: type snapshot', () => {
  const run = runCityPersistenceRoundTrip();
  const committed = readFileSync(
    new URL('../testSupport/cityDocumentSavedKeys.txt', import.meta.url),
    'utf8',
  );
  // A new saved key (zoning, access, co-op) must update this file on purpose.
  assert.equal(savedKeySnapshot(run.saved), committed);
});
