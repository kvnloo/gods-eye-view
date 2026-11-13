import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { nextTick, reactive } from 'vue';
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
    isDestroyed: () => false,
  });
}

function mount({ tiles = [], time = MORNING, ground = -8.25 } = {}) {
  const sources = [];
  const viewer = {
    shadows: false,
    clock: { currentTime: Cesium.JulianDate.fromIso8601(time) },
    dataSources: {
      add: (ds) => (sources.push(ds), Promise.resolve(ds)),
      remove: (ds) => sources.splice(sources.indexOf(ds), 1).length > 0,
      getByName: (name) => sources.filter((ds) => ds.name === name),
    },
    scene: {
      context: { webgl2: true },
      sampleHeightSupported: true,
      sampleHeight: () => ground,
      globe: { show: tiles.length === 0, getHeight: () => ground },
      primitives: { length: tiles.length, get: (i) => tiles[i] },
      requestRender() {},
    },
  };
  const store = reactive({ view: null });
  const win = {};
  const owner = mountCityMassing({ viewer, store, win });
  const ds = sources[0];
  const select = async (view) => {
    store.view = view && {
      active: true,
      tier: 'plot',
      pending: false,
      ...view,
    };
    await nextTick();
  };
  return { viewer, store, win, owner, ds, select };
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
