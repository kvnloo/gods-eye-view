import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftCard,
  briefCard,
  cameraCard,
  distanceCard,
  firesCard,
  neededKey,
  parseMarkdownLite,
  quakesCard,
  receiptOf,
  satelliteCard,
  unavailableCard,
  vesselsCard,
} from './cardModels.js';
import { freshness, compactAge, utcClock } from './freshness.js';

const calledAt = Date.parse('2026-11-24T04:00:00Z');

// Shapes as the tools return them (src/tools/queries); values are made up
// for the test, not shown anywhere.
const aircraftResult = {
  summary: '2 aircraft in 120 km around 26.449, 56.203.',
  data: {
    view: { camera: { lat: 26.45, lon: 56.2, altitude_m: 218_000 }, layers: ['flights'] },
    total: 2,
    returned: 2,
    truncated: false,
    rows: [
      { id: 'a1', callsign: 'TST1', lat: 26.5, lon: 56.1, altitude_m: 9800, on_ground: false, speed_mps: 25, course_deg: 90, type_code: null, distance_km: 10 },
      { id: 'a2', callsign: null, lat: 26.6, lon: 56.3, altitude_m: 1200, on_ground: false, speed_mps: 70, course_deg: 180, type_code: 'B738', distance_km: 20.5 },
    ],
    source: 'adsb.lol',
    coverage: '250nm regional fallback',
    observed_at: '2026-11-24T03:59:50.000Z',
    freshness: 'current',
  },
};

test('an aircraft card carries the answer, source, observed time, coverage and unknowns', () => {
  const card = aircraftCard({ result: aircraftResult, request: { label: 'Strait of Hormuz' }, args: { area: {} }, calledAt, origin: 'agent' });
  assert.equal(card.kind, 'aircraft');
  assert.equal(card.status, 'ok');
  assert.equal(card.title, 'Strait of Hormuz');
  assert.equal(card.answer.value, 2);
  assert.equal(card.source, 'adsb.lol');
  assert.equal(card.observedAt, '2026-11-24T03:59:50.000Z');
  assert.equal(card.observedKind, 'observed');
  assert.equal(card.band, 'live');
  assert.equal(card.coverage, '250nm regional fallback');
  assert.equal(card.rows.length, 2);
  assert.equal(card.rows[1].cells[0], 'a2', 'a row without a callsign shows its id');
  assert.equal(card.pins.length, 2);
  assert.deepEqual(card.focus, { lat: 26.45, lon: 56.2, altitude_m: 218_000 });
  const unknowns = card.unknowns.map((u) => u.text);
  assert.ok(unknowns.some((text) => /report no aircraft type/.test(text)));
  assert.ok(unknowns.some((text) => /Regional feed/.test(text)));
  assert.ok(unknowns.some((text) => /implausible for their altitude/.test(text)), 'a jet at 9.8 km doing 49 kt is doubted, not hidden');
  assert.equal(card.trail[0].value, 'aircraft_in_area');
});

test('a vessel card narrows to a destination and says how many matched', () => {
  const result = {
    data: {
      total: 3,
      rows: [
        { id: 'v1', name: 'ALPHA', type: 'Cargo', destination: 'OAKLAND', lat: 37.8, lon: -122.3, speed_mps: 5 },
        { id: 'v2', name: 'BETA', type: 'Tanker', destination: 'LONG BEACH', lat: 37.7, lon: -122.4, speed_mps: 0 },
        { id: 'v3', name: 'GAMMA', type: 'Cargo', destination: null, lat: 37.6, lon: -122.5, speed_mps: 3 },
      ],
      source: 'AISStream',
      observed_at: '2026-11-24T03:58:00.000Z',
      freshness: 'current',
    },
  };
  const card = vesselsCard({ result, request: { label: 'Oakland', filter: 'Oakland' }, calledAt });
  assert.equal(card.answer.value, 1);
  assert.equal(card.rows.length, 1);
  assert.equal(card.rows[0].cells[0], 'ALPHA');
  assert.equal(card.line.values.total, 3);
  assert.ok(card.unknowns.some((u) => /broadcast no destination/.test(u.text)));
});

test('a quake card says it was retrieved now and names the feed limits', () => {
  const result = {
    data: {
      total: 1,
      rows: [{ id: 'q1', magnitude: 5.5, place: 'off the coast', time: '2026-11-24T01:00:00.000Z', lat: 35, lon: 141, depth_km: 10 }],
    },
  };
  const card = quakesCard({ result, request: { label: 'Japan' }, calledAt });
  assert.equal(card.source, 'USGS');
  assert.equal(card.observedKind, 'retrieved');
  assert.equal(card.observedAt, new Date(calledAt).toISOString());
  assert.equal(card.rows[0].cells[0], 'M5.5');
  assert.ok(card.trail.some((row) => row.value === '2026-11-24T01:00:00.000Z'));
});

test('fires without a FIRMS key answer from mapped perimeters and name the missing source', () => {
  const error = Object.assign(new Error('Fire detections need a NASA FIRMS key configured for this server'), { code: 'unavailable' });
  const perimeters = {
    args: { area: {} },
    result: {
      data: {
        retrieved_at: '2026-11-24T03:50:00.000Z',
        stale: false,
        rows: [
          { id: 'f1', name: 'Timber', acres: 25350, contained_pct: 100, last_growth: '2026-09-16T00:20:00.000Z', lat: 36.2, lon: -121.7 },
          { id: 'f2', name: 'Ridge', acres: 900, contained_pct: 40, last_growth: '2026-11-23T20:00:00.000Z', lat: 38, lon: -122 },
        ],
      },
    },
  };
  const card = firesCard({ error, perimeters, request: { label: 'California' }, calledAt, args: {} });
  assert.equal(card.status, 'ok');
  assert.equal(card.answer.value, 1, 'one fire is not yet contained');
  assert.equal(card.source, 'NIFC WFIGS');
  assert.deepEqual(card.missing, ['NASA FIRMS']);
  assert.equal(card.rows[0].cells[0], 'Ridge', 'uncontained fires come first');
  assert.equal(card.rows[1].cells[3], '16 SEP');
  assert.ok(card.unknowns.some((u) => /FIRMS key/.test(u.text)));
});

test('fires with neither source are an honest unavailable card', () => {
  const error = new Error('Fire detections need a NASA FIRMS key configured for this server');
  const card = firesCard({ error, perimeters: { error: new Error('down') }, request: { label: 'X' }, calledAt });
  assert.equal(card.status, 'needs-key');
  assert.equal(card.answer.value, '—');
  assert.equal(card.rows.length, 0);
});

test('a missing key is named and nothing is invented', () => {
  const error = Object.assign(new Error('AISSTREAM_API_KEY not set'), { code: 'key-required' });
  assert.equal(neededKey(error), 'AISSTREAM_API_KEY');
  assert.equal(neededKey(new Error('Fire detections need a NASA FIRMS key configured')), 'FIRMS_MAP_KEY');
  assert.equal(neededKey(new Error('HTTP 500')), null);
  const card = unavailableCard({ kind: 'vessels', error, request: { label: 'Oakland' }, calledAt });
  assert.equal(card.status, 'needs-key');
  assert.equal(card.needsKey, 'AISSTREAM_API_KEY');
  assert.equal(card.rows.length, 0);
  assert.equal(card.pins.length, 0);
  assert.equal(card.source, 'AISStream');
  assert.ok(card.observedAt);
  const down = unavailableCard({ kind: 'quakes', error: new Error('HTTP 502'), calledAt });
  assert.equal(down.status, 'unavailable');
});

test('a satellite pass card counts minutes to rise from the call time', () => {
  const result = {
    data: {
      stale: false,
      location: { label: '37.7700, -122.4200', lat: 37.77, lon: -122.42 },
      satellite: 'ISS (ZARYA)',
      norad: 25544,
      pass: { rise: '2026-11-24T04:35:00.000Z', peak: '2026-11-24T04:38:00.000Z', set: '2026-11-24T04:41:00.000Z', max_elevation_deg: 88.6, rise_direction: 'NW', visible: false },
    },
  };
  const card = satelliteCard({ result, request: { label: 'San Francisco' }, calledAt });
  assert.equal(card.answer.value, '35');
  assert.equal(card.title, 'ISS (ZARYA)');
  assert.equal(card.rows[0].cells[3], 'NO');
  assert.ok(card.unknowns.some((u) => /prediction/.test(u.text)));
});

test('a camera card shows a fetched frame with its own time when there is one', () => {
  const result = { data: { total: 1, rows: [{ id: 'c1', name: 'Bridge', provider: 'Caltrans', feed_type: 'image', lat: 37.8, lon: -122.4, distance_km: 1.2 }], complete: true } };
  const snapshot = { image: { mimeType: 'image/jpeg', data: 'AAAA' }, at: '2026-11-24T03:59:30.000Z' };
  const card = cameraCard({ result, request: { label: 'SF' }, calledAt, snapshot });
  assert.equal(card.image.src, 'data:image/jpeg;base64,AAAA');
  assert.equal(card.observedAt, '2026-11-24T03:59:30.000Z');
  assert.equal(card.observedKind, 'observed');
  assert.equal(card.source, 'Caltrans');
  const bare = cameraCard({ result, request: { label: 'SF' }, calledAt });
  assert.equal(bare.image, null);
  assert.equal(bare.observedKind, 'retrieved');
});

test('a distance card computes the great circle and bearing', () => {
  const card = distanceCard({
    from: { label: 'San Francisco', lat: 37.7749, lon: -122.4194 },
    to: { label: 'Tokyo', lat: 35.6762, lon: 139.6503 },
    calledAt,
  });
  const km = Number(String(card.answer.value).replace(/[^\d]/g, ''));
  assert.ok(km > 8200 && km < 8300, `got ${card.answer.value}`);
  assert.equal(card.pins.length, 2);
});

test('a brief lists de-duplicated sources, its unknowns and the missing ones', () => {
  const card = briefCard({
    sections: [
      { id: 'air', status: 'ok', source: 'ADS-B', observedAt: '2026-11-24T03:59:00Z', line: { text: 'x' } },
      { id: 'sea', status: 'needs-key', source: 'AISStream', unknown: { text: 'SEA: AISStream needs a key' } },
      { id: 'fires', status: 'ok', source: 'NIFC WFIGS', missing: 'NASA FIRMS', observedAt: '2026-11-24T03:00:00Z' },
    ],
    sources: [{ name: 'ads-b' }],
    request: { place: 'Bay Area', label: 'Bay Area' },
    calledAt,
  });
  assert.deepEqual(card.sourceList.map((s) => s.name), ['ads-b', 'AISStream', 'NIFC WFIGS']);
  assert.deepEqual(card.missing, ['AISStream', 'NASA FIRMS']);
  assert.equal(card.observedAt, '2026-11-24T03:00:00.000Z', 'a brief is as old as its oldest source');
  assert.ok(card.unknowns.some((u) => /AISStream needs a key/.test(u.text)));
});

test('an agent brief without sources says so', () => {
  const card = briefCard({ title: 'Note', body: 'Hello **world**\n\n- one\n- two', calledAt, origin: 'agent' });
  assert.equal(card.source, null);
  assert.ok(card.unknowns.some((u) => /No sources were given/.test(u.text)));
  assert.equal(card.body.length, 2);
});

test('markdown-lite never produces markup, only runs', () => {
  const blocks = parseMarkdownLite('<script>alert(1)</script> **bold**\n- item **b**');
  assert.equal(blocks[0].type, 'p');
  assert.equal(blocks[0].runs[0].text, '<script>alert(1)</script> ');
  assert.deepEqual(blocks[0].runs[1], { text: 'bold', strong: true });
  assert.equal(blocks[1].type, 'ul');
  assert.equal(blocks[1].items[0][1].strong, true);
});

test('a receipt keeps when, what, the answer and the source', () => {
  const card = aircraftCard({ result: aircraftResult, request: { label: 'Hormuz' }, calledAt });
  card.id = 'card-9';
  assert.deepEqual(receiptOf(card), {
    id: 'card-9',
    kind: 'aircraft',
    status: 'ok',
    at: calledAt,
    title: 'Hormuz',
    value: 2,
    unit: 'AIRCRAFT',
    source: 'adsb.lol',
    observedAt: '2026-11-24T03:59:50.000Z',
  });
});

test('freshness bands and compact ages', () => {
  const now = calledAt;
  assert.equal(freshness('2026-11-24T03:59:30Z', now, 'live').state, 'live');
  assert.equal(freshness('2026-11-24T03:50:00Z', now, 'live').state, 'recent');
  assert.equal(freshness('2026-11-24T03:00:00Z', now, 'live').state, 'stale');
  assert.equal(freshness('2026-11-24T03:00:00Z', now, 'daily').state, 'live');
  assert.equal(freshness('2026-11-24T03:59:59Z', now, 'live', { stale: true }).state, 'stale');
  assert.equal(freshness(null, now).state, 'unknown');
  assert.deepEqual(compactAge(45_000), { value: 45, unit: 's' });
  assert.deepEqual(compactAge(12 * 60_000), { value: 12, unit: 'min' });
  assert.deepEqual(compactAge(3 * 3_600_000), { value: 3, unit: 'h' });
  assert.equal(utcClock('2026-11-24T04:01:30Z'), '04:01Z');
});
