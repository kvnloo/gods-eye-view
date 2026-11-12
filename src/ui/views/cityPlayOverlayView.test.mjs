import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useCityPlayStore } from '../stores/cityPlay.js';
import { useCommunityPlanningStore } from '../stores/communityPlanning.js';
import CityPlayOverlay from './panels/CityPlayOverlay.vue';
import GlobeActions from './panels/GlobeActions.vue';
import { snapPlot } from '../../data/cityPlot.js';
import {
  carouselCards,
  plotCode,
  resourceStats,
  wheelActions,
} from '../cityPlayModel.js';

const plot = snapPlot({ lat: 37.8007, lon: -122.4103 });
const image = 'data:image/png;base64,AAAA';
const alternatives = [
  {
    id: 'world-1',
    title: 'Public plaza',
    description: 'd',
    parameters: { kind: 'plaza', trees: 12, widthMeters: 8, shadePercent: 45 },
    concept: { image, provider: 'fixture' },
    revision: 1,
    versionCount: 1,
    site: { plot, reference: null },
  },
];
function playView(patch = {}) {
  return {
    active: true,
    tier: 'plot',
    pending: false,
    framing: false,
    error: null,
    status: null,
    stats: resourceStats(alternatives),
    plot: { id: plot.id, code: plotCode(plot), area: 1600, size: 40 },
    actions: wheelActions({}),
    cards: carouselCards(alternatives, plot.id, { focusId: 'world-1' }),
    focused: {
      id: 'world-1',
      title: 'Public plaza',
      kind: 'plaza',
      icon: 'deck',
      parameters: alternatives[0].parameters,
      revision: 1,
      concept: true,
      built: false,
    },
    callouts: [],
    pins: [],
    ...patch,
  };
}

async function mount(t) {
  document.body.replaceChildren();
  // A desktop viewport so the wheel fits between the resource bar and carousel.
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const planning = useCommunityPlanningStore(pinia);
  const calls = [];
  store.connect(
    Object.fromEntries(
      ['toggle', 'exit', 'act', 'focus', 'build', 'reroll', 'openRecords'].map(
        (name) => [name, (...args) => calls.push([name, ...args])],
      ),
    ),
  );
  planning.offerLauncher({ label: 'City builder' });
  const app = createApp({
    render: () => h('div', [h(GlobeActions), h(CityPlayOverlay)]),
  }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const settle = async () => {
    await nextTick();
    await nextTick();
  };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  return { store, calls, settle, $, $$ };
}

test('the launcher toggles play mode and shows its pressed state', async (t) => {
  const { store, calls, settle, $ } = await mount(t);
  await settle();
  assert.equal($('[data-city-play]'), null, 'nothing over the globe until entered');
  $('[data-city-builder-open]').click();
  assert.deepEqual(calls, [['toggle']]);
  store.publish(playView({ plot: null, cards: [], focused: null }));
  await settle();
  assert.equal($('[data-city-builder-open]').getAttribute('aria-pressed'), 'true');
  assert.ok($('[data-city-play-bar]'));
  assert.ok($('[data-city-play-hint]'), 'hint until a plot is chosen');
  assert.equal($('[data-city-play-wheel]'), null);
  store.publish({ ...playView(), active: false });
  await settle();
  assert.equal($('[data-city-play]'), null);
  assert.equal($('[data-city-builder-open]').getAttribute('aria-pressed'), 'false');
});

test('the wheel follows the projected plot and sends honest actions', async (t) => {
  const { store, calls, settle, $, $$ } = await mount(t);
  store.publish(playView());
  store.place({ plot: { x: 700, y: 460 }, tag: { x: 760, y: 400 }, callouts: {}, pins: {} });
  await settle();
  const wheel = $('[data-city-play-wheel]');
  assert.equal(wheel.style.left, '700px');
  assert.equal(wheel.style.top, '460px');
  assert.deepEqual(
    $$('[data-city-play-action]').map((b) => b.dataset.cityPlayAction),
    ['reimagine', 'park', 'plaza', 'bike-lane', 'inspect'],
  );
  $('[data-city-play-action="reimagine"]').click();
  $('[data-city-play-action="inspect"]').click();
  assert.deepEqual(calls.slice(-2), [
    ['act', 'reimagine'],
    ['act', 'inspect'],
  ]);
  assert.match($('[data-city-play-tag]').textContent, /40 m grid cell, not a surveyed parcel/);
  const stats = Object.fromEntries(
    $$('[data-city-play-stat]').map((s) => [s.dataset.cityPlayStat, s.querySelector('.city-play-stat-value').textContent]),
  );
  assert.deepEqual(stats, {
    plots: '1',
    worlds: '1',
    concepts: '1',
    trees: '+12',
    shade: '45%',
    walk: '—',
  });
});

test('the carousel lists this plot\'s worlds with chips, Build, Reroll and records', async (t) => {
  const { store, calls, settle, $, $$ } = await mount(t);
  store.publish(playView());
  store.place({ plot: { x: 700, y: 460 }, callouts: {}, pins: {} });
  await settle();
  const cards = $$('[data-city-play-card]');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true');
  assert.equal(cards[0].querySelector('img').getAttribute('src'), image);
  assert.deepEqual(
    $$('[data-city-play-chip]').map((c) => c.dataset.cityPlayChip),
    ['trees', 'shade', 'width'],
  );
  assert.match($('[data-city-play-ai-label]').textContent, /AI concept, not a plan or an approval/);
  $('[data-city-play-build]').click();
  $('[data-city-play-reroll]').click();
  $('[data-city-play-records="carousel"]').click();
  cards[0].click();
  assert.deepEqual(calls, [
    ['build', 'world-1'],
    ['reroll', 'world-1'],
    ['openRecords'],
    ['focus', 'world-1'],
  ]);
  store.publish(playView({ pending: true }));
  await settle();
  assert.equal($('[data-city-play-reroll]').disabled, true);
  assert.equal($('[data-city-play-records="carousel"]').disabled, true);
  assert.equal($('[data-city-play-records="bar"]').disabled, true);
});

test('zoom tiers swap the wheel for detail callouts or district pins', async (t) => {
  const { store, settle, $, $$ } = await mount(t);
  store.publish(
    playView({
      tier: 'detail',
      callouts: [
        { id: 'kind', fx: 0.8, fy: 0.8, kind: 'plaza' },
        { id: 'trees', fx: 0.2, fy: 0.7, value: 12, unit: '' },
      ],
    }),
  );
  store.place({
    plot: { x: 700, y: 460 },
    callouts: { kind: { x: 760, y: 480 }, trees: null },
    pins: {},
  });
  await settle();
  assert.equal($('[data-city-play-wheel]'), null);
  assert.deepEqual(
    $$('[data-city-play-callout]').map((c) => c.dataset.cityPlayCallout),
    ['kind'],
    'a callout behind the camera or off screen is not drawn',
  );
  assert.ok($('[data-city-play-stats]'));
  store.publish(
    playView({
      tier: 'district',
      pins: [
        {
          plotId: plot.id,
          alternativeId: 'world-1',
          center: plot.center,
          kind: 'plaza',
          icon: 'deck',
          title: 'Public plaza',
          built: true,
        },
      ],
    }),
  );
  store.place({ plot: null, callouts: {}, pins: { [plot.id]: { x: 500, y: 300 } } });
  await settle();
  assert.equal($('[data-city-play-carousel]'), null);
  assert.equal($('[data-city-play-stats]'), null);
  const pin = $(`[data-city-play-pin="${plot.id}"]`);
  assert.match(pin.textContent, /Public plaza/);
  assert.match(pin.textContent, /Kept/);
});
