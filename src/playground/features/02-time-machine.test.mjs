import assert from 'node:assert/strict';
import test from 'node:test';
import { clampSceneProgress, playableScenes } from './02-time-machine.js';

test('scene seek clamps arbitrary numeric input to [0, 1]', () => {
  assert.equal(clampSceneProgress(1.2), 1);
  assert.equal(clampSceneProgress(-2), 0);
  assert.equal(clampSceneProgress('0.5'), 0.5);
  assert.equal(clampSceneProgress('not-a-number'), 0);
  assert.equal(clampSceneProgress(Infinity), 0);
});

test('time machine only offers nonempty authored scenes', () => {
  const scenes = playableScenes({ listScenes: () => [
    { id: 'nepal', title: 'Bhote Koshi', shots: 14 },
    { id: 'empty', title: 'Empty', shots: 0 },
    { id: 23, title: 'Bad', shots: 1 },
  ]});
  assert.deepEqual(scenes.map((scene) => scene.id), ['nepal']);
  assert.deepEqual(playableScenes(null), []);
});
