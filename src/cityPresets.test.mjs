// CITY PRESETS — the destination table, checked as data.
//
// CITY_POIS is written by hand and read directly by the camera, so a malformed
// row is not a crash: the pill lights up, the camera flies, and it frames the
// wrong thing. These checks are structural. They say a row is well formed —
// present keys, finite numbers, coordinates on Earth, a camera angle a camera
// can hold, a landmark inside the rectangle its own destination opens on — and
// say nothing about whether a destination is framed well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_POIS, LOCATIONS } from './locations.js';

const DESTINATIONS = Object.entries(CITY_POIS);
const REQUIRED_POI_KEYS = ['name', 'lat', 'lon', 'alt', 'pitch', 'heading'];

/** `id · POI name`, so a failure names the row instead of an index. */
const where = (id, poi) => `${id} · ${poi.name}`;

/** Longitude folded into [-180, 180]. */
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Whether a longitude lies in the west→east span, the way navigation reads it.
 *
 * A span that crosses the antimeridian has a west greater than its east
 * (179 → -179), and everything outside that pair is what falls between them.
 */
export function lonWithin(lon, west, east) {
  const value = wrapLon(lon);
  const from = wrapLon(west);
  const to = wrapLon(east);
  return from <= to
    ? value >= from && value <= to
    : value >= from || value <= to;
}

test('the table is not empty, and every destination offers at least one place', () => {
  assert.ok(DESTINATIONS.length > 0);
  for (const [id, city] of DESTINATIONS) {
    assert.ok(
      typeof city.name === 'string' && city.name.trim().length > 0,
      `${id} has no name`,
    );
    assert.ok(
      Array.isArray(city.pois) && city.pois.length > 0,
      `${id} has no POIs`,
    );
  }
});

test('every POI carries the keys the camera reads', () => {
  for (const [id, city] of DESTINATIONS) {
    for (const poi of city.pois) {
      for (const key of REQUIRED_POI_KEYS) {
        assert.notEqual(
          poi[key],
          undefined,
          `${where(id, poi)} is missing ${key}`,
        );
      }
      // A blank name reaches the pill as an unlabelled button.
      assert.ok(
        typeof poi.name === 'string' && poi.name.trim().length > 0,
        `${id} has a place with no name`,
      );
    }
  }
});

test('every coordinate is a finite point on Earth', () => {
  for (const [id, city] of DESTINATIONS) {
    for (const poi of city.pois) {
      assert.ok(
        Number.isFinite(poi.lat) && Math.abs(poi.lat) <= 90,
        `${where(id, poi)} lat ${poi.lat}`,
      );
      assert.ok(
        Number.isFinite(poi.lon) && Math.abs(poi.lon) <= 180,
        `${where(id, poi)} lon ${poi.lon}`,
      );
    }
  }
});

test('every camera angle is one a camera can hold', () => {
  for (const [id, city] of DESTINATIONS) {
    for (const poi of city.pois) {
      // Looking down, not up and not along the horizon: these are aerial frames.
      assert.ok(
        Number.isFinite(poi.pitch) && poi.pitch < 0 && poi.pitch >= -90,
        `${where(id, poi)} pitch ${poi.pitch}`,
      );
      assert.ok(
        Number.isFinite(poi.heading) && poi.heading >= 0 && poi.heading < 360,
        `${where(id, poi)} heading ${poi.heading}`,
      );
      // A non-finite altitude is a camera at no distance at all.
      assert.ok(
        Number.isFinite(poi.alt) && poi.alt > 0,
        `${where(id, poi)} alt ${poi.alt}`,
      );
    }
  }
});

test('every viewBounds is a finite rectangle on Earth', () => {
  for (const [id, city] of DESTINATIONS) {
    assert.ok(city.viewBounds, `${id} has no viewBounds`);
    const { southwest: sw, northeast: ne } = city.viewBounds;
    for (const [corner, point] of [
      ['southwest', sw],
      ['northeast', ne],
    ]) {
      assert.ok(
        Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90,
        `${id} ${corner} lat ${point?.lat}`,
      );
      assert.ok(
        Number.isFinite(point?.lng) && Math.abs(point.lng) <= 180,
        `${id} ${corner} lng ${point?.lng}`,
      );
    }
    // Swapped latitudes produce an inverted-but-plausible box: the framing code
    // still runs, and the camera frames nothing. Longitudes are not ordered,
    // because a span that crosses the antimeridian runs west > east.
    assert.ok(sw.lat < ne.lat, `${id} viewBounds latitudes are inverted`);
    assert.notEqual(
      wrapLon(sw.lng),
      wrapLon(ne.lng),
      `${id} viewBounds has no width`,
    );
  }
});

test('every POI lies inside the frame its own destination opens on', () => {
  // The failure this exists for: a landmark the destination lists but its
  // overview never shows.
  for (const [id, city] of DESTINATIONS) {
    const { southwest: sw, northeast: ne } = city.viewBounds;
    for (const poi of city.pois) {
      assert.ok(
        poi.lat >= sw.lat &&
          poi.lat <= ne.lat &&
          lonWithin(poi.lon, sw.lng, ne.lng),
        `${where(id, poi)} at ${poi.lat}, ${poi.lon} is outside ${id}'s viewBounds`,
      );
    }
  }
});

test('every LOCATIONS row matches the destination it names', () => {
  assert.equal(LOCATIONS.length, DESTINATIONS.length);
  for (const [index, [id, city]] of DESTINATIONS.entries()) {
    assert.deepEqual(LOCATIONS[index], {
      id,
      name: city.name,
      lat: city.pois[0].lat,
      lon: city.pois[0].lon,
    });
  }
});

test('containment follows a span across the antimeridian', () => {
  // No current destination crosses 180°, so the wrapped case is exercised here
  // rather than left to whoever adds the first one. southwest (-1, 179) to
  // northeast (1, -179) is a real 2° box straddling the line.
  const west = 179;
  const east = -179;
  assert.equal(lonWithin(179.5, west, east), true);
  assert.equal(lonWithin(-179.5, west, east), true);
  assert.equal(lonWithin(180, west, east), true);
  assert.equal(lonWithin(0, west, east), false);
  assert.equal(lonWithin(178.9, west, east), false);
  assert.equal(lonWithin(-178.9, west, east), false);
  // An ordinary span is unaffected by the wrapping.
  assert.equal(lonWithin(-97.7, -97.95, -97.55), true);
  assert.equal(lonWithin(-98.4, -97.95, -97.55), false);
  // A whole POI checked against a synthetic destination, the way the table
  // check reads it.
  const destination = {
    viewBounds: {
      southwest: { lat: -1, lng: west },
      northeast: { lat: 1, lng: east },
    },
    pois: [{ name: 'Dateline overlook', lat: 0, lon: 179.5 }],
  };
  const { southwest: sw, northeast: ne } = destination.viewBounds;
  for (const poi of destination.pois) {
    assert.ok(
      poi.lat >= sw.lat &&
        poi.lat <= ne.lat &&
        lonWithin(poi.lon, sw.lng, ne.lng),
      'a landmark inside a wrapped view must read as inside',
    );
  }
});

const PORTUGAL_LANDMARK_ANCHORS = [
  ['cascais', 'Santa Marta Lighthouse', 38.6904, -9.421],
  ['cascais', 'Cascais Citadel', 38.6937, -9.4191],
  ['cascais', 'Boca do Inferno', 38.6911, -9.4308],
  ['faro', 'Faro Marina', 37.0151, -7.9363],
  ['faro', 'Sé de Faro', 37.0133, -7.9347],
  ['faro', 'Praia de Faro', 37.0031, -7.986],
  ['faro', 'Ilha Deserta', 36.972, -7.929],
];

test('Portuguese landmark pins match geographic anchors inside their city view', () => {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  for (const [id, name, latitude, longitude] of PORTUGAL_LANDMARK_ANCHORS) {
    const city = CITY_POIS[id];
    assert.ok(city, 'missing ' + id + ' city preset');
    const poi = city.pois.find((entry) => entry.name === name);
    assert.ok(poi, 'missing ' + id + ' · ' + name);

    const dLat = radians(poi.lat - latitude);
    const dLon = radians(poi.lon - longitude);
    const arc =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(latitude)) *
        Math.cos(radians(poi.lat)) *
        Math.sin(dLon / 2) ** 2;
    const distanceM = 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(arc)));
    assert.ok(
      distanceM <= 250,
      id + ' · ' + name + ' is ' + Math.round(distanceM) + ' m from its reference site',
    );

    const { southwest: sw, northeast: ne } = city.viewBounds;
    assert.ok(
      latitude >= sw.lat &&
        latitude <= ne.lat &&
        lonWithin(longitude, sw.lng, ne.lng),
      id + ' · ' + name + ' reference site is outside the city viewBounds',
    );
  }
});
