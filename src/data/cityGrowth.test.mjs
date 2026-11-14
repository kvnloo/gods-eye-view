import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';

// The growth decision of the City builder design loop (city-dream r081, which
// grows from the shadow round r080), as one fixed table: a district of plots,
// a cohort of them that rises stage by stage, and a sun-locked plot that never
// does. Each case loads the modules itself, so a missing one fails that case
// by name.
const load = async () => ({
  ...(await import('./cityGrowth.js')),
  ...(await import('./cityMassing.js')),
  ...(await import('./cityPlot.js')),
  ...(await import('../ui/cityGrowthLines.js')),
});
const near = (actual, expected, label, tolerance = 0.01) =>
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} ±${tolerance}`,
  );
// The SF test site; the block reaches `side` plots north and east of it.
const SF = Object.freeze({ lat: 37.7694, lon: -122.4262 });
function district({ snapPlot, plotBlock, PLOT_METERS }, side) {
  const from = snapPlot(SF);
  const step = (side - 1) * PLOT_METERS;
  const to = snapPlot({
    lat: from.center.lat + step / 111_320,
    lon:
      from.center.lon +
      step / (111_320 * Math.cos((from.center.lat * Math.PI) / 180)),
  });
  return plotBlock(from, to);
}
// What #315's estimator says for one stage: every plot at its own storeys.
function estimator({ plotMassing }, plots, storeysOf) {
  const blocks = plots.map((plot) =>
    plotMassing({ corners: plot.corners, storeys: storeysOf(plot.id) }),
  );
  const sum = (key) => blocks.reduce((total, block) => total + block[key], 0);
  return {
    homes: sum('homes'),
    floorAreaSquareMeters: sum('floorAreaSquareMeters'),
  };
}
const texts = (lines) => lines.map((line) => line.text);
const ids = (lines) => lines.map((line) => line.id);

test('(a) r081 golden: 25 plots, a 12-plot cohort 3 → 4 → 5 storeys; homes and floor area are the massing estimator’s own', async () => {
  const m = await load();
  const plots = district(m, 5);
  assert.equal(plots.length, 25);
  const plan = m.growthPlan({ plots, anchorId: plots[0].id });
  assert.equal(plan.estimated, true);
  assert.equal(plan.plots, 25);
  near(plan.areaSquareMeters, 40_000, 'district area');
  assert.equal(plan.cohort.length, 12);
  assert.equal(new Set(plan.cohort).size, 12);
  assert.ok(
    plan.cohort.every((id) => plots.some((plot) => plot.id === id)),
    'the cohort is plots of the district',
  );
  assert.ok(!plan.cohort.includes(plots[0].id), 'inland: not the anchor');
  assert.deepEqual(plan.locked, []);
  assert.deepEqual(
    plan.stages.map((stage) => [stage.id, stage.years, stage.storeys]),
    [
      ['now', 0, 3],
      ['5yr', 5, 4],
      ['15yr', 15, 5],
    ],
  );
  const share = m.MASSING_ASSUMPTIONS.residentialShare;
  plan.stages.forEach((stage) => {
    assert.equal(stage.blocks.length, 25);
    const own = estimator(m, plots, (id) =>
      plan.cohort.includes(id) ? stage.storeys : 3,
    );
    assert.equal(stage.homes, own.homes, `${stage.id} homes`);
    near(
      stage.floorAreaSquareMeters,
      own.floorAreaSquareMeters,
      `${stage.id} floor area`,
    );
    near(
      stage.residentialSquareMeters,
      own.floorAreaSquareMeters * share,
      `${stage.id} residential floor area`,
    );
  });
  // Pinned: the estimator's figures, not r081's 312 / 360 / 408.
  assert.deepEqual(
    plan.stages.map((stage) => stage.homes),
    [575, 659, 755],
  );
  assert.deepEqual(
    plan.stages.map((stage) => Math.round(stage.residentialSquareMeters)),
    [49_152, 57_016, 64_881],
  );
  // r081: one visit a day per six homes, district totals rounded up.
  assert.deepEqual(
    plan.stages.map((stage) => stage.deliveriesPerDay),
    [96, 110, 126],
  );
});

test('(b) a shadow-locked plot inside the cohort keeps its fitted storeys at every stage, and the plan reports it as locked', async () => {
  const m = await load();
  const plots = district(m, 5);
  const free = m.growthPlan({ plots, anchorId: plots[0].id });
  const lockedId = free.cohort[0];
  const plan = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    locks: { [lockedId]: 2 },
  });
  assert.deepEqual(plan.cohort, free.cohort, 'a lock does not move the cohort');
  assert.deepEqual(plan.locked, [lockedId]);
  const fitted = m.plotMassing({
    corners: plots.find((plot) => plot.id === lockedId).corners,
    storeys: 2,
  });
  plan.stages.forEach((stage, i) => {
    const block = stage.blocks.find((b) => b.plotId === lockedId);
    assert.equal(block.storeys, 2, `${stage.id}: the fit stands`);
    assert.equal(block.locked, true);
    near(block.heightMeters, fitted.heightMeters, `${stage.id} height`);
    assert.equal(
      stage.blocks.filter((b) => b.locked).length,
      1,
      'one locked block',
    );
    const others = stage.blocks.filter(
      (b) => b.plotId !== lockedId && plan.cohort.includes(b.plotId),
    );
    assert.equal(others.length, 11);
    assert.ok(others.every((b) => b.storeys === stage.storeys && !b.locked));
    // The district has the locked plot's own homes in place of a cohort plot's.
    const own = estimator(m, plots, (id) =>
      id === lockedId ? 2 : plan.cohort.includes(id) ? stage.storeys : 3,
    );
    assert.equal(stage.homes, own.homes);
    assert.ok(stage.homes < free.stages[i].homes);
  });
  // The plan refuses to raise it, whatever the stage is edited to.
  const raised = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    locks: { [lockedId]: 2 },
    storeys: m.editStage(
      plan.stages.map((s) => s.storeys),
      2,
      4,
    ),
  });
  assert.equal(raised.stages[2].storeys, 9);
  assert.equal(
    raised.stages[2].blocks.find((b) => b.plotId === lockedId).storeys,
    2,
  );
  // A locked plot outside the cohort (r081's corner) is reported the same way.
  const corner = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    locks: { [plots[0].id]: 3 },
  });
  assert.deepEqual(corner.locked, [plots[0].id]);
  assert.ok(
    corner.stages.every((stage) => {
      const block = stage.blocks.find((b) => b.plotId === plots[0].id);
      return block.storeys === 3 && block.locked;
    }),
  );
  assert.deepEqual(
    corner.stages.map((stage) => stage.homes),
    [575, 659, 755],
  );
});

test('(c) stages are monotone: a later stage never has fewer storeys than an earlier one, unless the player edits it, and then it is flagged', async () => {
  const m = await load();
  const plots = district(m, 5);
  const plan = m.growthPlan({ plots, anchorId: plots[0].id });
  assert.ok(plan.stages.every((stage) => stage.lowered === false));
  for (const plot of plots) {
    const run = plan.stages.map(
      (stage) => stage.blocks.find((b) => b.plotId === plot.id).storeys,
    );
    assert.ok(run[0] <= run[1] && run[1] <= run[2], `${plot.id}: ${run}`);
  }
  assert.ok(plan.stages[0].homes <= plan.stages[1].homes);
  assert.ok(plan.stages[1].homes <= plan.stages[2].homes);
  // The player's edit: one stage, by whole storeys, never below one.
  const start = [3, 4, 5];
  assert.deepEqual(m.editStage(start, 2, -2), [3, 4, 3]);
  assert.deepEqual(start, [3, 4, 5], 'an edit returns a new list');
  assert.deepEqual(m.editStage(start, 0, -5), [1, 4, 5]);
  assert.deepEqual(m.editStage(start, 1, 3), [3, 7, 5]);
  const cut = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    storeys: m.editStage(start, 2, -2),
  });
  assert.deepEqual(
    cut.stages.map((stage) => stage.lowered),
    [false, false, true],
  );
  assert.equal(cut.stages[2].storeys, 3);
  assert.equal(cut.stages[2].homes, cut.stages[0].homes);
  // Raising the middle stage past the last flags the last one.
  const bulge = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    storeys: m.editStage(start, 1, 3),
  });
  assert.deepEqual(
    bulge.stages.map((stage) => stage.lowered),
    [false, false, true],
  );
});

test('(d) an unknown per-home rate gives no deliveries figure: null, not 0', async () => {
  const m = await load();
  const plots = district(m, 5);
  for (const homesPerDelivery of [null, Number.NaN, 0]) {
    const plan = m.growthPlan({
      plots,
      anchorId: plots[0].id,
      homesPerDelivery,
    });
    assert.deepEqual(
      plan.stages.map((stage) => stage.deliveriesPerDay),
      [null, null, null],
      `rate ${homesPerDelivery}`,
    );
    assert.deepEqual(
      plan.stages.map((stage) => stage.homes),
      [575, 659, 755],
      'homes do not depend on the rate',
    );
    setLocale('en');
    plan.stages.forEach((stage, i) => {
      const lines = m.growthLines(plan, i);
      assert.ok(!ids(lines).includes('deliveries'), `${stage.id} deliveries`);
      assert.ok(!ids(lines).includes('assumed'), `${stage.id} assumed rate`);
      assert.ok(!texts(lines).some((text) => /DELIVER/.test(text)));
    });
  }
});

test('(e) a district of one plot behaves like single-plot massing', async () => {
  const m = await load();
  const [plot] = district(m, 1);
  assert.equal(district(m, 1).length, 1);
  const plan = m.growthPlan({ plots: [plot], anchorId: plot.id });
  assert.equal(plan.plots, 1);
  near(plan.areaSquareMeters, plot.areaSquareMeters, 'area');
  assert.deepEqual(plan.cohort, [plot.id]);
  plan.stages.forEach((stage) => {
    const single = m.plotMassing({
      corners: plot.corners,
      storeys: stage.storeys,
    });
    assert.equal(stage.homes, single.homes);
    near(
      stage.floorAreaSquareMeters,
      single.floorAreaSquareMeters,
      'floor area',
    );
    assert.equal(stage.blocks.length, 1);
    assert.equal(stage.blocks[0].storeys, single.storeys);
    near(stage.blocks[0].heightMeters, single.heightMeters, 'height');
  });
  assert.deepEqual(
    plan.stages.map((stage) => stage.homes),
    [23, 30, 38],
  );
});

test('(f) each stage’s visible strings go through the HUD formatter: every figure once, arrows spaced', async (t) => {
  const m = await load();
  const plots = district(m, 5);
  const plan = m.growthPlan({ plots, anchorId: plots[0].id });
  t.after(() => setLocale('en'));
  setLocale('en');
  assert.deepEqual(
    plan.stages.map((stage) => m.growthStageLabel(stage)),
    ['NOW', '5 YR', '15 YR'],
  );
  const DISTRICT = 'DISTRICT · 25 PLOTS · 40,000 m²';
  const RATE = 'ASSUMED: A DELIVERY A DAY FOR EVERY 6 HOMES';
  const WORKS = 'COST: NEIGHBOURS LIVE BESIDE ROOF WORKS ON 12 PLOTS';
  assert.deepEqual(texts(m.growthLines(plan, 0)), [
    DISTRICT,
    'GROWTH FLOORS 3 EST',
    'HOMES 575 EST',
    'RESIDENTIAL FLOOR AREA 49,152 m² EST',
    'HOME DELIVERIES 96 /d EST',
    RATE,
    'COST: NO WORKS YET',
  ]);
  assert.deepEqual(texts(m.growthLines(plan, 1)), [
    DISTRICT,
    'GROWTH FLOORS 3 → 4 EST',
    'HOMES 575 → 659 EST',
    'RESIDENTIAL FLOOR AREA 49,152 → 57,016 m² EST',
    'HOME DELIVERIES 96 → 110 /d EST',
    RATE,
    WORKS,
  ]);
  assert.deepEqual(texts(m.growthLines(plan, 2)), [
    DISTRICT,
    'GROWTH FLOORS 3 → 5 EST',
    'HOMES 575 → 755 EST',
    'RESIDENTIAL FLOOR AREA 49,152 → 64,881 m² EST',
    'HOME DELIVERIES 96 → 126 /d EST',
    RATE,
    WORKS,
  ]);
  plan.stages.forEach((stage, i) => {
    const lines = m.growthLines(plan, i);
    assert.deepEqual(ids(lines), [
      'district',
      'floors',
      'homes',
      'area',
      'deliveries',
      'assumed',
      'cost',
    ]);
    // Each figure once: one line names the homes, and no number is repeated.
    assert.equal(
      texts(lines).filter((text) => /^HOMES /.test(text)).length,
      1,
      `${stage.id}: HOMES once`,
    );
    const numbers = texts(lines).flatMap(
      (text) => text.match(/\d[\d,]*/g) ?? [],
    );
    assert.equal(
      new Set(numbers).size,
      numbers.length,
      `${stage.id}: ${numbers}`,
    );
    for (const text of texts(lines)) {
      assert.ok(!/\S→|→\S/.test(text), `spaced arrow: ${text}`);
      assert.ok(!/GOAL SCORE|CANOPY/.test(text), `no basis: ${text}`);
    }
  });
  // A locked plot adds one line in words, with no second figure.
  const locked = m.growthPlan({
    plots,
    anchorId: plots[0].id,
    locks: { [plots[0].id]: 3 },
  });
  assert.equal(
    m.growthLines(locked, 2).find((line) => line.id === 'locked').text,
    'LOCKED PLOTS KEEP THEIR SUN FIT',
  );
  assert.equal(
    m.growthLines(plan, 2).find((line) => line.id === 'locked'),
    undefined,
  );
  // German: the same figures in the locale's own digits and words.
  setLocale('de');
  const german = texts(m.growthLines(plan, 1));
  assert.equal(german[2], 'WOHNUNGEN 575 → 659 GESCHÄTZT');
  assert.equal(german[3], 'WOHNFLÄCHE 49.152 → 57.016 m² GESCHÄTZT');
  assert.equal(m.growthStageLabel(plan.stages[2]), '15 J.');
});
