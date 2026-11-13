import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useCityPlayStore } from '../ui/stores/cityPlay.js';
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
  const surface = { ground, tiles };
  const eye = Cesium.Cartesian3.fromDegrees(-122.4103, 37.795, 600);
  const viewer = {
    shadows: false,
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
        getHeight: () => surface.ground,
      },
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
