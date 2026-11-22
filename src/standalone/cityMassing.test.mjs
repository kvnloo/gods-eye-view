import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useCityPlayStore } from '../ui/stores/cityPlay.js';
import { getRenderGovernorDiagnostics } from '../renderGovernor.js';
import { PLOT_METERS, plotBlock, snapPlot } from '../data/cityPlot.js';
import { growthPlan } from '../data/cityGrowth.js';
import { fromDegrees, toLonLatH } from '../geo/ellipsoid.js';
import { distance, normalize, sub } from '../geo/vector.js';
import { bindRenderer } from '../render/rendererOf.js';
import { fakeDrawPort } from '../testSupport/fakeDrawPort.mjs';
import { mountCityMassing } from './cityMassing.js';

const plot = snapPlot({ lat: 37.8006, lon: -122.4103 });
const MORNING = '2026-06-21T15:00:00Z';
const NIGHT = '2026-06-21T08:00:00Z';
const CAPABILITIES = new Set([
  'facadeFill',
  'shapeShadows',
  'sunShadows',
  'photorealCut',
  'globeVisibility',
  'surfaceIdentity',
]);

/**
 * The renderer as the owner sees it, through its ports: what it draws (a
 * fake draw port), the map it samples (tests move the ground, add photoreal
 * tiles and say whether they have loaded), the photoreal cuts it holds and
 * the sun's shadows as the effects port was last told them.
 */
function mount({ tiles = 0, time = MORNING, ground = -8.25, on = true } = {}) {
  const frames = [];
  const surface = {
    ground,
    // Photoreal tilesets shown; the globe shows without them.
    tiles,
    loaded: true,
    // The height at a point, for tests of the mesh beside the plot.
    sample: null,
    cuts: [],
    shadows: null,
  };
  const eye = fromDegrees(-122.4103, 37.795, 600);
  const direction = normalize(
    sub(fromDegrees(plot.center.lon, plot.center.lat, 0), eye),
  );
  const host = {};
  const draw = fakeDrawPort();
  const rect = { left: 0, top: 0, width: 1440, height: 900 };
  rect.right = rect.width;
  rect.bottom = rect.height;
  bindRenderer(host, {
    capabilities: CAPABILITIES,
    canvas: { getBoundingClientRect: () => rect, clientWidth: rect.width },
    draw,
    camera: {
      pose: () => ({ ...toLonLatH(eye), position: eye, direction }),
    },
    query: {
      project: () => ({ x: 700, y: 450 }),
      isOccluded: () => false,
      sampleHeightNow: (at) => surface.sample?.(at) ?? surface.ground,
    },
    frame: {
      on(phase, cb) {
        if (phase !== 'postRender') return () => {};
        frames.push(cb);
        return () => frames.splice(frames.indexOf(cb), 1);
      },
      requestRender() {},
      time: () => Date.parse(time),
    },
    globe: {
      isGlobeVisible: () => surface.tiles === 0,
      surfaceVersion: () => surface.tiles,
      isSettled: () => surface.loaded,
      cutPhotoreal(ring) {
        if (!surface.tiles) return null;
        const cut = { ring, released: false };
        surface.cuts.push(cut);
        return () => {
          cut.released = true;
        };
      },
    },
    effects: {
      sunShadows(settings) {
        surface.shadows = settings && { ...settings };
      },
      diagnostics: () => ({
        passes: surface.shadows?.cast ? ['sunShadows'] : [],
      }),
    },
  });
  const render = () => [...frames].forEach((fn) => fn());
  const store = useCityPlayStore(createPinia());
  const win = {};
  const owner = mountCityMassing({ host, store, win });
  const select = async (view) => {
    store.publish(
      view && { active: true, tier: 'plot', pending: false, ...view },
    );
    await nextTick();
  };
  if (on) store.massingControls.toggle();
  // What the owner's draw sets hold now.
  const items = (id) => [...(draw.set(id)?.items.values() ?? [])];
  const item = (id) =>
    ['city-massing', 'city-massing-marks', 'city-massing-growth']
      .flatMap(items)
      .find((it) => it.id === id);
  const standing = () => surface.cuts.filter((cut) => !cut.released);
  return {
    host,
    draw,
    store,
    win,
    owner,
    select,
    surface,
    render,
    items,
    item,
    standing,
    eye,
  };
}

const bottom = (shape) => shape.geometry.rings[0][0].height;

test('a selected plot gets a plate and a block on the sampled ground', async () => {
  const { surface, win, items, item, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.shown, true);
  assert.equal(s.plotId, plot.id);
  assert.equal(s.base, -8.25);
  assert.ok(Math.abs(s.blockTop - (-8.25 + 6 * 3.2)) < 1e-9);
  assert.equal(s.blockShadows, true);
  assert.equal(surface.shadows.cast, true, 'the sun is up: the shadow map is on');
  assert.equal(s.shadowMap, true);
  const block = item('city-massing-block');
  const plate = item('city-massing-plate');
  assert.equal(bottom(block), -8.25);
  assert.equal(block.height, 'absolute');
  assert.ok(bottom(plate) <= -8.75, 'the plate reaches below ground');
  assert.ok(plate.extrudeHeight > -8.25, 'and covers the base');
  await select(null);
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  assert.equal(items('city-massing').length, 0);
  assert.equal(surface.shadows, null, 'the shadow map is restored');
  owner.destroy();
  assert.equal(win.__gevCityMassing, undefined);
});

test('on 3D tiles the plot is cut out of the mesh and restored afterwards', async () => {
  const { win, select, standing, surface, owner } = mount({ tiles: 1 });
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().cuts, 1);
  assert.equal(standing().length, 1);
  standing()[0].ring.forEach(({ lon, lat }, i) => {
    assert.ok(Math.abs(lon - plot.corners[i][0]) < 1e-9);
    assert.ok(Math.abs(lat - plot.corners[i][1]) < 1e-9);
  });
  await select(null);
  assert.equal(standing().length, 0, 'our cut is released');
  assert.equal(surface.cuts.length, 1);
  owner.destroy();
});

test('the block hides while Reimagine captures and in the district tier', async () => {
  const { win, select, owner } = mount();
  await select({ plot: { id: plot.id }, pending: true });
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  await select({ plot: { id: plot.id }, tier: 'district' });
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  await select({ plot: { id: plot.id }, active: false });
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().shown, true);
  owner.destroy();
});

test('with the sun below the horizon no shadow map is turned on', async () => {
  const { surface, win, select, owner } = mount({ time: NIGHT });
  await select({ plot: { id: plot.id } });
  assert.ok(win.__gevCityMassing.snapshot().sun.elevationDeg < 0);
  assert.equal(surface.shadows.cast, false);
  assert.equal(win.__gevCityMassing.snapshot().shadowMap, false);
  owner.destroy();
});

test('massing waits for the MASSING toggle and publishes the readout numbers', async () => {
  const { store, win, select, owner } = mount({ on: false });
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().shown, false, 'off by default');
  assert.deepEqual(
    { on: store.massing.on, storeys: store.massing.storeys },
    { on: false, storeys: 6 },
  );
  store.massingControls.toggle();
  assert.equal(win.__gevCityMassing.snapshot().shown, true);
  assert.equal(store.massing.on, true);
  assert.ok(Math.abs(store.massing.far - 3.84) < 1e-9);
  store.massingControls.toggle();
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  await select(null);
  assert.equal(store.massing, null, 'no plot, no readout');
  owner.destroy();
  assert.equal(store.massingControls, null);
});


test('the stepper recomputes every number and re-extrudes the block', async () => {
  const { store, win, item, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  store.massingControls.step(1);
  store.massingControls.step(1);
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.storeys, 8);
  assert.ok(Math.abs(s.blockTop - s.base - 25.6) < 1e-9);
  const block = item('city-massing-block');
  assert.ok(Math.abs(block.extrudeHeight - (-8.25 + 25.6)) < 1e-9);
  assert.equal(store.massing.storeys, 8);
  assert.ok(Math.abs(store.massing.heightMeters - 25.6) < 1e-9);
  assert.ok(Math.abs(store.massing.floorAreaSquareMeters - 8192) < 1e-6);
  assert.ok(Math.abs(store.massing.far - 5.12) < 1e-9);
  owner.destroy();
});

test('the block stands anew on the refined ground once the framed tiles load', async () => {
  const { win, item, select, surface, render, owner } = mount({
    ground: -3,
  });
  // Coming in from the district view: tiles still coarse.
  surface.loaded = false;
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().base, -3);
  surface.ground = -8.25;
  render();
  assert.equal(win.__gevCityMassing.snapshot().base, -3, 'still loading');
  surface.loaded = true;
  render();
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.base, -8.25);
  assert.equal(s.blockBase, -8.25, 'the block shape moved');
  assert.ok(Math.abs(s.blockExtrudedHeight - (-8.25 + 19.2)) < 1e-9);
  assert.ok(s.plateBottom <= -8.75 && s.plateTop > -8.25);
  assert.ok(item('city-massing-block'));
  owner.destroy();
});

test('a map switch to photoreal while the block shows cuts the new tileset', async () => {
  const { win, select, surface, standing, render, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().cuts, 0, 'globe only');
  surface.tiles = 1;
  render();
  await Promise.resolve();
  assert.equal(win.__gevCityMassing.snapshot().cuts, 1);
  assert.equal(standing().length, 1);
  owner.destroy();
  assert.equal(standing().length, 0);
});

test('the globe receives the block shadow with soft edges, and both are restored', async () => {
  const { surface, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(surface.shadows.softEdges, true);
  await select(null);
  assert.equal(surface.shadows, null, 'the scene settings come back');
  owner.destroy();
});

test('frames keep coming until the block is drawn as it now stands', async () => {
  const held = () =>
    getRenderGovernorDiagnostics().holds.includes('city-massing');
  const { store, win, select, render, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(held(), true, 'the shapes are still being handed over');
  assert.equal(win.__gevCityMassing.snapshot().drawn, false);
  // A change reaches the renderer's primitives on the next frame: the
  // frames after it draw it.
  render();
  render();
  assert.equal(held(), true);
  assert.equal(win.__gevCityMassing.snapshot().drawn, false);
  render();
  assert.equal(held(), false, 'drawn: the app renders on demand again');
  assert.equal(win.__gevCityMassing.snapshot().drawn, true);
  // The stepper rebuilds the block: held again until the new block is drawn,
  // and the frames before the change do not count.
  store.massingControls.step(1);
  assert.equal(win.__gevCityMassing.snapshot().drawn, false);
  render();
  assert.equal(held(), true);
  render();
  render();
  assert.equal(held(), false);
  owner.destroy();
  assert.equal(held(), false);
});

test('the readout gets HOMES and SHADOW REACH from the block and the scene sun', async () => {
  const { store, win, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  const sun = win.__gevCityMassing.snapshot().sun;
  const reach = (h) => h / Math.tan((sun.elevationDeg * Math.PI) / 180);
  assert.equal(store.massing.homes, 46);
  assert.equal(store.massing.residentialShare, 0.64);
  assert.equal(store.massing.homeSquareMeters, 85);
  assert.ok(Math.abs(store.massing.shadowReachMeters - reach(19.2)) < 1e-9);
  assert.equal(store.massing.sunElevationDeg, sun.elevationDeg);
  store.massingControls.step(1);
  store.massingControls.step(1);
  assert.equal(store.massing.homes, 61);
  assert.ok(Math.abs(store.massing.shadowReachMeters - reach(25.6)) < 1e-9);
  owner.destroy();
});

test('with the sun down SHADOW REACH is missing, never zero', async () => {
  const { store, select, owner } = mount({ time: NIGHT });
  await select({ plot: { id: plot.id } });
  assert.equal(store.massing.shadowReachMeters, null);
  assert.equal(store.massing.homes, 46);
  owner.destroy();
});

// --- The shadow study (PROTECT SIDEWALK) ---------------------------------
// Solar noon at the plot on the winter solstice: the sun 28.8° up, due south.
const WINTER_NOON = '2026-12-21T20:07:41Z';
const within = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} ±${tolerance}`,
  );
const studyIds = (items) =>
  items('city-massing-marks')
    .map((line) => line.id)
    .filter((id) => id.includes('-shadow-'))
    .sort();
// A ground point `meters` north of the plot centre.
const north = (meters) => ({
  lat: plot.center.lat + meters / 111_320,
  lon: plot.center.lon,
});

test('PROTECT SIDEWALK draws the plan, what a fit would leave and the edge; FIT TO SUN cuts 6 storeys to 3', async () => {
  const { store, win, items, item, select, render, owner } = mount({
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  assert.deepEqual(studyIds(items), [], 'off by default: nothing on the ground');
  assert.equal(store.massing.shadow.on, false);
  assert.equal(store.massing.shadow.plan, null);
  assert.equal(store.massing.shadow.winter, true);
  assert.equal(win.__gevCityMassing.snapshot().study, false);
  store.massingControls.study();
  render();
  let s = win.__gevCityMassing.snapshot();
  assert.deepEqual(studyIds(items), [
    'city-massing-shadow-edge',
    'city-massing-shadow-fit',
    'city-massing-shadow-now',
  ]);
  assert.deepEqual(
    s.study.plan.lines.map((line) => [line.kind, line.storeys]),
    [
      ['now', 6],
      ['fit', 3],
    ],
  );
  assert.equal(s.study.edgeMeters, 20);
  assert.equal(s.study.edgeSet, false, 'assumed until the player sets it');
  // The entities are as long as the plan says, and the edge is 20 m out.
  for (const line of s.study.plan.lines)
    within(s.study.drawn[line.kind], line.reachMeters, 0.3, line.kind);
  within(s.study.drawn.now, 34.9, 0.3, '6 storeys of 3.2 m at 28.8°');
  within(s.study.drawn.edge, 20, 0.3, 'edge');
  assert.equal(store.massing.shadow.plan.canFit, true);
  assert.ok(store.massing.shadow.plan.now.overMeters > 0, 'on the sidewalk');
  assert.equal(store.massing.shadow.was, null, 'nothing changed yet');
  assert.deepEqual(Object.keys(store.massingAnchors.tips), ['now', 'fit']);

  store.massingControls.fit();
  render();
  s = win.__gevCityMassing.snapshot();
  assert.equal(s.storeys, 3);
  within(item('city-massing-block').extrudeHeight, -8.25 + 9.6, 1e-9, 'block top');
  assert.deepEqual(studyIds(items), [
    'city-massing-shadow-edge',
    'city-massing-shadow-now',
    'city-massing-shadow-was',
  ]);
  assert.deepEqual(
    s.study.plan.lines.map((line) => [line.kind, line.storeys]),
    [
      ['was', 6],
      ['now', 3],
    ],
  );
  within(s.study.drawn.was, 34.9, 0.3, 'was');
  within(s.study.drawn.now, 17.5, 0.3, 'now');
  assert.ok(s.study.plan.now.overMeters < 0, 'clears the sidewalk');
  assert.equal(s.study.plan.canFit, false);
  assert.equal(store.massing.homes, 23);
  within(store.massing.far, 1.92, 1e-9, 'FAR');
  // What the cut cost: the six storeys' homes and FAR beside the new ones.
  assert.equal(store.massing.shadow.was.homes, 46);
  within(store.massing.shadow.was.far, 3.84, 1e-9, 'FAR before');
  assert.deepEqual(Object.keys(store.massingAnchors.tips), ['was', 'now']);
  store.massingControls.fit();
  assert.equal(win.__gevCityMassing.snapshot().storeys, 3, 'fitted: a no-op');

  store.massingControls.study();
  render();
  assert.deepEqual(studyIds(items), [], 'study off: the ground is clear');
  assert.equal(store.massing.shadow.on, false);
  assert.equal(store.massingAnchors.tips.now, undefined);
  owner.destroy();
});

test('SET ON MAP takes one ground click as the edge, measured from the block face along the shadow; the stepper moves it', async () => {
  const { store, win, select, render, owner } = mount({ time: WINTER_NOON });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  assert.equal(
    store.massingControls.click(north(43)),
    false,
    'not armed: play mode keeps the click',
  );
  store.massingControls.pickEdge();
  assert.equal(store.massing.shadow.picking, true);
  // The block's north face is 16 m north of the centre: 27 m beyond it.
  assert.equal(store.massingControls.click(north(16 + 27)), true);
  assert.deepEqual(
    [
      store.massing.shadow.edgeMeters,
      store.massing.shadow.edgeSet,
      store.massing.shadow.picking,
    ],
    [27, true, false],
  );
  render();
  within(win.__gevCityMassing.snapshot().study.drawn.edge, 27, 0.3, 'edge');
  assert.equal(store.massing.shadow.plan.fit.storeys, 4);
  // A click on the block or behind the face is taken and sets nothing: the
  // tool stays armed until a click lands across the street or it is put down.
  store.massingControls.pickEdge();
  assert.equal(store.massingControls.click(north(0)), true);
  assert.equal(store.massing.shadow.edgeMeters, 27);
  assert.equal(store.massing.shadow.picking, true);
  store.massingControls.pickEdge();
  assert.equal(store.massing.shadow.picking, false);
  store.massingControls.stepEdge(-1);
  store.massingControls.stepEdge(-1);
  store.massingControls.stepEdge(1);
  assert.equal(store.massing.shadow.edgeMeters, 26);
  for (let i = 0; i < 40; i++) store.massingControls.stepEdge(-1);
  assert.equal(store.massing.shadow.edgeMeters, 1, 'never nearer than 1 m');
  assert.equal(store.massing.shadow.plan.cannotClear, true);
  // Another plot starts again from the assumption.
  const other = snapPlot({ lat: 37.8016, lon: -122.4103 });
  await select({ plot: { id: other.id } });
  assert.deepEqual(
    [store.massing.shadow.edgeMeters, store.massing.shadow.edgeSet],
    [20, false],
  );
  owner.destroy();
});

test('WINTER NOON seeks the world clock to solar noon on the winter solstice at the plot', async (t) => {
  const { worldClock } = await import('../time/worldClock.js');
  t.after(() => worldClock.goLive());
  const { store, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(store.massing.shadow.winter, false, 'a June scene');
  store.massingControls.winterNoon();
  assert.equal(worldClock.isLive(), false);
  assert.equal(
    new Date(worldClock.now()).toISOString().slice(0, 16),
    '2026-12-21T20:07',
  );
  owner.destroy();
});

test('with the sun down the study draws nothing and FIT TO SUN does nothing', async () => {
  const { store, win, items, item, select, render, owner } = mount({ time: NIGHT });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  render();
  assert.deepEqual(studyIds(items), []);
  const { plan } = store.massing.shadow;
  assert.equal(plan.now.reachMeters, null, 'missing, never zero');
  assert.equal(plan.fit, null);
  assert.equal(plan.canFit, false);
  store.massingControls.fit();
  assert.equal(win.__gevCityMassing.snapshot().storeys, 6);
  store.massingControls.pickEdge();
  assert.equal(store.massingControls.click(north(43)), false);
  assert.equal(win.__gevCityMassing.snapshot().study.drawn, false);
  owner.destroy();
});

// --- The look: the block is drawn as a building ---------------------------
test('the block is drawn as an opaque building from its own storeys, with no cyan cage', async () => {
  const { store, win, draw, item, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  let s = win.__gevCityMassing.snapshot();
  const block = item('city-massing-block');
  assert.equal(s.blockFill, 'facade');
  // The renderer draws a facade fill opaque, in a material of its own
  // (src/render/cesium/drawFacade.test.mjs).
  assert.ok(block.fill.facade, 'drawn as a facade');
  assert.equal(block.outline, undefined, 'no wireframe on the block');
  assert.equal(s.facade.bands.length, 6);
  assert.equal(s.facade.bands[0].kind, 'shopfront');
  within(s.facade.heightMeters, s.blockTop - s.base, 1e-9, 'top');
  // What the renderer is handed is the block as it stands: storeys, storey
  // height, top and parapet, around an origin at the footprint's middle on
  // the ground.
  let { facade } = block.fill;
  assert.deepEqual(
    [facade.storeys, facade.storeyHeightM, facade.heightM],
    [6, 3.2, s.facade.heightMeters],
  );
  within(facade.parapetM, 0.576, 1e-9, 'parapet');
  within(facade.origin.height, -8.25, 1e-9, 'origin on the ground');
  within(facade.origin.lat, plot.center.lat, 1e-6, 'lat');
  // Four walls of 32 m in ten bays, each facing out along its own normal.
  assert.equal(facade.walls.length, 4);
  for (const wall of facade.walls) {
    within(Math.hypot(...wall.normal), 1, 1e-9, 'unit normal');
    within(wall.offsetM, 16, 0.01, 'wall 16 m from the middle');
    within(wall.lengthM / 2, 16, 0.01, 'half of 32 m');
  }
  assert.deepEqual(
    facade.walls.map((wall) => wall.bays),
    [10, 10, 10, 10],
  );
  // The stepper re-dresses the standing block: the same item, new levels.
  const writes = draw.set('city-massing').writes;
  store.massingControls.step(-1);
  s = win.__gevCityMassing.snapshot();
  assert.equal(s.facade.bands.length, 5);
  ({ facade } = item('city-massing-block').fill);
  assert.deepEqual([facade.storeys, facade.heightM], [5, 16]);
  assert.equal(draw.set('city-massing').writes, writes + 1, 'one upsert');
  owner.destroy();
});

test('the block casts and receives nothing; its shadow is as dark as one in the imagery while it shows', async () => {
  const { surface, item, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  const block = item('city-massing-block');
  const plate = item('city-massing-plate');
  // A shadow map speckles a lit roof it falls back on: the shader shades the
  // block itself, and the paving under it takes the shadow.
  assert.equal(block.shadows, 'cast');
  assert.equal(plate.shadows, 'receive');
  assert.ok(plate.fill.facade, 'paving');
  assert.equal(surface.shadows.darkness, 0.4);
  owner.destroy();
  assert.equal(surface.shadows, null, 'restored');
});

test('the study marks are thin ground lines: NOW solid, WAS dashed, no fill over the cast shadow', async () => {
  const { store, items, item, select, render, owner } = mount({
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  store.massingControls.fit();
  render();
  const now = item('city-massing-shadow-now');
  const was = item('city-massing-shadow-was');
  assert.ok(
    !items('city-massing').some((shape) => shape.id.includes('-shadow-')),
    'the shadow map draws the shadow',
  );
  for (const line of [now, was]) {
    assert.equal(line.mode, 'draped');
    assert.ok(line.widthPx <= 4, 'thin');
  }
  assert.equal(now.style.kind, 'solid');
  assert.equal(was.style.kind, 'dash');
  owner.destroy();
});

test('on 3D tiles the study lines run level at the block base', async () => {
  const { store, win, item, select, render, owner } = mount({
    tiles: 1,
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  // The renderer's cut draws the mesh's inside (photorealCut.test.mjs).
  store.massingControls.study();
  render();
  for (const id of ['now', 'fit', 'edge']) {
    const line = item(`city-massing-shadow-${id}`);
    // A ground line would smear down every wall of the mesh it meets.
    assert.notEqual(line.mode, 'draped', `${id} is not draped`);
    for (const at of line.positions)
      within(
        toLonLatH(at).height,
        -8.25 + 0.5,
        1e-3,
        `${id} runs half a metre over the base`,
      );
    assert.ok(
      Number(/rgba\([^)]*,([\d.]+)\)/.exec(line.depthFail.color)[1]) < 0.5,
      `${id} is faint behind a building`,
    );
  }
  const { drawn, plan } = win.__gevCityMassing.snapshot().study;
  within(drawn.now, plan.now.reachMeters, 0.3, 'now, read off the level line');
  within(drawn.edge, 20, 0.3, 'edge');
  owner.destroy();
});

test('on 3D tiles a blank wall closes the cut where a neighbour stands at the plot edge, not where a tree does', async () => {
  const { surface, item, select, owner } = mount({ tiles: 1 });
  const north = Math.max(...plot.corners.map(([, lat]) => lat));
  const east = Math.max(...plot.corners.map(([lon]) => lon));
  // The mesh outside the plot: a building 12 m over the ground all along the
  // north edge, one tree 9 m high beside the east edge, street elsewhere.
  surface.sample = ({ lon, lat }) => {
    if (lat > north) return 3.75;
    if (lon > east && Math.abs(lat - plot.center.lat) < 0.00001) return 0.75;
    return -8.25;
  };
  await select({ plot: { id: plot.id } });
  const sides = item('city-massing-sides').geometry;
  const tops = sides.maximumHeights;
  const bottoms = sides.minimumHeights;
  assert.equal(tops.length, 41, 'a closed ring of forty 4 m steps');
  assert.ok(bottoms.every((height) => Math.abs(height - -8.15) < 1e-9));
  const high = tops.filter((height) => height === 3.75).length;
  assert.ok(high >= 9 && high <= 13, `the neighbour's wall: ${high} steps`);
  assert.ok(!tops.includes(0.75), 'a lone tree raises no wall');
  assert.equal(
    item('city-massing-sides').shadows,
    'receive',
    'the wall takes the shadow',
  );
  await select(null);
  assert.equal(item('city-massing-sides'), undefined);
  owner.destroy();
});

test('while a block shows the shadow map ends a little beyond it, and is restored', async () => {
  const { surface, select, render, eye, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(surface.shadows.maxDistanceM, undefined, 'the scene’s own');
  render();
  // The eye is about 880 m from the plot: 1.6 times that, not 5 km of texels.
  const away = distance(
    eye,
    fromDegrees(plot.center.lon, plot.center.lat, -8.25),
  );
  within(surface.shadows.maxDistanceM, 1.6 * away, 1e-6, 'fitted');
  assert.ok(surface.shadows.maxDistanceM < 2000);
  await select(null);
  assert.equal(surface.shadows, null, 'restored');
  owner.destroy();
});

// The 25 plots from the test plot out to the one four rows north and four
// columns east of it: a district as play mode's shift-click selects it.
const FAR_CORNER = snapPlot({
  lat: plot.center.lat + (4 * PLOT_METERS) / 111_320,
  lon:
    plot.center.lon +
    (4 * PLOT_METERS) /
      (111_320 * Math.cos((plot.center.lat * Math.PI) / 180)),
});
const DISTRICT = plotBlock(plot, FAR_CORNER);
const districtView = (anchor = plot) => ({
  plot: { id: anchor.id },
  district: DISTRICT.map((cell) => cell.id),
});
const blockOf = (item, id) => item(`city-massing-block-${id}`);
const heightOf = (item, id) =>
  blockOf(item, id).extrudeHeight - bottom(blockOf(item, id));

test('GROWTH stands a block on every plot of the district, and the rail stages the cohort 3 → 4 → 5 storeys', async () => {
  const { surface, store, win, items, item, select, owner } = mount();
  await select(districtView());
  assert.equal(DISTRICT.length, 25);
  assert.equal(store.growth.on, false, 'off until GROWTH is pressed');
  assert.equal(store.growth.plan.plots, 25);
  // The one block's look, to hold every district block to.
  const look = (shape) => [
    Boolean(shape.fill.facade),
    shape.outline,
    shape.shadows,
  ];
  const one = look(item('city-massing-block'));
  assert.equal(win.__gevCityMassing.snapshot().growth, false);

  store.massingControls.growth();
  assert.equal(store.growth.on, true);
  assert.equal(store.growth.stage, 0);
  assert.equal(item('city-massing-block'), undefined);
  assert.equal(items('city-massing').length, 0);
  assert.equal(items('city-massing-growth').length, 50, '25 plates and 25 blocks');
  for (const cell of DISTRICT)
    assert.deepEqual(look(blockOf(item, cell.id)), one, 'the massing block as it is');
  const plan = growthPlan({ plots: DISTRICT, anchorId: plot.id });
  assert.deepEqual(store.growth.plan.cohort, plan.cohort);
  assert.deepEqual(
    store.growth.plan.stages.map((stage) => stage.homes),
    [575, 659, 755],
  );
  for (const index of [0, 1, 2, 0]) {
    store.massingControls.stage(index);
    assert.equal(store.growth.stage, index);
    const drawn = win.__gevCityMassing.snapshot().growth;
    assert.equal(drawn.stage, index);
    for (const block of plan.stages[index].blocks) {
      within(heightOf(item, block.plotId), block.heightMeters, 1e-9, block.plotId);
      assert.equal(
        bottom(blockOf(item, block.plotId)),
        -8.25,
        'on the sampled ground',
      );
    }
    assert.deepEqual(
      drawn.blocks.map((block) => block.plotId),
      DISTRICT.map((cell) => cell.id),
    );
  }
  store.massingControls.stage(7);
  assert.equal(store.growth.stage, 0, 'no such stop');

  store.massingControls.growth();
  assert.equal(store.growth.on, false);
  assert.equal(items('city-massing-growth').length, 0);
  assert.equal(items('city-massing').length, 2, 'the one plate and block again');
  assert.ok(item('city-massing-block'));
  assert.equal(surface.shadows.cast, true, 'still lit for the one block');
  await select(null);
  assert.equal(store.growth, null);
  assert.equal(items('city-massing').length, 0);
  assert.equal(surface.shadows, null, 'the shadow map is restored');
  owner.destroy();
});

test('a plot fitted to the sun is locked: no stage raises it, a badge marks it, and the stepper releases it', async () => {
  const { store, win, item, select, render, owner } = mount({
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  store.massingControls.fit();
  assert.deepEqual(win.__gevCityMassing.snapshot().locks, { [plot.id]: 3 });
  // The district is picked from its far corner: the fitted plot is in the cohort.
  await select(districtView(FAR_CORNER));
  store.massingControls.growth();
  assert.ok(store.growth.plan.cohort.includes(plot.id));
  assert.deepEqual(store.growth.plan.locked, [plot.id]);
  for (const index of [0, 1, 2]) {
    store.massingControls.stage(index);
    within(heightOf(item, plot.id), 3 * 3.2, 1e-9, `stage ${index}`);
    const other = store.growth.plan.cohort.find((id) => id !== plot.id);
    within(heightOf(item, other), (3 + index) * 3.2, 1e-9, 'the cohort rises');
  }
  assert.deepEqual(
    win.__gevCityMassing
      .snapshot()
      .growth.blocks.filter((block) => block.locked)
      .map((block) => block.plotId),
    [plot.id],
  );
  render();
  assert.deepEqual(
    store.growthAnchors.locks.map((lock) => lock.plotId),
    [plot.id],
  );
  assert.deepEqual(store.growthAnchors.locks[0].at, { x: 700, y: 450 });
  store.massingControls.growth();
  assert.equal(store.growthAnchors, null, 'off: no badge');
  // The player's own stepper on that plot changes the block the fit left.
  await select({ plot: { id: plot.id } });
  store.massingControls.step(1);
  assert.deepEqual(win.__gevCityMassing.snapshot().locks, {});
  owner.destroy();
});

test('the player edits the storeys of the stage shown; a stage below an earlier one is flagged, and another district starts from the plan', async () => {
  const { store, item, select, owner } = mount();
  await select(districtView());
  store.massingControls.stepStage(1);
  assert.equal(store.growth.plan.stages[0].storeys, 3, 'GROWTH is off');
  store.massingControls.growth();
  store.massingControls.stage(2);
  store.massingControls.stepStage(-2);
  assert.deepEqual(
    store.growth.plan.stages.map((stage) => [stage.storeys, stage.lowered]),
    [
      [3, false],
      [4, false],
      [3, true],
    ],
  );
  const grown = store.growth.plan.cohort[0];
  within(heightOf(item, grown), 3 * 3.2, 1e-9, 'the edit is drawn');
  store.massingControls.stepStage(4);
  assert.equal(store.growth.plan.stages[2].storeys, 7);
  assert.equal(store.growth.plan.stages[2].lowered, false);
  within(heightOf(item, grown), 7 * 3.2, 1e-9, 'and drawn again');
  // A smaller district: the timeline is off, at NOW, on the plan's storeys.
  await select({
    plot: { id: plot.id },
    district: DISTRICT.slice(0, 5).map((cell) => cell.id),
  });
  assert.equal(store.growth.on, false);
  assert.equal(store.growth.stage, 0);
  assert.equal(store.growth.plan.plots, 5);
  assert.deepEqual(
    store.growth.plan.stages.map((stage) => stage.storeys),
    [3, 4, 5],
  );
  assert.equal(item(`city-massing-block-${grown}`), undefined);
  owner.destroy();
});
