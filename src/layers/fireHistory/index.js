import {
  adaptFireHistoryRecords,
  buildFireHistoryTimeline,
  fireHistoryEventRange,
  selectFireHistoryEvent,
} from './model.js';
import {
  advanceFireReplay,
  createFireReplayState,
  fireReplayActive,
  fireReplayCounts,
  fireReplayLabel,
  pauseFireReplay,
  playFireReplay,
  resetFireReplay,
  seekFireReplay,
  setFireReplaySpeed,
} from './replay.js';

const DEFAULT_UPDATE_MS = 24 * 60 * 60_000;

const defaultRequestFrame = (callback) =>
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(() => callback(Date.now()), 16);
const defaultCancelFrame = (handle) => {
  if (typeof globalThis.cancelAnimationFrame === 'function')
    globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
};

/**
 * Historic Fires lifecycle owner. Acquisition, replay math and rendering are
 * supplied owners; this module coordinates them without importing Cesium or UI.
 */
export function createFireHistoryLayer({
  source,
  createRenderer,
  focusSphere = () => false,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  updateInterval = DEFAULT_UPDATE_MS,
} = {}) {
  if (
    typeof source?.listEvents !== 'function' ||
    typeof source?.getEvent !== 'function'
  )
    throw new TypeError('Historic fires require an archive source');
  if (typeof createRenderer !== 'function')
    throw new TypeError('Historic fires require a renderer factory');

  let viewer = null;
  let renderer = null;
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let request = null;
  let events = [];
  let selectedId = null;
  let event = null;
  let fires = [];
  let timeline = [];
  let replay = null;
  let complete = true;
  let keyRequired = false;
  let error = null;
  let lastUpdate = null;
  let frame = null;
  let lastFrameAt = 0;
  let lastNotifyAt = 0;
  const listeners = new Set();

  const replaySnapshot = () => {
    if (!replay) return null;
    const counts = fireReplayCounts(fires, replay.cursorMs);
    return Object.freeze({ ...replay, ...counts, total: fires.length });
  };

  const snapshot = () =>
    Object.freeze({
      enabled,
      loading,
      events: Object.freeze([...events]),
      selectedId,
      event,
      timeline: Object.freeze([...timeline]),
      replay: replaySnapshot(),
      count: fires.length,
      complete,
      keyRequired,
      error,
      lastUpdate,
    });

  const notify = () => {
    const value = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (cause) {
        console.warn('[Data:FireHistory] observer failed:', cause);
      }
    }
  };

  const stopReplayLoop = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    lastFrameAt = 0;
    lastNotifyAt = 0;
  };

  const applyReplay = () => {
    renderer?.setReplay(replay);
  };

  const replayTick = (time) => {
    frame = null;
    if (
      destroyed ||
      !enabled ||
      !replay ||
      replay.status !== 'playing'
    ) {
      stopReplayLoop();
      return;
    }
    const elapsed = lastFrameAt ? Math.max(0, time - lastFrameAt) : 0;
    lastFrameAt = time;
    replay = advanceFireReplay(replay, elapsed);
    applyReplay();
    if (replay.status === 'ended') {
      stopReplayLoop();
      notify();
      return;
    }
    if (!lastNotifyAt || time - lastNotifyAt >= 250) {
      lastNotifyAt = time;
      notify();
    }
    frame = requestFrame(replayTick);
  };

  const startReplayLoop = () => {
    if (frame !== null || !enabled || replay?.status !== 'playing') return;
    lastFrameAt = 0;
    lastNotifyAt = 0;
    frame = requestFrame(replayTick);
  };

  const clearEvent = () => {
    stopReplayLoop();
    event = null;
    fires = [];
    timeline = [];
    replay = null;
    complete = true;
    keyRequired = false;
    error = null;
    renderer?.clear();
  };

  const currentRequest = (controller) =>
    request === controller &&
    !controller.signal.aborted &&
    !destroyed &&
    enabled;

  async function load({ signal = null, focus = false } = {}) {
    if (!enabled || destroyed || !renderer) return false;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const abort = () => controller.abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();

    loading = true;
    error = null;
    notify();
    try {
      if (!events.length) {
        const catalog = await source.listEvents({ signal: controller.signal });
        if (!currentRequest(controller)) return false;
        events = catalog.events;
        const selected = selectFireHistoryEvent(events, selectedId);
        selectedId = selected?.id || null;
      }

      const selected = selectFireHistoryEvent(events, selectedId);
      if (!selected) {
        clearEvent();
        error = 'No registered historical fire events';
        return false;
      }
      selectedId = selected.id;

      const payload = await source.getEvent(selected.id, {
        signal: controller.signal,
      });
      if (!currentRequest(controller)) return false;

      if (payload.keyRequired) {
        stopReplayLoop();
        event = selected;
        fires = [];
        timeline = [];
        replay = createFireReplayState(selected);
        complete = false;
        keyRequired = true;
        error = null;
        renderer.clear();
        return true;
      }

      const sameEvent = event?.id === payload.event.id;
      const previousReplay = sameEvent ? replay : null;
      event = payload.event;
      fires = adaptFireHistoryRecords(payload.fires, event);
      timeline = buildFireHistoryTimeline(fires, event);
      complete = payload.complete;
      keyRequired = false;
      error = null;
      lastUpdate = payload.fetchedAt;
      const freshReplay = createFireReplayState(event, previousReplay?.speed);
      replay =
        previousReplay &&
        freshReplay &&
        previousReplay.startMs === freshReplay.startMs &&
        previousReplay.endMs === freshReplay.endMs
          ? previousReplay
          : freshReplay;
      renderer.setSnapshot(fires, event);
      applyReplay();
      if (focus) layer.focusEvent();
      return true;
    } catch (cause) {
      if (!currentRequest(controller)) return false;
      error = cause?.message || 'Historic fire archive unavailable';
      return false;
    } finally {
      signal?.removeEventListener?.('abort', abort);
      if (request === controller) {
        request = null;
        loading = false;
        notify();
      }
    }
  }

  const layer = {
    id: 'fire-history',
    name: 'Historic Fires',
    icon: '🔥',
    source: 'NASA FIRMS · ARCHIVE',
    requiresKeyId: 'firms',
    updateInterval,

    init(nextViewer) {
      if (viewer || destroyed)
        throw new Error('Historic fires layer cannot be initialized twice');
      viewer = nextViewer;
      renderer = createRenderer(nextViewer);
      renderer.setVisible(false);
    },

    enable() {
      if (destroyed) return false;
      enabled = true;
      renderer?.setVisible(true);
      notify();
      return true;
    },

    disable() {
      request?.abort();
      request = null;
      enabled = false;
      loading = false;
      stopReplayLoop();
      replay = resetFireReplay(replay);
      renderer?.setReplay(replay);
      renderer?.setVisible(false);
      notify();
      return true;
    },

    update(_viewer, options = {}) {
      return load(options);
    },

    async selectEvent(id, { focus = true } = {}) {
      const next = events.find((candidate) => candidate.id === id);
      if (!next) return false;
      if (selectedId === next.id && event?.id === next.id) {
        if (focus) layer.focusEvent();
        return true;
      }
      selectedId = next.id;
      clearEvent();
      selectedId = next.id;
      notify();
      if (!enabled) return true;
      return load({ focus });
    },

    focusEvent() {
      const sphere = renderer?.getFocusSphere?.();
      return sphere ? focusSphere(viewer, sphere) : false;
    },

    toggleReplay() {
      if (!replay || !fires.length) return false;
      if (replay.status === 'playing') {
        replay = pauseFireReplay(replay);
        stopReplayLoop();
      } else {
        replay = playFireReplay(replay);
        startReplayLoop();
      }
      applyReplay();
      notify();
      return true;
    },

    resetReplay() {
      if (!replay) return false;
      replay = resetFireReplay(replay);
      stopReplayLoop();
      applyReplay();
      notify();
      return true;
    },

    seekReplay(fraction) {
      if (!replay || !fires.length) return false;
      replay = seekFireReplay(replay, fraction);
      applyReplay();
      notify();
      return true;
    },

    seekToTick(tick) {
      if (!replay) return false;
      const time = Date.parse(String(tick || ''));
      const { startMs, endMs } = fireHistoryEventRange(event);
      if (!Number.isFinite(time) || !(endMs > startMs)) return false;
      return layer.seekReplay((time - startMs) / (endMs - startMs));
    },

    stepReplay(direction) {
      if (!timeline.length || !replay) return false;
      const ticks = timeline.map(({ date }) => Date.parse(date + 'T00:00:00Z'));
      let index = ticks.findLastIndex((time) => time <= replay.cursorMs);
      if (index < 0) index = 0;
      index = Math.max(
        0,
        Math.min(ticks.length - 1, index + Math.sign(Number(direction) || 0)),
      );
      return layer.seekToTick(new Date(ticks[index]).toISOString());
    },

    setReplaySpeed(speed) {
      const next = setFireReplaySpeed(replay, Number(speed));
      if (next === replay) return false;
      replay = next;
      notify();
      return true;
    },

    subscribe(listener, { emitCurrent = true } = {}) {
      if (destroyed || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },

    getPresentationState() {
      return snapshot();
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !event) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return fires.slice(0, limit).map((fire) => ({
        id:
          event.id +
          '-' +
          String(fire.index).padStart(5, '0'),
        eventId: event.id,
        eventName: event.name,
        lat: Number.isFinite(fire.lat) ? fire.lat : null,
        lon: Number.isFinite(fire.lon) ? fire.lon : null,
        timeMs: Number.isFinite(fire.acqMs) ? fire.acqMs : null,
        progress: Number.isFinite(fire.progress) ? fire.progress : null,
        frpMw: Number.isFinite(fire.frp) ? fire.frp : null,
        confidence: Number.isFinite(fire.confidence)
          ? fire.confidence
          : null,
        sensor: fire.sensor || null,
        satellite: fire.satellite || null,
      }));
    },

    getStats() {
      const counts =
        replay && fireReplayActive(replay)
          ? fireReplayCounts(fires, replay.cursorMs)
          : null;
      return {
        count: fires.length,
        countLabel: counts
          ? String(counts.shown) + ' / ' + String(fires.length)
          : undefined,
        lastUpdate,
        loading,
        keyRequired,
        error,
        status: complete ? undefined : event ? 'partial' : undefined,
        loadingLabel:
          keyRequired
            ? 'KEY REQUIRED'
            : replay && fireReplayActive(replay)
              ? fireReplayLabel(replay)
              : event
                ? event.startDate + ' → ' + event.endDate
                : '',
      };
    },

    getDiagnostics() {
      return {
        enabled,
        loading,
        requestPending: Boolean(request),
        replayFrameActive: frame !== null,
        selectedId,
        ...renderer?.getDiagnostics?.(),
      };
    },

    destroy() {
      if (destroyed) return;
      request?.abort();
      request = null;
      stopReplayLoop();
      destroyed = true;
      enabled = false;
      listeners.clear();
      renderer?.destroy();
      renderer = null;
      viewer = null;
      events = [];
      selectedId = null;
      event = null;
      fires = [];
      timeline = [];
      replay = null;
    },
  };

  return layer;
}

export { createFireHistorySource } from './source.js';
export * from './model.js';
export * from './replay.js';
