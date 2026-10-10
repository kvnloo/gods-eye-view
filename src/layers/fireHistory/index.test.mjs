import assert from 'node:assert/strict';
import test from 'node:test';

import { createFireHistoryLayer } from './index.js';

const CAMP = {
  id: 'camp-fire-2018',
  name: 'Camp Fire',
  region: 'Butte County',
  startDate: '2018-11-08',
  endDate: '2018-11-09',
  bbox: [-121.75, 39.65, -121.3, 39.95],
};
const LAHAINA = {
  id: 'lahaina-2023',
  name: 'Lahaina Fire',
  region: 'Maui',
  startDate: '2023-08-08',
  endDate: '2023-08-09',
  bbox: [-156.75, 20.8, -156.55, 20.98],
};
const fires = (date) => [
  {
    lat: 39.8,
    lon: -121.5,
    frp: 12,
    confidence: 'n',
    acqDate: date,
    acqTime: '0100',
    instrument: 'VIIRS',
  },
  {
    lat: 39.81,
    lon: -121.51,
    frp: 3,
    confidence: 'h',
    acqDate: date,
    acqTime: '1300',
    instrument: 'MODIS',
  },
];

function fixture({ keyRequired = false } = {}) {
  const calls = [];
  const source = {
    async listEvents() {
      calls.push(['catalog']);
      return { hasKey: !keyRequired, events: [CAMP, LAHAINA] };
    },
    async getEvent(id) {
      calls.push(['event', id]);
      if (keyRequired) return { keyRequired: true, eventId: id };
      const event = id === LAHAINA.id ? LAHAINA : CAMP;
      return {
        event,
        fetchedAt: 1_800_000_000_000,
        complete: true,
        windows: [],
        fires: fires(event.startDate),
      };
    },
  };
  const rendering = {
    visible: [],
    snapshots: [],
    replays: [],
    clearCount: 0,
    destroyed: 0,
    setVisible(value) {
      this.visible.push(value);
    },
    setSnapshot(records, event) {
      this.snapshots.push({ records, event });
    },
    setReplay(replay) {
      this.replays.push(replay);
    },
    clear() {
      this.clearCount++;
    },
    getFocusSphere() {
      return { radius: 42 };
    },
    getDiagnostics() {
      return { rendererPoints: this.snapshots.at(-1)?.records.length || 0 };
    },
    destroy() {
      this.destroyed++;
    },
  };
  let frameId = 0;
  const frames = new Map();
  const focus = [];
  const layer = createFireHistoryLayer({
    source,
    createRenderer: () => rendering,
    focusSphere: (_viewer, sphere) => {
      focus.push(sphere);
      return true;
    },
    requestFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
  });
  return { layer, calls, rendering, frames, focus };
}

function runNextFrame(f, time) {
  const entry = f.frames.entries().next().value;
  assert.ok(entry, 'a replay frame is pending');
  const [id, callback] = entry;
  f.frames.delete(id);
  callback(time);
}

test('layer loads the reviewed catalog, normalizes records and publishes a presentation snapshot', async () => {
  const f = fixture();
  f.layer.init({});
  assert.deepEqual(f.rendering.visible, [false]);

  f.layer.enable();
  assert.equal(await f.layer.update(), true);

  const state = f.layer.getPresentationState();
  assert.equal(state.enabled, true);
  assert.equal(state.selectedId, CAMP.id);
  assert.equal(state.event.id, CAMP.id);
  assert.equal(state.count, 2);
  assert.equal(state.timeline.length, 2);
  assert.equal(state.complete, true);
  assert.equal(state.keyRequired, false);
  assert.equal(f.rendering.snapshots.length, 1);
  assert.equal(f.rendering.snapshots[0].records[0].index, 0);
  assert.deepEqual(f.calls, [['catalog'], ['event', CAMP.id]]);
  assert.equal(f.layer.getStats().count, 2);
  assert.equal(f.layer.getAnalystRecords()[0].eventId, CAMP.id);
});

test('event selection, focus and replay are coordinated without UI ownership', async () => {
  const f = fixture();
  f.layer.init({});
  f.layer.enable();
  await f.layer.update();

  assert.equal(await f.layer.selectEvent(LAHAINA.id, { focus: true }), true);
  assert.equal(f.layer.getPresentationState().event.id, LAHAINA.id);
  assert.equal(f.focus.length, 1);

  assert.equal(f.layer.toggleReplay(), true);
  assert.equal(f.layer.getPresentationState().replay.status, 'playing');
  assert.equal(f.frames.size, 1);

  runNextFrame(f, 1000);
  runNextFrame(f, 2000);
  const replay = f.layer.getPresentationState().replay;
  assert.ok(replay.cursorMs > replay.startMs);
  assert.ok(f.rendering.replays.length >= 3);

  assert.equal(f.layer.stepReplay(1), true);
  assert.equal(f.layer.getPresentationState().replay.status, 'playing');
  assert.equal(f.layer.resetReplay(), true);
  assert.equal(f.layer.getPresentationState().replay.status, 'idle');
  assert.equal(f.frames.size, 0);
});

test('missing FIRMS key is explicit and keeps renderer empty', async () => {
  const f = fixture({ keyRequired: true });
  f.layer.init({});
  f.layer.enable();

  assert.equal(await f.layer.update(), true);
  const state = f.layer.getPresentationState();
  assert.equal(state.keyRequired, true);
  assert.equal(state.event.id, CAMP.id);
  assert.equal(state.count, 0);
  assert.equal(f.rendering.clearCount, 1);
  assert.equal(f.layer.getStats().keyRequired, true);
});

test('disable cancels replay visibility and destroy releases the renderer', async () => {
  const f = fixture();
  f.layer.init({});
  f.layer.enable();
  await f.layer.update();
  f.layer.toggleReplay();
  assert.equal(f.frames.size, 1);

  assert.equal(f.layer.disable(), true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.layer.getPresentationState().enabled, false);
  assert.equal(f.rendering.visible.at(-1), false);

  f.layer.destroy();
  assert.equal(f.rendering.destroyed, 1);
  assert.deepEqual(f.layer.getAnalystRecords(), []);
});
