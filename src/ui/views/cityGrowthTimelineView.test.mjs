import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityGrowthTimeline from './panels/CityGrowthTimeline.vue';
import { PLOT_METERS, plotBlock, snapPlot } from '../../data/cityPlot.js';
import { growthPlan } from '../../data/cityGrowth.js';
import { growthLines } from '../cityGrowthLines.js';

const from = snapPlot({ lat: 37.7694, lon: -122.4262 });
const DISTRICT = plotBlock(
  from,
  snapPlot({
    lat: from.center.lat + (4 * PLOT_METERS) / 111_320,
    lon:
      from.center.lon +
      (4 * PLOT_METERS) /
        (111_320 * Math.cos((from.center.lat * Math.PI) / 180)),
  }),
);
// What the globe owner publishes for the district.
const timeline = ({ on = true, stage = 0, ...plan } = {}) => ({
  on,
  stage,
  maxStoreys: 60,
  plan: growthPlan({ plots: DISTRICT, anchorId: from.id, ...plan }),
});

async function mount(t, width = 1440) {
  document.body.replaceChildren();
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
  });
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const calls = [];
  store.connectMassing(
    Object.fromEntries(
      ['growth', 'stage', 'stepStage'].map((name) => [
        name,
        (...args) => calls.push([name, ...args]),
      ]),
    ),
  );
  const app = createApp({ render: () => h(CityGrowthTimeline) }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const $ = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  return { store, calls, $, all, text };
}

test('nothing shows without a district; with one, a GROWTH TIMELINE toggle and the district line', async (t) => {
  const { store, calls, $, text } = await mount(t);
  await nextTick();
  assert.equal($('[data-city-growth]'), null);
  store.publishGrowth(timeline({ on: false }));
  await nextTick();
  const toggle = $('[data-city-growth-toggle]');
  assert.equal(text(toggle), 'Growth timeline');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(
    text($('[data-city-growth-line="district"]')),
    'DISTRICT · 25 PLOTS · 40,000 m²',
  );
  assert.equal($('[data-city-growth-rail]'), null, 'off: no rail');
  assert.equal($('[data-city-growth-lines]'), null, 'off: no figures');
  toggle.click();
  assert.deepEqual(calls, [['growth']]);
});

test('on: one rail of NOW / 5 YR / 15 YR with the stage shown pressed, and the stage’s lines, each figure once', async (t) => {
  const { store, calls, $, all, text } = await mount(t);
  for (const stage of [0, 1, 2]) {
    const view = timeline({ stage });
    store.publishGrowth(view);
    await nextTick();
    assert.equal(all('[data-city-growth-rail]').length, 1, 'one rail');
    assert.deepEqual(
      all('[data-city-growth-stop]').map((stop) => [
        text(stop),
        stop.getAttribute('aria-pressed'),
      ]),
      ['NOW', '5 YR', '15 YR'].map((label, i) => [label, String(i === stage)]),
    );
    assert.deepEqual(
      all('[data-city-growth-line]').map((line) =>
        text(line.querySelector('[data-city-growth-text]') ?? line),
      ),
      growthLines(view.plan, stage).map((line) => line.text),
    );
    const shown = text($('[data-city-growth]'));
    assert.equal(shown.split('HOMES ').length - 1, 2, 'HOMES and “6 HOMES”');
    assert.equal(shown.match(/\b(575|659|755)\b/g).length, stage ? 2 : 1);
    assert.ok(!/GOAL SCORE|CANOPY/.test(shown));
  }
  assert.equal(
    text($('[data-city-growth-line="homes"]')),
    'HOMES 575 → 755 EST',
  );
  all('[data-city-growth-stop]')[1].click();
  $('[data-city-growth-step="1"]').click();
  $('[data-city-growth-step="-1"]').click();
  assert.deepEqual(calls, [
    ['stage', 1],
    ['stepStage', 1],
    ['stepStage', -1],
  ]);
});

test('an edited stage below an earlier one says so; an unknown rate leaves deliveries off', async (t) => {
  const { store, $, text } = await mount(t);
  store.publishGrowth(
    timeline({ stage: 2, storeys: [3, 4, 3], homesPerDelivery: null }),
  );
  await nextTick();
  assert.equal(
    text($('[data-city-growth-line="lowered"]')),
    'LOWER THAN AN EARLIER STAGE',
  );
  assert.equal($('[data-city-growth-line="deliveries"]'), null);
  assert.equal($('[data-city-growth-line="assumed"]'), null);
  assert.ok(!/DELIVER/.test(text($('[data-city-growth]'))));
});

test('a sun-locked block carries a SUN FIT badge where the owner places it, only while the timeline is on', async (t) => {
  const { store, $, all, text } = await mount(t);
  const locked = { locks: { [from.id]: 3 } };
  store.publishGrowth(timeline({ stage: 2, ...locked }));
  store.placeGrowth({
    locks: [{ plotId: from.id, at: { x: 610, y: 420 } }],
  });
  await nextTick();
  const badge = $('[data-city-growth-lock]');
  assert.equal(text(badge), 'Sun fit');
  assert.equal(badge.style.left, '610px');
  assert.equal(badge.style.top, '420px');
  assert.equal(
    text($('[data-city-growth-line="locked"]')),
    'LOCKED PLOTS KEEP THEIR SUN FIT',
  );
  store.publishGrowth(timeline({ on: false, ...locked }));
  await nextTick();
  assert.equal(all('[data-city-growth-lock]').length, 0);
});

test('a phone has no room for the timeline', async (t) => {
  const { store, $ } = await mount(t, 390);
  store.publishGrowth(timeline());
  await nextTick();
  assert.equal($('[data-city-growth]'), null);
});
