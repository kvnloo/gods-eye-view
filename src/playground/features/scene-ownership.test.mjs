import assert from 'node:assert/strict';
import test from 'node:test';
import { feature as expeditions } from './01-expeditions.js';
import { feature as timeMachine } from './02-time-machine.js';

function createHarness() {
  const nodes = [];
  const doc = {
    createElement(tagName) {
      const listeners = new Map();
      const node = {
        tagName,
        ownerDocument: doc,
        textContent: '',
        style: {},
        children: [],
        disabled: false,
        append(...children) {
          this.children.push(...children);
        },
        setAttribute() {},
        addEventListener(type, callback) {
          listeners.set(type, callback);
        },
        dispatch(type) {
          return listeners.get(type)?.();
        },
      };
      nodes.push(node);
      return node;
    },
  };
  return {
    root: { ownerDocument: doc, append() {} },
    nodes,
    button(label) {
      return nodes.find((node) => node.tagName === 'button' && node.textContent === label);
    },
  };
}

test('completed expedition does not stop another controller’s scene on close', async () => {
  const ui = createHarness();
  let running = false;
  let stops = 0;
  const sceneDirector = {
    findSceneByQuery: () => ({ id: 'nepal' }),
    get running() {
      return running;
    },
    async startScene() {
      return { started: true };
    },
    stopScene() {
      stops++;
    },
  };
  const dispose = expeditions.mount({ root: ui.root, services: { sceneDirector } });
  const nepal = ui.nodes.find((node) =>
    node.tagName === 'button' && node.children[0]?.textContent.includes('Nepal'),
  );
  await nepal.dispatch('click');
  running = true; // An unrelated scene starts after this expedition completes.
  dispose();
  assert.equal(stops, 0);
});

test('closing an active expedition cancels only its owned scene', async () => {
  const ui = createHarness();
  let running = false;
  let stops = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const sceneDirector = {
    findSceneByQuery: () => ({ id: 'nepal' }),
    get running() { return running; },
    startScene() { running = true; return pending; },
    stopScene() { stops++; running = false; },
  };
  const dispose = expeditions.mount({ root: ui.root, services: { sceneDirector } });
  const nepal = ui.nodes.find((node) =>
    node.tagName === 'button' && node.children[0]?.textContent.includes('Nepal'),
  );
  const click = nepal.dispatch('click');
  dispose();
  assert.equal(stops, 1);
  finish({ started: false, reason: 'cancelled' });
  await click;
  assert.equal(stops, 1);
});

test('Time Machine Stop and cleanup do not interrupt unowned scenes', async () => {
  const ui = createHarness();
  let running = true;
  let stops = 0;
  const sceneDirector = {
    listScenes: () => [{ id: 'nepal', title: 'Bhote Koshi', shots: 5 }],
    get running() { return running; },
    async startScene() { return { started: true }; },
    stopScene() { stops++; },
  };
  const dispose = timeMachine.mount({ root: ui.root, services: { sceneDirector } });
  ui.button('Stop').dispatch('click');
  assert.equal(stops, 0);
  running = false;
  await ui.button('Play scene').dispatch('click');
  running = true; // Independent playback after ours settles.
  dispose();
  assert.equal(stops, 0);
});

test('Time Machine still stops owned playback and unlocks Play', async () => {
  const ui = createHarness();
  let running = false;
  let stops = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const sceneDirector = {
    listScenes: () => [{ id: 'nepal', title: 'Bhote Koshi', shots: 5 }],
    get running() { return running; },
    startScene() { running = true; return pending; },
    stopScene() { stops++; running = false; },
  };
  const dispose = timeMachine.mount({ root: ui.root, services: { sceneDirector } });
  const play = ui.button('Play scene');
  const click = play.dispatch('click');
  assert.equal(play.disabled, true);
  ui.button('Stop').dispatch('click');
  assert.equal(stops, 1);
  finish({ started: false, reason: 'cancelled' });
  await click;
  assert.equal(play.disabled, false);
  dispose();
  assert.equal(stops, 1);
});
