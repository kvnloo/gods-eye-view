import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityBuilder } from './cityBuilder.js';
import { createPlanningConceptGenerator } from '../data/planningConceptGenerator.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const reference = {
  camera: { lat: 0, lon: 0, alt: 1000, heading: 0, pitch: -90, roll: 0 },
  bounds: [-1, -1, 1, 1],
  sources: [],
  capturedAt: '2026-11-10T12:00:00.000Z',
  image,
};
function harness(extra = {}) {
  let view,
    launcher,
    saved = null,
    calls = 0,
    exported;
  const controls = createCityBuilder({
    publish: (v) => {
      view = v;
    },
    offerLauncher: (v) => {
      launcher = v;
    },
    captureReference: async () => reference,
    storage: {
      getItem: () => saved,
      setItem: (_k, v) => {
        saved = v;
      },
    },
    generator: (options) => ({
      generate: async (...args) => {
        calls++;
        return createPlanningConceptGenerator({
          ...options,
          now: () => reference.capturedAt,
        }).generate(...args);
      },
    }),
    download: (text) => {
      exported = text;
    },
    uid: () => 'test-project',
    ...extra,
  });
  return {
    controls,
    get view() {
      return view;
    },
    get saved() {
      return saved;
    },
    get calls() {
      return calls;
    },
    get launcher() {
      return launcher;
    },
    get exported() {
      return exported;
    },
  };
}
function author(h, title = 'Pocket park') {
  h.controls.editField('title', title);
  h.controls.editField('description', 'Add shade and public seating.');
  h.controls.saveAlternative();
}
test('full controller journey never generates except Imagine; history, export and reload round trip', async () => {
  const h = harness();
  assert.ok(h.launcher);
  assert.equal(h.view, null);
  h.controls.open();
  await h.controls.start({ title: 'Public block' });
  assert.equal(h.view.city.reference.image, image);
  author(h);
  h.controls.newAlternative();
  author(h, 'Protected lane');
  assert.equal(h.view.city.alternatives.length, 2);
  assert.equal(h.calls, 0);
  h.controls.setMode('game');
  assert.equal(h.view.mode, 'game');
  await h.controls.imagine(h.view.city.alternatives[0].id);
  assert.equal(h.calls, 1);
  assert.equal(
    h.view.cards[0].concept.label,
    'AI concept, not a plan or an approval',
  );
  const id = h.view.city.alternatives[0].id;
  const firstConcept = h.view.city.alternatives[0].concept;
  await h.controls.imagine(id);
  assert.equal(
    h.calls,
    1,
    'an existing concept cannot be overwritten or sent again',
  );
  assert.deepEqual(h.view.city.alternatives[0].concept, firstConcept);
  h.controls.editAlternative(id);
  h.controls.editField('description', 'More shade.');
  h.controls.saveAlternative();
  assert.equal(h.view.city.alternatives[0].revision, 2);
  assert.equal(h.view.city.alternatives[0].concept, null);
  h.controls.restoreRevision(id, 1);
  assert.equal(h.view.city.alternatives[0].revision, 3);
  h.controls.exportFile();
  assert.equal(h.exported, h.saved);
  const reloaded = harness({
    storage: { getItem: () => h.saved, setItem() {} },
  });
  reloaded.controls.open();
  assert.equal(reloaded.view.city.alternatives.length, 2);
  assert.equal(reloaded.calls, 0);
  h.controls.destroy();
  h.controls.destroy();
  assert.equal(h.view, null);
});
test('malformed import leaves current project intact and never generates', async () => {
  const h = harness();
  h.controls.open();
  await h.controls.start({ title: 'Block' });
  const prior = h.saved;
  await h.controls.importFile({
    size: 50,
    text: async () => '{"approval":"approved"}',
  });
  assert.equal(h.saved, prior);
  assert.ok(h.view.city.error);
  assert.equal(h.calls, 0);
});
test('storage failures are visible and export remains available', async () => {
  const h = harness({
    storage: {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
    },
  });
  h.controls.open();
  await h.controls.start({ title: 'Block' });
  assert.equal(h.view.city.persisted, false);
  assert.ok(h.view.city.error);
  h.controls.exportFile();
  assert.ok(h.exported);
});
test('close/dispose cancels stale asynchronous capture without replacing persisted project', async () => {
  let resolve;
  const h = harness({
    captureReference: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  h.controls.open();
  const pending = h.controls.start({ title: 'Block' });
  h.controls.close();
  resolve(reference);
  await pending;
  assert.equal(h.saved, null);
  h.controls.open();
  assert.equal(h.view.city.reference, null);
  h.controls.destroy();
  assert.equal(h.launcher, null);
});
test('unreadable storage preserved; foreign-tab writes fail closed rather than overwrite', async () => {
  let saved = 'invalid';
  const h = harness({
    storage: {
      getItem: () => saved,
      setItem: (_k, v) => {
        saved = v;
      },
    },
  });
  h.controls.open();
  assert.ok(h.view.city.error);
  await h.controls.start({ title: 'Block' });
  assert.equal(saved, 'invalid');
});
test('sharing dialog excludes open and local provider requires development capability', () => {
  const h = harness({ sharingDialogOpen: () => true });
  h.controls.open();
  assert.equal(h.view, null);
  const other = harness();
  other.controls.open();
  other.controls.setProvider('local');
  assert.equal(other.view.city.provider, 'fixture');
});
