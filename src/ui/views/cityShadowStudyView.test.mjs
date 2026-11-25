import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityShadowStudy from './panels/CityShadowStudy.vue';
import { plotMassing } from '../../data/cityMassing.js';
import { snapPlot } from '../../data/cityPlot.js';
import { shadowFit } from '../../data/cityShadowFit.js';

const plot = snapPlot({ lat: 37.8007, lon: -122.4103 });

// What the globe owner publishes for a 3.2 m storey block at winter noon.
const SUN = { elevationDeg: 28.8, azimuthDeg: 180 };
function massingView({
  storeys = 6,
  wasStoreys = storeys,
  on = true,
  sun = SUN,
  ...shadow
} = {}) {
  const study = { on: true, edgeMeters: 20, ...shadow };
  const of = (count) => plotMassing({ corners: plot.corners, storeys: count });
  return {
    on,
    storeys,
    homes: of(storeys).homes,
    far: of(storeys).far,
    sunElevationDeg: sun?.elevationDeg ?? null,
    shadow: {
      picking: false,
      edgeSet: false,
      winter: true,
      was:
        wasStoreys === storeys
          ? null
          : { homes: of(wasStoreys).homes, far: of(wasStoreys).far },
      ...study,
      plan: study.on
        ? shadowFit({
            storeys,
            wasStoreys,
            storeyHeightMeters: 3.2,
            sun,
            edgeMeters: study.edgeMeters,
          })
        : null,
    },
  };
}

// The far side of a study line on screen, 120 px wide at height `y`.
const far = (y) => [
  { x: 660, y },
  { x: 780, y },
];

async function mount(t) {
  document.body.replaceChildren();
  for (const [key, value] of [
    ['innerWidth', 1440],
    ['innerHeight', 900],
  ])
    Object.defineProperty(window, key, { value, configurable: true });
  // The massing readout this panel sits beside, as laid out on screen.
  const readout = document.body.appendChild(document.createElement('div'));
  readout.setAttribute('data-city-massing', '');
  readout.getBoundingClientRect = () => ({
    left: 190,
    top: 320,
    right: 430,
    bottom: 580,
    width: 240,
    height: 260,
  });
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const calls = [];
  store.connectMassing(
    Object.fromEntries(
      ['study', 'stepEdge', 'pickEdge', 'winterNoon', 'fit'].map((name) => [
        name,
        (...args) => calls.push([name, ...args]),
      ]),
    ),
  );
  const app = createApp({ render: () => h(CityShadowStudy) }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await nextTick();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await nextTick();
  };
  const $ = (s) => document.querySelector(s);
  const text = (s) => $(s)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  const value = (id) =>
    text(`[data-city-shadow-row="${id}"] [data-city-shadow-value]`);
  return { store, calls, settle, $, text, value };
}

test('nothing shows until MASSING is on; then one PROTECT SIDEWALK toggle', async (t) => {
  const { store, calls, settle, $ } = await mount(t);
  await settle();
  assert.equal($('[data-city-shadow]'), null, 'no massing view');
  store.publishMassing(massingView({ on: false }));
  await settle();
  assert.equal($('[data-city-shadow]'), null, 'MASSING is off');
  const off = massingView();
  off.shadow = { ...off.shadow, on: false, plan: null };
  store.publishMassing(off);
  await settle();
  const toggle = $('[data-city-shadow-toggle]');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal($('[data-city-shadow-rows]'), null);
  assert.equal($('[data-city-shadow-tip]'), null);
  toggle.click();
  assert.deepEqual(calls, [['study']]);
});

test('before a fit: the plan on the sidewalk, the assumed distance and what FIT TO SUN would leave', async (t) => {
  const { store, calls, settle, $, text, value } = await mount(t);
  store.publishMassing(massingView());
  store.placeMassing({
    points: [],
    tips: { now: far(180), fit: far(260) },
  });
  await settle();
  assert.equal(
    text('[data-city-shadow-row="distance"] [data-city-shadow-value]'),
    '20 m',
  );
  assert.equal(text('[data-city-shadow-assumed]'), 'Assumed');
  assert.equal(value('sun'), '29° EST');
  assert.equal(value('floors'), '6 EST');
  assert.equal(
    text('[data-city-shadow-row="edge"] dt'),
    'Onto sidewalk',
    'the row names what the shadow does',
  );
  assert.equal(value('edge'), '15 m EST');
  assert.equal(text('[data-city-shadow-fit]'), 'Fit to sun · Floors 6 → 3 EST');
  assert.equal($('[data-city-shadow-fit]').disabled, false);
  assert.equal($('[data-city-shadow-winter]'), null, 'the scene is in winter');
  assert.equal($('[data-city-shadow-note]'), null, 'no change, no cost yet');
  // The two tips, worded by the shared formatter, at the ends of the lines.
  assert.equal(
    text('[data-city-shadow-tip="now"]'),
    'SHADOW NOW 35 m · 15 m ONTO SIDEWALK EST',
  );
  assert.equal(
    text('[data-city-shadow-tip="fit"]'),
    'FIT TO SUN 17 m · CLEARS SIDEWALK BY 3 m EST',
  );
  assert.equal($('[data-city-shadow-tip="was"]'), null);
  $('[data-city-shadow-edge="-1"]').click();
  $('[data-city-shadow-edge="1"]').click();
  $('[data-city-shadow-pick]').click();
  $('[data-city-shadow-fit]').click();
  assert.deepEqual(calls, [
    ['stepEdge', -1],
    ['stepEdge', 1],
    ['pickEdge'],
    ['fit'],
  ]);
});

test('after a fit: FLOORS 6 → 3 EST, the shadow clears, WAS and NOW at the tips', async (t) => {
  const { store, settle, $, text, value } = await mount(t);
  store.publishMassing(
    massingView({ storeys: 3, wasStoreys: 6, edgeSet: true }),
  );
  store.placeMassing({
    points: [],
    tips: { was: far(180), now: far(260) },
  });
  await settle();
  assert.equal(value('floors'), '6 → 3 EST');
  // What the cut cost, through the same formatter.
  assert.equal(
    text('[data-city-shadow-cost]'),
    'Homes 46 → 23 EST · FAR 3.84 → 1.92',
  );
  assert.equal(text('[data-city-shadow-row="edge"] dt'), 'Clears sidewalk by');
  assert.equal(value('edge'), '3 m EST');
  assert.equal($('[data-city-shadow-assumed]'), null, 'the player set it');
  assert.equal(text('[data-city-shadow-fit]'), 'Fit to sun');
  assert.equal($('[data-city-shadow-fit]').disabled, true, 'nothing to cut');
  assert.equal(
    text('[data-city-shadow-tip="was"]'),
    'SHADOW WAS 35 m · 15 m ONTO SIDEWALK EST',
  );
  assert.equal(
    text('[data-city-shadow-tip="now"]'),
    'SHADOW NOW 17 m · CLEARS SIDEWALK BY 3 m EST',
  );
  // The tips do not sit on each other or on the readout.
  const boxes = ['was', 'now'].map((kind) => {
    const { left, top } = $(`[data-city-shadow-tip="${kind}"]`).style;
    return [parseFloat(left), parseFloat(top)];
  });
  assert.ok(
    Math.abs(boxes[0][1] - boxes[1][1]) >= 30 ||
      Math.abs(boxes[0][0] - boxes[1][0]) >= 300,
    `tips apart: ${JSON.stringify(boxes)}`,
  );
});

test('outside winter WINTER NOON is offered; armed, the panel says where to click', async (t) => {
  const { store, calls, settle, $, text } = await mount(t);
  store.publishMassing(massingView({ winter: false, picking: true }));
  await settle();
  $('[data-city-shadow-winter]').click();
  assert.deepEqual(calls, [['winterNoon']]);
  assert.equal(
    $('[data-city-shadow-pick]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    text('[data-city-shadow-note]'),
    'Click the ground across the street',
  );
});

test('sun down: dashes, never zero, and FIT TO SUN is disabled; one storey that still reaches is flagged', async (t) => {
  const { store, settle, $, text, value } = await mount(t);
  store.publishMassing(massingView({ sun: { elevationDeg: -12 } }));
  await settle();
  assert.equal(value('sun'), '—');
  assert.equal(value('edge'), '—');
  assert.equal($('[data-city-shadow-fit]').disabled, true);
  assert.equal(
    text('[data-city-shadow-note]'),
    'The sun is down: no shadow to fit',
  );
  assert.equal($('[data-city-shadow-tip]'), null);
  store.publishMassing(massingView({ edgeMeters: 4 }));
  await settle();
  assert.equal(text('[data-city-shadow-fit]'), 'Fit to sun · Floors 6 → 1 EST');
  assert.equal(
    text('[data-city-shadow-note]'),
    'Even one storey reaches the sidewalk',
  );
});

test('a phone keeps the massing readout alone', async (t) => {
  const { store, settle, $ } = await mount(t);
  Object.defineProperty(window, 'innerWidth', {
    value: 390,
    configurable: true,
  });
  window.dispatchEvent(new window.Event('resize'));
  store.publishMassing(massingView());
  await settle();
  assert.equal($('[data-city-shadow]'), null);
});
