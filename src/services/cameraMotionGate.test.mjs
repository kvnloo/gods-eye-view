import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMERA_REFINEMENT_SETTLE_MS,
  createCameraMotionGate,
} from './cameraMotionGate.js';

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeoutImpl(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeoutImpl(id) {
      pending.delete(id);
    },
    pending,
    flush() {
      const entries = [...pending.values()];
      pending.clear();
      for (const { fn } of entries) fn();
    },
  };
}

function event() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
    size: () => listeners.size,
  };
}

test('camera motion opens a new generation and refinement resumes only after quiet', () => {
  const timers = manualTimers();
  const gate = createCameraMotionGate({
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  const moveStart = event();
  const moveEnd = event();
  gate.attach({ moveStart, moveEnd });

  assert.deepEqual(gate.snapshot(), {
    settled: true,
    moving: false,
    generation: 0,
  });

  moveStart.raise();
  assert.deepEqual(gate.snapshot(), {
    settled: false,
    moving: true,
    generation: 1,
  });
  moveEnd.raise();
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, CAMERA_REFINEMENT_SETTLE_MS);
  assert.equal(gate.isSettled(), false);

  timers.flush();
  assert.deepEqual(gate.snapshot(), {
    settled: true,
    moving: false,
    generation: 1,
  });
});

test('new motion invalidates the prior generation and its pending settle', () => {
  const timers = manualTimers();
  const gate = createCameraMotionGate({
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  const moveStart = event();
  const moveEnd = event();
  gate.attach({ moveStart, moveEnd });

  moveStart.raise();
  const firstGeneration = gate.getGeneration();
  moveEnd.raise();
  moveStart.raise();

  assert.equal(gate.isCurrent(firstGeneration), false);
  assert.equal(gate.getGeneration(), firstGeneration + 1);
  assert.equal(timers.pending.size, 0);
  assert.equal(gate.isSettled(), false);
});

test('reattach and destroy release camera listeners and timers', () => {
  const timers = manualTimers();
  const gate = createCameraMotionGate({
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  const first = { moveStart: event(), moveEnd: event() };
  const second = { moveStart: event(), moveEnd: event() };

  gate.attach(first);
  assert.equal(first.moveStart.size(), 1);
  gate.attach(second);
  assert.equal(first.moveStart.size(), 0);
  assert.equal(second.moveStart.size(), 1);

  second.moveStart.raise();
  second.moveEnd.raise();
  assert.equal(timers.pending.size, 1);
  gate.destroy();
  assert.equal(second.moveStart.size(), 0);
  assert.equal(timers.pending.size, 0);
});
