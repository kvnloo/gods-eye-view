import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import {
  addCityAlternative,
  attachCityConcept,
  cityAlternatives,
  cityZoning,
  createCityDocument,
  setCityZoning,
} from '../../data/cityPlanningDocument.js';
import { setLocale, t as tr } from '../../i18n/index.js';
import {
  PERSISTENCE_NEIGHBOR as neighbor,
  PERSISTENCE_PLOT as plot,
  PERSISTENCE_REFERENCE,
} from '../../testSupport/cityPersistenceFixture.mjs';
import { hudFigure } from '../cityHudFigure.js';
import {
  carouselCards,
  detailCallouts,
  districtPins,
  plotAlternatives,
  plotCode,
  resourceStats,
  wheelActions,
  zoneLegend,
} from '../cityPlayModel.js';
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityPlayOverlay from './panels/CityPlayOverlay.vue';

// A player never reads an internal code. The plot tag, the reimagined tag, the
// concept cards, the callouts, the district pins, the land-use legend, the
// play bar and every tooltip of City builder play mode name a plot by what a
// player can see: the word "Plot" and its area, drawn by the HUD formatter
// (cityHudFigure.js). The grid id (`plot-n105199-126638`) and its short code
// (`N5199-6638`) stay in the data: attributes, records, the published view.
const IDS = [plot, neighbor].flatMap((p) => [p.id, plotCode(p)]);
const GRID_CODE = /\b[NWR]?\d{3,}-\d{3,}\b/;
const OSM_ID = /\b(node|way|relation)\/?\d+/i;
const NO_VALUE = /undefined|null|NaN|(^|\s)[–—-]+(\s|$)/;

function world() {
  return {
    id: 'world-1',
    title: 'Pocket park',
    description: 'A possible world on the fixture plot.',
    parameters: { kind: 'park', trees: 24, widthMeters: 3, shadePercent: 60 },
    site: { plot, reference: null },
  };
}
function project({ reimagined = false, zoned = false } = {}) {
  let doc = createCityDocument({
    id: 'label',
    title: 'Label',
    reference: PERSISTENCE_REFERENCE,
  });
  if (reimagined) {
    doc = addCityAlternative(doc, world());
    doc = attachCityConcept(doc, 'world-1', 1, {
      prompt: 'A pocket park on the fixture plot.',
      provider: 'fixture',
      generatedAt: PERSISTENCE_REFERENCE.capturedAt,
      sourceView: PERSISTENCE_REFERENCE,
      image: PERSISTENCE_REFERENCE.image,
    });
  }
  return zoned ? setCityZoning(doc, neighbor, 'housing') : doc;
}

// The view as the globe owner publishes it (src/standalone/cityPlay.js
// present()), `code` included: the overlay holds the code and must not print it.
function playView(
  doc,
  { selected = plot, tier = 'plot', wheelOpen = false, area },
) {
  const alternatives = cityAlternatives(doc);
  const zoning = cityZoning(doc);
  const focused = plotAlternatives(alternatives, selected.id).at(-1) ?? null;
  const use = zoning.find((z) => z.plot.id === selected.id)?.use ?? null;
  return {
    active: true,
    tier,
    wheelOpen,
    pending: false,
    framing: false,
    error: null,
    status: null,
    stats: resourceStats(alternatives, { focusId: focused?.id }),
    plot: {
      id: selected.id,
      code: plotCode(selected),
      area: area === undefined ? selected.areaSquareMeters : area,
      size: selected.sizeMeters,
      use,
    },
    actions: wheelActions({ use }),
    legend: tier === 'district' && zoning.length ? zoneLegend(zoning) : null,
    cards: carouselCards(alternatives, selected.id, {
      focusId: focused?.id,
      zoning,
    }),
    focused: focused && {
      id: focused.id,
      title: focused.title,
      kind: focused.parameters.kind,
      icon: 'park',
      parameters: focused.parameters,
      revision: focused.revision,
      concept: Boolean(focused.concept),
      built: false,
    },
    callouts: tier === 'detail' ? detailCallouts(focused) : [],
    pins: tier === 'district' ? districtPins(alternatives, {}, { zoning }) : [],
  };
}
const ANCHORS = {
  plot: { x: 700, y: 400 },
  holo: { x: 700, y: 300 },
  footprint: [
    { x: 620, y: 460 },
    { x: 780, y: 460 },
    { x: 780, y: 340 },
    { x: 620, y: 340 },
  ],
  callouts: {
    kind: { x: 760, y: 440 },
    trees: { x: 640, y: 430 },
    shade: { x: 750, y: 360 },
    width: { x: 660, y: 350 },
  },
  pins: { [plot.id]: { x: 500, y: 300 }, [neighbor.id]: { x: 800, y: 320 } },
};

// Everything a player can read or hear on the overlay: the text outside
// aria-hidden parts, and the tooltip, label and image-alt attributes.
function visibleStrings(root) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) out.push(node.textContent.trim());
      return;
    }
    if (node.nodeType !== 1 || node.getAttribute('aria-hidden') === 'true')
      return;
    for (const name of ['title', 'aria-label', 'alt', 'placeholder']) {
      const value = node.getAttribute(name);
      if (value?.trim()) out.push(value.trim());
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

async function screen(t, view) {
  document.body.replaceChildren();
  for (const [name, value] of [
    ['innerWidth', 1440],
    ['innerHeight', 1000],
  ])
    Object.defineProperty(window, name, { value, configurable: true });
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const app = createApp({ render: () => h(CityPlayOverlay) }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  store.publish(view);
  store.place(ANCHORS);
  await nextTick();
  await nextTick();
  await nextTick();
  const root = document.querySelector('[data-city-play]');
  assert.ok(root, 'play mode is on screen');
  return {
    strings: visibleStrings(root),
    label: (selector) =>
      root.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim(),
    count: (selector) => root.querySelectorAll(selector).length,
  };
}

const TAG = '[data-city-play-tag]';
const HOLO = '[data-city-play-holo-tag]';

// Each case is one or more screens of one project. `label` is the element that
// names the selected plot on that screen; `parts` are elements that must be on
// screen, so a screen that fails to mount cannot pass as "no id visible".
const CASES = [
  {
    name: '(a) a plot selected: the plot tag reads the area, not the code',
    area: true,
    screens: [
      {
        doc: project(),
        wheelOpen: true,
        label: TAG,
        parts: ['[data-city-play-wheel]', '[data-city-play-stat]'],
      },
    ],
  },
  {
    name: '(b) a plot reimagined: the tag on the concept reads the area',
    area: true,
    screens: [
      {
        doc: project({ reimagined: true }),
        label: HOLO,
        parts: ['[data-city-play-card="world-1"]', '[data-city-play-move]'],
      },
    ],
  },
  {
    name: '(c) two plots, one reimagined: pins, legend, tags, callouts and stats card',
    area: true,
    screens: [
      {
        doc: project({ reimagined: true, zoned: true }),
        tier: 'district',
        label: null,
        parts: [
          `[data-city-play-pin="${plot.id}"]`,
          `[data-city-play-pin="${neighbor.id}"]`,
          '[data-city-play-legend-row="housing"]',
        ],
      },
      {
        doc: project({ reimagined: true, zoned: true }),
        selected: neighbor,
        wheelOpen: true,
        label: TAG,
        parts: ['[data-city-play-tag-use]', '[data-city-play-wheel]'],
      },
      {
        doc: project({ reimagined: true, zoned: true }),
        tier: 'detail',
        label: HOLO,
        parts: ['[data-city-play-callout="kind"]', '[data-city-play-stats]'],
      },
    ],
  },
  {
    name: '(d) a plot with no area data: the label is the word alone, no code, no placeholder',
    area: false,
    screens: [
      { doc: project(), wheelOpen: true, area: null, label: TAG, parts: [] },
      {
        doc: project({ reimagined: true }),
        area: null,
        label: HOLO,
        parts: ['[data-city-play-card="world-1"]'],
      },
    ],
  },
  {
    name: '(e) German: the same labels, worded and formatted for the locale',
    locale: 'de',
    area: true,
    screens: [
      { doc: project(), wheelOpen: true, label: TAG, parts: [] },
      {
        doc: project({ reimagined: true }),
        label: HOLO,
        parts: ['[data-city-play-card="world-1"]'],
      },
    ],
  },
];

for (const c of CASES) {
  test(`plot label: ${c.name}`, async (t) => {
    t.after(() => setLocale('en'));
    setLocale(c.locale ?? 'en');
    for (const [index, s] of c.screens.entries()) {
      const at = `screen ${index + 1}`;
      const { strings, label, count } = await screen(t, playView(s.doc, s));
      for (const part of s.parts)
        assert.ok(count(part), `${at}: ${part} is on screen`);

      // No visible string carries a plot id, a grid code or an OSM-style id.
      for (const text of [...strings, strings.join(' ')]) {
        for (const id of IDS)
          assert.ok(
            !text.toLowerCase().includes(id.toLowerCase()),
            `${at}: internal id ${id} in "${text}"`,
          );
        assert.doesNotMatch(text, GRID_CODE, `${at}: a grid code`);
        assert.doesNotMatch(text, OSM_ID, `${at}: an OSM id`);
      }

      if (!s.label) continue;
      const text = label(s.label);
      assert.ok(text, `${at}: ${s.label} names the plot`);
      const word = tr('Plot');
      if (c.area) {
        // The area is the HUD formatter's text for the plot's own area.
        const area = hudFigure({ value: plot.areaSquareMeters, unit: 'm²' });
        assert.ok(
          text.startsWith(`${word} · ${area}`),
          `${at}: "${text}" starts with "${word} · ${area}"`,
        );
        if (!c.locale)
          assert.ok(text.startsWith('Plot · 1,600 m²'), `${at}: "${text}"`);
      } else {
        assert.ok(
          text.startsWith(word),
          `${at}: "${text}" starts with "${word}"`,
        );
        assert.doesNotMatch(
          text,
          NO_VALUE,
          `${at}: a placeholder for the missing area`,
        );
        assert.doesNotMatch(text, /m²/, `${at}: no area to state`);
      }
      if (s.label === HOLO)
        assert.ok(text.endsWith(tr('Reimagined')), `${at}: "${text}"`);
      if (c.locale) {
        assert.notEqual(word, 'Plot', 'the word is translated');
        assert.doesNotMatch(
          text,
          /1,600/,
          'the area is formatted for the locale',
        );
      }
    }
  });
}
