import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';

// The shadow decision of the City builder design loop (city-dream r080:
// planspec.shadow_geom, floor_height_errors and the hud.py tip block), as one
// fixed table: a block is cut until its winter-noon shadow clears a protected
// edge across the street. Each case loads the modules itself, so a missing
// one fails that case by name.
const load = async () => ({
  ...(await import('./cityShadowFit.js')),
  ...(await import('./citySun.js')),
  ...(await import('../ui/cityShadowTip.js')),
  ...(await import('../ui/cityHudFigure.js')),
});
const near = (actual, expected, label, tolerance = 0.1) =>
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} ±${tolerance}`,
  );
const kinds = (plan) => plan.lines.map((line) => line.kind);
// r080: six storeys of 3.0 m, the sun 29° up, the far sidewalk 20 m away.
const GOLDEN = Object.freeze({
  storeys: 6,
  storeyHeightMeters: 3,
  sun: Object.freeze({ elevationDeg: 29 }),
  edgeMeters: 20,
});

test('(a) golden: 6 storeys x 3.0 m, sun 29°, edge 20 m: WAS 32.5 m, 12.5 m onto; FIT gives 3 storeys, NOW 16.2 m, clears by 3.8 m', async () => {
  const { shadowFit } = await load();
  const plan = shadowFit(GOLDEN);
  near(plan.now.reachMeters, 32.5, 'reach at 6 storeys');
  near(plan.now.overMeters, 12.5, 'onto the edge at 6 storeys');
  assert.equal(plan.was, null, 'nothing changed yet');
  assert.equal(plan.fit.storeys, 3, 'the most storeys that still clear');
  assert.equal(plan.canFit, true);
  assert.equal(plan.cannotClear, false);
  // Before FIT the plan and what FIT would leave; after it, was and now.
  assert.deepEqual(kinds(plan), ['now', 'fit']);
  const fitted = shadowFit({
    ...GOLDEN,
    storeys: plan.fit.storeys,
    wasStoreys: GOLDEN.storeys,
  });
  assert.deepEqual(kinds(fitted), ['was', 'now']);
  assert.equal(fitted.was.storeys, 6);
  near(fitted.was.reachMeters, 32.5, 'WAS reach');
  near(fitted.was.overMeters, 12.5, 'WAS onto the edge');
  assert.equal(fitted.now.storeys, 3);
  near(fitted.now.reachMeters, 16.2, 'NOW reach');
  near(fitted.now.overMeters, -3.8, 'NOW clears the edge');
  assert.equal(fitted.canFit, false, 'fitted: nothing more to cut');
  // The fit changes the storey count, never the floor height (2.8-4.5 m).
  near(fitted.now.heightMeters, 9, 'three storeys of 3.0 m', 1e-9);
  for (const storeyHeightMeters of [2.5, 4.6])
    assert.throws(
      () => shadowFit({ ...GOLDEN, storeyHeightMeters }),
      TypeError,
      `floor-to-floor ${storeyHeightMeters} m`,
    );
});

test('(b) already clears: the storeys stay and FIT is a no-op', async () => {
  const { shadowFit } = await load();
  for (const storeys of [1, 2, 3]) {
    const plan = shadowFit({ ...GOLDEN, storeys });
    assert.ok(plan.now.overMeters < 0, `${storeys} storeys clear the edge`);
    assert.equal(plan.fit.storeys, storeys, 'FIT never adds a storey');
    assert.equal(plan.canFit, false);
    assert.equal(plan.cannotClear, false);
    assert.equal(plan.was, null);
    assert.deepEqual(kinds(plan), ['now']);
  }
  near(shadowFit({ ...GOLDEN, storeys: 2 }).now.reachMeters, 10.8, 'reach');
});

test('(c) sun below the horizon or unknown: the reach is null, never zero, and FIT is disabled', async () => {
  const { shadowFit, shadowTip } = await load();
  for (const sun of [
    null,
    undefined,
    {},
    { elevationDeg: 0 },
    { elevationDeg: -5 },
    { elevationDeg: NaN },
  ]) {
    const plan = shadowFit({ ...GOLDEN, sun });
    const label = JSON.stringify(sun);
    assert.equal(plan.now.reachMeters, null, label);
    assert.equal(plan.now.overMeters, null, label);
    assert.equal(plan.fit, null, label);
    assert.equal(plan.canFit, false, label);
    assert.equal(plan.cannotClear, false, label);
    assert.deepEqual(plan.lines, [], label);
    assert.equal(shadowTip(plan.now), null, 'no reach, no tip text');
  }
});

test("(d) edge closer than one storey's shadow: FIT gives 1 storey, flagged cannot-clear, never 0", async () => {
  const { shadowFit } = await load();
  // One 3.0 m storey casts 5.4 m at 29°.
  const plan = shadowFit({ ...GOLDEN, edgeMeters: 4 });
  assert.equal(plan.fit.storeys, 1);
  assert.equal(plan.cannotClear, true);
  assert.equal(plan.canFit, true, 'six storeys can still be cut to one');
  near(plan.fit.reachMeters, 5.4, 'one storey still reaches');
  near(plan.fit.overMeters, 1.4, 'onto the edge at one storey');
  const one = shadowFit({ ...GOLDEN, storeys: 1, edgeMeters: 4 });
  assert.equal(one.fit.storeys, 1);
  assert.equal(one.canFit, false);
  assert.equal(one.cannotClear, true);
});

test('(e) citySun at San Francisco (37.77 N), 21 Dec solar noon: altitude within 1° of 28.8°, and the golden decision reproduces from it', async () => {
  const { shadowFit, sunPosition, winterNoon } = await load();
  const SF = { lat: 37.77, lon: -122.42 };
  // Asked from a June scene: the winter solstice of that scene's year.
  const ms = winterNoon(SF.lat, SF.lon, Date.UTC(2026, 5, 21, 15));
  const at = new Date(ms);
  assert.deepEqual(
    [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()],
    [2026, 12, 21],
  );
  // Solar noon at 122.42° W: 20:10 UTC less the equation of time (2 min).
  near(at.getUTCHours() + at.getUTCMinutes() / 60, 20.13, 'UTC hour', 0.2);
  const sun = sunPosition(SF.lat, SF.lon, ms);
  near(sun.elevationDeg, 28.8, 'altitude', 1);
  near(sun.azimuthDeg, 180, 'due south at solar noon', 1);
  // South of the equator winter is June.
  assert.equal(
    new Date(winterNoon(-33.87, 151.21, ms)).getUTCMonth() + 1,
    6,
    'Sydney',
  );
  // 28.8° instead of 29°: the same decision, each reach within half a metre.
  const plan = shadowFit({ ...GOLDEN, sun });
  near(plan.now.reachMeters, 32.5, 'reach at 6 storeys', 0.5);
  assert.ok(plan.now.overMeters > 0, 'six storeys reach the edge');
  assert.equal(plan.fit.storeys, 3);
  near(plan.fit.reachMeters, 16.2, 'reach at 3 storeys', 0.5);
  assert.ok(plan.fit.overMeters < 0, 'three storeys clear it');
});

test('(f) tip strings through the HUD formatter, in English and German; arrows spaced', async (t) => {
  const { shadowFit, shadowTip, hudFigure } = await load();
  const plan = shadowFit(GOLDEN);
  const fitted = shadowFit({ ...GOLDEN, storeys: 3, wasStoreys: 6 });
  t.after(() => setLocale('en'));
  setLocale('en');
  assert.equal(
    shadowTip(fitted.was),
    'SHADOW WAS 32 m · 12 m ONTO SIDEWALK EST',
  );
  assert.equal(
    shadowTip(fitted.now),
    'SHADOW NOW 16 m · CLEARS SIDEWALK BY 4 m EST',
  );
  assert.equal(shadowTip(plan.now), 'SHADOW NOW 32 m · 12 m ONTO SIDEWALK EST');
  assert.equal(
    shadowTip(plan.fit),
    'FIT TO SUN 16 m · CLEARS SIDEWALK BY 4 m EST',
  );
  // The FLOORS figure beside them is #326's own before → after.
  assert.equal(
    hudFigure({
      before: fitted.was.storeys,
      value: fitted.now.storeys,
      estimate: true,
    }),
    '6 → 3 EST',
  );
  setLocale('de');
  assert.equal(
    shadowTip(fitted.was),
    'SCHATTEN VORHER 32 m · 12 m AUF DEM GEHWEG GESCHÄTZT',
  );
  assert.equal(
    shadowTip(fitted.now),
    'SCHATTEN JETZT 16 m · GEHWEG FREI UM 4 m GESCHÄTZT',
  );
});
