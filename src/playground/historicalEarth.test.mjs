import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EARLIEST_MAP_YEAR,
  HISTORICAL_PLACES,
  historicalYear,
  historicalPlaceView,
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

test('lens links evidence, changes years, and hides unsupported associations', () => {
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
    (node) => node.tag === 'button' && node.textContent === 'Visit documented site',
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
    (node) => node.tag === 'p' && node.children.some((child) => child.tag === 'a'),
  );
  assert.match(map.href, /12\/40.75\/-73.98&date=1880$/);
  assert.equal(sources.hidden, true);
  cleanup();
});
