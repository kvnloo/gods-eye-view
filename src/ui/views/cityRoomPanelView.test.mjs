import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick, shallowRef } from 'vue';
import CityRoomPanel from './panels/CityRoomPanel.vue';
import { createCityRoomSession } from '../cityRoom.js';
import { openLocalRoom } from '../../data/localRoom.js';
import {
  addCityAlternative,
  createCityDocument,
} from '../../data/cityPlanningDocument.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const doc = addCityAlternative(
  createCityDocument({
    id: 'city-elm',
    title: 'Elm street',
    reference: {
      camera: { lat: 0, lon: 0, alt: 1000, heading: 0, pitch: -90, roll: 0 },
      bounds: [-1, -1, 1, 1],
      sources: [],
      capturedAt: '2026-11-12T12:00:00.000Z',
      image,
    },
  }),
  {
    id: 'world-1',
    title: 'Pocket park',
    description: 'Shade trees and seating.',
    parameters: { kind: 'park', trees: 20, widthMeters: 3, shadePercent: 60 },
  },
);
const channels = new Set();
class Channel {
  constructor(name) {
    this.name = name;
    channels.add(this);
  }
  postMessage(data) {
    for (const other of [...channels])
      if (other !== this && other.name === this.name)
        other.onmessage?.({ data: structuredClone(data) });
  }
  close() {
    channels.delete(this);
  }
}
const timers = {
  setInterval: () => 1,
  clearInterval() {},
  setTimeout: () => 1,
  clearTimeout() {},
};
let ids = 0;
function mountTab() {
  const view = shallowRef(null);
  const storage = new Map();
  const session = createCityRoomSession({
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    openRoom: (options) =>
      openLocalRoom({ ...options, BroadcastChannel: Channel, timers }),
    randomId: () => `p-view${String(++ids).padStart(6, '0')}`,
    download() {},
    changed: () => {
      view.value = session.view({ canShare: true });
    },
    timers,
  });
  const controls = {
    ...session.controls,
    share: () => session.controls.share(doc),
  };
  view.value = session.view({ canShare: true });
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({
    render: () => h(CityRoomPanel, { room: view.value, controls }),
  });
  app.mount(root);
  return { root, controls, view, app };
}
const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await nextTick();
};

test('the panel shows roles, credits, a visible conflict and rejected writes', async () => {
  const ana = mountTab();
  const ben = mountTab();
  for (const [tab, name] of [
    [ana, 'Ana'],
    [ben, 'Ben'],
  ]) {
    tab.controls.editDraft('name', name);
    tab.controls.editDraft('room', 'elm-street');
  }
  ana.controls.share();
  await settle();
  ben.controls.join();
  await settle();
  assert.match(ben.root.textContent, /You are a viewer/);
  assert.equal(ben.root.querySelector('[data-city-room-editor]'), null);
  assert.equal(
    ben.root.querySelector('[data-city-room-edit]').disabled,
    true,
    'viewer write controls are disabled',
  );
  const benId = ben.view.value.self.actorId;
  const row = ana.root.querySelector(`[data-city-room-member="${benId}"]`);
  assert.match(row.textContent, /Ben/);
  row.querySelector('[data-city-room-set-role="contributor"]').click();
  await settle();
  assert.equal(
    ben.root.querySelector('[data-city-room]').dataset.cityRoomRole,
    'contributor',
  );
  assert.ok(ben.root.querySelector('[data-city-room-editor]'));

  const parkHead = ana.view.value.alternatives[0].heads[0].id;
  ben.controls.leave();
  ana.controls.edit(parkHead);
  ana.controls.editField('title', 'Park with fountain');
  ana.controls.save();
  ben.controls.edit(parkHead);
  ben.controls.editField('title', 'Park with play area');
  ben.controls.save();
  ben.controls.reconnect();
  await settle();
  for (const tab of [ana, ben]) {
    const card = tab.root.querySelector('[data-city-room-alternative]');
    assert.equal(card.dataset.cityRoomConflict, 'true');
    assert.match(card.textContent, /Nothing was merged/);
    assert.equal(card.querySelectorAll('[data-city-room-keep]').length, 2);
    assert.match(card.textContent, /Park with fountain/);
    assert.match(card.textContent, /Park with play area/);
  }
  assert.equal(
    ana.root.querySelector('[data-city-room]').dataset.cityRoomDigest,
    ben.root.querySelector('[data-city-room]').dataset.cityRoomDigest,
  );

  ben.controls.leave();
  ana.root
    .querySelector(
      `[data-city-room-member="${benId}"] [data-city-room-set-role="revoked"]`,
    )
    .click();
  ben.controls.newProposal();
  ben.controls.editField('title', 'Late proposal');
  ben.controls.editField('description', 'Written while offline.');
  ben.controls.save();
  ben.controls.reconnect();
  await settle();
  for (const tab of [ana, ben]) {
    const rejected = tab.root.querySelector('[data-city-room-rejected]');
    assert.match(rejected.textContent, /Late proposal/);
    assert.match(rejected.textContent, /contributor access was revoked/);
  }
  assert.match(
    ben.root.textContent,
    /contributor access was revoked\. You can still read/,
  );
  assert.doesNotMatch(
    ana.root.textContent + ben.root.textContent,
    /\blat(itude)?\b|\blon(gitude)?\b|camera|-?\d+\.\d{3,}/i,
    'no coordinates or camera are rendered',
  );
  ana.app.unmount();
  ben.app.unmount();
});
