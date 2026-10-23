export const CAMERA_REFINEMENT_SETTLE_MS = 180;

/**
 * Track Cesium camera motion as a generation-safe refinement gate.
 *
 * Camera/input work owns the realtime lane. Optional refinement may resume only
 * after the camera has been quiet for `settleMs`. Every new motion start
 * increments the generation so async work can prove it still belongs to the
 * current viewport before publishing.
 */
export function createCameraMotionGate({
  settleMs = CAMERA_REFINEMENT_SETTLE_MS,
  setTimeoutImpl = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutImpl = (id) => globalThis.clearTimeout(id),
} = {}) {
  let settled = true;
  let moving = false;
  let generation = 0;
  let settleTimer = null;
  let detachCamera = () => {};
  let destroyed = false;
  const listeners = new Set();

  const snapshot = () => ({ settled, moving, generation });

  function notify(reason) {
    const state = snapshot();
    for (const listener of [...listeners]) listener(state, reason);
  }

  function clearSettleTimer() {
    if (settleTimer !== null) clearTimeoutImpl(settleTimer);
    settleTimer = null;
  }

  function onMoveStart() {
    if (destroyed) return;
    clearSettleTimer();
    generation += 1;
    moving = true;
    settled = false;
    notify('motion-start');
  }

  function onMoveEnd() {
    if (destroyed) return;
    clearSettleTimer();
    const candidateGeneration = generation;
    settleTimer = setTimeoutImpl(() => {
      settleTimer = null;
      if (destroyed || generation !== candidateGeneration) return;
      moving = false;
      settled = true;
      notify('settled');
    }, settleMs);
  }

  function detach() {
    clearSettleTimer();
    detachCamera();
    detachCamera = () => {};
    moving = false;
    settled = true;
  }

  return {
    attach(camera) {
      detach();
      if (destroyed || !camera) return;
      const offStart = camera.moveStart?.addEventListener?.(onMoveStart);
      const offEnd = camera.moveEnd?.addEventListener?.(onMoveEnd);
      detachCamera = () => {
        if (typeof offStart === 'function') offStart();
        if (typeof offEnd === 'function') offEnd();
      };
    },

    isSettled() {
      return settled;
    },

    getGeneration() {
      return generation;
    },

    isCurrent(candidateGeneration) {
      return candidateGeneration === generation;
    },

    snapshot,

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach();
      listeners.clear();
    },
  };
}
