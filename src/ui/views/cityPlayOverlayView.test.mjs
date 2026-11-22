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
  detailCallouts,
  plotCode,
  resourceStats,
  wheelActions,
  zoneLegend,
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
    wheelOpen: true,
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
  Object.defineProperty(window, 'innerWidth', {
    value: 1440,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: 1000,
    configurable: true,
  });
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
  assert.equal(
    $('[data-city-play]'),
    null,
    'nothing over the globe until entered',
  );
  $('[data-city-builder-open]').click();
  assert.deepEqual(calls, [['toggle']]);
  store.publish(playView({ plot: null, cards: [], focused: null }));
  await settle();
  assert.equal(
    $('[data-city-builder-open]').getAttribute('aria-pressed'),
    'true',
  );
  assert.ok($('[data-city-play-bar]'));
  assert.ok($('[data-city-play-hint]'), 'hint until a plot is chosen');
  assert.equal($('[data-city-play-wheel]'), null);
  store.publish({ ...playView(), active: false });
  await settle();
  assert.equal($('[data-city-play]'), null);
  assert.equal(
    $('[data-city-builder-open]').getAttribute('aria-pressed'),
    'false',
  );
});

test('the wheel follows the projected plot and sends honest actions', async (t) => {
  const { store, calls, settle, $, $$ } = await mount(t);
  store.publish(playView());
  // Above the carousel dock, so the wheel is not clamped.
  store.place({
    plot: { x: 700, y: 400 },
    tag: { x: 760, y: 340 },
    callouts: {},
    pins: {},
  });
  await settle();
  const wheel = $('[data-city-play-wheel]');
  assert.equal(wheel.style.left, '700px');
  assert.equal(wheel.style.top, '400px');
  assert.deepEqual(
    $$('[data-city-play-action]').map((b) => b.dataset.cityPlayAction),
    ['reimagine', 'park', 'plaza', 'bike-lane', 'zone', 'inspect'],
  );
  $('[data-city-play-action="reimagine"]').click();
  $('[data-city-play-action="inspect"]').click();
  assert.deepEqual(calls.slice(-2), [
    ['act', 'reimagine'],
    ['act', 'inspect'],
  ]);
  assert.match(
    $('[data-city-play-tag]').textContent,
    /40 m grid cell, not a surveyed parcel/,
  );
  const stats = Object.fromEntries(
    $$('[data-city-play-stat]').map((s) => [
      s.dataset.cityPlayStat,
      s.querySelector('.city-play-stat-value').textContent,
    ]),
  );
  assert.deepEqual(stats, {
    plots: '1',
    worlds: '1',
    concepts: '1',
    trees: '12 EST',
    shade: '45% EST',
    walk: '—',
  });
});

test("the carousel lists this plot's worlds with chips, Build, Reroll and records", async (t) => {
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
  assert.deepEqual(
    [...document.querySelectorAll('[data-city-play-ghost]')].map(
      (c) => c.dataset.cityPlayGhost,
    ),
    ['park', 'bike-lane'],
    'untried kinds appear as ghost slots',
  );
  document.querySelector('[data-city-play-ghost="park"]').click();
  assert.match(
    $('[data-city-play-ai-label]').textContent,
    /AI concept, not a plan or an approval/,
  );
  $('[data-city-play-build]').click();
  $('[data-city-play-reroll]').click();
  $('[data-city-play-records="carousel"]').click();
  cards[0].click();
  assert.deepEqual(calls, [
    ['act', 'park'],
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
  const footprint = [
    { x: 640, y: 420 },
    { x: 760, y: 420 },
    { x: 760, y: 500 },
    { x: 640, y: 500 },
  ];
  store.place({
    plot: { x: 700, y: 460 },
    footprint,
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
  const stats = $('[data-city-play-stats]');
  assert.ok(stats);
  // Anchored beside the plot on a leader, not docked at the screen edge.
  const left = parseFloat(stats.style.left);
  const gap = Math.min(Math.abs(640 - (left + 260)), Math.abs(left - 760));
  assert.ok(gap <= 96, `beside the plot: left ${left}, ${gap} px away`);
  const leader = $('[data-city-play-stats-leader]');
  assert.ok(leader, 'a leader joins the stats card to the plot');
  const x2 = Number(leader.getAttribute('x2'));
  const y2 = Number(leader.getAttribute('y2'));
  assert.ok(
    x2 >= 640 && x2 <= 760 && y2 >= 420 && y2 <= 500,
    'on the footprint',
  );
  store.place({
    plot: { x: 700, y: 460 },
    footprint: [null, null, null, null],
    callouts: {},
    pins: {},
  });
  await settle();
  assert.equal($('[data-city-play-stats]'), null, 'no plot on screen, no card');
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
          trees: 12,
          shade: 45,
          built: true,
        },
      ],
    }),
  );
  store.place({
    plot: null,
    callouts: {},
    pins: { [plot.id]: { x: 500, y: 300 } },
  });
  await settle();
  assert.equal($('[data-city-play-carousel]'), null);
  assert.equal($('[data-city-play-stats]'), null);
  const pin = $(`[data-city-play-pin="${plot.id}"]`);
  assert.match(pin.textContent, /Public plaza/);
  assert.match(pin.textContent, /Kept/);
});

test('every estimated figure reads EST, an exact figure does not, and an unknown one stays a plain dash', async (t) => {
  const { store, settle, $, $$ } = await mount(t);
  const text = (selector) => $$(selector).map((el) => el.textContent.trim());
  store.publish(playView());
  store.place({ plot: { x: 700, y: 400 }, callouts: {}, pins: {} });
  await settle();
  assert.deepEqual(
    text('[data-city-play-chip] strong'),
    ['12 EST', '45% EST', '8 m EST'],
    'card chips are proposal estimates',
  );
  assert.match($('[data-city-play-tag]').textContent, /1,600 m²/);
  assert.doesNotMatch(
    $('[data-city-play-tag]').textContent,
    /EST|~/,
    'the grid area is exact',
  );
  assert.deepEqual(
    text('[data-city-play-stat] .city-play-stat-value').slice(0, 3),
    ['1', '1', '1'],
    'counts are exact',
  );

  // The mean of 45, 45 and 40 % is 43.33…: two significant figures behind ~.
  const three = [0, 0, 5].map((less, i) => ({
    ...alternatives[0],
    id: `world-${i + 1}`,
    parameters: { ...alternatives[0].parameters, shadePercent: 45 - less },
  }));
  store.publish(playView({ stats: resourceStats(three) }));
  await settle();
  assert.deepEqual(text('[data-city-play-stat] .city-play-stat-value'), [
    '1',
    '3',
    '3',
    '36 EST',
    '~43% EST',
    '—',
  ]);

  store.publish(playView({ stats: resourceStats(null) }));
  await settle();
  assert.deepEqual(
    text('[data-city-play-stat] .city-play-stat-value'),
    ['—', '—', '—', '—', '—', '—'],
    'no project: unknown, never zero, never an estimate',
  );

  const footprint = [
    { x: 640, y: 420 },
    { x: 760, y: 420 },
    { x: 760, y: 500 },
    { x: 640, y: 500 },
  ];
  store.publish(
    playView({ tier: 'detail', callouts: detailCallouts(alternatives[0]) }),
  );
  store.place({
    plot: { x: 700, y: 460 },
    footprint,
    callouts: {
      kind: { x: 760, y: 480 },
      trees: { x: 650, y: 470 },
      shade: { x: 750, y: 430 },
      width: { x: 680, y: 425 },
    },
    pins: {},
  });
  await settle();
  assert.deepEqual(text('.city-play-callout-label'), [
    'Plaza',
    'Trees · 12 EST',
    'Shade · 45% EST',
    'Width · 8 m EST',
  ]);
  assert.deepEqual(
    text('.city-play-stats-row > span:last-child'),
    ['12 EST', '45% EST', '8 m EST'],
    'the stats card shows the same estimates',
  );

  const pin = {
    alternativeId: 'world-1',
    center: plot.center,
    kind: 'plaza',
    icon: 'deck',
    title: 'Public plaza',
    trees: 12,
    shade: 45,
    built: false,
    use: null,
  };
  store.publish(
    playView({
      tier: 'district',
      pins: [
        { ...pin, plotId: 'with-walk', walk: 212.37 },
        { ...pin, plotId: 'no-walk', walk: null },
      ],
      legend: zoneLegend([{ plot, use: 'housing' }]),
    }),
  );
  store.place({
    plot: null,
    callouts: {},
    pins: { 'with-walk': { x: 400, y: 300 }, 'no-walk': { x: 900, y: 300 } },
  });
  await settle();
  const yields = (id) =>
    [
      ...$(`[data-city-play-pin="${id}"]`).querySelectorAll(
        '.city-play-pin-yields > span',
      ),
    ].map((el) => el.textContent.trim());
  assert.deepEqual(yields('with-walk'), [
    'Trees 12 EST',
    'Shade 45% EST',
    'Walk access ~210 m EST',
  ]);
  assert.deepEqual(yields('no-walk'), [
    'Trees 12 EST',
    'Shade 45% EST',
    'Walk access —',
  ]);
  const legend = (use) =>
    [
      ...$(`[data-city-play-legend-row="${use}"]`).querySelectorAll(
        '[translate="no"]',
      ),
    ].map((el) => el.textContent.trim());
  assert.deepEqual(legend('housing'), ['1', '1,600 m²', '100%']);
  assert.deepEqual(
    legend('civic'),
    ['0', '0 m²', '0%'],
    'zoned land is counted, not estimated',
  );
  store.publish(playView({ tier: 'district', legend: zoneLegend([]) }));
  await settle();
  assert.deepEqual(
    legend('housing'),
    ['0', '0 m²', '—'],
    'nothing zoned: the share is unknown',
  );
});
