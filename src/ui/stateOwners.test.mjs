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
    searchInput: null,
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

test('render quality URL override is ephemeral while explicit Display choice persists', async (t) => {
  const { VisualSettings } = await import('./visualSettings.js');
  const priorDocument = globalThis.document;
  const priorStorage = globalThis.localStorage;
  const priorLocation = globalThis.location;
  const qualityNames = ['performance', 'balanced', 'high'];
  const buttons = qualityNames.map((name) => {
    const classes = new Set(name === 'balanced' ? ['active'] : []);
    return {
      dataset: { renderQuality: name },
      classList: {
        toggle(value, active) {
          if (active) classes.add(value);
          else classes.delete(value);
        },
        contains: (value) => classes.has(value),
      },
      setAttribute(name, value) {
        this[name] = value;
      },
    };
  });
  const stored = new Map([['gev:render-quality:v1', 'high']]);
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
    querySelectorAll: (selector) =>
      selector === '[data-render-quality]' ? buttons : [],
  };
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  globalThis.location = { search: '?quality=performance' };
  t.after(() => {
    globalThis.document = priorDocument;
    if (priorStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorStorage;
    if (priorLocation === undefined) delete globalThis.location;
    else globalThis.location = priorLocation;
  });

  let renders = 0;
  const viewer = {
    resolutionScale: 0.6,
    scene: {
      msaaSamples: 1,
      fog: { enabled: false },
      requestRender: () => {
        renders += 1;
      },
    },
  };
  const owner = new VisualSettings({
    viewer,
    elements: {},
    operations: {},
    services: {
      governorRequestRender() {},
      holdContinuousRender() {},
      releaseContinuousRender() {},
    },
    readDataManager: () => ({ setLayerParams() {} }),
  });

  assert.equal(owner._renderQualityPreference, 'performance');
  assert.equal(stored.get('gev:render-quality:v1'), 'high');
  assert.equal(buttons[0].classList.contains('active'), true);
  assert.equal(buttons[0]['aria-checked'], 'true');

  assert.equal(owner._setRenderQuality('balanced'), true);
  assert.equal(viewer.scene.msaaSamples, 2);
  assert.equal(viewer.resolutionScale, 0.85);
  assert.equal(stored.get('gev:render-quality:v1'), 'balanced');
  assert.equal(buttons[1].classList.contains('active'), true);
  assert.equal(buttons[1]['aria-checked'], 'true');
  assert.equal(renders, 1);
  assert.equal(owner._setRenderQuality('ultra'), false);
  assert.equal(stored.get('gev:render-quality:v1'), 'balanced');
  owner.destroy();
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
