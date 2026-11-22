import test from 'node:test';
import assert from 'node:assert/strict';
import { replayMoves, resourceChips } from '../data/cityScore.js';

// The figure rules of the City builder design loop (city-dream hud.py:
// display, after, fmt_errors), ported case by case. hud.py formats a whole
// line ('SHADOW 15.59 m EST'); the app keeps the label in its own element, so
// each case here is the figure after the label.
const figure = async (input) =>
  (await import('./cityHudFigure.js')).hudFigure(input);
const table = (name, rows) =>
  test(name, async () => {
    for (const [input, want] of rows)
      assert.equal(await figure(input), want, JSON.stringify(input));
  });

// test_c9_estimates_lose_false_precision
table(
  'an estimate carries EST and loses false precision; a measured value keeps its digits',
  [
    [{ value: 15.59, unit: 'm', estimate: true }, '~16 m EST'],
    [{ value: 4.41, unit: 'm', estimate: true }, '~4.4 m EST'],
    [{ value: 3.84 }, '3.84'],
    [{ value: 3.8415 }, '3.8415'],
  ],
);

// test_r042_equal_pair_reads_as_unchanged_not_a_delta
table('an equal pair is not a change; a real change reads before → after', [
  [{ before: 6, value: 6, unit: 'spaces', estimate: true }, '6 spaces EST'],
  [{ before: 0, value: 2.4, unit: 'm', estimate: true }, '0 → 2.4 m EST'],
]);

// test_r047_ticker_keeps_every_figure_and_whole_sentences_of_the_cost (hud.after)
table(
  'a change shows before → after; the figure a later screen carries is the after value',
  [
    [{ before: 15, value: 10, unit: 'min', estimate: true }, '15 → 10 min EST'],
    [{ value: 10, unit: 'min', estimate: true }, '10 min EST'],
    [{ before: 450, value: 600, estimate: true }, '450 → 600 EST'],
    [{ before: 1800, value: 900, unit: 'veh/h' }, '1,800 → 900 veh/h'],
    [
      { before: 15.59, value: 12.25, unit: 'm', estimate: true },
      '~16 → ~12 m EST',
    ],
    [{ before: null, value: 10, unit: 'min', estimate: true }, '10 min EST'],
    [{ before: NaN, value: 10, unit: 'min', estimate: true }, '10 min EST'],
  ],
);

// test_r030_formatter_refuses_placeholders ('WALK ACCESS · CALCULATING', 'HOMES EST · —')
table('a placeholder is no figure: nothing is returned to draw', [
  [{ value: '—', estimate: true }, null],
  [{ value: 'CALCULATING', estimate: true }, null],
  [{ value: 'N/A', unit: 'm' }, null],
  [{ value: 'TBD' }, null],
  [{ before: 12, value: '—', estimate: true }, null],
]);

// test_formatter_empty_display
table('an empty or non-finite value is no figure', [
  [{ value: '' }, null],
  [{ value: null, unit: '%', estimate: true }, null],
  [{ value: undefined, estimate: true }, null],
  [{ value: NaN, unit: '%', estimate: true }, null],
  [{ value: Infinity, unit: 'm' }, null],
  [{}, null],
]);

// The app's own figures (resource bar, plot tag, legend, cards, callouts, pins).
table(
  'play HUD figures: counts and grid areas are exact, proposal figures are estimates',
  [
    [{ value: 1 }, '1'],
    [{ value: 0 }, '0'],
    [{ value: 1600, unit: 'm²' }, '1,600 m²'],
    [{ value: 100, unit: '%' }, '100%'],
    [{ value: 24, estimate: true }, '24 EST'],
    [{ value: 60, unit: '%', estimate: true }, '60% EST'],
    [{ value: 3, unit: 'm', estimate: true }, '3 m EST'],
    [{ value: 2.5, unit: 'm', estimate: true }, '2.5 m EST'],
    [{ value: 900, unit: 'veh/lane/h', estimate: true }, '900 veh/lane/h EST'],
    [{ value: 130 / 3, unit: '%', estimate: true }, '~43% EST'],
    [{ value: 0.257, estimate: true }, '~0.26 EST'],
    [{ value: 1234.56, unit: 'm', estimate: true }, '~1,200 m EST'],
    [{ before: 15.59, value: 15.61, unit: 'm', estimate: true }, '~16 m EST'],
  ],
);

test('a plan-score chip (#316 resourceChips) formats as a before → after estimate', async () => {
  const chips = resourceChips(
    replayMoves([{ headway_min: [null, 10], homes: [450, 600] }]),
  );
  const shown = [];
  for (const chip of chips)
    shown.push([
      chip.metric,
      await figure({
        before: chip.base,
        value: chip.value,
        unit: chip.unit,
        estimate: true,
      }),
    ]);
  assert.deepEqual(shown, [
    ['headway_min', '15 → 10 min EST'],
    ['homes', '450 → 600 EST'],
  ]);
});
