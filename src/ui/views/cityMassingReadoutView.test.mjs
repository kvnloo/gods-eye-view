import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityMassingReadout from './panels/CityMassingReadout.vue';
import { snapPlot } from '../../data/cityPlot.js';
import { MAX_STOREYS, plotMassing } from '../../data/cityMassing.js';
import { plotCode } from '../cityPlayModel.js';

const plot = snapPlot({ lat: 37.8007, lon: -122.4103 });
const playView = (patch = {}) => ({
  active: true,
  tier: 'plot',
  wheelOpen: false,
  pending: false,
  plot: { id: plot.id, code: plotCode(plot), area: 1600, size: 40 },
  ...patch,
});
function massingView(on, storeys = 6) {
  const m = plotMassing({ corners: plot.corners, storeys });
  return {
    on,
    plotId: plot.id,
    storeys,
    maxStoreys: MAX_STOREYS,
    storeyHeightMeters: m.storeyHeightMeters,
    setbackMeters: m.setbackMeters,
    heightMeters: m.heightMeters,
    far: m.far,
    floorAreaSquareMeters: m.floorAreaSquareMeters,
  };
}
// The plot footprint and the block with its shadow, projected on screen.
const anchors = {
  plot: { x: 700, y: 450 },
  footprint: [
    { x: 620, y: 500 },
    { x: 780, y: 500 },
    { x: 760, y: 400 },
    { x: 640, y: 400 },
  ],
};
// The block's top corners, and a shadow tip falling east: placed from the
// footprint alone, the readout would land on that tip.
const massingAnchors = {
  points: [
    { x: 640, y: 330 },
    { x: 760, y: 330 },
    { x: 900, y: 450 },
  ],
};

async function mount(t) {
  document.body.replaceChildren();
  Object.defineProperty(window, 'innerWidth', {
    value: 1440,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: 900,
    configurable: true,
  });
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const calls = [];
  store.connectMassing({
    toggle: () => calls.push(['toggle']),
    step: (delta) => calls.push(['step', delta]),
  });
  const app = createApp({ render: () => h(CityMassingReadout) }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const settle = async () => {
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await nextTick();
  };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  return { store, calls, settle, $, $$ };
}

test('without the massing flag nothing is added to play mode', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  await settle();
  assert.equal($('[data-city-massing]'), null);
});

test('a selected plot offers one MASSING toggle until massing is on', async (t) => {
  const { store, calls, settle, $, $$ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  store.publishMassing(massingView(false));
  await settle();
  assert.ok($('[data-city-massing]'));
  assert.equal($$('[data-city-massing] button').length, 1);
  const toggle = $('[data-city-massing-toggle]');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal($('[data-city-massing-rows]'), null);
  toggle.click();
  assert.deepEqual(calls, [['toggle']]);
});

test('massing on: height EST, storeys, FAR and floor area with one stepper (3 controls)', async (t) => {
  const { store, calls, settle, $, $$ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  store.publishMassing(massingView(true));
  await settle();
  assert.equal(
    $$('[data-city-massing] button').length,
    3,
    'at most 3 controls',
  );
  assert.equal(
    $('[data-city-massing-toggle]').getAttribute('aria-pressed'),
    'true',
  );
  const value = (id) =>
    $(
      `[data-city-massing-row="${id}"] [data-city-massing-value]`,
    ).textContent.trim();
  assert.equal(value('height'), '19.2 m');
  assert.ok($('[data-city-massing-row="height"] [data-city-massing-est]'));
  assert.equal(value('storeys'), '6');
  assert.equal(value('far'), '3.84');
  assert.equal(value('floor'), '6,144 m²');
  $('[data-city-massing-step="1"]').click();
  $('[data-city-massing-step="-1"]').click();
  assert.deepEqual(calls, [
    ['step', 1],
    ['step', -1],
  ]);
  store.publishMassing(massingView(true, 8));
  await settle();
  assert.equal(value('height'), '25.6 m');
  assert.equal(value('far'), '5.12');
  assert.equal(value('floor'), '8,192 m²');
});

test('the stepper stops at 1 and at the maximum', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  store.publishMassing(massingView(true, 1));
  await settle();
  assert.equal($('[data-city-massing-step="-1"]').disabled, true);
  assert.equal($('[data-city-massing-step="1"]').disabled, false);
  store.publishMassing(massingView(true, MAX_STOREYS));
  await settle();
  assert.equal($('[data-city-massing-step="1"]').disabled, true);
});

test('the readout sits beside the plot, clear of the block and its shadow', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  store.placeMassing(massingAnchors);
  store.publishMassing(massingView(true));
  await settle();
  const box = $('[data-city-massing]');
  const left = parseFloat(box.style.left);
  const top = parseFloat(box.style.top);
  assert.ok(Number.isFinite(left) && Number.isFinite(top), 'placed');
  const right = left + (box.offsetWidth || 240);
  const bottom = top + (box.offsetHeight || 170);
  for (const p of [...anchors.footprint, ...massingAnchors.points])
    assert.ok(
      p.x < left || p.x > right || p.y < top || p.y > bottom,
      `readout ${JSON.stringify({ left, top, right, bottom })} covers ${JSON.stringify(p)}`,
    );
  assert.ok($('[data-city-massing-leader]'), 'a leader joins it to the plot');
});

test('the readout hides in the district tier and outside play mode', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.place(anchors);
  store.publishMassing(massingView(true));
  store.publish(playView({ tier: 'district' }));
  await settle();
  assert.equal($('[data-city-massing]'), null);
  store.publish(playView({ active: false }));
  await settle();
  assert.equal($('[data-city-massing]'), null);
});

test('the readout stays on screen when the plot fills the view', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.publish(playView());
  store.place({
    plot: { x: 700, y: 450 },
    footprint: [
      { x: -400, y: 1300 },
      { x: 1900, y: 1300 },
      { x: 1700, y: -300 },
      { x: -200, y: -300 },
    ],
  });
  store.publishMassing(massingView(true));
  await settle();
  const box = $('[data-city-massing]');
  const left = parseFloat(box.style.left);
  const top = parseFloat(box.style.top);
  assert.ok(left >= 0 && left + 240 <= 1440, `left ${left}`);
  assert.ok(top >= 0 && top + 176 <= 900, `top ${top}`);
});

test('the rows announce what the stepper changed', async (t) => {
  const { store, settle, $ } = await mount(t);
  store.publish(playView());
  store.place(anchors);
  store.publishMassing(massingView(true));
  await settle();
  assert.equal(
    $('[data-city-massing-rows]').getAttribute('aria-live'),
    'polite',
  );
});
