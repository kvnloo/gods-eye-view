import assert from 'node:assert/strict';
import test from 'node:test';

import { createFireHistoryRendering } from './rendering.js';

class FakeColor {
  constructor(r = 0, g = 0, b = 0, a = 1) {
    this.red = r;
    this.green = g;
    this.blue = b;
    this.alpha = a;
  }
  static fromBytes(r, g, b, a = 255, result = new FakeColor()) {
    result.red = r / 255;
    result.green = g / 255;
    result.blue = b / 255;
    result.alpha = a / 255;
    return result;
  }
}
FakeColor.WHITE = new FakeColor(1, 1, 1, 1);

class FakePointCollection {
  constructor() {
    this.values = [];
    this.show = true;
  }
  add(options) {
    const point = { ...options };
    this.values.push(point);
    return point;
  }
  removeAll() {
    this.values.length = 0;
  }
}

const C = {
  Color: FakeColor,
  PointPrimitiveCollection: FakePointCollection,
  Cartesian3: {
    fromDegrees(lon, lat, height = 0) {
      return { lon, lat, height };
    },
  },
  BoundingSphere: {
    fromPoints(points) {
      return { points, radius: 10 };
    },
  },
};

function fixture() {
  const collections = [];
  const removed = [];
  const renders = [];
  const viewer = {
    scene: {
      primitives: {
        add(value) {
          collections.push(value);
          return value;
        },
        remove(value) {
          removed.push(value);
          return true;
        },
      },
      requestRender() {},
    },
  };
  const rendering = createFireHistoryRendering({
    viewer,
    cesium: C,
    requestRender: (reason) => renders.push(reason),
  });
  return { rendering, collections, removed, renders };
}

const EVENT = {
  id: 'camp-fire-2018',
  bbox: [-121.75, 39.65, -121.3, 39.95],
};
const records = [
  {
    index: 0,
    lon: -121.6,
    lat: 39.75,
    frp: 10,
    sensor: 'VIIRS',
    progress: 0.1,
    acqMs: 100,
  },
  {
    index: 1,
    lon: -121.5,
    lat: 39.8,
    frp: 50,
    sensor: 'MODIS',
    progress: 0.8,
    acqMs: 200,
  },
];

test('renderer owns one point collection and replaces snapshots in place', () => {
  const f = fixture();
  assert.equal(f.collections.length, 1);
  assert.equal(f.collections[0].show, false);

  f.rendering.setVisible(true);
  f.rendering.setSnapshot(records, EVENT);

  assert.equal(f.collections[0].show, true);
  assert.equal(f.collections[0].values.length, 2);
  assert.equal(f.collections[0].values[0].id, 'fire-history:camp-fire-2018:0');
  assert.equal(f.collections[0].values[1].pixelSize >= 6, true);
  assert.deepEqual(f.rendering.getDiagnostics(), {
    points: 2,
    visible: true,
    eventId: EVENT.id,
  });

  f.rendering.setSnapshot(records.slice(0, 1), EVENT);
  assert.equal(f.collections.length, 1, 'snapshot replacement creates no new collection');
  assert.equal(f.collections[0].values.length, 1);
});

test('replay hides pending detections, brightens active ones and cools older ones', () => {
  const f = fixture();
  f.rendering.setSnapshot(records, EVENT);

  f.rendering.setReplay({
    status: 'paused',
    cursorMs: 150,
  });
  assert.equal(f.collections[0].values[0].show, true);
  assert.equal(f.collections[0].values[1].show, false);

  f.rendering.setReplay({
    status: 'paused',
    cursorMs: 13 * 3_600_000 + 200,
  });
  assert.equal(f.collections[0].values[0].show, true);
  assert.ok(
    f.collections[0].values[0].color.alpha < 1,
    'old detections cool into the scar',
  );

  f.rendering.setReplay({ status: 'idle', cursorMs: 0 });
  assert.ok(f.collections[0].values.every((point) => point.show));
});

test('focus sphere derives only from the registered event bbox', () => {
  const f = fixture();
  assert.equal(f.rendering.getFocusSphere(), null);
  f.rendering.setSnapshot(records, EVENT);
  const sphere = f.rendering.getFocusSphere();
  assert.ok(sphere);
  assert.equal(sphere.points.length, 5);
  assert.equal(sphere.radius, 25_000);
});

test('clear and destroy release only owned primitives', () => {
  const f = fixture();
  f.rendering.setSnapshot(records, EVENT);
  f.rendering.clear();
  assert.equal(f.collections[0].values.length, 0);
  assert.equal(f.removed.length, 0);

  f.rendering.destroy();
  assert.deepEqual(f.removed, [f.collections[0]]);
  assert.equal(f.collections[0].values.length, 0);
});
