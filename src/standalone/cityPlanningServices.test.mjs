import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPinia } from 'pinia';
import {
  captureCityReference,
  createCityBrowserStorage,
  mountCityBuilder,
} from './cityPlanningServices.js';
import { useCommunityPlanningStore } from '../ui/stores/communityPlanning.js';
import { useSceneSharingStore } from '../ui/stores/sceneSharing.js';
import {
  createCityDocument,
  parseCityDocument,
} from '../data/cityPlanningDocument.js';
import { createPlanningConceptGenerator } from '../data/planningConceptGenerator.js';

const capturedAt = '2026-11-10T12:00:00.000Z';
const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
const radians = (value) => (value * Math.PI) / 180;

function captureFixture({
  width = 1920,
  height = 1080,
  id = 'osm',
  status = 'ready',
} = {}) {
  const viewer = {
    camera: {
      positionCartographic: {
        latitude: radians(40),
        longitude: radians(-74),
        height: 500,
      },
      heading: radians(10),
      pitch: radians(-45),
      roll: 0,
      computeViewRectangle: () => ({
        west: radians(-75),
        south: radians(39),
        east: radians(-73),
        north: radians(41),
      }),
    },
    scene: { canvas: { width, height }, globe: { ellipsoid: {} } },
  };
  const calls = [];
  const context = {
    drawImage: (...args) => calls.push(args),
    getImageData: () => ({ data: new Uint8ClampedArray([80, 120, 160, 255]) }),
  };
  const canvas = {
    getContext: () => context,
    toDataURL: (...args) => {
      calls.push(args);
      return jpeg;
    },
  };
  const descriptor = {
    id,
    label: 'Selected source',
    url: 'https://private.invalid/?token=DO-NOT-EXPORT',
  };
  const options = {
    viewer,
    mapStackController: {
      getState: () => ({
        activeId: id,
        activeStack: descriptor,
        status,
        stacks: [{ id: 'photoreal' }],
      }),
    },
    now: () => capturedAt,
    renderFrame: async (value) => {
      assert.equal(value, viewer);
      return true;
    },
    createCanvas: () => canvas,
  };
  return { viewer, canvas, context, calls, options };
}

for (const [width, height, expected] of [
  [1920, 1080, [960, 540]],
  [1080, 1920, [360, 640]],
  [400, 300, [400, 300]],
  [9000, 1, [960, 1]],
]) {
  test(`capture scales ${width}x${height} within 960x640 without upscaling`, async () => {
    const { options, canvas, calls, viewer } = captureFixture({
      width,
      height,
    });
    const reference = await captureCityReference(options);
    assert.deepEqual([canvas.width, canvas.height], expected);
    assert.deepEqual(calls, [
      [viewer.scene.canvas, 0, 0, ...expected],
      ['image/jpeg', 0.78],
    ]);
    assert.deepEqual(reference.camera, {
      lat: 40,
      lon: -74,
      alt: 500,
      heading: 10,
      pitch: -45,
      roll: 0,
    });
    reference.bounds.forEach((value, index) => {
      assert.ok(Math.abs(value - [-75, 39, -73, 41][index]) < 1e-10);
    });
    assert.equal(reference.capturedAt, capturedAt);
    assert.equal(reference.image, jpeg);
    assert.equal(
      createCityDocument({ id: 'capture', title: 'Captured view', reference })
        .reference.image,
      jpeg,
    );
  });
}

test('capture reuses the bounded fresh-frame helper on the explicit viewer only', async () => {
  const { options, viewer } = captureFixture();
  delete options.renderFrame;
  let listener;
  let removals = 0;
  let requests = 0;
  viewer.scene.postRender = {
    addEventListener(fn) {
      listener = fn;
      return () => {
        removals++;
      };
    },
  };
  viewer.scene.requestRender = () => {
    requests++;
    queueMicrotask(() => listener());
  };
  await captureCityReference(options);
  assert.equal(requests, 1);
  assert.equal(removals, 1);
});

test('fresh-frame failure and missing explicit canvas fail closed without drawing', async () => {
  for (const mutate of [
    (options) => {
      options.renderFrame = async () => false;
    },
    (options) => {
      options.viewer.scene.canvas = null;
    },
    (options) => {
      options.viewer.scene.canvas.width = 0;
    },
    (options) => {
      options.viewer.scene.canvas.height = Infinity;
    },
  ]) {
    const { options, calls } = captureFixture();
    mutate(options);
    await assert.rejects(
      captureCityReference(options),
      /^Error: City reference capture unavailable$/,
    );
    assert.deepEqual(calls, []);
  }
});

test('sky, nonfinite camera, collapsed bounds, and dateline crossing are not fabricated as a site', async () => {
  for (const mutate of [
    (viewer) => {
      viewer.camera.computeViewRectangle = () => undefined;
    },
    (viewer) => {
      viewer.camera.positionCartographic.latitude = NaN;
    },
    (viewer) => {
      viewer.camera.heading = Infinity;
    },
    (viewer) => {
      viewer.camera.computeViewRectangle = () => ({
        west: 1,
        south: 0,
        east: -1,
        north: 1,
      });
    },
    (viewer) => {
      viewer.camera.computeViewRectangle = () => ({
        west: 1,
        south: 0,
        east: 1,
        north: 1,
      });
    },
    (viewer) => {
      viewer.camera.computeViewRectangle = () => ({
        west: 0,
        south: 0,
        east: 1,
        north: Infinity,
      });
    },
  ]) {
    const { options, viewer, calls } = captureFixture();
    mutate(viewer);
    await assert.rejects(
      captureCityReference(options),
      /City reference capture unavailable/,
    );
    assert.deepEqual(calls, []);
  }
});

test('black, transparent, tainted, unreadable, and oversized pixels fail with a generic error', async () => {
  for (const mutate of [
    ({ context }) => {
      context.getImageData = () => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      });
    },
    ({ context }) => {
      context.getImageData = () => ({
        data: new Uint8ClampedArray([255, 255, 255, 0]),
      });
    },
    ({ context }) => {
      context.getImageData = () => {
        throw new Error('secret provider URL');
      };
    },
    ({ context }) => {
      context.drawImage = () => {
        throw new Error('secret provider URL');
      };
    },
    ({ canvas }) => {
      canvas.getContext = () => null;
    },
    ({ canvas }) => {
      canvas.toDataURL = () => {
        throw new Error('secret provider URL');
      };
    },
    ({ canvas }) => {
      canvas.toDataURL = () => `data:image/jpeg;base64,${'A'.repeat(600_000)}`;
    },
    ({ canvas }) => {
      canvas.toDataURL = () => 'data:,';
    },
  ]) {
    const fixture = captureFixture();
    mutate(fixture);
    await assert.rejects(
      captureCityReference(fixture.options),
      /^Error: City reference capture unavailable$/,
    );
  }
});

test('only the settled active descriptor is cited, never inactive sources or credential URLs', async () => {
  for (const id of [
    'osm',
    'esri-imagery',
    'photoreal',
    'bing-aerial',
    'bing-labels',
  ]) {
    const { options } = captureFixture({ id });
    const reference = await captureCityReference(options);
    assert.equal(reference.sources.length, 1);
    assert.equal(reference.sources[0].id, id);
    assert.equal(reference.sources[0].revision, `Captured at ${capturedAt}`);
    assert.equal(
      reference.sources[0].license,
      'Unverified; provider terms apply',
    );
    assert.match(reference.sources[0].attribution, /unverified/);
    assert.ok(reference.sources[0].url.startsWith('https://'));
    assert.doesNotMatch(
      JSON.stringify(reference),
      /DO-NOT-EXPORT|token=|private\.invalid/,
    );
    createCityDocument({ id: 'capture', title: 'Captured view', reference });
  }
});

test('unknown, switching, missing, and inconsistent source state leave citations absent', async () => {
  for (const alter of [
    (options) => {
      options.mapStackController = undefined;
    },
    (options) => {
      options.mapStackController.getState = () => ({
        activeId: 'custom',
        activeStack: { id: 'custom' },
        status: 'ready',
      });
    },
    (options) => {
      options.mapStackController.getState = () => ({
        activeId: 'osm',
        activeStack: { id: 'osm' },
        status: 'switching',
      });
    },
    (options) => {
      options.mapStackController.getState = () => ({
        activeId: 'osm',
        activeStack: { id: 'photoreal' },
        status: 'ready',
      });
    },
    (options) => {
      options.mapStackController.getState = () => ({
        activeId: 'constructor',
        activeStack: { id: 'constructor' },
        status: 'ready',
      });
    },
  ]) {
    const { options } = captureFixture();
    alter(options);
    assert.deepEqual((await captureCityReference(options)).sources, []);
  }
});

function memoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}

function fakeLocks() {
  const held = new Set();
  const requests = [];
  return {
    held,
    requests,
    request(name, options, callback) {
      assert.equal(name, 'godsEyeView.cityBuilder.v1');
      assert.deepEqual(options, { ifAvailable: true });
      const done = Promise.resolve().then(async () => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name, mode: 'exclusive' });
        } finally {
          held.delete(name);
        }
      });
      requests.push({ done });
      return done;
    },
  };
}

test('browser storage holds one exclusive writer for its lifetime and lets a second owner read only', async (t) => {
  const storage = memoryStorage();
  const locks = fakeLocks();
  const first = createCityBrowserStorage({ storage, locks });
  const second = createCityBrowserStorage({ storage, locks });
  t.after(() => {
    first.destroy();
    second.destroy();
  });
  assert.throws(
    () => first.setItem('project', 'not acquired'),
    /storage unavailable/,
  );
  await locks.requests[1].done;
  first.setItem('project', 'first writer');
  assert.equal(second.getItem('project'), 'first writer');
  assert.throws(
    () => second.setItem('project', 'overwrite'),
    /storage unavailable/,
  );
  assert.equal(locks.held.size, 1);
  first.destroy();
  first.destroy();
  await locks.requests[0].done;
  assert.equal(locks.held.size, 0);
  assert.throws(
    () => first.setItem('project', 'disposed'),
    /storage unavailable/,
  );
  assert.throws(
    () => second.setItem('project', 'no retry'),
    /storage unavailable/,
  );
  const next = createCityBrowserStorage({ storage, locks });
  t.after(() => next.destroy());
  await Promise.resolve();
  next.setItem('project', 'new lifetime');
  assert.equal(storage.getItem('project'), 'new lifetime');
  assert.equal(first.getItem('project'), 'new lifetime');
});

test('browser storage refuses writes without Web Locks or after a rejected request, but keeps reads', async () => {
  for (const locks of [
    null,
    {},
    {
      request() {
        throw new Error('lock access denied');
      },
    },
    {
      request() {
        return Promise.reject(new Error('lock access denied'));
      },
    },
  ]) {
    const storage = memoryStorage();
    storage.setItem('project', 'readable');
    const adapter = createCityBrowserStorage({ storage, locks });
    await Promise.resolve();
    assert.equal(adapter.getItem('project'), 'readable');
    assert.throws(
      () => adapter.setItem('project', 'unsafe fallback'),
      /^Error: storage unavailable$/,
    );
    assert.equal(storage.writes.length, 1);
    adapter.destroy();
  }
});

test('browser storage disposal invalidates a pending grant and immediately releases a late lease', async () => {
  const storage = memoryStorage();
  let grant;
  const adapter = createCityBrowserStorage({
    storage,
    locks: {
      request(_name, _options, callback) {
        return new Promise((resolve, reject) => {
          grant = () =>
            Promise.resolve(callback({ mode: 'exclusive' })).then(
              resolve,
              reject,
            );
        });
      },
    },
  });
  assert.throws(
    () => adapter.setItem('project', 'pending'),
    /storage unavailable/,
  );
  adapter.destroy();
  adapter.destroy();
  await grant();
  assert.throws(
    () => adapter.setItem('project', 'late grant'),
    /storage unavailable/,
  );
  assert.equal(storage.writes.length, 0);
});

test('browser storage disposal before a scheduled grant cannot retain the lock', async () => {
  const storage = memoryStorage();
  const locks = fakeLocks();
  const adapter = createCityBrowserStorage({ storage, locks });
  adapter.destroy();
  await locks.requests[0].done;
  assert.equal(locks.held.size, 0);
  assert.throws(
    () => adapter.setItem('project', 'disposed'),
    /storage unavailable/,
  );
  assert.equal(storage.writes.length, 0);
});

async function mountFixture(t, overrides = {}) {
  const pinia = overrides.pinia ?? createPinia();
  const store = useCommunityPlanningStore(pinia);
  const sharing = useSceneSharingStore(pinia);
  const reference = await captureCityReference(captureFixture().options);
  const storage = overrides.storage ?? memoryStorage();
  const downloads = [];
  let captures = 0;
  let nextId = 0;
  const dispose = mountCityBuilder({
    pinia,
    storage,
    captureReference: async () => {
      captures++;
      return reference;
    },
    download: (...args) => downloads.push(args),
    uid: () => `test-${++nextId}`,
    ...overrides,
  });
  t.after(dispose);
  return {
    pinia,
    store,
    sharing,
    storage,
    downloads,
    reference,
    dispose,
    captures: () => captures,
    controls: store.controls,
  };
}

function saveAlternative(controls, title = 'More shade') {
  controls.editField('title', title);
  controls.editField(
    'description',
    'Add trees and seating without claiming approval.',
  );
  controls.editField('kind', 'park');
  controls.editField('trees', '12');
  controls.editField('widthMeters', '3');
  controls.editField('shadePercent', '40');
  controls.saveAlternative();
}

test('mount owns the default browser storage lease and releases it on cleanup', async (t) => {
  const storage = memoryStorage();
  const locks = fakeLocks();
  for (const [key, value] of [
    ['localStorage', storage],
    ['navigator', { locks }],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  const pinia = createPinia();
  const reference = await captureCityReference(captureFixture().options);
  const dispose = mountCityBuilder({
    pinia,
    captureReference: async () => reference,
    uid: () => 'locked-project',
  });
  t.after(dispose);
  const store = useCommunityPlanningStore(pinia);
  await Promise.resolve();
  assert.equal(locks.held.size, 1);
  store.controls.open();
  await store.controls.start({ title: 'Exclusive project' });
  assert.equal(store.preview.city.persisted, true);
  assert.equal(storage.writes.length, 1);
  dispose();
  dispose();
  await locks.requests[0].done;
  assert.equal(locks.held.size, 0);
  assert.equal(store.controls, null);
});

test('mount leaves injected storage lifetime with its caller', async (t) => {
  let destroys = 0;
  const storage = {
    ...memoryStorage(),
    destroy() {
      destroys++;
    },
  };
  const { dispose } = await mountFixture(t, { storage });
  dispose();
  dispose();
  assert.equal(destroys, 0);
});

test('mount offers a launcher without capture or network and respects the sharing dialog', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('No network on mount');
  });
  const fixture = await mountFixture(t);
  const { store, sharing, controls, captures } = fixture;
  assert.ok(store.launcher?.label);
  assert.equal(store.preview, null);
  assert.equal(captures(), 0);
  sharing.publishDialog({ title: 'Scene sharing' });
  controls.open();
  assert.equal(store.preview, null);
  sharing.publishDialog(null);
  controls.open();
  assert.ok(store.preview.city);
  assert.equal(store.preview.city.canLocal, false);
  assert.equal(captures(), 0);
  assert.equal(fetch.mock.callCount(), 0);
  controls.close();
  assert.equal(store.preview, null);
});

test('start captures once, edits and fixture concepts keep the original reference, export/import round trips', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Fixture concepts are offline');
  });
  const fixture = await mountFixture(t);
  const { controls, store, reference, storage, downloads } = fixture;
  controls.open();
  await controls.start({ title: 'Our neighborhood' });
  assert.deepEqual(store.preview.city.reference, reference);
  saveAlternative(controls);
  const id = store.preview.city.alternatives[0].id;
  controls.editAlternative(id);
  controls.editField('trees', '24');
  controls.saveAlternative();
  assert.equal(store.preview.city.alternatives[0].revision, 2);
  await controls.imagine(id);
  assert.equal(store.preview.city.alternatives[0].concept.provider, 'fixture');
  assert.deepEqual(store.preview.city.reference, reference);
  assert.equal(fixture.captures(), 1);
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(storage.writes.length > 0);
  controls.exportFile();
  assert.equal(downloads.length, 1);
  const exported = downloads[0].find(
    (value) => typeof value === 'string' && value.startsWith('{'),
  );
  const document = parseCityDocument(exported);
  assert.deepEqual(document.reference, reference);
  assert.equal(document.alternatives[0].versions.length, 2);
  await controls.importFile({
    size: exported.length,
    text: async () => exported,
  });
  assert.equal(store.preview.city.projectTitle, 'Our neighborhood');
  assert.deepEqual(store.preview.city.reference, reference);
  assert.equal(fixture.captures(), 1);
});

test('generation uses the selected service only after Imagine and passes captured provenance', async (t) => {
  const calls = [];
  const generator = (options) => {
    const real = createPlanningConceptGenerator({
      ...options,
      now: () => capturedAt,
    });
    return {
      generate(input, request) {
        calls.push({ options, input, request });
        return real.generate(input, request);
      },
    };
  };
  const { store, controls, reference } = await mountFixture(t, {
    generator,
    canLocal: true,
  });
  assert.deepEqual(calls, []);
  controls.open();
  await controls.start({ title: 'Our neighborhood' });
  saveAlternative(controls);
  assert.deepEqual(calls, []);
  await controls.imagine(store.preview.city.alternatives[0].id);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.sourceView, reference);
  assert.equal(calls[0].options.provider, 'fixture');
  assert.ok(calls[0].request.signal instanceof AbortSignal);
});

test('a late capture cannot publish or persist after cleanup or over a replacement owner', async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const first = await mountFixture(t, { captureReference: () => pending });
  first.controls.open();
  const start = first.controls.start({ title: 'Old owner' });
  const second = await mountFixture(t, { pinia: first.pinia });
  second.controls.open();
  const before = second.store.preview;
  first.dispose();
  first.dispose();
  release(first.reference);
  await start;
  assert.equal(second.store.controls, second.controls);
  assert.equal(second.store.preview, before);
  assert.equal(first.storage.writes.length, 0);
  second.dispose();
  assert.equal(second.store.controls, null);
  assert.equal(second.store.preview, null);
  assert.equal(second.store.launcher, null);
});

test('cleanup aborts concept work and a late result cannot overwrite the next owner', async (t) => {
  let resolve;
  let signal;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const first = await mountFixture(t, {
    generator: () => ({
      generate(_input, options) {
        signal = options.signal;
        return pending;
      },
    }),
  });
  first.controls.open();
  await first.controls.start({ title: 'First project' });
  saveAlternative(first.controls);
  const alternative = first.store.preview.city.alternatives[0];
  const generated = first.controls.imagine(alternative.id);
  const writes = first.storage.writes.length;
  const second = await mountFixture(t, { pinia: first.pinia });
  second.controls.open();
  const before = second.store.preview;
  first.dispose();
  assert.equal(signal.aborted, true);
  resolve(
    await createPlanningConceptGenerator().generate({
      description: alternative.description,
      parameters: alternative.parameters,
      sourceView: first.reference,
    }),
  );
  await generated;
  assert.equal(first.storage.writes.length, writes);
  assert.equal(second.store.preview, before);
});

test('normal tools mount synchronously after application tools and preserve the exact fixture path', async () => {
  const source = await readFile(new URL('./tools.js', import.meta.url), 'utf8');
  assert.match(source, /return search === '\?planningPreview=fixture'/);
  const create = source.indexOf('const tools = createApplicationTools(');
  const mount = source.indexOf('options.defer(mountCityBuilder(options))');
  assert.ok(create >= 0 && mount > create);
  assert.match(
    source,
    /if \(!isPlanningFixturePreviewRequested\(globalThis.location\?\.search\)\)/,
  );
  assert.match(source, /import\('\.\/communityPlanningFixture\.js'\)/);
});

test('standalone middleware mounts the city concept endpoint before the API fallback', async () => {
  const source = await readFile(
    new URL('../../server/standalone/vite.config.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /import \{ cityConceptPlugin \} from '\.\/city-concept\.js'/,
  );
  assert.ok(
    source.indexOf('cityConceptPlugin(),') <
      source.indexOf('apiNotFoundPlugin(),'),
  );
});

test('a detailed view that encodes over the limit steps down JPEG quality and size before failing', async () => {
  const fixture = captureFixture();
  const qualities = [];
  const sizes = [];
  const small = fixture.options.createCanvas;
  fixture.options.createCanvas = () => {
    const canvas = small();
    const encode = canvas.toDataURL;
    canvas.toDataURL = (type, quality) => {
      qualities.push(quality);
      sizes.push([canvas.width, canvas.height]);
      // Photoreal 3D tiles at the first two settings exceed the 600k data-URL limit.
      return qualities.length < 3
        ? `data:image/jpeg;base64,${'A'.repeat(600_004)}`
        : encode(type, quality);
    };
    return canvas;
  };
  const reference = await captureCityReference(fixture.options);
  assert.ok(reference.image.startsWith('data:image/jpeg;base64,'));
  assert.equal(qualities.length, 3);
  assert.ok(qualities[1] < qualities[0], 'second attempt lowers quality');
  assert.ok(sizes[2][0] < sizes[0][0], 'third attempt also shrinks the frame');
});
