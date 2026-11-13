import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { METERS_PER_DEGREE, snapPlot } from './cityPlot.js';
import { resolveClickedPlot } from './cityPlotPick.js';

// The plot a City builder click resolves, on a fake scene and camera whose
// geometry is real: one pixel ray from the app's plot framing (34° down, 290 m
// out, looking north) to a street point in San Francisco. The globe there sits
// below the ellipsoid, as the keyless terrain reports it.
const GROUND = -8;
const PITCH = Cesium.Math.toRadians(34);
const RANGE = 290;

const A = snapPlot({ lat: 37.8007, lon: -122.4103 });
const SOUTH_EDGE = A.corners[0][1];
// B is the neighbour between the camera and A.
const B = snapPlot({
  lat: SOUTH_EDGE - 20 / METERS_PER_DEGREE,
  lon: A.center.lon,
});

function where(cartesian) {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(c.latitude),
    lon: Cesium.Math.toDegrees(c.longitude),
    height: c.height,
  };
}

/** The pixel ray whose ground point is `target`. */
function clickAt(target) {
  const ground = Cesium.Cartesian3.fromDegrees(target.lon, target.lat, GROUND);
  const eye = Cesium.Cartesian3.fromDegrees(
    target.lon,
    target.lat - (RANGE * Math.cos(PITCH)) / METERS_PER_DEGREE,
    GROUND + RANGE * Math.sin(PITCH),
  );
  const direction = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(ground, eye, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  return {
    ray: new Cesium.Ray(eye, direction),
    ground,
    reach: Cesium.Cartesian3.distance(eye, ground),
  };
}

/** A point on the same pixel ray, `lift` metres above its ground point. */
function above(click, lift) {
  return Cesium.Ray.getPoint(click.ray, click.reach - lift / Math.sin(PITCH));
}

function onEllipsoid(ray) {
  const hit = Cesium.IntersectionTests.rayEllipsoid(
    ray,
    Cesium.Ellipsoid.WGS84,
  );
  return Cesium.Ray.getPoint(ray, hit.start);
}

// The click of #319: 8 m inside A's near edge.
const NEAR = clickAt({
  lat: SOUTH_EDGE + 8 / METERS_PER_DEGREE,
  lon: A.center.lon,
});
// 20 m up the same pixel ray: about 30 m nearer the camera.
const WRONG_DEPTH = above(NEAR, 20);
// A click on A's concept card: the ground behind it is still A.
const CARD = clickAt({
  lat: A.center.lat + 10 / METERS_PER_DEGREE,
  lon: A.center.lon,
});

// The play mode's own entities. Only a standing concept names its plot.
const concept = { _cityPlot: A };
const selectedPrism = {};
const OWN = new Set([concept, selectedPrism]);

function fake({ click, depth, ground = click.ground, top, ellipsoid = true }) {
  return {
    position: new Cesium.Cartesian2(720, 480),
    scene: {
      pickPositionSupported: true,
      pickPosition: () => depth && Cesium.Cartesian3.clone(depth),
      pick: () => (top ? { id: top } : undefined),
      globe: {
        show: true,
        // Only the click's own pick ray meets the ground.
        pick: (ray) =>
          ray === click.ray && ground
            ? Cesium.Cartesian3.clone(ground)
            : undefined,
      },
    },
    camera: {
      getPickRay: () => click.ray,
      pickEllipsoid: () => (ellipsoid ? onEllipsoid(click.ray) : undefined),
    },
    owns: (entity) => OWN.has(entity),
  };
}

/** What the click handler does with the resolver's answer. */
function click(input, state) {
  const hit = resolveClickedPlot(input);
  if (!hit) return hit;
  state.selected = hit.plot.id;
  // The first picked height fixes a plot's ground (cityPlay's baseHeight).
  if (Number.isFinite(hit.height) && !state.heights.has(hit.plot.id))
    state.heights.set(hit.plot.id, hit.height);
  return hit;
}

const fresh = (selected = null) => ({ selected, heights: new Map() });

// Fixture check, not a case: the wrong-depth and ellipsoid points really lie in
// the neighbour, and both card points in A.
assert.notEqual(A.id, B.id);
assert.equal(snapPlot(where(NEAR.ground)).id, A.id);
assert.equal(snapPlot(where(WRONG_DEPTH)).id, B.id);
assert.ok(Math.abs(where(WRONG_DEPTH).height - (GROUND + 20)) < 0.1);
assert.equal(snapPlot(where(onEllipsoid(NEAR.ray))).id, B.id);
assert.equal(snapPlot(where(CARD.ground)).id, A.id);
assert.equal(snapPlot(where(above(CARD, 6.7))).id, A.id);

const CASES = [
  [
    '1 a depth pick on the true ground inside plot A selects A',
    () => {
      const state = fresh();
      click(fake({ click: NEAR, depth: NEAR.ground }), state);
      assert.equal(state.selected, A.id);
    },
  ],
  [
    '2 a wrong-depth pick on the same pixel ray, inside neighbour B, still selects A',
    () => {
      const state = fresh();
      click(fake({ click: NEAR, depth: WRONG_DEPTH }), state);
      assert.equal(state.selected, A.id);
    },
  ],
  [
    '3 with no depth (sky) the globe-ray intersection is used: plot A',
    () => {
      const state = fresh();
      const hit = click(fake({ click: NEAR, depth: undefined }), state);
      assert.equal(state.selected, A.id);
      assert.ok(Math.abs(hit.height - GROUND) < 0.01, `height ${hit.height}`);
    },
  ],
  [
    '4 a plot with a standing concept and a tint, clicked while another plot is selected, is selected',
    () => {
      // On the concept card.
      const onCard = fresh(B.id);
      click(
        fake({ click: CARD, depth: above(CARD, 6.7), top: concept }),
        onCard,
      );
      assert.equal(onCard.selected, A.id);
      // On its tinted ground, through the selected plot's prism.
      const onGround = fresh(B.id);
      click(
        fake({ click: NEAR, depth: NEAR.ground, top: selectedPrism }),
        onGround,
      );
      assert.equal(onGround.selected, A.id);
    },
  ],
  [
    '5 a click that misses every plot changes no selection and writes no height',
    () => {
      const state = fresh(B.id);
      const hit = click(
        fake({ click: NEAR, depth: undefined, ground: null, ellipsoid: false }),
        state,
      );
      assert.equal(hit, null);
      assert.equal(state.selected, B.id);
      assert.equal(state.heights.size, 0);
    },
  ],
  [
    "6 a wrong-depth pick never writes a neighbour's base height",
    () => {
      const state = fresh();
      click(fake({ click: NEAR, depth: WRONG_DEPTH }), state);
      assert.equal(state.heights.has(B.id), false);
      assert.ok(
        Math.abs(state.heights.get(A.id) - GROUND) < 0.01,
        `A stands at ${state.heights.get(A.id)}`,
      );
    },
  ],
];

for (const [name, run] of CASES) test(`M1-${name}`, run);

// Not part of the table: the surfaces the globe ray does not cover.
test('photoreal tiles (globe hidden) keep the depth pick', () => {
  const input = fake({ click: NEAR, depth: NEAR.ground });
  input.scene.globe.show = false;
  const hit = resolveClickedPlot(input);
  assert.equal(hit.plot.id, A.id);
  assert.ok(Math.abs(hit.height - GROUND) < 0.01, `height ${hit.height}`);
});

test('a globe ray that meets no terrain falls back to the depth pick', () => {
  const hit = resolveClickedPlot(
    fake({ click: NEAR, depth: NEAR.ground, ground: null }),
  );
  assert.equal(hit.plot.id, A.id);
});
