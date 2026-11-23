import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CITY_HUD_PARTS,
  PERSONS_PER_HOME,
  RISE_MS,
  TRAY_CATEGORIES,
  cellYield,
  cityHudFlags,
  districtCells,
  districtGround,
  dustPuffs,
  placementCheck,
  riseShare,
  tickFigure,
  topBarModel,
  trayModel,
  trayShortcut,
} from './cityGameHud.js';
import { growthPlan } from './cityGrowth.js';
import { plotFromId } from './cityPlot.js';

const SITE = { lat: 37.796083363277035, lon: -122.41021134056297 };

test('no switch: every part off (the parent build)', () => {
  const f = cityHudFlags('?welcome=0&massing=1&cityR1=all');
  for (const p of CITY_HUD_PARTS) assert.equal(f[p], false);
  assert.equal(f.any, false);
});

test('game turns every part on; a list turns on only its parts', () => {
  const all = cityHudFlags('?cityHud=game');
  for (const p of CITY_HUD_PARTS) assert.equal(all[p], true);
  const some = cityHudFlags('?cityHud= BAR,plots,nope');
  assert.deepEqual(
    CITY_HUD_PARTS.filter((p) => some[p]),
    ['bar', 'plots'],
  );
  assert.equal(some.any, true);
});

test('tray: five categories with unique shortcuts, build open by default', () => {
  const keys = TRAY_CATEGORIES.map((c) => c.key);
  assert.deepEqual(
    TRAY_CATEGORIES.map((c) => c.id),
    ['zone', 'build', 'park', 'transit', 'trees'],
  );
  assert.equal(new Set(keys).size, keys.length);
  const m = trayModel({ plot: true });
  assert.equal(m.open, 'build');
  // exp/city-loop-v3: the tray keeps its three build verbs (r7 cost game_feel).
  assert.deepEqual(
    m.tools.map((t) => [t.id, t.key]),
    [
      ['massing', 'q'],
      ['reimagine', 'w'],
      ['inspect', 'e'],
    ],
  );
  assert.ok(m.tools.every((t) => !t.disabled));
});

test('tray: without a plot every tool is disabled and says why', () => {
  const m = trayModel({ category: 'park', plot: false });
  assert.ok(m.tools.every((t) => t.disabled && t.reason === 'no-plot'));
});

test('tray: the zoning budget blocks a new use but not the plot’s own', () => {
  const m = trayModel({
    category: 'zone',
    plot: true,
    zoneFull: true,
    use: 'civic',
  });
  const by = Object.fromEntries(m.tools.map((t) => [t.id, t]));
  assert.equal(by.housing.reason, 'budget');
  assert.equal(by.civic.disabled, false);
  assert.equal(by.civic.active, true);
  assert.equal(by['clear-use'].disabled, false);
});

test('tray: a pending concept blocks concept tools; massing stays', () => {
  const build = trayModel({ category: 'build', plot: true, pending: true });
  const by = Object.fromEntries(build.tools.map((t) => [t.id, t]));
  assert.equal(by.reimagine.reason, 'pending');
  assert.equal(by.massing.disabled, false);
  assert.equal(by.inspect.disabled, false);
  const park = trayModel({ category: 'park', plot: true, pending: true });
  assert.ok(park.tools.every((t) => t.reason === 'pending'));
  const full = trayModel({ category: 'transit', plot: true, full: true });
  assert.equal(full.tools[0].reason, 'full');
});

test('top bar: only known figures are drawn (no row of dashes)', () => {
  const m = topBarModel({ zoned: 0, zoneCap: 60 });
  assert.deepEqual(
    m.chips.filter((c) => c.shown).map((c) => c.id),
    ['zoning'],
  );
});

test('shortcuts: digits open categories, letters pick tools, modifiers never', () => {
  const m = trayModel({ category: 'park', plot: true });
  assert.deepEqual(trayShortcut({ key: '4' }, m), {
    type: 'category',
    id: 'transit',
  });
  assert.equal(trayShortcut({ key: 'Q' }, m).tool.id, 'park');
  assert.equal(trayShortcut({ key: 'q', ctrlKey: true }, m), null);
  assert.equal(trayShortcut({ key: 'z' }, m), null);
  const blocked = trayModel({ category: 'park', plot: false });
  assert.equal(trayShortcut({ key: 'q' }, blocked), null);
});

test('top bar: unknown stays null, never zero', () => {
  const m = topBarModel({});
  const by = Object.fromEntries(m.chips.map((c) => [c.id, c]));
  assert.equal(by.residents.value, null);
  assert.equal(by.homes.value, null);
  assert.equal(by.concepts.value, null);
  assert.equal(m.turn.stage, null);
});

test('top bar: homes from the growth plan, residents as an assumption', () => {
  const plots = districtCells(SITE, 0)[0].plots;
  const plan = growthPlan({ plots, anchorId: plots[0].id });
  const m = topBarModel({
    growth: { stage: 2, plan },
    zoned: 3,
    zoneCap: 12,
    stats: [{ id: 'concepts', value: 2 }],
  });
  const by = Object.fromEntries(m.chips.map((c) => [c.id, c]));
  assert.equal(by.homes.value, plan.stages[2].homes);
  assert.equal(by.homes.low, plan.stages[0].homes);
  assert.equal(by.homes.high, plan.stages[2].homes);
  assert.equal(
    by.residents.value,
    Math.round(plan.stages[2].homes * PERSONS_PER_HOME),
  );
  assert.equal(by.residents.estimate, true);
  assert.deepEqual([by.zoning.value, by.zoning.cap], [3, 12]);
  assert.equal(by.concepts.value, 2);
  assert.equal(m.turn.stage, '15yr');
});

test('tickFigure eases from the old figure to the new one', () => {
  assert.equal(tickFigure(10, 110, 0), 10);
  assert.equal(tickFigure(10, 110, 1), 110);
  assert.ok(tickFigure(10, 110, 0.5) > 60);
  assert.equal(tickFigure(null, 40, 1), 40);
  assert.equal(tickFigure(5, null, 0.5), null);
});

test('district cells: 3 x 3 cells of 25 grid plots each, no plot twice', () => {
  const cells = districtCells(SITE, 1);
  assert.equal(cells.length, 9);
  const ids = cells.flatMap((c) => c.plots.map((p) => p.id));
  assert.ok(cells.every((c) => c.plots.length === 25));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids.slice(0, 30)) assert.ok(plotFromId(id));
  // The middle cell holds the plot under the point it was asked about.
  const plot = plotFromId('plot-n105201-126637');
  const middle = districtCells(plot.center, 1)[4];
  assert.ok(middle.plots.some((p) => p.id === plot.id));
});

test('cell yield: plots, hectares and the growth homes range, estimated', () => {
  const [cell] = districtCells(SITE, 0);
  const y = cellYield(cell);
  const plan = growthPlan({ plots: cell.plots, anchorId: cell.plots[0].id });
  assert.equal(y.plots, 25);
  assert.equal(y.hectares, 4);
  assert.equal(y.homesLow, plan.stages[0].homes);
  assert.equal(y.homesHigh, plan.stages[2].homes);
  assert.ok(y.homesHigh > y.homesLow);
  assert.equal(y.estimate, true);
  assert.equal(cellYield(null), null);
});

test('district ground: a slope is fitted and roofs above it are ignored', () => {
  // Ground rising 0.1 m per metre east; two roofs 12 m and 25 m up.
  const samples = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++)
      samples.push({ x: j * 40, y: i * 40, h: 0.1 * j * 40 + 3 });
  samples[7].h += 12;
  samples[18].h += 25;
  const g = districtGround(samples);
  assert.ok(Math.abs(g.at(0, 0) - 3) < 1e-6);
  assert.ok(Math.abs(g.at(160, 80) - 19) < 1e-6);
  assert.equal(g.used, 23);
  assert.ok(Math.abs(g.floor - 3) < 1e-6);
});

test('district ground: few or no samples', () => {
  assert.equal(districtGround([]), null);
  assert.equal(districtGround([{ x: 0, y: 0, h: NaN }]), null);
  const two = districtGround([
    { x: 0, y: 0, h: 5 },
    { x: 40, y: 0, h: 2 },
  ]);
  assert.equal(two.at(100, 100), 2);
  // Unsampled plots still get a floor from the plane.
  const g = districtGround([
    { x: 0, y: 0, h: 1 },
    { x: 40, y: 0, h: 1 },
    { x: 0, y: 40, h: 1 },
    { x: 80, y: 80, h: NaN },
  ]);
  assert.ok(Math.abs(g.at(80, 80) - 1) < 1e-9);
});

test('placement: valid / invalid with a reason', () => {
  const plot = { id: 'p' };
  assert.deepEqual(placementCheck({ tool: 'park', plot }), {
    valid: true,
    reason: null,
  });
  assert.equal(placementCheck({ tool: 'park', plot, full: true }).reason, 'full');
  assert.equal(
    placementCheck({ tool: 'housing', plot, zoneFull: true }).reason,
    'budget',
  );
  assert.equal(
    placementCheck({ tool: 'housing', plot, zoneFull: true, use: 'civic' })
      .valid,
    true,
  );
  assert.equal(placementCheck({ tool: 'massing', plot, pending: true }).valid, true);
  assert.equal(placementCheck({ tool: 'park', plot: null }).reason, 'none');
});

test('rise: from the ground, a small overshoot, settled at full height', () => {
  assert.equal(riseShare(0), 0);
  assert.equal(riseShare(-5), 0);
  assert.equal(riseShare(RISE_MS), 1);
  assert.equal(riseShare(RISE_MS * 3), 1);
  const samples = Array.from({ length: 50 }, (_, i) => riseShare((i * RISE_MS) / 50));
  assert.ok(Math.max(...samples) > 1 && Math.max(...samples) < 1.12);
  assert.ok(samples[5] < samples[10]);
});

test('dust: puffs round the footprint grow out and fade to nothing', () => {
  const early = dustPuffs(100);
  const late = dustPuffs(1200);
  assert.equal(early.length, 10);
  assert.ok(late[0].alpha < early[0].alpha);
  assert.ok(late[0].size > early[0].size);
  assert.ok(Math.hypot(late[0].x, late[0].y) > Math.hypot(early[0].x, early[0].y));
  assert.deepEqual(dustPuffs(1400), []);
  assert.deepEqual(dustPuffs(100), dustPuffs(100));
});

test('city=v3 preset turns every HUD part on; an explicit cityHud wins', () => {
  const v3 = cityHudFlags('?city=v3');
  for (const p of CITY_HUD_PARTS) assert.equal(v3[p], true);
  assert.equal(v3.any, true);
  const only = cityHudFlags('?city=v3&cityHud=bar');
  assert.equal(only.bar, true);
  assert.equal(only.plots, false);
  assert.equal(cityHudFlags('?city=v2').any, false);
});
