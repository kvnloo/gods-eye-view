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
import {
  createPedestrianGraph,
  evaluateWalkAccess,
} from '../../data/walkAccess.js';
import { WALK_ACCESS_FIXTURE as NETWORK } from '../../data/walkAccessFixture.js';
import { setLocale, t as tr } from '../../i18n/index.js';
import {
  PERSISTENCE_NEIGHBOR as neighbor,
  PERSISTENCE_PLOT as plot,
  PERSISTENCE_REFERENCE,
} from '../../testSupport/cityPersistenceFixture.mjs';
import { hudFigure } from '../cityHudFigure.js';
import {
  carouselCards,
  plotCode,
  resourceStats,
  wheelActions,
} from '../cityPlayModel.js';
import { presentCityWalkAccess } from '../cityWalkAccess.js';
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityPlayOverlay from './panels/CityPlayOverlay.vue';

// The play bar (the stat strip at the top of City builder play mode) never
// shows a figure it does not have: no bare dash, no placeholder word. A value
// the app holds is drawn by the HUD formatter (cityHudFigure.js); one it does
// not hold leaves its field off the strip. Walk access is the walk-access
// module's own estimate for the focused world (mean metres to the nearest
// park), computed here straight from the #313 function on its fixture network.
const graph = createPedestrianGraph(NETWORK);
const siteA = NETWORK.sites.find((s) => s.id === 'site-a');
const withSiteA = evaluateWalkAccess({
  graph,
  zones: NETWORK.zones,
  parks: [...NETWORK.parks, siteA],
});

const BARE = /^\s*[–—\-…]+\s*$/;
const WORD = /^\s*(PENDING|CALCULATING|N\/A|UNKNOWN)\s*$/i;

// A pocket park as Reimagine makes it (24 trees, 3 m, 60 % shade). `site` is
// the walk-access candidate site, chosen in the project records; play mode
// itself never sets one.
function world(site) {
  return {
    id: 'world-1',
    title: 'Pocket park',
    description: 'A possible world on the fixture plot.',
    parameters: {
      kind: 'park',
      trees: 24,
      widthMeters: 3,
      shadePercent: 60,
      ...(site === undefined ? {} : { site }),
    },
    site: { plot, reference: null },
  };
}
function project(input) {
  let doc = createCityDocument({
    id: 'strip',
    title: 'Strip',
    reference: PERSISTENCE_REFERENCE,
  });
  if (!input) return doc;
  doc = addCityAlternative(doc, input);
  return attachCityConcept(doc, input.id, 1, {
    prompt: 'A pocket park on the fixture plot.',
    provider: 'fixture',
    generatedAt: PERSISTENCE_REFERENCE.capturedAt,
    sourceView: PERSISTENCE_REFERENCE,
    image: PERSISTENCE_REFERENCE.image,
  });
}

const count = (id, value) => [id, { value }];
const PROJECT_OF_ONE = [
  count('plots', 1),
  count('worlds', 1),
  count('concepts', 1),
  ['trees', { value: 24, estimate: true }],
  ['shade', { value: 60, unit: '%', estimate: true }],
];
const CANOPY = [
  'move:canopy_pct',
  { before: 18, value: 60, unit: '%', estimate: true },
];
const WALK = [
  'walk',
  { value: withSiteA.meanMeters, unit: 'm', estimate: true },
];
// The row #323 adds to the walk-access comparison for its #206 suggestion: an
// option the study proposes, not a world of this plan.
const SUGGESTION = {
  id: 'suggestion',
  label: 'Suggested option',
  state: 'evaluated',
  meanMeters: withSiteA.meanMeters,
};

// `want` is the whole strip, in order: [field, the raw figure it must draw].
// `text` pins the English wording of the same fields.
const CASES = [
  {
    name: '(a) no plot selected and no project: nothing to state',
    alternatives: null,
    selected: false,
    want: [],
    text: [],
  },
  {
    name: '(b) a plot selected, no concept: the counts, no estimate of nothing',
    alternatives: cityAlternatives(project()),
    want: [count('plots', 0), count('worlds', 0), count('concepts', 0)],
    text: ['0', '0', '0'],
  },
  {
    name: '(c) a concept on a walk-access site: the walk-access estimate',
    alternatives: cityAlternatives(project(world('site-a'))),
    want: [...PROJECT_OF_ONE, WALK, CANOPY],
    text: ['1', '1', '1', '24 EST', '60% EST', null, '18 → 60% EST'],
    walk: true,
  },
  {
    name: '(d) a concept with no walk-access site: the field is left off',
    alternatives: cityAlternatives(project(world())),
    want: [...PROJECT_OF_ONE, CANOPY],
    text: ['1', '1', '1', '24 EST', '60% EST', '18 → 60% EST'],
  },
  {
    name: '(e) a #206 suggestion beside a world off the network: not borrowed',
    alternatives: cityAlternatives(project(world('site-zz'))),
    extraRows: [SUGGESTION],
    want: [...PROJECT_OF_ONE, CANOPY],
    text: ['1', '1', '1', '24 EST', '60% EST', '18 → 60% EST'],
  },
  {
    name: '(f) German: the same strip, worded and formatted for the locale',
    locale: 'de',
    alternatives: cityAlternatives(project(world('site-a'))),
    want: [...PROJECT_OF_ONE, WALK, CANOPY],
    walk: true,
  },
];

// The view as the globe owner publishes it (src/standalone/cityPlay.js): the
// walk map holds the mean metres of every evaluated row of the walk-access
// comparison, keyed by row id.
async function strip(t, c) {
  document.body.replaceChildren();
  const alternatives = c.alternatives;
  const list = alternatives ?? [];
  const selected = c.selected !== false;
  const focused = list[0] ?? null;
  const rows = [...presentCityWalkAccess(list).rows, ...(c.extraRows ?? [])];
  const walk = Object.fromEntries(
    rows
      .filter((r) => r.id !== 'baseline' && r.state === 'evaluated')
      .map((r) => [r.id, r.meanMeters]),
  );
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const app = createApp({ render: () => h(CityPlayOverlay) }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  store.publish({
    active: true,
    tier: 'plot',
    wheelOpen: false,
    pending: false,
    framing: false,
    error: null,
    status: null,
    stats: resourceStats(alternatives, { walk, focusId: focused?.id }),
    plot: selected
      ? { id: plot.id, code: plotCode(plot), area: 1600, size: 40 }
      : null,
    actions: wheelActions({}),
    cards: selected
      ? carouselCards(list, plot.id, {
          focusId: focused?.id,
          ...(c.zoning ? { zoning: c.zoning } : {}),
        })
      : [],
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
    callouts: [],
    pins: [],
  });
  store.place({
    plot: selected ? { x: 700, y: 400 } : null,
    callouts: {},
    pins: {},
  });
  await nextTick();
  await nextTick();
  const bar = document.querySelector('[data-city-play-bar]');
  assert.ok(bar, 'the strip is on screen');
  return {
    walk,
    items: [...bar.querySelectorAll('.city-play-stat')].map((el) => ({
      id: el.dataset.cityPlayStat ?? `move:${el.dataset.cityPlayMove}`,
      label: el.querySelector('.city-play-stat-label').textContent,
      value: el.querySelector('.city-play-stat-value').textContent,
    })),
  };
}

for (const c of CASES) {
  test(`play strip: ${c.name}`, async (t) => {
    t.after(() => setLocale('en'));
    setLocale(c.locale ?? 'en');
    const { items, walk } = await strip(t, c);

    for (const { id, label, value } of items) {
      assert.ok(label.trim(), `${id}: labelled`);
      assert.ok(value.trim(), `${id}: a value`);
      assert.doesNotMatch(value, BARE, `${id}: a bare placeholder`);
      assert.doesNotMatch(value, WORD, `${id}: a placeholder word`);
    }
    // Every figure is the HUD formatter's text for the raw value, and a field
    // with no value is not on the strip at all.
    assert.deepEqual(
      items.map(({ id, value }) => [id, value]),
      c.want.map(([id, figure]) => [id, hudFigure(figure)]),
    );
    if (c.text)
      assert.deepEqual(
        items.map((i) => i.value).filter((_, i) => c.text[i] !== null),
        c.text.filter((text) => text !== null),
      );

    const shown = items.find((i) => i.id === 'walk');
    if (c.walk) {
      // The value is the #313 function's, reached through the comparison row.
      assert.equal(withSiteA.status, 'evaluated');
      assert.equal(walk['world-1'], withSiteA.meanMeters);
      assert.equal(shown.label, tr('Walk access'));
      assert.match(
        shown.value,
        c.locale ? /^~?[\d.,\s]+ m \S+$/ : /^~?[\d,]+ m EST$/,
      );
    } else {
      assert.equal(shown, undefined, 'no walk-access figure to state');
      if (c.extraRows)
        assert.ok(
          !items.some((i) => i.value === hudFigure(WALK[1])),
          'a suggestion is not this plan’s walk access',
        );
    }
    if (c.locale) {
      const est = tr('EST', { context: 'estimated value' });
      assert.notEqual(est, 'EST', 'the estimate mark is translated');
      assert.ok(shown.value.endsWith(` ${est}`), shown.value);
      assert.notEqual(shown.label, 'Walk access', 'the label is translated');
    }
  });
}

// A before → after pair never mixes scopes. The canopy chip is a plan figure:
// its before is the goal table's plan baseline, so its after is the plan's
// canopy with this world built, weighted by land area over every plot of the
// plan (a plot with a world or a proposed land use), the others at the
// baseline. One plot's 60 % against the plan's 18 % would be two scopes.
test('play strip: (g) two plots, one reimagined: the canopy chip is the plan figure, weighted by area', async (t) => {
  const doc = setCityZoning(project(world()), neighbor, 'housing');
  const { items } = await strip(t, {
    alternatives: cityAlternatives(doc),
    zoning: cityZoning(doc),
  });
  const [own, other] = [plot, neighbor].map((p) => p.areaSquareMeters);
  const plan = (60 * own + 18 * other) / (own + other);
  assert.equal(plan, 39);
  const chip = items.find((i) => i.id === 'move:canopy_pct');
  assert.equal(chip.label, tr('Canopy'));
  assert.equal(
    chip.value,
    '18 → 39% EST',
    'the plan with this world, not one plot against the plan',
  );
  assert.deepEqual(
    items.map(({ id, value }) => [id, value]),
    [
      ...PROJECT_OF_ONE,
      [
        'move:canopy_pct',
        { before: 18, value: plan, unit: '%', estimate: true },
      ],
    ].map(([id, figure]) => [id, hudFigure(figure)]),
  );
  for (const { id, value } of items) {
    assert.doesNotMatch(value, BARE, `${id}: a bare placeholder`);
    assert.doesNotMatch(value, WORD, `${id}: a placeholder word`);
  }
});
