import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import {
  addCityAlternative,
  cityAlternatives,
  createCityDocument,
  reviseCityAlternative,
} from '../../data/cityPlanningDocument.js';
import { replayMoves, resourceChips } from '../../data/cityScore.js';
import { formatNumber } from '../../i18n/index.js';
import {
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
import { useCityPlayStore } from '../stores/cityPlay.js';
import CityPlayOverlay from './panels/CityPlayOverlay.vue';

// The plan-score chips of the play bar: one per goal the focused possible
// world moves, each a before → after pair whose before is the goal table's
// baseline. The baselines are read from the document the score model is
// tested against (score-golden.json), never recomputed here.
const { goals } = JSON.parse(
  readFileSync(
    new URL('../../data/__fixtures__/score-golden.json', import.meta.url),
  ),
);

const world = (id, kind, trees, widthMeters, shadePercent) => ({
  id,
  title: `${kind} ${id}`,
  description: 'A possible world on the fixture plot.',
  parameters: { kind, trees, widthMeters, shadePercent },
  site: { plot, reference: null },
});
function project(...worlds) {
  let doc = createCityDocument({
    id: 'score-chips',
    title: 'Score chips',
    reference: PERSISTENCE_REFERENCE,
  });
  for (const input of worlds) doc = addCityAlternative(doc, input);
  return doc;
}
const revised = (doc, id, parameters) =>
  reviseCityAlternative(doc, id, 1, {
    title: 'Revised',
    description: 'The same world with another target.',
    parameters,
  });

// `moves` is what the possible world does to the goals, as the #316 score
// model takes it: [null, after] leaves the before to the goal table. `want` is
// the bar, in order. `stale` is a figure an earlier version or another world
// of the same plot holds for a goal; it must never be the before.
const CASES = [
  {
    name: 'a pocket park raises canopy from the baseline',
    doc: project(world('world-1', 'park', 24, 3, 60)),
    moves: { canopy_pct: [null, 60] },
    want: [['canopy_pct', '18 → 60% EST']],
  },
  {
    name: 'a plaza raises canopy from the baseline',
    doc: project(world('world-1', 'plaza', 12, 8, 45)),
    moves: { canopy_pct: [null, 45] },
    want: [['canopy_pct', '18 → 45% EST']],
  },
  {
    name: 'a bike lane moves bike width and canopy',
    doc: project(world('world-1', 'bike-lane', 10, 2.5, 30)),
    moves: { bike_m: [null, 2.5], canopy_pct: [null, 30] },
    want: [
      ['bike_m', '0 → 2.5 m EST'],
      ['canopy_pct', '18 → 30% EST'],
    ],
  },
  {
    name: 'a park at the baseline canopy moves nothing: no chip',
    doc: project(world('world-1', 'park', 24, 3, 18)),
    moves: { canopy_pct: [null, 18] },
    want: [],
  },
  {
    name: 'a bike lane at the baseline canopy shows the bike chip only',
    doc: project(world('world-1', 'bike-lane', 10, 2.5, 18)),
    moves: { bike_m: [null, 2.5], canopy_pct: [null, 18] },
    want: [['bike_m', '0 → 2.5 m EST']],
  },
  {
    name: 'a revised park still starts from the baseline, not from version 1',
    doc: revised(project(world('world-1', 'park', 24, 3, 60)), 'world-1', {
      kind: 'park',
      trees: 30,
      widthMeters: 3,
      shadePercent: 80,
    }),
    moves: { canopy_pct: [null, 80] },
    want: [['canopy_pct', '18 → 80% EST']],
    stale: { canopy_pct: 60 },
  },
  {
    name: 'a second world starts from the baseline, not from the first world',
    doc: project(
      world('world-1', 'park', 24, 3, 60),
      world('world-2', 'bike-lane', 10, 2.5, 30),
    ),
    focus: 'world-2',
    moves: { bike_m: [null, 2.5], canopy_pct: [null, 30] },
    want: [
      ['bike_m', '0 → 2.5 m EST'],
      ['canopy_pct', '18 → 30% EST'],
    ],
    stale: { canopy_pct: 60 },
  },
  {
    name: 'a fall is a move, and false precision is rounded by the formatter',
    doc: project(world('world-1', 'bike-lane', 4, 2.75, 10)),
    moves: { bike_m: [null, 2.75], canopy_pct: [null, 10] },
    want: [
      ['bike_m', '0 → ~2.8 m EST'],
      ['canopy_pct', '18 → 10% EST'],
    ],
  },
];

async function bar(t, alternatives, focusId) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useCityPlayStore(pinia);
  const cards = carouselCards(alternatives, plot.id, { focusId });
  const focused = alternatives.find((a) => a.id === focusId);
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
    stats: resourceStats(alternatives),
    plot: { id: plot.id, code: plotCode(plot), area: 1600, size: 40 },
    actions: wheelActions({}),
    cards,
    focused: {
      id: focused.id,
      title: focused.title,
      kind: focused.parameters.kind,
      icon: 'park',
      parameters: focused.parameters,
      revision: focused.revision,
      concept: false,
      built: false,
    },
    callouts: [],
    pins: [],
  });
  store.place({ plot: { x: 700, y: 400 }, callouts: {}, pins: {} });
  await nextTick();
  await nextTick();
  return {
    card: cards.find((c) => c.id === focusId),
    chips: [
      ...document.querySelectorAll(
        '[data-city-play-bar] [data-city-play-move]',
      ),
    ],
  };
}

for (const c of CASES) {
  test(`score chips: ${c.name}`, async (t) => {
    const focusId = c.focus ?? 'world-1';
    const { card, chips } = await bar(t, cityAlternatives(c.doc), focusId);
    assert.ok(Array.isArray(card.moves), 'the card carries its score moves');

    // The scores the #316 model moves for this world, with their baselines.
    const moved = resourceChips(replayMoves([c.moves]));
    const shown = chips.map((el) => [
      el.dataset.cityPlayMove,
      el.querySelector('.city-play-stat-value').textContent,
    ]);
    assert.deepEqual(
      shown.map(([metric]) => metric).sort(),
      moved.map((chip) => chip.metric).sort(),
      'one chip per moved score, none for an unmoved one',
    );
    assert.deepEqual(shown, c.want);

    for (const chip of moved) {
      const { base, unit } = goals.weights[chip.metric];
      const text = Object.fromEntries(shown)[chip.metric];
      assert.equal(chip.base, base, `${chip.metric}: the document's baseline`);
      assert.equal(
        text,
        hudFigure({ before: base, value: chip.value, unit, estimate: true }),
        `${chip.metric}: drawn by the HUD formatter`,
      );
      assert.ok(text.startsWith(`${formatNumber(base)} → `), text);
      assert.match(text, / EST$/);
      const stale = c.stale?.[chip.metric];
      if (stale !== undefined) {
        assert.notEqual(stale, base);
        assert.ok(!text.startsWith(`${formatNumber(stale)} `), text);
      }
    }
    for (const el of chips)
      assert.ok(
        el.querySelector('.city-play-stat-label').textContent.trim(),
        'every chip is labelled',
      );
  });
}
