import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_CONTROLS_STORAGE_KEY,
  DECK_LOOK_FULL_ALTITUDE_M,
  DECK_LOOK_MIN_ALTITUDE_M,
  DECK_LOOK_MIN_SCALE,
  deckLookSensitivityScale,
  readDeckControlsEnabled,
  writeDeckControlsEnabled,
  initDeckControls,
} from './deckControls.js';
import {
  _resetRenderGovernorForTest,
  getRenderGovernorDiagnostics,
} from './renderGovernor.js';

test('deck look sensitivity is lowest near the ground and full at regional altitude', () => {
  assert.equal(deckLookSensitivityScale(DECK_LOOK_MIN_ALTITUDE_M), DECK_LOOK_MIN_SCALE);
  assert.equal(deckLookSensitivityScale(DECK_LOOK_FULL_ALTITUDE_M), 1);
  assert.ok(deckLookSensitivityScale(2_000) < deckLookSensitivityScale(40_000));
  assert.ok(deckLookSensitivityScale(40_000) < deckLookSensitivityScale(DECK_LOOK_FULL_ALTITUDE_M));
});

test('deck look sensitivity clamps below min and above full altitude', () => {
  assert.equal(deckLookSensitivityScale(0), DECK_LOOK_MIN_SCALE);
  assert.equal(deckLookSensitivityScale(-100), DECK_LOOK_MIN_SCALE);
  assert.equal(deckLookSensitivityScale(DECK_LOOK_FULL_ALTITUDE_M + 50_000), 1);
});

test('deck controls slider preference prefers stored value over env default', () => {
  const storage = new Map();
  const fake = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  };
  assert.equal(readDeckControlsEnabled(fake, '0'), false);
  assert.equal(readDeckControlsEnabled(fake, '1'), true);
  fake.setItem(DECK_CONTROLS_STORAGE_KEY, '1');
  assert.equal(readDeckControlsEnabled(fake, '0'), true);
  fake.setItem(DECK_CONTROLS_STORAGE_KEY, '0');
  assert.equal(readDeckControlsEnabled(fake, '1'), false);
});

test('writeDeckControlsEnabled persists 1/0 and survives read-back', () => {
  const storage = new Map();
  const fake = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  };
  writeDeckControlsEnabled(true, fake);
  assert.equal(fake.getItem(DECK_CONTROLS_STORAGE_KEY), '1');
  assert.equal(readDeckControlsEnabled(fake, '0'), true);
  writeDeckControlsEnabled(false, fake);
  assert.equal(fake.getItem(DECK_CONTROLS_STORAGE_KEY), '0');
  assert.equal(readDeckControlsEnabled(fake, '1'), false);
});

test('gamepad loss releases render ownership and pointer lock before disconnect event', () => {
  _resetRenderGovernorForTest();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const pad = { connected: true, axes: [0.5, 0, 0, 0], buttons };
  let pads = [pad];
  let frame = null;
  const listeners = new Map();
  const classNames = new Set();
  const documentRef = {
    pointerLockElement: null,
    body: {
      appendChild() {},
      classList: {
        contains: (name) => classNames.has(name),
        toggle(name, active) {
          if (active) classNames.add(name);
          else classNames.delete(name);
        },
        remove: (name) => classNames.delete(name),
      },
    },
    createElement: () => ({ hidden: true, setAttribute() {}, remove() {} }),
    getElementById: () => null,
    exitPointerLock() { this.pointerLockElement = null; },
  };
  const canvas = {
    addEventListener() {},
    removeEventListener() {},
    requestPointerLock() {
      documentRef.pointerLockElement = canvas;
      return Promise.resolve();
    },
  };
  const viewer = {
    scene: { canvas, screenSpaceCameraController: { enableInputs: true } },
    camera: {
      positionCartographic: { height: 2_000 },
      moveForward() {},
      moveRight() {},
      rotateRight() {},
      lookUp() {},
      zoomIn() {},
      zoomOut() {},
    },
  };
  const previous = new Map();
  const setGlobal = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  let dispose;
  try {
    setGlobal('document', documentRef);
    setGlobal('window', {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name),
    });
    setGlobal('navigator', { getGamepads: () => pads });
    setGlobal('localStorage', { getItem: () => null, setItem() {} });
    setGlobal('requestAnimationFrame', (callback) => { frame = callback; return 1; });
    setGlobal('cancelAnimationFrame', () => { frame = null; });

    const tick = () => {
      const next = frame;
      assert.equal(typeof next, 'function');
      frame = null;
      next();
    };
    dispose = initDeckControls(viewer, { activeStyle: 'normal' });

    tick();
    assert.deepEqual(getRenderGovernorDiagnostics().holds, ['deck-controls']);
    assert.equal(documentRef.pointerLockElement, canvas);

    pads = [];
    tick(); // Browser has not dispatched gamepaddisconnected yet.
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    assert.equal(documentRef.pointerLockElement, null);
    assert.equal(classNames.has('deck-controls-active'), false);

    pads = [pad];
    tick();
    assert.deepEqual(getRenderGovernorDiagnostics().holds, ['deck-controls']);
    assert.equal(documentRef.pointerLockElement, canvas);

    pads = [];
    listeners.get('gamepaddisconnected')();
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    assert.equal(documentRef.pointerLockElement, null);
  } finally {
    try {
      dispose?.();
    } finally {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      _resetRenderGovernorForTest();
    }
  }
});
