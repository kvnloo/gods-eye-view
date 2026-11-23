#!/usr/bin/env node
// FORK-ONLY (exp/city-loop-v5, fix1): the INNER LOOP for placement
// correctness. Runs the app's OWN placement code (src/data: snapPlot /
// plotBlock / plotMassing / plotGround / districtGrounds, the functions the
// globe adapters cityPlay.js and cityMassing.js call) headlessly against the
// OSM fixtures and public-domain USGS 3DEP terrain, and checks the
// invariants I1 (placement) and I2 (place label) over the hero journey and
// many random plot picks at every QA location. No browser, no Boat, seconds.
//
//   node downstream/city-loop/inner/harness.mjs [--root <app checkout>]
//        [--picks 300] [--districts 60] [--seed 1] [--json out.json] [--quiet]
//
// --root points at another checkout (e.g. a worktree of the parent head) to
// measure "before". A checkout without src/data/cityGround.js runs the
// replica of its globe adapter's ground rule (legacyGround below, copied from
// cityMassing.js at 025b5b5). Exit 0 = every invariant holds, 1 = failures,
// 2 = the harness could not run (missing fixture/terrain).
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { labelFailures, placementFailures } from './invariants.mjs';
import { EXPECTED_PLACE, LOCATION_KEYS, loadLocation } from './locations.mjs';

const t0 = performance.now();
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const ROOT = resolve(arg('root', fileURLToPath(new URL('../../../', import.meta.url))));
const PICKS = Number(arg('picks', 300));
const DISTRICTS = Number(arg('districts', 60));
const SEED = Number(arg('seed', 1));
// 299 m: inside the 300 m claim of a fitted grid (cityGridSpecs.js); beyond it the global grid answers.
const PICK_RADIUS = Number(arg('radius', 299));
const QUIET = argv.includes('--quiet');

const app = async (rel) => import(pathToFileURL(join(ROOT, 'src/data', rel)).href);
const plotMod = await app('cityPlot.js');
const massingMod = await app('cityMassing.js');
const hudMod = await app('cityGameHud.js');
const { CITY_LOCATIONS } = await app('cityLocations.js');
const locMod = await app('cityLocations.js');
const groundMod = existsSync(join(ROOT, 'src/data/cityGround.js'))
  ? await app('cityGround.js')
  : null;
const { snapPlot, plotBlock, plotFromId } = plotMod;
const { plotMassing } = massingMod;

// --- the ground rule the app runs ------------------------------------------
// Replica of the parent's globe adapter (src/standalone/cityMassing.js at
// 025b5b5): measure() = groundBase(centre, edgeProbes(corners, 6)); a growth
// district under ?cityHud=ground (on in ?city=hero) stands on districtGround.
// bc5acb3 (r03) added a Sausalito-only branch: a park plot stands on the
// middle of its footprint's ground range and its district skips the fitted plane.
const parkPlot = (plot) => Boolean(plotMod.isSausalitoPlot?.(plot));
const footprintGround = (plot, sample) => {
  const { footprint } = plotMassing({ corners: plot.corners });
  const h = [...footprint, [plot.center.lon, plot.center.lat]].map(sample);
  const floor = Math.min(...h);
  return { floor, base: (floor + Math.max(...h)) / 2 };
};
const legacyGround = {
  plotGround(plot, sample) {
    if (parkPlot(plot)) return footprintGround(plot, sample);
    return massingMod.groundBase(
      sample([plot.center.lon, plot.center.lat]),
      massingMod.edgeProbes(plot.corners, 6).map(sample),
    );
  },
  districtGrounds(plots, sample, { fit }) {
    if (!fit || parkPlot(plots[0]))
      return { grounds: plots.map((plot) => legacyGround.plotGround(plot, sample)) };
    const frame = massingMod.localFrame(plots.map((p) => [p.center.lon, p.center.lat]));
    const lows = plots.map((plot) => {
      const h = [
        sample([plot.center.lon, plot.center.lat]),
        ...massingMod.edgeProbes(plot.corners, 6).map(sample),
      ].filter(Number.isFinite);
      const [x, y] = frame.toMeters([plot.center.lon, plot.center.lat]);
      return { x, y, h: h.length ? Math.min(...h) : NaN };
    });
    const fitted = hudMod.districtGround(lows);
    return {
      grounds: lows.map(({ x, y }) => (fitted ? { base: fitted.at(x, y), floor: fitted.floor - 1 } : null)),
    };
  },
};
const ground = groundMod ?? legacyGround;
// The snap the app's click resolver uses at a location: this head's
// snapCityPlot, else bc5acb3's cityPlay rule (a location with a gridPlot snaps
// with snapSausalitoPlot), else the global snapPlot.
const snapFor = (location) =>
  plotMod.snapCityPlot ??
  (location.gridPlot && plotMod.snapSausalitoPlot ? plotMod.snapSausalitoPlot : snapPlot);
// The hero preset turns every HUD part on, ground included.
const HUD = hudMod.cityHudFlags('?city=hero');

// --- the place label the HUD shows (I2) --------------------------------------
function shownPlace(point) {
  if (!locMod.cityPlaceName || !hudMod.placeText) return null; // parent: camera-nearest largest city
  return hudMod.placeText(locMod.cityPlaceName(point));
}

// --- seeded randomness ---------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const M = 111_320;
const offset = ({ lat, lon }, east, north) => ({
  lat: lat + north / M,
  lon: lon + east / (M * Math.cos((lat * Math.PI) / 180)),
});

// --- one location ------------------------------------------------------------
function runLocation(key) {
  const location = CITY_LOCATIONS[key];
  const loc = loadLocation(ROOT, key, location);
  if (!loc.dem) throw Object.assign(new Error(`no DEM for ${key}: run fetch-dem.mjs`), { code: 2 });
  const sample = (p) => loc.dem(p);
  const snapPlot = snapFor(location);
  const seen = new Map(); // placement key -> failures
  const placements = [];
  const appErrors = [];
  const check = (kind, plot, base, origin) => {
    const footprint = plotMassing({ corners: plot.corners }).footprint;
    const k = `${kind}|${plot.id}|${Number.isFinite(base) ? base.toFixed(2) : 'NaN'}`;
    if (seen.has(k)) return seen.get(k);
    const failures = placementFailures({ kind, id: plot.id, footprint, base, plot }, loc.fixture, sample);
    seen.set(k, failures);
    placements.push({ kind, id: plot.id, base, origin, failures });
    return failures;
  };
  const build = (plot, origin) =>
    check('massing', plot, ground.plotGround(plot, sample)?.base ?? NaN, origin);
  const growth = (plots, origin) => {
    let grounds = [];
    try {
      ({ grounds } = ground.districtGrounds(plots, sample, { fit: HUD.ground }));
    } catch (error) {
      // the app throws here too (e.g. a fitted plane through < 3 plot centres)
      appErrors.push({ origin, plots: plots.length, error: error.message });
    }
    plots.forEach((plot, i) => check('growth', plot, grounds[i]?.base ?? NaN, origin));
  };

  // the hero journey: the capture's click on the location plot, then its district
  const heroId = location.gridPlot ?? location.plot;
  const heroAt = plotFromId(heroId)?.center;
  const hero = heroAt && snapPlot(heroAt);
  const journey = { plot: hero?.id ?? null, district: 0 };
  if (hero) {
    build(hero, 'hero-build');
    let far = location.gridOppositePlot ? plotFromId(location.gridOppositePlot) : null;
    if (!far) {
      // capture.mjs (growth beat): the first of four plots 4 cells away on the global grid
      const size = hero.sizeMeters;
      for (const [r, c] of [[4, 4], [4, -4], [-4, 4], [-4, -4]]) {
        far = snapPlot(offset(hero.center, c * size, r * size));
        if (far) break;
      }
    }
    const district = far && plotBlock(hero, far);
    if (district) {
      journey.district = district.length;
      growth(district, 'hero-growth');
    }
  }
  // random picks across the location: every pick that resolves to a plot must hold
  const random = rng(SEED * 7919 + key.length);
  // picks fall in the disc a location answers for: PICK_RADIUS around its fixture centre
  const anchor = { lat: loc.json.centre.lat, lon: loc.json.centre.lon };
  const disc = () => {
    const r = PICK_RADIUS * Math.sqrt(random());
    const a = 2 * Math.PI * random();
    return offset(anchor, r * Math.cos(a), r * Math.sin(a));
  };
  let resolved = 0;
  const plotsSeen = new Set();
  for (let i = 0; i < PICKS; i++) {
    const plot = snapPlot(disc());
    if (!plot) continue;
    resolved++;
    plotsSeen.add(plot.id);
    build(plot, 'random-pick');
  }
  // exhaustive sweep: every plot a click anywhere in the disc can name (5 m lattice)
  const reachable = new Map();
  for (let y = -PICK_RADIUS; y <= PICK_RADIUS; y += 5)
    for (let x = -PICK_RADIUS; x <= PICK_RADIUS; x += 5) {
      if (Math.hypot(x, y) > PICK_RADIUS) continue;
      const plot = snapPlot(offset(anchor, x, y));
      if (plot && !reachable.has(plot.id)) reachable.set(plot.id, plot);
    }
  for (const plot of reachable.values()) build(plot, 'sweep');
  // random districts: a shift-click from one reachable plot to another within reach
  const pool = [...reachable.values()];
  let districts = 0;
  for (let i = 0; i < DISTRICTS && pool.length; i++) {
    const a = pool[Math.floor(random() * pool.length)];
    const near = pool.filter(
      (p) => p !== a && Math.hypot((p.center.lon - a.center.lon) * M * Math.cos((a.center.lat * Math.PI) / 180), (p.center.lat - a.center.lat) * M) <= 6 * a.sizeMeters,
    );
    const b = near[Math.floor(random() * near.length)];
    const block = b && plotBlock(a, b);
    if (!block) continue;
    districts++;
    growth(block, 'random-district');
  }
  // I2: the label for the hero plot and random plots of this location
  const labels = [];
  const expect = EXPECTED_PLACE[key];
  const labelAt = (point, where) => {
    const shown = shownPlace(point);
    labels.push(...labelFailures({ shown, expected: expect, where }));
  };
  if (heroAt) labelAt(heroAt, 'hero');
  for (let i = 0; i < 20; i++) labelAt(disc(), 'random');
  const failing = placements.filter((p) => p.failures.length);
  const byCheck = {};
  for (const p of failing) for (const f of p.failures) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
  return {
    key,
    water: loc.waterSource,
    shore: Boolean(loc.shoreSource),
    terrain: loc.dem.meta.source,
    journey,
    picks: PICKS,
    resolvedPicks: resolved,
    distinctPickPlots: plotsSeen.size,
    reachablePlots: reachable.size,
    randomDistricts: districts,
    placements: placements.length,
    failingPlacements: failing.length,
    failureItems: failing.reduce((s, p) => s + p.failures.length, 0),
    byCheck,
    labelFailures: labels.length,
    labelSample: labels.slice(0, 2),
    appErrors: appErrors.length,
    examples: failing.slice(0, 3).map((p) => ({ kind: p.kind, id: p.id, origin: p.origin, failures: p.failures })),
  };
}

let results;
try {
  results = LOCATION_KEYS.map(runLocation);
} catch (error) {
  console.error(`inner loop could not run: ${error.message}`);
  process.exit(error.code === 2 ? 2 : 3);
}
// I2 "unknown stays a dash": a point no location or city answers for.
const nowhere = shownPlace({ lat: 30, lon: -140 });
const dash = labelFailures({ shown: nowhere, expected: '—', where: 'mid-Pacific' });
const seconds = (performance.now() - t0) / 1000;
const totals = {
  placements: results.reduce((s, r) => s + r.placements, 0),
  failingPlacements: results.reduce((s, r) => s + r.failingPlacements, 0),
  failureItems: results.reduce((s, r) => s + r.failureItems, 0),
  labelFailures: results.reduce((s, r) => s + r.labelFailures, 0) + dash.length,
};
totals.invariantFailures = totals.failingPlacements + totals.labelFailures;
const coverage = results.every((r) => r.journey.plot && r.journey.district >= 16 && r.reachablePlots >= 16);
const report = { root: ROOT, seed: SEED, seconds: +seconds.toFixed(2), coverage, totals, dash, locations: results };
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(report, null, 1));
if (!QUIET)
  for (const r of results)
    console.log(
      `${r.key.padEnd(10)} hero=${r.journey.plot} district=${r.journey.district} picks ${r.resolvedPicks}/${r.picks} ` +
        `reachable=${r.reachablePlots} districts=${r.randomDistricts} placements=${r.placements} ` +
        `failing=${r.failingPlacements} labels=${r.labelFailures} ${JSON.stringify(r.byCheck)}`,
    );
console.log(
  `inner-loop: ${totals.invariantFailures} invariant failures (${totals.failingPlacements}/${totals.placements} placements, ` +
    `${totals.labelFailures} labels), coverage=${coverage ? 'ok' : 'LOW'}, ${seconds.toFixed(2)} s`,
);
process.exit(totals.invariantFailures === 0 && coverage ? 0 : 1);
