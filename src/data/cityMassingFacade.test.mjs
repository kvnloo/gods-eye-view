import test from 'node:test';
import assert from 'node:assert/strict';

// The look of the massing block as one fixed table: the building drawn on the
// globe is laid out from the massing owner's own storeys, storey height and
// footprint, so the picture and the numbers are one thing. Each case loads the
// modules itself, so a missing one fails that case by name.
const load = async () => ({
  ...(await import('./cityMassingFacade.js')),
  ...(await import('./cityMassing.js')),
  ...(await import('./cityPlot.js')),
});
const near = (actual, expected, label, tolerance = 1e-9) =>
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} ±${tolerance}`,
  );
// The journey's plot: Washington Square, San Francisco, a 40 m grid cell.
const SITE = Object.freeze({ lat: 37.8006, lon: -122.4103 });
async function build(storeys, options = {}) {
  const { massingFacade, plotMassing, snapPlot } = await load();
  const massing = plotMassing({
    corners: snapPlot(SITE).corners,
    storeys,
    ...options,
  });
  return { massing, facade: massingFacade(massing) };
}

test('(a) six storeys: one floor band per storey, each the massing storey height', async () => {
  const { massing, facade } = await build(6);
  assert.equal(facade.bands.length, massing.storeys);
  assert.deepEqual(
    facade.bands.map((band) => band.storey),
    [1, 2, 3, 4, 5, 6],
  );
  facade.bands.forEach((band, i) => {
    near(band.bottomMeters, i * massing.storeyHeightMeters, `band ${i} bottom`);
    near(
      band.topMeters - band.bottomMeters,
      massing.storeyHeightMeters,
      `band ${i} height`,
    );
  });
});

test('(b) the ground band is a shopfront, every band above it a floor of windows', async () => {
  const { facade } = await build(6);
  assert.deepEqual(
    facade.bands.map((band) => band.kind),
    ['shopfront', 'floor', 'floor', 'floor', 'floor', 'floor'],
  );
  const [shop, floor] = facade.bands;
  for (const band of facade.bands) {
    assert.ok(
      band.glass.sillMeters > band.bottomMeters,
      'glass above the floor',
    );
    assert.ok(
      band.glass.headMeters < band.topMeters,
      'glass below the next floor',
    );
    assert.ok(
      band.glass.share > 0 && band.glass.share < 1,
      'piers between bays',
    );
  }
  // A shopfront is glazed lower, taller and wider than a floor of windows.
  assert.ok(
    shop.glass.sillMeters - shop.bottomMeters <
      floor.glass.sillMeters - floor.bottomMeters,
  );
  assert.ok(
    shop.glass.headMeters - shop.glass.sillMeters >
      floor.glass.headMeters - floor.glass.sillMeters,
  );
  assert.ok(shop.glass.share > floor.glass.share);
});

test('(c) the building top is the massing height (±0.01 m); the parapet is inside the top band', async () => {
  const { massing, facade } = await build(6);
  near(facade.heightMeters, massing.heightMeters, 'top', 0.01);
  near(facade.bands.at(-1).topMeters, massing.heightMeters, 'top band', 0.01);
  near(facade.parapet.topMeters, massing.heightMeters, 'parapet top', 0.01);
  assert.ok(facade.parapet.topMeters > facade.parapet.bottomMeters);
  assert.ok(
    facade.parapet.bottomMeters >= facade.bands.at(-1).glass.headMeters,
    'the parapet starts above the top windows',
  );
});

test('(d) one storey: a shopfront with its parapet, 3.2 m to the top', async () => {
  const { massing, facade } = await build(1);
  assert.equal(massing.heightMeters, 3.2);
  assert.deepEqual(
    facade.bands.map((band) => band.kind),
    ['shopfront'],
  );
  near(facade.bands[0].topMeters, 3.2, 'top band', 0.01);
  near(facade.parapet.topMeters, 3.2, 'parapet top', 0.01);
  assert.ok(facade.parapet.bottomMeters >= facade.bands[0].glass.headMeters);
});

test('(e) twelve storeys: twelve bands, 38.4 m to the top', async () => {
  const { massing, facade } = await build(12);
  assert.equal(facade.bands.length, 12);
  assert.equal(facade.bands.filter((b) => b.kind === 'shopfront').length, 1);
  near(facade.bands.at(-1).topMeters, 38.4, 'top band', 0.01);
  near(facade.heightMeters, massing.heightMeters, 'top', 0.01);
  near(facade.parapet.topMeters, 38.4, 'parapet top', 0.01);
});

test('(f) another storey height: the bands follow the massing, not a constant', async () => {
  const { massing, facade } = await build(4, { storeyHeightMeters: 3 });
  assert.equal(facade.bands.length, 4);
  facade.bands.forEach((band, i) =>
    near(band.topMeters - band.bottomMeters, 3, `band ${i} height`),
  );
  near(facade.heightMeters, massing.heightMeters, 'top', 0.01);
  near(facade.heightMeters, 12, 'top', 0.01);
});

test('(g) the footprint vertices are the massing footprint; one wall per edge, in whole window bays', async () => {
  const { massing, facade } = await build(6);
  assert.deepEqual(facade.footprint, massing.footprint);
  assert.equal(facade.walls.length, massing.footprint.length);
  facade.walls.forEach((wall, i) => {
    assert.deepEqual(wall.from, massing.footprint[i]);
    assert.deepEqual(
      wall.to,
      massing.footprint[(i + 1) % massing.footprint.length],
    );
    // 40 m cell, 4 m setback: every wall is 32 m.
    near(wall.lengthMeters, 32, `wall ${i}`, 0.01);
    assert.ok(Number.isInteger(wall.bays) && wall.bays >= 1);
    near(wall.bays * wall.bayMeters, wall.lengthMeters, `wall ${i} bays`, 1e-6);
    assert.ok(wall.bayMeters >= 2.4 && wall.bayMeters <= 4.8, 'a window bay');
  });
});

test('(h) the body is opaque and not cyan: every material colour is solid', async () => {
  const { facade } = await build(6);
  const { material } = facade;
  assert.equal(material.translucent, false);
  assert.equal(material.alpha, 1);
  for (const [name, css] of Object.entries(material.colors))
    assert.match(css, /^#[0-9a-f]{6}$/, `${name} is a solid colour`);
  // The cyan accent marks the plot outline; the body is a neutral material.
  const [r, g, b] = [1, 3, 5].map((i) =>
    parseInt(material.colors.body.slice(i, i + 2), 16),
  );
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 40, 'a neutral body');
  assert.notEqual(material.colors.body, '#2ec8e8');
});

test('(i) no footprint, no building: missing is never a zero-height box', async () => {
  const { massingFacade, plotMassing, snapPlot } = await load();
  const massing = plotMassing({
    corners: snapPlot(SITE).corners,
    setbackMeters: 25,
  });
  assert.equal(massing.footprint, null);
  assert.equal(massingFacade(massing), null);
});
