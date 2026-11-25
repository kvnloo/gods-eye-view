import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { plotBlock, plotFromId, snapCityPlot } from '../../../src/data/cityPlot.js';
import { captureTargets } from './capture-targets.mjs';

const app = fileURLToPath(new URL('../../../', import.meta.url));
const pick = (id) => {
  const plot = plotFromId(id);
  return plot ? snapCityPlot(plot.center) : null;
};

test('stock city=v3 capture selects the fitted North Beach plot', async () => {
  const { plot } = await captureTargets(app, 'city=v3');
  assert.equal(pick(plot)?.id ?? null, 'plot-northbeach-8-11', `pick at ${plot}`);
});

test('stock city=v3 capture extends to the fitted North Beach district anchor', async () => {
  const { plot, oppositePlot } = await captureTargets(app, 'city=v3');
  const opposite = pick(oppositePlot);
  assert.equal(opposite?.id ?? null, 'plot-northbeach-11-14');
  assert.equal(plotBlock(pick(plot), opposite)?.length, 16);
});

test('explicit location and capture plot override retain precedence', async () => {
  const targets = await captureTargets(app, 'city=hero&cityLoc=presidio', 'plot-presidio-10-8');
  assert.equal(targets.location.key, 'presidio');
  assert.equal(targets.plot, 'plot-presidio-10-8');
  assert.equal(targets.oppositePlot, 'plot-presidio-10-8');
});

test('hero and legacy capture defaults remain available', async () => {
  assert.equal((await captureTargets(app, 'city=hero')).plot, 'plot-sausalito-0-0');
  const legacy = await captureTargets(app, '');
  assert.equal(legacy.plot, 'plot-n105201-126637');
  assert.equal(legacy.oppositePlot, undefined);
  await assert.rejects(captureTargets(app, 'city=v3&cityLoc=unknown'), /unknown cityLoc unknown/);
});
