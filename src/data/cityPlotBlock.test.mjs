import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BLOCK_SIDE,
  PLOT_METERS,
  plotBlock,
  plotFromId,
  snapPlot,
} from './cityPlot.js';

const SF = { lat: 37.7694, lon: -122.4262 };
// The plot `rows` north and `cols` east of the one at SF.
function plotAt(rows, cols) {
  const from = snapPlot(SF);
  return snapPlot({
    lat: from.center.lat + (rows * PLOT_METERS) / 111_320,
    lon:
      from.center.lon +
      (cols * PLOT_METERS) /
        (111_320 * Math.cos((from.center.lat * Math.PI) / 180)),
  });
}

test('plotBlock gives every cell between two plots, rows south to north, each west to east', () => {
  const from = snapPlot(SF);
  const block = plotBlock(from, plotAt(4, 4));
  assert.equal(block.length, 25);
  assert.equal(new Set(block.map((plot) => plot.id)).size, 25);
  assert.equal(block[0].id, from.id);
  assert.equal(block.at(-1).id, plotAt(4, 4).id);
  assert.deepEqual(
    block.map((plot) => plot.row - from.row),
    [0, 1, 2, 3, 4].flatMap((row) => Array(5).fill(row)),
  );
  block.forEach((plot, i) => {
    assert.deepEqual(plotFromId(plot.id), plot, 'an exact grid cell');
    if (i % 5) assert.equal(plot.col, block[i - 1].col + 1);
  });
  assert.equal(
    block.reduce((sum, plot) => sum + plot.areaSquareMeters, 0),
    40_000,
  );
});

test('plotBlock is the same block from either corner, and one plot from itself', () => {
  const from = snapPlot(SF);
  const ids = (block) => block.map((plot) => plot.id);
  assert.deepEqual(
    ids(plotBlock(plotAt(4, 4), from)),
    ids(plotBlock(from, plotAt(4, 4))),
  );
  // Rows are bricks: the other diagonal is its own block of as many plots.
  const other = plotBlock(plotAt(0, 4), plotAt(4, 0));
  assert.equal(other.length, 25);
  assert.ok(ids(other).includes(plotAt(0, 4).id));
  assert.ok(ids(other).includes(plotAt(4, 0).id));
  assert.deepEqual(ids(plotBlock(from, from)), [from.id]);
  assert.equal(plotBlock(from, plotAt(0, 2)).length, 3);
});

test('plotBlock refuses a missing plot and a block wider than the limit', () => {
  const from = snapPlot(SF);
  assert.equal(plotBlock(from, null), null);
  assert.equal(plotBlock(null, from), null);
  const side = MAX_BLOCK_SIDE - 1;
  assert.equal(plotBlock(from, plotAt(side, side)).length, MAX_BLOCK_SIDE ** 2);
  assert.equal(plotBlock(from, plotAt(MAX_BLOCK_SIDE, 0)), null);
  assert.equal(plotBlock(from, plotAt(0, MAX_BLOCK_SIDE)), null);
});
