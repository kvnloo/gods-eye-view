import assert from 'node:assert/strict';
import test from 'node:test';

import { ShareRestoration } from './shareRestoration.js';

function installBrowserGlobals(t) {
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    CustomEvent: globalThis.CustomEvent,
  };
  let frameId = 0;
  globalThis.window = new EventTarget();
  globalThis.document = { getElementById: () => null };
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    queueMicrotask(() => callback(0));
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, options = {}) {
        super(type);
        this.detail = options.detail;
      }
    };
  }
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
}

function createOwner(savedState, notices) {
  const owner = new ShareRestoration({
    viewer: { canvas: new EventTarget() },
    navigation: {
      _beginDeferredNavigation: () => 1,
      _stampNavigation() {},
    },
    syncShareState() {},
    syncModels3d() {},
    showStatus: (message) => notices.push(message),
    feedback: {},
    updateFeedback() {},
  });
  owner.attachLinks({
    parseInitialHash: () => savedState,
  });
  return owner;
}

async function flushDeferredNotice() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('invalid shared layer state surfaces only after initial restore settles', async (t) => {
  installBrowserGlobals(t);
  const notices = [];
  const owner = createOwner(
    {
      latitude: 30,
      longitude: -97,
      layerStateInvalid: true,
    },
    notices,
  );

  owner.start();
  assert.deepEqual(notices, []);

  owner._settleInitialShareRestore({
    status: 'settled',
    share: { camera: 'skipped' },
    layers: [],
  });
  await flushDeferredNotice();

  assert.deepEqual(notices, ['Shared layer selection could not be restored']);
  owner.destroy();
});

test('valid layer state stays quiet and disposal suppresses a pending invalid notice', async (t) => {
  installBrowserGlobals(t);

  const validNotices = [];
  const valid = createOwner(
    { latitude: 30, longitude: -97, layerStateInvalid: false },
    validNotices,
  );
  valid.start();
  valid._settleInitialShareRestore({
    status: 'settled',
    share: { camera: 'skipped' },
    layers: [],
  });
  await flushDeferredNotice();
  assert.deepEqual(validNotices, []);
  valid.destroy();

  const disposedNotices = [];
  const disposed = createOwner(
    { latitude: 30, longitude: -97, layerStateInvalid: true },
    disposedNotices,
  );
  disposed.start();
  disposed.destroy();
  await flushDeferredNotice();
  assert.deepEqual(disposedNotices, []);
});

test('share-follow startup notices ignore superseded tracking results', async (t) => {
  installBrowserGlobals(t);
  const cover = new EventTarget();
  globalThis.document = {
    getElementById: (id) => (id === 'loading-screen' ? cover : null),
  };
  const priorGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  t.after(() => {
    if (priorGetComputedStyle === undefined)
      delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = priorGetComputedStyle;
  });

  const notices = [];
  const owner = createOwner(null, notices);
  owner.start();
  owner._handleShareTrackingRestoreStatus({
    classification: 'expired',
    label: 'flight',
    targetId: 'first',
  });
  await flushDeferredNotice();
  assert.deepEqual(notices, []);

  owner._handleShareTrackingRestoreStatus({
    classification: 'source-unavailable',
    label: 'flight',
    targetId: 'second',
  });
  await flushDeferredNotice();
  assert.deepEqual(notices, []);

  cover.dispatchEvent(new Event('transitionend'));
  assert.deepEqual(notices, [
    'Shared flight could not be restored — feed unavailable',
  ]);
  owner.destroy();
});

// Keep the production owner and UiLifetime intact: only the browser clock,
// cover and external share application are controlled by this fixture.
function scheduledOwner(t, seam, visibility = 'visible') {
  const keys = ['window', 'document', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame'];
  const prior = new Map(keys.map((key) => [key,
    Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cover = new EventTarget();
  const frames = new Map();
  let nextFrame = 0;
  const notices = [];
  let applyState;
  let completed = 0;
  const applied = new Promise((resolve) => { applyState = resolve; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById: (id) => id === 'loading-screen' && visibility !== 'absent' ? cover : null,
  };
  globalThis.getComputedStyle = () => ({ visibility });
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const owner = createOwner({ layerStateInvalid: seam === 'invalid' }, notices);
  owner.navigation._reassertNavigationHandoff = () => true;
  owner.shareLinkManager.applyState = () => applied;
  owner.shareLinkManager.completeInitialRestore = () => { completed += 1; };
  t.after(() => {
    owner.destroy();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  owner.start();
  const terminal = (classification = 'expired', targetId = 'first') =>
    owner._handleShareTrackingRestoreStatus({ classification, targetId, label: 'flight' });
  if (seam === 'follow') terminal();
  return {
    owner, cover, notices, frames, terminal,
    message: seam === 'invalid' ? 'Shared layer selection could not be restored' : 'Shared flight follow expired',
    async settle(expectedFrames = 1) {
      t.mock.timers.tick(1500);
      assert.equal(completed, 0, 'restoration must still await applyState');
      assert.equal(frames.size, 0, 'neither seam may schedule before restoration');
      assert.deepEqual(notices, []);
      applyState({ camera: 'skipped' });
      await owner.initialRestorePromise;
      await flushDeferredNotice();
      assert.equal(completed, 1, 'the production restore transaction completed');
      assert.equal(frames.size, expectedFrames, 'presentation is deferred to an owned frame');
      assert.deepEqual(notices, []);
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

for (const seam of ['invalid', 'follow']) {
  for (const visibility of ['absent', 'hidden']) {
    test(`${seam}: restored notice waits for its frame with ${visibility} cover`, async (t) => {
      const h = scheduledOwner(t, seam, visibility);
      await h.settle();
      h.frame();
      assert.deepEqual(h.notices, [h.message]);
      t.mock.timers.tick(1000);
      h.cover.dispatchEvent(new Event('transitionend'));
      assert.deepEqual(h.notices, [h.message]);
    });
  }
  for (const trigger of ['transition', 'fallback']) {
    test(`${seam}: visible cover releases once through ${trigger} and cancels its peer`, async (t) => {
      const h = scheduledOwner(t, seam);
      await h.settle();
      h.frame();
      assert.deepEqual(h.notices, []);
      assert.equal(h.owner._lifetime.removers.size, 1);
      assert.equal(h.owner._lifetime.timers.size, 1);
      t.mock.timers.tick(999);
      assert.deepEqual(h.notices, [], 'fallback must retain the full 1000ms wait');
      if (trigger === 'transition') h.cover.dispatchEvent(new Event('transitionend'));
      else t.mock.timers.tick(1);
      assert.deepEqual(h.notices, [h.message]);
      assert.equal(h.owner._lifetime.removers.size, 0);
      assert.equal(h.owner._lifetime.timers.size, 0);
      h.cover.dispatchEvent(new Event('transitionend'));
      t.mock.timers.tick(1000);
      assert.deepEqual(h.notices, [h.message], 'no replay from the other completion path');
    });
  }
  for (const phase of ['restore', 'frame', 'cover']) {
    test(`${seam}: disposal at ${phase} cancels deferred presentation`, async (t) => {
      const h = scheduledOwner(t, seam);
      if (phase !== 'restore') await h.settle();
      if (phase === 'cover') h.frame();
      h.owner.destroy();
      await flushDeferredNotice();
      h.frame();
      h.cover.dispatchEvent(new Event('transitionend'));
      t.mock.timers.tick(3000);
      assert.deepEqual(h.notices, []);
      assert.equal(h.frames.size, 0);
      assert.equal(h.owner._lifetime.removers.size, 0);
      assert.equal(h.owner._lifetime.timers.size, 0);
    });
  }
}

for (const phase of ['frame', 'cover']) {
  test(`new acquisition revokes a terminal notice at ${phase} without losing its own status`, async (t) => {
    const h = scheduledOwner(t, 'follow');
    await h.settle();
    if (phase === 'cover') h.frame();
    h.terminal('pending', 'second');
    h.terminal('source-unavailable', 'first');
    h.frame();
    if (phase === 'frame') {
      assert.equal(h.owner._lifetime.removers.size, 0);
      assert.equal(h.owner._lifetime.timers.size, 0);
    }
    h.cover.dispatchEvent(new Event('transitionend'));
    t.mock.timers.tick(1000);
    assert.deepEqual(h.notices, ['ACQUIRING']);
    h.terminal('followed', 'second');
    h.frame();
    assert.deepEqual(h.notices, ['ACQUIRING'], 'successful follow adds no terminal error');
  });
}

for (const trigger of ['transition', 'fallback']) {
  test(`both seams share cover scheduling without invalidating independent notices: ${trigger}`, async (t) => {
    const h = scheduledOwner(t, 'invalid');
    h.terminal();
    await h.settle(2);
    h.frame();
    h.terminal('source-unavailable', 'second');
    h.frame();
    assert.deepEqual(h.notices, []);
    if (trigger === 'transition') h.cover.dispatchEvent(new Event('transitionend'));
    else t.mock.timers.tick(1000);
    assert.deepEqual(h.notices, [h.message,
      'Shared flight could not be restored — feed unavailable']);
    h.cover.dispatchEvent(new Event('transitionend'));
    t.mock.timers.tick(1000);
    assert.equal(h.notices.length, 2, 'independent layer notice survives, stale follow notice does not');
  });
}
