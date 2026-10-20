import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EARLIEST_MAP_YEAR,
  HISTORICAL_PLACES,
  historicalYear,
  historicalPlaceView,
  historicalAnimationView,
  historicalPlaceAssociation,
  mountHistoricalEarthLens,
} from './historicalEarth.js';

test('historical years accept BCE and CE without inventing a year zero', () => {
  assert.equal(historicalYear('-44', 2026), -44);
  assert.equal(historicalYear(1880, 2026), 1880);
  assert.equal(historicalYear(String(EARLIEST_MAP_YEAR), 2026), -4000);
  for (const bad of [
    0,
    '-0',
    '1.5',
    '2026.0',
    'x',
    '',
    '10000',
    '-4001',
    2027,
    Infinity,
    null,
  ]) {
    assert.throws(
      () => historicalYear(bad, 2026),
      { name: /TypeError|RangeError/ },
    );
  }
});

test('map links bind date and coordinates without fake terrain', () => {
  const view = historicalPlaceView({
    lat: 38.863,
    lon: -76.9851,
    year: 1880,
    currentYear: 2026,
  });
  assert.equal(
    view.mapUrl,
    'https://www.openhistoricalmap.org/#map=12/38.863/-76.9851&date=1880',
  );
  assert.equal(view.yearLabel, '1880 CE');
  assert.equal(view.evidenceStatus, 'coverage-unverified');
  assert.match(view.renderStatus, /Modern GEV globe/);
  assert.equal(
    historicalPlaceView({
      lat: 41.5,
      lon: 12.4,
      year: -44,
      currentYear: 2026,
    }).yearLabel,
    '44 BCE',
  );
  assert.throws(
    () => historicalPlaceView({ lat: 91, lon: 2, year: 1800 }),
    TypeError,
  );
  assert.throws(
    () => historicalPlaceView({ lat: 8, lon: NaN, year: 1800 }),
    TypeError,
  );
  assert.throws(
    () => historicalPlaceView({ lat: 0, lon: 0, year: 1880, zoom: 400 }),
    RangeError,
  );
  assert.throws(
    () => historicalPlaceView({ lat: '0', lon: 0, year: 1880 }),
    TypeError,
  );
});

test('person association only applies in a documented interval', () => {
  const sample = HISTORICAL_PLACES[0];
  assert.equal(
    sample.sourceUrl,
    'https://www.nps.gov/frdo/learn/historyculture/places.htm',
  );
  const association = historicalPlaceAssociation(sample, 1880, 2026);
  assert.equal(association.status, 'documented-residence');
  assert.match(association.caveat, /not a recording/);
  assert.equal(historicalPlaceAssociation(sample, 1700, 2026), null);
  assert.equal(historicalPlaceAssociation(sample, 1896, 2026), null);
  assert.equal(historicalPlaceAssociation(null, 1880, 2026), null);
});

function fakeLensDocument() {
  const nodes = [];
  class Node {
    constructor(tag, ownerDocument) {
      this.tag = tag;
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.events = new Map();
      this.style = {};
      nodes.push(this);
    }
    append(...children) {
      this.children.push(...children);
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    removeAttribute(key) {
      delete this[key];
    }
    addEventListener(type, fn) {
      this.events.set(type, fn);
    }
    dispatch(type) {
      this.events.get(type)?.();
    }
    remove() {
      this.removed = true;
    }
  }
  const document = { createElement: (tag) => new Node(tag, document) };
  return { document, nodes, Node };
}

test('lens links evidence and hides unsupported associations', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const services = {
    viewer: { camera: { flyTo() {}, cancelFlight() {} } },
  };
  const cleanup = mountHistoricalEarthLens({ root, services });
  const year = nodes.find((node) => node.type === 'number');
  const map = nodes.find(
    (node) =>
      node.tag === 'a' && /OpenHistoricalMap/.test(node.textContent),
  );
  const sources = nodes.find(
    (node) =>
      node.tag === 'p' &&
      node.children.some((child) => child.tag === 'a'),
  );
  assert.match(map.href, /date=1880$/);
  assert.match(sources.children[0].href, /nps.gov/);
  year.value = '1700';
  year.dispatch('input');
  assert.match(map.href, /date=1700$/);
  assert.equal(sources.hidden, true);
  year.value = '0';
  year.dispatch('input');
  assert.equal(map.hidden, true);
  assert.equal(map.href, undefined);
  cleanup();
  assert.equal(root.children[0].removed, true);
});


test('documented-site navigation does not steal a running scene camera', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const cameraCalls = [];
  const services = {
    sceneDirector: { running: true },
    Cesium: {
      Cartesian3: { fromDegrees: (...args) => args },
      Math: { toRadians: (value) => value },
    },
    viewer: {
      camera: {
        flyTo: (options) => cameraCalls.push(options),
        cancelFlight: () => cameraCalls.push('cancel'),
      },
    },
  };
  const cleanup = mountHistoricalEarthLens({ root, services });
  const visit = nodes.find(
    (node) =>
      node.tag === 'button' && node.textContent === 'Visit documented site',
  );
  const status = nodes.find((node) => node.role === 'status');
  visit.dispatch('click');
  assert.equal(cameraCalls.length, 0);
  assert.match(status.textContent, /Stop the authored scene/);

  services.sceneDirector.running = false;
  visit.dispatch('click');
  assert.equal(cameraCalls.length, 1);
  assert.deepEqual(cameraCalls[0].destination, [-76.9851, 38.863, 1600]);
  cleanup();
  assert.deepEqual(cameraCalls[1], 'cancel');
});

test('globe center switches to an unsourced custom location', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const services = {
    Cesium: {
      Cartesian2: class {
        constructor(x, y) { this.x = x; this.y = y; }
      },
      Ellipsoid: { WGS84: {} },
      Cartographic: { fromCartesian: (point) => point },
      Math: { toDegrees: (value) => value },
    },
    viewer: {
      scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
      camera: { pickEllipsoid: () => ({ latitude: 40.75, longitude: -73.98 }) },
    },
  };
  const cleanup = mountHistoricalEarthLens({ root, services });
  nodes.find(
    (node) => node.tag === 'button' && node.textContent === 'Use globe center',
  ).dispatch('click');
  const map = nodes.find(
    (node) => node.tag === 'a' && /OpenHistoricalMap/.test(node.textContent),
  );
  const sources = nodes.find(
    (node) =>
      node.tag === 'p' && node.children.some((child) => child.tag === 'a'),
  );
  assert.match(map.href, /12\/40.75\/-73.98&date=1880$/);
  assert.equal(sources.hidden, true);
  cleanup();
});

test('preview requires consent and unloads on date changes', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const cleanup = mountHistoricalEarthLens({
    root,
    services: { viewer: { camera: { flyTo() {}, cancelFlight() {} } } },
  });
  const frame = nodes.find((node) => node.tag === 'iframe');
  const preview = nodes.find(
    (node) => node.tag === 'button' && node.textContent === 'Preview dated map',
  );
  const year = nodes.find((node) => node.type === 'number');
  assert.equal(frame.hidden, true);
  assert.equal(frame.src, undefined);
  assert.equal(frame.sandbox, 'allow-scripts allow-same-origin');
  preview.dispatch('click');
  assert.equal(frame.hidden, false);
  assert.equal(
    frame.src,
    'https://embed.openhistoricalmap.org/#map=12/38.863/-76.9851&date=1880&layer=O',
  );
  year.value = '1881';
  year.dispatch('input');
  assert.equal(frame.hidden, true);
  assert.equal(frame.src, undefined);
  preview.dispatch('click');
  assert.match(frame.src, /date=1881&layer=O$/);
  cleanup();
  assert.equal(frame.src, undefined);
  assert.equal(frame.hidden, true);
});

test('OHM animation uses start/end without overriding date', () => {
  const view = historicalAnimationView({
    lat: 38.863,
    lon: -76.9851,
    fromYear: 1880,
    toYear: 1920,
    currentYear: 2026,
  });
  assert.equal(view.fromLabel, '1880 CE');
  assert.equal(view.toLabel, '1920 CE');
  assert.equal(view.evidenceStatus, 'coverage-unverified');
  assert.equal(
    view.embedUrl,
    'https://embed.openhistoricalmap.org/#map=12/38.863/-76.9851' +
      '&start_date=1880&end_date=1920&interval=P1Y&framerate=2&layer=O',
  );
  assert.equal(new URL(view.embedUrl).hash.includes('&date='), false);
  const reverse = historicalAnimationView({
    lat: 40.7,
    lon: -73.9,
    fromYear: -100,
    toYear: -205,
    currentYear: 2026,
  });
  assert.equal(reverse.fromLabel, '100 BCE');
  assert.equal(reverse.toLabel, '205 BCE');
  assert.match(reverse.embedUrl, /interval=-P3Y&framerate=2&layer=O$/);
  const wide = historicalAnimationView({
    lat: 10,
    lon: 20,
    fromYear: 1700,
    toYear: 2000,
    currentYear: 2026,
  });
  assert.match(wide.embedUrl, /interval=P8Y&framerate=2&layer=O$/);
});

test('animation rejects invalid, ambiguous or excessive date spans', () => {
  const options = { lat: 0, lon: 0, currentYear: 2026 };
  for (const [fromYear, toYear] of [
    [1880, 1880],
    [1880, 2027],
    [-44, 44],
    [44, -44],
    [1800, 2200],
    [-3000, -2500],
    [0, 1880],
  ]) {
    assert.throws(
      () => historicalAnimationView({ ...options, fromYear, toYear }),
      { name: /RangeError|TypeError/ },
    );
  }
});

test('historical animation is opt-in and unloads on edits', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const cleanup = mountHistoricalEarthLens({
    root,
    services: { viewer: { camera: { flyTo() {}, cancelFlight() {} } } },
  });
  const year = nodes.find((node) => node['aria-label'] === 'Historical year');
  const compare = nodes.find(
    (node) => node['aria-label'] === 'Historical comparison year',
  );
  const frame = nodes.find((node) => node.tag === 'iframe');
  const animate = nodes.find(
    (node) => node.tag === 'button' && node.textContent === 'Animate years',
  );
  const preview = nodes.find(
    (node) => node.tag === 'button' && node.textContent === 'Preview dated map',
  );
  assert.equal(frame.src, undefined);
  assert.equal(animate.type, 'button');
  assert.equal(preview.type, 'button');
  assert.equal(animate.disabled, false);
  animate.dispatch('click');
  assert.equal(frame.hidden, false);
  assert.match(frame.src, /start_date=1880&end_date=1900&interval=P1Y/);
  preview.dispatch('click');
  assert.match(frame.src, /&date=1880&layer=O$/);
  assert.equal(animate.textContent, 'Animate years');
  compare.value = '0';
  compare.dispatch('input');
  assert.equal(animate.disabled, true);
  assert.equal(frame.src, undefined);
  assert.equal(frame.hidden, true);
  year.value = '1881';
  year.dispatch('input');
  assert.equal(animate.disabled, true);
  compare.value = '1890';
  compare.dispatch('input');
  assert.equal(animate.disabled, false);
  animate.dispatch('click');
  assert.match(frame.src, /start_date=1881&end_date=1890/);
  animate.dispatch('click');
  assert.equal(frame.src, undefined);
  assert.equal(frame.hidden, true);
  cleanup();
});

test('stale flight cancellation preserves the next flight lease', () => {
  const { document, nodes, Node } = fakeLensDocument();
  const root = new Node('root', document);
  const flights = [];
  const cancels = [];
  const cleanup = mountHistoricalEarthLens({
    root,
    services: {
      sceneDirector: { running: false },
      Cesium: {
        Cartesian3: { fromDegrees: (...args) => args },
        Math: { toRadians: (value) => value },
      },
      viewer: {
        camera: {
          flyTo: (options) => flights.push(options),
          cancelFlight: () => cancels.push('cancel'),
        },
      },
    },
  });
  const visit = nodes.find(
    (node) =>
      node.tag === 'button' && node.textContent === 'Visit documented site',
  );
  visit.dispatch('click');
  visit.dispatch('click');
  assert.equal(flights.length, 2);
  flights[0].cancel();
  cleanup();
  assert.deepEqual(cancels, ['cancel']);
});
