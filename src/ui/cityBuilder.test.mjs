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
test('play mode: reimagining a plot creates the project, a sited alternative and its concept', async () => {
  const { snapPlot } = await import('../data/cityPlot.js');
  let play = null;
  const h = harness({ publishPlay: (v) => (play = v) });
  assert.equal(play.alternatives, null, 'no project yet: stats stay unknown');
  assert.equal(play.pending, false);
  const plot = snapPlot({ lat: 0.1, lon: 0.1 });
  const id = await h.controls.reimagine({ plot, kind: 'plaza' });
  assert.equal(id, 'world-1');
  assert.equal(h.calls, 1, 'exactly one explicit generation');
  assert.equal(h.view, null, 'the records dialog stays closed');
  const [a] = play.alternatives;
  assert.equal(a.parameters.kind, 'plaza');
  assert.deepEqual(a.site.plot, plot);
  assert.equal(
    a.site.reference,
    null,
    'the first capture is the project baseline',
  );
  assert.equal(a.concept.label, 'AI concept, not a plan or an approval');
  assert.deepEqual(a.concept.sourceView, reference);
  assert.ok(a.title && a.description);
  const doc = JSON.parse(h.saved);
  assert.equal(doc.alternatives[0].site.plot.id, plot.id);
  // A second plot gets its own captured view.
  const other = snapPlot({ lat: -0.2, lon: 0.3 });
  const id2 = await h.controls.reimagine({ plot: other, kind: 'park' });
  assert.equal(id2, 'world-2');
  assert.deepEqual(play.alternatives[1].site.reference, reference);
  assert.equal(h.calls, 2);
  // Reroll makes version 2 with a new concept; history keeps version 1.
  assert.equal(await h.controls.reroll('world-1'), true, 'reports the landing');
  assert.equal(play.alternatives[0].revision, 2);
  assert.equal(play.alternatives[0].versionCount, 2);
  assert.ok(play.alternatives[0].concept);
  assert.equal(h.calls, 3);
  assert.equal(JSON.parse(h.saved).alternatives[0].versions.length, 2);
  // The records dialog shows the same document.
  h.controls.open();
  assert.equal(h.view.city.alternatives.length, 2);
  assert.equal(h.view.city.alternatives[0].history.length, 2);
});
test('play mode: busy, full and failed generations never write partial concepts silently', async () => {
  const { snapPlot } = await import('../data/cityPlot.js');
  let play = null;
  let fail = false;
  const h = harness({
    publishPlay: (v) => (play = v),
    generator: () => ({
      generate: async () => {
        if (fail) throw new Error('offline');
        return createPlanningConceptGenerator({
          now: () => reference.capturedAt,
        }).generate({
          description: 'd',
          parameters: { kind: 'park' },
          sourceView: reference,
        });
      },
    }),
  });
  const plot = snapPlot({ lat: 0.1, lon: 0.1 });
  const first = h.controls.reimagine({ plot, kind: 'park' });
  assert.equal(play.pending, true);
  assert.equal(await h.controls.reimagine({ plot, kind: 'park' }), null);
  await first;
  fail = true;
  assert.equal(await h.controls.reimagine({ plot, kind: 'plaza' }), null);
  assert.ok(play.error, 'failure is visible');
  assert.equal(
    play.alternatives[1].concept,
    null,
    'saved proposal, no concept',
  );
  assert.equal(
    await h.controls.reroll('world-2'),
    false,
    'a failed reroll says so',
  );
  fail = false;
  assert.equal(await h.controls.reroll('world-2'), true);
  assert.equal(
    play.alternatives[1].revision,
    1,
    'retry fills the empty version',
  );
  assert.ok(play.alternatives[1].concept);
  for (let i = 0; i < 4; i++)
    await h.controls.reimagine({ plot, kind: 'bike-lane' });
  assert.equal(play.alternatives.length, 6);
  assert.equal(play.full, true);
  assert.equal(await h.controls.reimagine({ plot, kind: 'park' }), null);
  assert.equal(play.alternatives.length, 6);
  assert.equal(await h.controls.reimagine({ plot: null, kind: 'park' }), null);
});
function place(h, title, { kind = 'park', site = null } = {}) {
  h.controls.newAlternative();
  h.controls.editField('title', title);
  h.controls.editField('description', 'A hypothetical public space.');
  h.controls.editField('kind', kind);
  if (site !== null) h.controls.editField('site', site);
  h.controls.saveAlternative();
}
test('walk access shows the baseline beside every alternative without changing proposals', async () => {
  const h = harness();
  h.controls.open();
  await h.controls.start({ title: 'Public block' });
  let access = h.view.city.access;
  assert.match(access.label, /HYPOTHETICAL ESTIMATE/);
  assert.match(access.network, /synthetic/);
  assert.match(access.method, /uniform/);
  assert.deepEqual(
    access.sites.map((s) => s.id),
    ['site-a', 'site-b', 'site-c', 'site-d'],
  );
  assert.deepEqual(
    access.rows.map((r) => [r.id, r.state, r.mean, r.worst]),
    [['baseline', 'evaluated', '432 m', '710 m']],
  );
  place(h, 'Unplaced park');
  place(h, 'East park', { site: 'site-b' });
  place(h, 'Lane', { kind: 'bike-lane', site: 'site-c' });
  place(h, 'West plaza', { kind: 'plaza', site: 'site-c' });
  access = h.view.city.access;
  assert.deepEqual(
    access.rows.map((r) => r.state),
    ['evaluated', 'unknown', 'evaluated', 'not-applicable', 'evaluated'],
  );
  const east = access.rows.find((r) => r.id === 'world-2');
  assert.equal(east.label, 'East park');
  assert.equal(east.site, 'Site B');
  assert.deepEqual([east.mean, east.worst], ['231 m', '480 m']);
  assert.match(east.delta, /−201 m.*−230 m/);
  assert.match(east.meanRange, /^\d+–\d+ m$/);
  assert.equal(east.known, '9 of 9 zones');
  assert.equal(east.parks.filter((p) => p.proposed).length, 1);
  assert.equal(east.zones.length, 9);
  assert.match(access.rows[1].note, /choose a site/);
  assert.match(access.rows[3].note, /park and plaza/);
  // Moving the park is a new version; history keeps the old site.
  const before = h.view.city.reference;
  h.controls.editAlternative('world-2');
  h.controls.editField('site', 'site-c');
  h.controls.saveAlternative();
  const moved = h.view.city.access.rows.find((r) => r.id === 'world-2');
  assert.equal(moved.site, 'Site C');
  assert.notEqual(moved.mean, east.mean);
  const history = h.view.city.alternatives[1].history;
  assert.deepEqual(
    history.map((v) => v.parameters.site),
    ['site-b', 'site-c'],
  );
  // Clearing the site goes back to an explicit unknown.
  h.controls.editAlternative('world-2');
  h.controls.editField('site', '');
  h.controls.saveAlternative();
  assert.equal(h.view.city.access.rows[2].state, 'unknown');
  assert.deepEqual(h.view.city.reference, before);
  assert.equal(h.calls, 0, 'estimating access never calls a concept provider');
  // Estimates are derived for display; the saved document holds no metric.
  assert.doesNotMatch(h.saved, /meanMeters|worst|access/);
});
test('a site suggestion joins the comparison as a hypothetical option and saves nothing', async () => {
  const h = harness();
  h.controls.open();
  // Without a project there is no comparison to add to.
  h.controls.suggestSite({ objective: 'average', siteCount: 1 });
  assert.equal(h.view.city.access, null);
  await h.controls.start({ title: 'Public block' });
  place(h, 'Central park', { site: 'site-a' });
  const saved = h.saved;
  const plan = h.view.city.access.rows.filter((r) => r.id !== 'suggestion');
  const option = (objective, siteCount) => {
    h.controls.suggestSite({ objective, siteCount });
    const rows = h.view.city.access.rows;
    // The plan's own rows never change; the option is one more row after them.
    assert.deepEqual(rows.slice(0, -1), plan);
    return rows.at(-1);
  };
  let row = option('average', 1);
  assert.deepEqual(
    [row.id, row.state, row.site, row.mean, row.worst, row.suggested],
    ['suggestion', 'evaluated', 'Site B', '231 m', '480 m', 'average:1'],
  );
  assert.match(row.hypothetical, /HYPOTHETICAL OPTION · NOT ZONING/);
  assert.match(row.method, /4 possible choices of 1 from 4 candidate sites/);
  assert.match(row.method, /eligibility is assumed/);
  assert.equal(row.tie, null);
  assert.match(row.delta, /−201 m.*−230 m/);
  // The plan (site A) already holds the best single site for the worst-served zone.
  row = option('worst-served', 1);
  assert.deepEqual(
    [row.site, row.mean, row.worst],
    [plan[1].site, plan[1].mean, plan[1].worst],
  );
  row = option('worst-served', 2);
  assert.deepEqual(
    [row.site, row.mean, row.worst, row.suggested],
    ['Site B + Site C', '169 m', '320 m', 'worst-served:2'],
  );
  assert.match(row.tie, /Tie on worst-served walk between 2 choices/);
  assert.equal(row.parks.filter((p) => p.proposed).length, 2);
  // A request outside the exact reference's range changes nothing.
  h.controls.suggestSite({ objective: 'cheapest', siteCount: 1 });
  h.controls.suggestSite({ objective: 'average', siteCount: 3 });
  assert.equal(h.view.city.access.rows.at(-1).suggested, 'worst-served:2');
  assert.equal(h.saved, saved, 'a suggestion is never saved');
  assert.equal(h.calls, 0, 'a suggestion never calls a concept provider');
});
test('play mode: a proposed land use per plot saves through the same document', async () => {
  const { snapPlot } = await import('../data/cityPlot.js');
  let play = null;
  const h = harness({ publishPlay: (v) => (play = v) });
  const plot = snapPlot({ lat: 0.1, lon: 0.1 });
  assert.deepEqual(play.zoning, [], 'no project, no land use');
  // Zoning first creates the project from the current view, like Reimagine.
  assert.equal(await h.controls.setZone({ plot, use: 'housing' }), true);
  assert.deepEqual(
    play.zoning.map((z) => [z.plot.id, z.use]),
    [[plot.id, 'housing']],
  );
  assert.equal(JSON.parse(h.saved).zoning[0].use, 'housing');
  assert.equal(play.alternatives.length, 0, 'land use is not a possible world');
  assert.equal(await h.controls.setZone({ plot, use: 'civic' }), true);
  assert.deepEqual(
    play.zoning.map((z) => z.use),
    ['civic'],
  );
  assert.equal(await h.controls.setZone({ plot, use: null }), true);
  assert.deepEqual(play.zoning, []);
  assert.equal(Object.hasOwn(JSON.parse(h.saved), 'zoning'), false);
  assert.equal(await h.controls.setZone({ plot, use: 'industrial' }), false);
  assert.ok(play.error, 'an invalid use is refused visibly');
  assert.equal(await h.controls.setZone({ plot: null, use: 'civic' }), false);
});
