import test from 'node:test';
import assert from 'node:assert/strict';
import { plotBlock, snapPlot } from '../data/cityPlot.js';
import { createPlayState, playReducer } from './cityPlayModel.js';

const plotA = snapPlot({ lat: 37.7694, lon: -122.4262 });
const plotB = snapPlot({ lat: 37.7704, lon: -122.4252 });
const block = plotBlock(plotA, plotB);

test('a district is the selected plot’s block: it needs the mode and a selected plot, and the wheel steps aside', () => {
  const idle = createPlayState();
  assert.equal(idle.district, undefined, 'a key only while one is selected');
  assert.equal(playReducer(idle, { type: 'district', plots: block }), idle);
  const entered = playReducer(idle, { type: 'enter' });
  assert.equal(
    playReducer(entered, { type: 'district', plots: block }),
    entered,
    'no selected plot to start from',
  );
  const selected = playReducer(entered, { type: 'select', plot: plotA });
  assert.equal(selected.wheel, true);
  assert.equal(
    playReducer(selected, { type: 'district', plots: [] }),
    selected,
  );
  const district = playReducer(selected, { type: 'district', plots: block });
  assert.equal(district.district, block);
  assert.equal(district.plot, plotA, 'the selected plot stays its anchor');
  assert.equal(district.wheel, false);
});

test('a plain select, a clear, an exit and a new entry each drop the district', () => {
  const district = playReducer(
    playReducer(playReducer(createPlayState(), { type: 'enter' }), {
      type: 'select',
      plot: plotA,
    }),
    { type: 'district', plots: block },
  );
  for (const action of [
    { type: 'select', plot: plotB },
    { type: 'select', plot: plotA },
    { type: 'clear' },
    { type: 'exit' },
  ])
    assert.ok(
      !Object.hasOwn(playReducer(district, action), 'district'),
      action.type,
    );
  // The camera and the cards leave it alone.
  for (const action of [
    { type: 'tier', tier: 'district' },
    { type: 'hover', plot: plotB },
    { type: 'focus', id: 'world-1' },
  ])
    assert.equal(playReducer(district, action).district, block, action.type);
});
