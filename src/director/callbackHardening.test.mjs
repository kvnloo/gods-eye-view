import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInteractionSession,
  createPlaybackClock,
  playSceneQueue,
} from './playback.js';

const noop = async () => {};
const phases = Object.fromEntries(
  [
    'selectShot',
    'applyVisual',
    'applyLayers',
    'travel',
    'settle',
    'hold',
    'completeShot',
  ].map((name) => [name, noop]),
);

function silenceWarnings(t) {
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => {
    console.warn = warn;
  });
}

test('clock subscribe returns an unsubscribe handle when the immediate observer throws', (t) => {
  silenceWarnings(t);
  const clock = createPlaybackClock({
    isRunning: () => false,
    timingForShot: () => ({ shotIndex: 0, totalSec: 10 }),
    onProgress() {},
  });
  const scene = { id: 's1', shots: [{ id: 'a' }] };
  clock.publish(scene, scene.shots[0], 1);

  let calls = 0;
  let unsubscribe;
  assert.doesNotThrow(() => {
    unsubscribe = clock.subscribe(() => {
      calls += 1;
      throw new Error('listener failed');
    });
  });
  assert.equal(typeof unsubscribe, 'function');

  clock.publish(scene, scene.shots[0], 2);
  assert.equal(calls, 2);
  unsubscribe();
  clock.publish(scene, scene.shots[0], 3);
  assert.equal(calls, 2);
  clock.destroy();
});

test('final release failure cannot replace the shot phase failure', async (t) => {
  silenceWarnings(t);
  const scene = { id: 's1', title: 'One', shots: [{ id: 'a' }] };
  let releases = 0;
  const adapter = {
    ...phases,
    travel: async () => {
      throw new Error('travel failed');
    },
    releaseScene: async () => {
      releases += 1;
      throw new Error('release failed');
    },
  };

  await assert.rejects(
    playSceneQueue([{ scene, shot: scene.shots[0] }], {
      token: { cancelled: false },
      adapter,
    }),
    /travel failed/,
  );
  assert.equal(releases, 1);
});

test('a release failure between scenes is not retried during final cleanup', async () => {
  const a = { id: 'a', title: 'A', shots: [{ id: 'a1' }] };
  const b = { id: 'b', title: 'B', shots: [{ id: 'b1' }] };
  const released = [];
  const adapter = {
    ...phases,
    releaseScene: async (scene) => {
      released.push(scene.id);
      throw new Error('release failed');
    },
  };

  await assert.rejects(
    playSceneQueue(
      [
        { scene: a, shot: a.shots[0] },
        { scene: b, shot: b.shots[0] },
      ],
      { token: { cancelled: false }, adapter },
    ),
    /release failed/,
  );
  assert.deepEqual(released, ['a']);
});

test('a changed observer throwing at action start cannot strand the session busy', async (t) => {
  silenceWarnings(t);
  let fail = true;
  let executions = 0;
  const session = createInteractionSession({
    execute: () => {
      executions += 1;
      return true;
    },
    changed(state) {
      if (fail && state.busy) throw new Error('changed failed');
    },
  });
  session.activate([{ id: 'a' }]);

  assert.equal(await session.dispatch('a'), true);
  assert.equal(session.getState().busy, false);
  fail = false;
  assert.equal(await session.dispatch('a'), true);
  assert.equal(executions, 2);
});

test('a changed observer throwing at action end cannot reject completed work', async (t) => {
  silenceWarnings(t);
  let executions = 0;
  const session = createInteractionSession({
    execute: () => {
      executions += 1;
      return true;
    },
    changed(state) {
      if (state.active && !state.busy && state.selected === 'a') {
        throw new Error('changed failed');
      }
    },
  });
  session.activate([{ id: 'a' }]);

  assert.equal(await session.dispatch('a'), true);
  assert.equal(executions, 1);
  assert.deepEqual(session.getState(), {
    active: true,
    busy: false,
    selected: 'a',
    count: 1,
  });
});

test('clear and activate remain usable when the changed observer always throws', (t) => {
  silenceWarnings(t);
  const session = createInteractionSession({
    execute: () => true,
    changed() {
      throw new Error('changed failed');
    },
  });

  assert.doesNotThrow(() => session.activate([{ id: 'a' }]));
  assert.equal(session.getState().active, true);
  assert.doesNotThrow(() => session.clear());
  assert.deepEqual(session.getState(), {
    active: false,
    busy: false,
    selected: null,
    count: 0,
  });
});
