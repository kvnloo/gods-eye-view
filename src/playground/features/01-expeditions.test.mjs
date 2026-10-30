import assert from 'node:assert/strict';
import test from 'node:test';
import { MISSIONS, availableExpeditions } from './01-expeditions.js';

test('expedition IDs are distinct and geo destinations are bounded', () => {
  assert.equal(new Set(MISSIONS.map(({ id }) => id)).size, MISSIONS.length);
  for (const mission of MISSIONS.filter(({ camera }) => camera)) {
    assert.ok(Math.abs(mission.camera.lat) <= 90);
    assert.ok(Math.abs(mission.camera.lon) <= 180);
    assert.ok(mission.camera.altitude > 0);
  }
});

test('requires a genuine authored scene before offering Nepal playback', () => {
  const absent = availableExpeditions(MISSIONS, { findSceneByQuery: () => null });
  assert.equal(absent[0].available, false);
  assert.ok(absent.slice(1).every(({ available }) => available));
  const ready = availableExpeditions(MISSIONS, {
    findSceneByQuery: (query) => query === 'Bhote Koshi' ? { id: 'authored-scene' } : null,
  });
  assert.equal(ready[0].sceneId, 'authored-scene');
  assert.equal(ready[0].available, true);
});
