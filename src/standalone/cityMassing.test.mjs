import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useCityPlayStore } from '../ui/stores/cityPlay.js';
import { getRenderGovernorDiagnostics } from '../renderGovernor.js';
import { snapPlot } from '../data/cityPlot.js';
import { mountCityMassing } from './cityMassing.js';

const plot = snapPlot({ lat: 37.8006, lon: -122.4103 });
const MORNING = '2026-06-21T15:00:00Z';
const NIGHT = '2026-06-21T08:00:00Z';

// A photoreal tileset as the owner sees it: a Cesium3DTileset that can be cut.
function tileset() {
  return Object.assign(Object.create(Cesium.Cesium3DTileset.prototype), {
    show: true,
    shadows: Cesium.ShadowMode.ENABLED,
    _tilesLoaded: true,
    isDestroyed: () => false,
  });
}

function mount({ tiles = [], time = MORNING, ground = -8.25, on = true } = {}) {
  const sources = [];
  const frames = [];
  // The map as the owner samples it; tests move the ground and add tilesets.
  // `drawn` is whether the entities' geometry has built (it builds over frames).
  const surface = { ground, tiles, drawn: true };
  const eye = Cesium.Cartesian3.fromDegrees(-122.4103, 37.795, 600);
  const viewer = {
    shadows: false,
    dataSourceDisplay: {
      getBoundingSphere: () =>
        surface.drawn
          ? Cesium.BoundingSphereState.DONE
          : Cesium.BoundingSphereState.PENDING,
    },
    clock: { currentTime: Cesium.JulianDate.fromIso8601(time) },
    camera: {
      positionWC: eye,
      directionWC: Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(
          Cesium.Cartesian3.fromDegrees(plot.center.lon, plot.center.lat, 0),
          eye,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      ),
    },
    dataSources: {
      add: (ds) => (sources.push(ds), Promise.resolve(ds)),
      remove: (ds) => sources.splice(sources.indexOf(ds), 1).length > 0,
      getByName: (name) => sources.filter((ds) => ds.name === name),
    },
    scene: {
      context: { webgl2: true },
      sampleHeightSupported: true,
      sampleHeight: () => surface.ground,
      globe: {
        show: tiles.length === 0,
        tilesLoaded: true,
        shadows: Cesium.ShadowMode.DISABLED,
        getHeight: () => surface.ground,
      },
      shadowMap: { softShadows: false },
      primitives: {
        get length() {
          return surface.tiles.length;
        },
        get: (i) => surface.tiles[i],
      },
      postRender: {
        addEventListener: (fn) => {
          frames.push(fn);
          return () => frames.splice(frames.indexOf(fn), 1);
        },
      },
      canvas: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 1440,
          height: 900,
        }),
      },
      cartesianToCanvasCoordinates: () => ({ x: 700, y: 450 }),
      requestRender() {},
    },
  };
  const render = () => frames.forEach((fn) => fn());
  const store = useCityPlayStore(createPinia());
  const win = {};
  const owner = mountCityMassing({ viewer, store, win });
  const ds = sources[0];
  const select = async (view) => {
    store.publish(
      view && { active: true, tier: 'plot', pending: false, ...view },
    );
    await nextTick();
  };
  if (on) store.massingControls.toggle();
  return { viewer, store, win, owner, ds, select, surface, render };
}

test('a selected plot gets a plate and a block on the sampled ground', async () => {
  const { viewer, win, ds, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.shown, true);
  assert.equal(s.plotId, plot.id);
  assert.equal(s.base, -8.25);
  assert.ok(Math.abs(s.blockTop - (-8.25 + 6 * 3.2)) < 1e-9);
  assert.equal(s.blockShadows, true);
  assert.equal(viewer.shadows, true, 'the sun is up: the shadow map is on');
  const block = ds.entities.getById('city-massing-block').polygon;
  const plate = ds.entities.getById('city-massing-plate').polygon;
  assert.equal(block.height.getValue(), -8.25);
  assert.ok(plate.height.getValue() <= -8.75, 'the plate reaches below ground');
  assert.ok(plate.extrudedHeight.getValue() > -8.25, 'and covers the base');
  await select(null);
  assert.equal(win.__gevCityMassing.snapshot().shown, false);
  assert.equal(ds.entities.values.length, 0);
  assert.equal(viewer.shadows, false, 'the shadow map is restored');
  owner.destroy();
  assert.equal(win.__gevCityMassing, undefined);
});

test('on 3D tiles the plot is cut out of the mesh and restored afterwards', async () => {
  const tiles = tileset();
  const { win, select, owner } = mount({ tiles: [tiles] });
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().cuts, 1);
  assert.equal(tiles.clippingPolygons.length, 1);
  const cut = tiles.clippingPolygons.get(0).positions.map((p) => {
    const c = Cesium.Cartographic.fromCartesian(p);
    return [c.longitude, c.latitude].map(Cesium.Math.toDegrees);
  });
  cut.forEach(([lon, lat], i) => {
    assert.ok(Math.abs(lon - plot.corners[i][0]) < 1e-9);
    assert.ok(Math.abs(lat - plot.corners[i][1]) < 1e-9);
  });
  assert.equal(tiles.shadows, Cesium.ShadowMode.RECEIVE_ONLY);
  await select(null);
  assert.equal(tiles.clippingPolygons, undefined, 'our collection is gone');
  assert.equal(tiles.shadows, Cesium.ShadowMode.ENABLED);
  owner.destroy();
});

test('an existing cut stays: ours joins it and leaves again', async () => {
  const tiles = tileset();
  const theirs = new Cesium.ClippingPolygonCollection({
    polygons: [
      new Cesium.ClippingPolygon({
        positions: Cesium.Cartesian3.fromDegreesArray([0, 0, 1, 0, 0, 1]),
      }),
    ],
  });
  tiles.clippingPolygons = theirs;
  const { select, owner } = mount({ tiles: [tiles] });
  await select({ plot: { id: plot.id } });
  assert.equal(tiles.clippingPolygons, theirs);
  assert.equal(theirs.length, 2);
  await select(null);
  assert.equal(tiles.clippingPolygons, theirs);
  assert.equal(theirs.length, 1);
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
  const { viewer, win, select, owner } = mount({ time: NIGHT });
  await select({ plot: { id: plot.id } });
  assert.ok(win.__gevCityMassing.snapshot().sun.elevationDeg < 0);
  assert.equal(viewer.shadows, false);
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
  const { store, win, ds, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  store.massingControls.step(1);
  store.massingControls.step(1);
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.storeys, 8);
  assert.ok(Math.abs(s.blockTop - s.base - 25.6) < 1e-9);
  const block = ds.entities.getById('city-massing-block').polygon;
  assert.ok(Math.abs(block.extrudedHeight.getValue() - (-8.25 + 25.6)) < 1e-9);
  assert.equal(store.massing.storeys, 8);
  assert.ok(Math.abs(store.massing.heightMeters - 25.6) < 1e-9);
  assert.ok(Math.abs(store.massing.floorAreaSquareMeters - 8192) < 1e-6);
  assert.ok(Math.abs(store.massing.far - 5.12) < 1e-9);
  owner.destroy();
});

test('the block stands anew on the refined ground once the framed tiles load', async () => {
  const { viewer, win, ds, select, surface, render, owner } = mount({
    ground: -3,
  });
  // Coming in from the district view: tiles still coarse.
  viewer.scene.globe.tilesLoaded = false;
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().base, -3);
  surface.ground = -8.25;
  render();
  assert.equal(win.__gevCityMassing.snapshot().base, -3, 'still loading');
  viewer.scene.globe.tilesLoaded = true;
  render();
  const s = win.__gevCityMassing.snapshot();
  assert.equal(s.base, -8.25);
  assert.equal(s.blockBase, -8.25, 'the block entity moved');
  assert.ok(Math.abs(s.blockExtrudedHeight - (-8.25 + 19.2)) < 1e-9);
  assert.ok(s.plateBottom <= -8.75 && s.plateTop > -8.25);
  assert.ok(ds.entities.getById('city-massing-block'));
  owner.destroy();
});

test('a map switch to photoreal while the block shows cuts the new tileset', async () => {
  const { win, select, surface, render, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(win.__gevCityMassing.snapshot().cuts, 0, 'globe only');
  const photoreal = tileset();
  surface.tiles.push(photoreal);
  render();
  await Promise.resolve();
  assert.equal(win.__gevCityMassing.snapshot().cuts, 1);
  assert.equal(photoreal.clippingPolygons.length, 1);
  assert.equal(photoreal.shadows, Cesium.ShadowMode.RECEIVE_ONLY);
  owner.destroy();
  assert.equal(photoreal.clippingPolygons, undefined);
  assert.equal(photoreal.shadows, Cesium.ShadowMode.ENABLED);
});

test('the globe receives the block shadow with soft edges, and both are restored', async () => {
  const { viewer, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  assert.equal(viewer.scene.globe.shadows, Cesium.ShadowMode.RECEIVE_ONLY);
  assert.equal(viewer.scene.shadowMap.softShadows, true);
  await select(null);
  assert.equal(viewer.scene.globe.shadows, Cesium.ShadowMode.DISABLED);
  assert.equal(viewer.scene.shadowMap.softShadows, false);
  owner.destroy();
});

test('frames keep coming until the block is drawn as it now stands', async () => {
  const held = () =>
    getRenderGovernorDiagnostics().holds.includes('city-massing');
  const { store, win, select, surface, render, owner } = mount();
  surface.drawn = false;
  await select({ plot: { id: plot.id } });
  for (let i = 0; i < 5; i++) render();
  assert.equal(held(), true, 'the geometry is still building');
  assert.equal(win.__gevCityMassing.snapshot().drawn, false);
  surface.drawn = true;
  render();
  render();
  assert.equal(held(), false, 'drawn: the app renders on demand again');
  assert.equal(win.__gevCityMassing.snapshot().drawn, true);
  // The stepper rebuilds the block: held again until the new block is drawn,
  // and a stale "drawn" in the first frames after the change does not count.
  store.massingControls.step(1);
  assert.equal(win.__gevCityMassing.snapshot().drawn, false);
  render();
  assert.equal(held(), true);
  surface.drawn = false;
  render();
  render();
  render();
  assert.equal(held(), true);
  surface.drawn = true;
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
const studyIds = (ds) =>
  ds.entities.values
    .map((entity) => entity.id)
    .filter((id) => id.includes('-shadow-'))
    .sort();
// A ground point `meters` north of the plot centre.
const north = (meters) => ({
  lat: plot.center.lat + meters / 111_320,
  lon: plot.center.lon,
});

test('PROTECT SIDEWALK draws the plan, what a fit would leave and the edge; FIT TO SUN cuts 6 storeys to 3', async () => {
  const { store, win, ds, select, render, owner } = mount({
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  assert.deepEqual(studyIds(ds), [], 'off by default: nothing on the ground');
  assert.equal(store.massing.shadow.on, false);
  assert.equal(store.massing.shadow.plan, null);
  assert.equal(store.massing.shadow.winter, true);
  assert.equal(win.__gevCityMassing.snapshot().study, false);
  store.massingControls.study();
  render();
  let s = win.__gevCityMassing.snapshot();
  assert.deepEqual(studyIds(ds), [
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
  const block = ds.entities.getById('city-massing-block').polygon;
  within(block.extrudedHeight.getValue(), -8.25 + 9.6, 1e-9, 'block top');
  assert.deepEqual(studyIds(ds), [
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
  assert.deepEqual(studyIds(ds), [], 'study off: the ground is clear');
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
  const { store, win, ds, select, render, owner } = mount({ time: NIGHT });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  render();
  assert.deepEqual(studyIds(ds), []);
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
  const { store, win, ds, select, owner } = mount();
  await select({ plot: { id: plot.id } });
  let s = win.__gevCityMassing.snapshot();
  const block = ds.entities.getById('city-massing-block').polygon;
  assert.equal(s.blockMaterial, 'GevCityMassingFacade');
  // Cesium registers the material type when it first asks for it (in a
  // browser); here the image types its uniform check names stand in.
  for (const name of [
    'HTMLCanvasElement',
    'HTMLImageElement',
    'ImageBitmap',
    'OffscreenCanvas',
  ])
    globalThis[name] ??= class {};
  assert.equal(block.material.getType(), s.blockMaterial);
  assert.equal(
    Cesium.Material.fromType(s.blockMaterial).isTranslucent(),
    false,
    'the body is opaque',
  );
  assert.equal(block.outline, undefined, 'no wireframe on the block');
  assert.equal(s.facade.bands.length, 6);
  assert.equal(s.facade.bands[0].kind, 'shopfront');
  within(s.facade.heightMeters, s.blockTop - s.base, 1e-9, 'top');
  // What the shader reads is the block as it stands: storeys, storey height,
  // top and parapet, around an origin at the footprint's middle on the ground.
  let look = block.material.getValue();
  assert.deepEqual(
    [look.gevLevels.x, look.gevLevels.y, look.gevLevels.z],
    [6, 3.2, s.facade.heightMeters],
  );
  within(look.gevLevels.w, 0.576, 1e-9, 'parapet');
  const origin = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.add(
      look.gevOriginHigh,
      look.gevOriginLow,
      new Cesium.Cartesian3(),
    ),
  );
  within(origin.height, -8.25, 1e-3, 'origin on the ground');
  within(Cesium.Math.toDegrees(origin.latitude), plot.center.lat, 1e-6, 'lat');
  // Four walls of 32 m in ten bays, each facing out along its own normal.
  for (const wall of [look.gevWall0, look.gevWall1, look.gevWall2, look.gevWall3]) {
    within(Math.hypot(wall.x, wall.y), 1, 1e-9, 'unit normal');
    within(wall.z, 16, 0.01, 'wall 16 m from the middle');
    within(wall.w, 16, 0.01, 'half of 32 m');
  }
  assert.deepEqual(
    [look.gevBays.x, look.gevBays.y, look.gevBays.z, look.gevBays.w],
    [10, 10, 10, 10],
  );
  // The stepper re-dresses the standing block: no new entity, new levels.
  store.massingControls.step(-1);
  s = win.__gevCityMassing.snapshot();
  assert.equal(s.facade.bands.length, 5);
  look = block.material.getValue();
  assert.deepEqual([look.gevLevels.x, look.gevLevels.z], [5, 16]);
  assert.equal(ds.entities.getById('city-massing-block').polygon, block);
  owner.destroy();
});

test('the block casts and receives nothing; its shadow is as dark as one in the imagery while it shows', async () => {
  const { viewer, ds, select, owner } = mount();
  viewer.scene.shadowMap.darkness = 0.3;
  await select({ plot: { id: plot.id } });
  const { block, plate } = {
    block: ds.entities.getById('city-massing-block').polygon,
    plate: ds.entities.getById('city-massing-plate').polygon,
  };
  // A shadow map speckles a lit roof it falls back on: the shader shades the
  // block itself, and the paving under it takes the shadow.
  assert.equal(block.shadows.getValue(), Cesium.ShadowMode.CAST_ONLY);
  assert.equal(plate.shadows.getValue(), Cesium.ShadowMode.RECEIVE_ONLY);
  assert.equal(plate.material.type, 'GevCityMassingFacade', 'paving');
  assert.equal(viewer.scene.shadowMap.darkness, 0.4);
  owner.destroy();
  assert.equal(viewer.scene.shadowMap.darkness, 0.3, 'restored');
});

test('the study marks are thin ground lines: NOW solid, WAS dashed, no fill over the cast shadow', async () => {
  const { store, ds, select, render, owner } = mount({ time: WINTER_NOON });
  await select({ plot: { id: plot.id } });
  store.massingControls.study();
  store.massingControls.fit();
  render();
  const now = ds.entities.getById('city-massing-shadow-now');
  const was = ds.entities.getById('city-massing-shadow-was');
  assert.equal(now.polygon, undefined, 'the shadow map draws the shadow');
  for (const line of [now, was]) {
    assert.equal(line.polyline.clampToGround.getValue(), true);
    assert.ok(line.polyline.width.getValue() <= 4, 'thin');
  }
  assert.ok(now.polyline.material instanceof Cesium.ColorMaterialProperty);
  assert.ok(was.polyline.material instanceof Cesium.PolylineDashMaterialProperty);
  owner.destroy();
});

test('on 3D tiles the cut shows the inside of the mesh and the study lines run level at the block base', async () => {
  const tiles = tileset();
  tiles.backFaceCulling = true;
  const { store, win, ds, select, render, owner } = mount({
    tiles: [tiles],
    time: WINTER_NOON,
  });
  await select({ plot: { id: plot.id } });
  // The mesh is a hollow shell: sliced by the cut, its inside is drawn.
  assert.equal(tiles.backFaceCulling, false);
  store.massingControls.study();
  render();
  for (const id of ['now', 'fit', 'edge']) {
    const line = ds.entities.getById(`city-massing-shadow-${id}`).polyline;
    // A ground line would smear down every wall of the mesh it meets.
    assert.equal(line.clampToGround, undefined, `${id} is not draped`);
    for (const at of line.positions.getValue())
      within(
        Cesium.Cartographic.fromCartesian(at).height,
        -8.25 + 0.5,
        1e-3,
        `${id} runs half a metre over the base`,
      );
    assert.ok(
      line.depthFailMaterial.color.getValue().alpha < 0.5,
      `${id} is faint behind a building`,
    );
  }
  const { drawn, plan } = win.__gevCityMassing.snapshot().study;
  within(drawn.now, plan.now.reachMeters, 0.3, 'now, read off the level line');
  within(drawn.edge, 20, 0.3, 'edge');
  await select(null);
  assert.equal(tiles.backFaceCulling, true, 'restored');
  owner.destroy();
});

test('on 3D tiles a blank wall closes the cut where a neighbour stands at the plot edge, not where a tree does', async () => {
  const tiles = tileset();
  const { viewer, ds, select, owner } = mount({ tiles: [tiles] });
  const north = Math.max(...plot.corners.map(([, lat]) => lat));
  const east = Math.max(...plot.corners.map(([lon]) => lon));
  // The mesh outside the plot: a building 12 m over the ground all along the
  // north edge, one tree 9 m high beside the east edge, street elsewhere.
  viewer.scene.sampleHeight = (at) => {
    const [lon, lat] = [at.longitude, at.latitude].map(Cesium.Math.toDegrees);
    if (lat > north) return 3.75;
    if (lon > east && Math.abs(lat - plot.center.lat) < 0.00001) return 0.75;
    return -8.25;
  };
  await select({ plot: { id: plot.id } });
  const sides = ds.entities.getById('city-massing-sides').wall;
  const tops = sides.maximumHeights.getValue();
  const bottoms = sides.minimumHeights.getValue();
  assert.equal(tops.length, 41, 'a closed ring of forty 4 m steps');
  assert.ok(bottoms.every((height) => Math.abs(height - -8.15) < 1e-9));
  const high = tops.filter((height) => height === 3.75).length;
  assert.ok(high >= 9 && high <= 13, `the neighbour's wall: ${high} steps`);
  assert.ok(!tops.includes(0.75), 'a lone tree raises no wall');
  assert.equal(
    sides.shadows.getValue(),
    Cesium.ShadowMode.RECEIVE_ONLY,
    'the wall takes the shadow',
  );
  await select(null);
  assert.equal(ds.entities.getById('city-massing-sides'), undefined);
  owner.destroy();
});
