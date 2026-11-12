import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PERSISTENCE_PLOT,
  PERSISTENCE_REFERENCE,
  runCityPersistenceRoundTrip,
  savedKeySnapshot,
} from '../testSupport/cityPersistenceFixture.mjs';
import { presentCityWalkAccess } from '../ui/cityWalkAccess.js';

test('shared fixture: create, save, reload and reselect round-trip every saved key', async () => {
  const run = await runCityPersistenceRoundTrip();
  // Reload reads the saved bytes and never rewrites them.
  assert.equal(run.afterSaved, run.saved);
  assert.deepEqual(run.after.alternatives, run.before.alternatives);
  assert.equal(run.after.persisted, true);
  assert.equal(run.after.error, null);
  const byId = Object.fromEntries(run.after.alternatives.map((a) => [a.id, a]));
  // The unplaced proposal stays unplaced in both senses.
  assert.equal(byId['world-1'].parameters.site, null);
  assert.equal(byId['world-1'].site, null);
  // Walk access reads the reloaded document: unknown until a site is chosen.
  const rows = Object.fromEntries(
    presentCityWalkAccess(run.after.alternatives).rows.map((r) => [r.id, r]),
  );
  assert.equal(rows['world-1'].state, 'unknown');
  assert.equal(rows['world-2'].state, 'evaluated');
  // Reselect: play mode resumes the placed plot with its concept leading.
  assert.equal(run.reselected.state.plot.id, PERSISTENCE_PLOT.id);
  assert.equal(run.reselected.state.focusId, run.placedId);
  assert.equal(run.reselected.state.wheel, false);
  assert.deepEqual(
    run.reselected.alternatives.map((a) => a.id),
    [run.placedId],
  );
  const placed = run.reselected.alternatives[0];
  assert.deepEqual(placed.site.plot, PERSISTENCE_PLOT);
  assert.deepEqual(placed.concept.sourceView, PERSISTENCE_REFERENCE);
  assert.equal(run.reselected.cards[0].id, run.placedId);
  assert.ok(run.reselected.cards[0].image, 'the card shows the saved concept');
  assert.equal(
    run.reselected.reopened.wheel,
    true,
    'clicking the plot reopens the wheel',
  );
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
