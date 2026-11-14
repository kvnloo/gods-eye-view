import assert from 'node:assert/strict';
import test from 'node:test';
import { NavigationController } from './navigationController.js';
import { ShareRestoration } from './shareRestoration.js';

function navigation() {
  const tracking = Object.fromEntries(
    [
      'flightsLayer',
      'militaryFlightsLayer',
      'satellitesLayer',
      'aisLiveVesselsLayer',
      'militaryAwarenessLayer',
      'rocketLaunchesLayer',
    ].map((name) => [name, {}]),
  );
  return new NavigationController({
    viewer: { camera: { cancelFlight() {}, lookAtTransform() {} } },
    tracking,
    interruptCameraMotion() {},
    isCockpitActive: () => false,
    clearLocation() {},
    cancelShareSelection: () => false,
    getDataManager: () => null,
    stopOrbit() {},
    showToast() {},
  });
}

test('navigation generations belong to their owner and teardown closes both entry paths', () => {
  const first = navigation();
  const second = navigation();
  const a = first._beginDeferredNavigation();
  const b = second._beginDeferredNavigation();
  first._stampNavigation();
  assert.equal(first._reassertNavigationHandoff(a), false);
  assert.equal(second._reassertNavigationHandoff(b), true);
  let flights = 0;
  second.stop();
  assert.equal(second._beginDeferredNavigation(), false);
  assert.equal(
    second._runExplicitNavigation('location', () => {
      flights += 1;
    }),
    false,
  );
  assert.equal(flights, 0);
  const generation = second._navigationGeneration;
  second.destroy();
  assert.equal(second._navigationGeneration, generation + 1);
});

test('share teardown settles its promise, removes gestures and rejects a retained timer callback', async (t) => {
  const prior = {
    window: globalThis.window,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timers = new Map();
  let timerId = 0;
  globalThis.window = new EventTarget();
  globalThis.setTimeout = (fn) => {
    timers.set(++timerId, fn);
    return timerId;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  t.after(() => Object.assign(globalThis, prior));
  const canvas = new EventTarget();
  let stamps = 0;
  let applies = 0;
  const owner = new ShareRestoration({
    viewer: { canvas },
    navigation: {
      _beginDeferredNavigation: () => 1,
      _reassertNavigationHandoff: () => true,
      _stampNavigation: () => {
        stamps += 1;
      },
    },
    syncShareState() {},
    syncModels3d() {},
    showStatus() {},
    feedback: {},
    updateFeedback() {},
  });
  owner.attachLinks({
    parseInitialHash: () => ({ latitude: 30, longitude: -97 }),
    applyState: async () => {
      applies += 1;
      return { camera: 'applied' };
    },
    completeInitialRestore() {},
  });
  owner.start();
  const retained = [...timers.values()][0];
  canvas.dispatchEvent(new Event('wheel'));
  assert.equal(stamps, 1);
  owner.destroy();
  assert.equal((await owner.initialRestorePromise).status, 'destroyed');
  assert.equal(timers.size, 0);
  canvas.dispatchEvent(new Event('wheel'));
  retained();
  await Promise.resolve();
  assert.equal(stamps, 1);
  assert.equal(applies, 0);
});

test('visual teardown restores owned fog and aircraft sensor state once', async (t) => {
  const { VisualSettings } = await import('./visualSettings.js');
  const priorDocument = globalThis.document;
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
  };
  t.after(() => {
    globalThis.document = priorDocument;
  });
  const calls = [];
  const viewer = { scene: { fog: { enabled: false } } };
  const owner = new VisualSettings({
    viewer,
    elements: {},
    operations: {},
    services: {
      governorRequestRender() {},
      holdContinuousRender() {},
      releaseContinuousRender() {},
    },
    readDataManager: () => ({ setLayerParams: (...args) => calls.push(args) }),
  });
  owner._irBoostActive = true;
  owner._irFogWasEnabled = true;
  owner.releaseIrBoost();
  owner.releaseIrBoost();
  assert.equal(viewer.scene.fog.enabled, true);
  assert.deepEqual(calls, [
    ['flights', { irBoost: false }],
    ['military', { irBoost: false }],
  ]);
  assert.equal(owner._irBoostActive, false);
  owner.destroy();
});

test('passive share restore does not overwrite the recipient Display preferences during map switch', async (t) => {
  const { VisualSettings } = await import('./visualSettings.js');
  const { DISPLAY_PREFERENCES_KEY } = await import('./displayPreferences.js');
  const previousStorage = globalThis.localStorage;
  const original = JSON.stringify({
    version: 1,
    hudVariant: 'tactical',
    mapStack: 'esri-hybrid',
    sonar: { enabled: false },
  });
  let stored = original;
  let writes = 0;
  globalThis.localStorage = {
    getItem(key) {
      assert.equal(key, DISPLAY_PREFERENCES_KEY);
      return stored;
    },
    setItem(key, value) {
      assert.equal(key, DISPLAY_PREFERENCES_KEY);
      stored = value;
      writes += 1;
    },
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  let completeMap;
  const mapSwitch = new Promise((resolve) => {
    completeMap = resolve;
  });
  const owner = Object.create(VisualSettings.prototype);
  Object.assign(owner, {
    services: {},
    _localPreferencesReady: true,
    activeStyle: 'normal',
    stages: {},
    _setDetectionFade() {},
    _setScope() {},
    _setMapStack: () => mapSwitch,
    _readShareState: () => ({
      bloomEnabled: false,
      sharpenEnabled: false,
      options: { hudVariant: 'cyber', mapStack: 'osm' },
    }),
    _syncShareState() {
      this.persistLocalPreferences();
    },
  });

  const restore = owner.restoreShareState({ mapStack: 'osm' });
  assert.equal(writes, 0);
  completeMap();
  await restore;
  assert.equal(writes, 0);
  assert.equal(stored, original);

  // Explicit changes after restoration may still replace the saved snapshot.
  owner._syncShareState();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(stored).mapStack, 'osm');
});
