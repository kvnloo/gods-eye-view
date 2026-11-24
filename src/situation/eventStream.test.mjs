import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cycloneEvents,
  dedupeNews,
  eventsInBounds,
  eventsNear,
  mergeEvents,
  newsEvents,
  nextQuestion,
  perimeterEvents,
  quakeEvents,
  rankMatters,
  rankableNews,
  recencyWeight,
} from './eventStream.js';
import { missingSources, recordPoll, sourceStatuses } from './sourceStatus.js';
import { areaFor, normalizeCardRequest } from './requests.js';

const now = Date.parse('2026-11-24T04:00:00Z');
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();

test('feeds normalize into one geolocated event shape', () => {
  const quakes = quakeEvents([
    { id: 'q1', magnitude: 6.1, place: 'off Honshu', time: hoursAgo(1), lat: 38, lon: 142 },
    { id: 'q2', magnitude: 3, place: null, time: hoursAgo(2), lat: 999, lon: 0 },
  ]);
  assert.equal(quakes.length, 1, 'an impossible point is dropped');
  assert.equal(quakes[0].title, 'M6.1 off Honshu');
  assert.ok(quakes[0].severity > 0.7);
  const news = newsEvents([
    { id: 'n1', title: 'Strike on port', publishedAt: hoursAgo(0.5), relevance: 'core', severity: 4, copies: 3, category: 'strike', geo: { mappable: true, lat: 15, lon: 44, place: 'Hodeidah' } },
    { id: 'n2', title: 'Unmapped', publishedAt: hoursAgo(0.5), geo: { mappable: false, lat: 1, lon: 1 } },
  ]);
  assert.equal(news.length, 1);
  assert.equal(news[0].place, 'Hodeidah');
  assert.equal(news[0].source, 'GDELT');
  const storms = cycloneEvents([{ id: 'al01', name: 'ALPHA', lat: 20, lon: -60, wind_kt: 90, position_at: hoursAgo(3) }]);
  assert.equal(storms[0].kind, 'cyclone');
  const fires = perimeterEvents([
    { id: 'f1', name: 'Ridge', acres: 5000, contained_pct: 20, lat: 38, lon: -122, last_growth: hoursAgo(5), county: 'Napa', state: 'US-CA' },
    { id: 'f2', name: 'Done', acres: 5000, contained_pct: 100, lat: 38, lon: -121 },
  ]);
  assert.equal(fires.length, 1, 'contained fires are not events');
  assert.equal(fires[0].title, 'Ridge fire');
});

test('the same story from two outlets is one event', () => {
  const events = dedupeNews([
    { id: 'a', title: '23 civilians killed in airstrikes in Yemen', lat: 15, lon: 44, copies: 2, at: 1 },
    { id: 'b', title: 'At least 23 civilians killed in Yemen airstrikes', lat: 15.2, lon: 44.1, copies: 1, at: 2 },
    { id: 'c', title: 'Port reopens after storm', lat: 15, lon: 44, copies: 1, at: 3 },
  ]);
  assert.deepEqual(events.map((e) => e.id).sort(), ['a', 'c']);
  assert.equal(events.find((e) => e.id === 'a').copies, 3);
});

test('what matters now: severe, recent, varied, spread out, each with a next question', () => {
  const events = mergeEvents([
    quakeEvents([
      { id: 'q1', magnitude: 6.5, place: 'off Honshu', time: hoursAgo(0.5), lat: 38, lon: 142 },
      { id: 'q2', magnitude: 6.4, place: 'near Honshu', time: hoursAgo(0.6), lat: 38.2, lon: 142.1 },
      { id: 'q3', magnitude: 4.1, place: 'Chile', time: hoursAgo(20), lat: -30, lon: -71 },
    ]),
    newsEvents([
      { id: 'n1', title: 'Strike on port', publishedAt: hoursAgo(0.2), relevance: 'core', severity: 5, copies: 4, category: 'strike', geo: { mappable: true, lat: 15, lon: 44, place: 'Hodeidah' } },
      { id: 'n2', title: 'Celebrity news', publishedAt: hoursAgo(0.1), relevance: 'minor', severity: 5, copies: 0, category: 'other', geo: { mappable: true, lat: 40, lon: -74, place: 'New York' } },
    ]),
  ]);
  const matters = rankMatters(events, now, { firstSeen: new Map() });
  assert.equal(matters.length, 3);
  assert.deepEqual(matters.map((m) => m.rank), [1, 2, 3]);
  const ids = matters.map((m) => m.id);
  assert.ok(ids.includes('quake:q1'));
  assert.ok(!ids.includes('quake:q2'), 'a second quake within 150 km of the first is not a separate change');
  assert.ok(!ids.includes('news:n2'), 'minor, uncarried news does not rank');
  for (const item of matters) {
    assert.ok(item.next.text.text);
    assert.equal(item.next.action.name, 'show_card');
    assert.ok(Number.isFinite(item.next.action.args.latitude));
  }
});

test('next questions fit the event kind', () => {
  const base = { lat: 1, lon: 2, title: 'X', place: 'Y' };
  assert.equal(nextQuestion({ ...base, kind: 'quake' }).action.args.kind, 'aircraft');
  assert.equal(nextQuestion({ ...base, kind: 'cyclone' }).action.args.kind, 'vessels');
  assert.equal(nextQuestion({ ...base, kind: 'perimeter' }).action.args.kind, 'camera');
  assert.equal(nextQuestion({ ...base, kind: 'news', category: 'fire' }).action.args.kind, 'camera');
  assert.equal(nextQuestion({ ...base, kind: 'news', category: 'strike' }).action.args.kind, 'aircraft');
  assert.equal(rankableNews({ kind: 'news', relevance: 'core', category: 'strike' }), true);
  assert.equal(rankableNews({ kind: 'news', relevance: 'minor', copies: 1, category: 'strike' }), false);
});

test('recency halves at the half life; area filters', () => {
  assert.equal(recencyWeight(now, now), 1);
  assert.ok(Math.abs(recencyWeight(now - 6 * 3_600_000, now) - 0.5) < 1e-9);
  assert.equal(recencyWeight(NaN, now), 0.3);
  const events = [
    { id: 'a', lat: 37.8, lon: -122.3 },
    { id: 'b', lat: 10, lon: 170 },
    { id: 'c', lat: 10, lon: -175 },
  ];
  assert.deepEqual(eventsInBounds(events, { west: -123, east: -122, south: 37, north: 38 }).map((e) => e.id), ['a']);
  assert.deepEqual(eventsInBounds(events, { west: 160, east: -170, south: 0, north: 20 }).map((e) => e.id), ['b', 'c'], 'a box across the antimeridian');
  assert.deepEqual(eventsNear(events, { lat: 37.7, lon: -122.4 }, 50).map((e) => e.id), ['a']);
});

test('source status: live, stale, needs key, down and pending, from real poll outcomes only', () => {
  let records = {};
  records.quakes = recordPoll(null, { ok: true, at: now - 60_000, count: 52 });
  records.vessels = recordPoll(null, { ok: false, at: now, error: Object.assign(new Error('AISSTREAM_API_KEY not set'), { code: 'key-required' }) });
  records.cameras = recordPoll(null, { ok: false, at: now, error: new Error('HTTP 502') });
  records.news = recordPoll(null, { ok: true, at: now, observedAt: now - 3_600_000 });
  records.storms = recordPoll(null, { ok: true, at: now - 1000, stale: true });
  const aircraftOk = recordPoll(null, { ok: true, at: now - 10_000 });
  records.aircraft = recordPoll(aircraftOk, { ok: false, at: now, error: new Error('timeout') });
  const statuses = Object.fromEntries(sourceStatuses(records, now).map((s) => [s.id, s]));
  assert.equal(statuses.quakes.state, 'live');
  assert.equal(statuses.quakes.count, 52);
  assert.equal(statuses.vessels.state, 'needs-key');
  assert.equal(statuses.vessels.needsKey, 'AISSTREAM_API_KEY');
  assert.equal(statuses.cameras.state, 'down');
  assert.equal(statuses.news.state, 'stale', 'the newest report is an hour old');
  assert.equal(statuses.storms.state, 'stale', 'the source said so');
  assert.equal(statuses.aircraft.state, 'stale', 'answered before, failed now');
  assert.equal(statuses.satellites.state, 'pending');
  assert.deepEqual(missingSources(Object.values(statuses)).map((s) => s.id).sort(), ['cameras', 'vessels']);
});

test('card requests normalize kinds, places and points', () => {
  assert.equal(normalizeCardRequest({ kind: 'flights', place: 'Hormuz' }).kind, 'aircraft');
  assert.equal(normalizeCardRequest({ kind: 'ships', place: 'Oakland' }).kind, 'vessels');
  assert.match(normalizeCardRequest({ kind: 'aircraft' }).error, /needs a place/);
  assert.match(normalizeCardRequest({ kind: 'teleport', place: 'x' }).error, /Unknown card kind/);
  assert.equal(normalizeCardRequest({ kind: 'quakes' }).error, undefined, 'quakes may be worldwide');
  const point = normalizeCardRequest({ kind: 'camera', latitude: 37, longitude: -122, radiusKm: 5000 });
  assert.deepEqual(point.point, { lat: 37, lon: -122 });
  assert.equal(point.radiusKm, 2000);
  assert.match(normalizeCardRequest({ kind: 'distance', place: 'A' }).error, /"to"/);
});

test('a small place widens to the kind’s minimum radius; a big one keeps its box', () => {
  const city = { lat: 37.8, lon: -122.27, bounds: { west: -122.35, south: 37.7, east: -122.1, north: 37.9 } };
  assert.deepEqual(areaFor({ kind: 'aircraft' }, city), { lat: 37.8, lon: -122.27, radius_km: 120 });
  const state = { lat: 37, lon: -120, bounds: { west: -124.4, south: 32.5, east: -114.1, north: 42 } };
  assert.deepEqual(areaFor({ kind: 'fires' }, state), { bbox: [-124.4, 32.5, -114.1, 42] });
  assert.deepEqual(areaFor({ kind: 'vessels', radiusKm: 30 }, city), { lat: 37.8, lon: -122.27, radius_km: 30 });
  assert.deepEqual(areaFor({ kind: 'camera', point: { lat: 1, lon: 2 } }, null), { lat: 1, lon: 2, radius_km: 20 });
});
