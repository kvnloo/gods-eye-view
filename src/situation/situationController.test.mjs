import test from 'node:test';
import assert from 'node:assert/strict';
import { createSituationController, lineText } from './situationController.js';
import { runSituationAction, SITUATION_ACTIONS } from './situationActions.js';
import { GEV_ACTION_SCHEMAS } from '../voice/actionSchemas.js';
import {
  realtimeTools,
  SITUATION_TOOLS,
} from '../../server/providers/openai/tools.js';
import {
  summarizeResult,
  z0liveDisplayTools,
} from '../voice/z0liveDisplay.js';
import { createSituationGeocoder } from '../standalone/situationServices.js';

const NOW = Date.parse('2026-11-24T04:00:00Z');

/** A catalog double answering in the tools' shapes; records every call. */
function fakeServices({ keys = { AISSTREAM_API_KEY: false, FIRMS_MAP_KEY: false } } = {}) {
  const calls = [];
  const answers = {
    aircraft_in_area: () => ({
      summary: '2 aircraft',
      data: {
        view: { camera: { lat: 26.4, lon: 56.2, altitude_m: 200_000 }, layers: ['flights'] },
        total: 2,
        returned: 2,
        rows: [
          { id: 'a', callsign: 'AAA1', lat: 26.4, lon: 56.2, altitude_m: 3000, on_ground: false, speed_mps: 150, distance_km: 3 },
          { id: 'b', callsign: 'BBB2', lat: 26.5, lon: 56.3, altitude_m: 0, on_ground: true, speed_mps: 0, distance_km: 9 },
        ],
        source: 'adsb.lol',
        coverage: 'worldwide',
        observed_at: '2026-11-24T03:59:55.000Z',
        freshness: 'current',
      },
    }),
    get_earthquakes: () => ({
      summary: '1 earthquake',
      data: { total: 1, rows: [{ id: 'q', magnitude: 5.2, place: 'off Honshu', time: '2026-11-24T03:00:00.000Z', lat: 38, lon: 142, depth_km: 20 }] },
    }),
    get_cyclones: () => ({ data: { storms: [], source: 'NOAA NHC / CPHC · JTWC', coverage: 'basins', stale: false } }),
    get_fire_perimeters: () => ({ data: { retrieved_at: '2026-11-24T03:00:00.000Z', rows: [], total: 0 } }),
    satellites_overhead: () => ({ data: { total: 0, rows: [] } }),
    find_cctv_cameras: () => ({ data: { total: 0, rows: [] } }),
    get_weather: () => ({
      data: { weather: { observed_at: '2026-11-24T03:45:00.000Z', conditions: 'clear sky', temperature_c: 9, wind_kph: 8, visibility_m: 16000 } },
    }),
    vessels_in_area: () => {
      throw new Error('should not be called without a key');
    },
    get_active_fires: () => {
      throw new Error('should not be called without a key');
    },
  };
  const catalog = {
    async call(name, args) {
      calls.push({ name, args });
      const answer = answers[name];
      if (!answer) throw new Error(`no fake for ${name}`);
      return answer(args);
    },
  };
  const news = {
    async getFeed() {
      return {
        reports: [
          { id: 'n1', title: 'Port strike', publishedAt: '2026-11-24T03:50:00Z', relevance: 'core', severity: 4, copies: 3, category: 'strike', geo: { mappable: true, lat: 37.8, lon: -122.3, place: 'Oakland' } },
        ],
      };
    },
  };
  const geocode = async (name) =>
    ({
      'strait of hormuz': { label: 'Strait of Hormuz', lat: 26.45, lon: 56.2, bounds: { west: 55.2, south: 25.7, east: 57.3, north: 27.2 }, geocoder: 'test' },
      oakland: { label: 'Oakland', lat: 37.8, lon: -122.27, bounds: { west: -122.35, south: 37.7, east: -122.1, north: 37.9 }, geocoder: 'test' },
      'bay area': { label: 'Bay Area', lat: 37.79, lon: -122.36, bounds: null, geocoder: 'test' },
    })[String(name).toLowerCase()] ?? null;
  return {
    calls,
    services: async () => ({ catalog, news, geocode, keys: async () => keys }),
  };
}

function controller(options = {}) {
  const fake = fakeServices(options);
  const published = [];
  const pins = [];
  const runs = [];
  const situation = createSituationController({
    services: fake.services,
    run: async (name, args) => {
      runs.push({ name, args });
      return { ok: true };
    },
    publish: (view) => published.push(view),
    publishPins: (next) => pins.push(next),
    project: (lat, lon) => ({ x: 960 + lon, y: 540 - lat }),
    onFrame: () => () => {},
    now: () => NOW,
    setInterval: null,
    clearInterval: null,
    setTimeout: () => 0,
    clearTimeout: () => {},
    logger: null,
  });
  return { situation, published, pins, runs, calls: fake.calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('situation mode polls the feeds and publishes sources, events and what matters now', async () => {
  const { situation, published, calls } = controller();
  situation.setEnabled(true);
  await settle();
  const view = published.at(-1);
  assert.equal(view.enabled, true);
  const states = Object.fromEntries(view.sources.map((s) => [s.id, s.state]));
  assert.equal(states.quakes, 'live');
  assert.equal(states.news, 'live');
  assert.equal(states.vessels, 'needs-key', 'no key: no request, an honest status');
  assert.equal(states.fires, 'needs-key');
  assert.ok(!calls.some((c) => c.name === 'vessels_in_area' || c.name === 'get_active_fires'));
  assert.ok(view.events.some((e) => e.id === 'quake:q'));
  assert.ok(view.matters.length >= 1);
  assert.equal(situation.context().enabled, true);
  assert.deepEqual(situation.context().missing.sort(), ['fires', 'vessels']);
  situation.setEnabled(false);
  assert.deepEqual(published.at(-1), { enabled: false });
});

test('show_card builds a card from the real tool answer, frames it and answers honestly', async () => {
  const { situation, published, runs, calls } = controller();
  const result = await situation.showCard({ kind: 'flights', place: 'Strait of Hormuz' }, { origin: 'voice' });
  assert.equal(result.ok, true);
  assert.equal(result.card.kind, 'aircraft');
  assert.equal(result.card.value, 2);
  assert.equal(result.card.source, 'adsb.lol');
  assert.equal(result.card.observed_at, '2026-11-24T03:59:55.000Z');
  assert.equal(result.card.freshness, 'live');
  assert.equal(situation.enabled, true, 'a card turns situation mode on');
  const asked = calls.find((c) => c.name === 'aircraft_in_area' && c.args.limit === 50);
  assert.deepEqual(asked.args.area, { lat: 26.45, lon: 56.2, radius_km: 120 }, 'a strait narrower than 120 km widens to the aircraft radius');
  await settle();
  assert.ok(runs.some((r) => r.name === 'fly_to_location'));
  assert.ok(runs.some((r) => r.name === 'set_layer_visibility' && r.args.layerId === 'flights' && r.args.enabled));
  const card = published.at(-1).cards[0];
  assert.equal(card.origin, 'voice');
  assert.ok(card.trail.some((row) => /fly_to_location: ok/.test(row.value)));
  situation.stop();
});

test('a card for a source without a key says so and is not ok', async () => {
  const { situation } = controller();
  const result = await situation.showCard({ kind: 'vessels', place: 'Oakland', filter: 'Oakland' });
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.match(result.error, /AISSTREAM_API_KEY/);
  assert.equal(result.card.status, 'needs-key');
  situation.stop();
});

test('an unknown place is an honest unavailable card, not a guess', async () => {
  const { situation } = controller();
  const result = await situation.showCard({ kind: 'aircraft', place: 'Nowhereville' });
  assert.equal(result.ok, false);
  assert.match(result.error, /No place matched/);
  situation.stop();
});

test('a composed brief lists its sections, sources and missing keys', async () => {
  const { situation, published } = controller();
  situation.setEnabled(true);
  await settle();
  const result = await situation.brief({ place: 'Bay Area' });
  assert.equal(result.ok, true);
  assert.match(result.say, /Brief for Bay Area/);
  const card = published.at(-1).cards.find((c) => c.kind === 'brief');
  const status = Object.fromEntries(card.sections.map((s) => [s.id, s.status]));
  assert.equal(status.air, 'ok');
  assert.equal(status.weather, 'ok');
  assert.equal(status.sea, 'needs-key');
  assert.ok(card.missing.includes('AISStream'));
  assert.ok(card.missing.includes('NASA FIRMS'));
  assert.ok(card.sourceList.some((s) => s.name === 'Open-Meteo'));
  assert.ok(result.card.unknowns.some((u) => /AISStream needs a key/.test(u)));
  situation.stop();
});

test('an agent brief shows the agent text with its listed sources', async () => {
  const { situation } = controller();
  const result = await situation.brief({
    title: 'Port watch',
    body: '- **Two** tankers waiting\n- Berth 3 closed',
    sources: [{ name: 'Harbor notice', url: 'https://example.org/notice' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.card.sources, ['Harbor notice']);
  situation.stop();
});

test('pin, dismiss and focus_event answer with what they did', async () => {
  const { situation } = controller();
  situation.setEnabled(true);
  await settle();
  assert.equal((await runSituationAction(situation, 'pin_card', {})).ok, false, 'nothing to pin yet');
  await situation.showCard({ kind: 'quakes' });
  const pinned = await runSituationAction(situation, 'pin_card', {});
  assert.equal(pinned.ok, true);
  const focused = await runSituationAction(situation, 'focus_event', { rank: 1 });
  assert.equal(focused.ok, true);
  assert.ok(focused.event.title);
  assert.ok(focused.next_question);
  const dismissed = await runSituationAction(situation, 'dismiss_card', { all: true });
  assert.equal(dismissed.ok, true);
  assert.equal((await runSituationAction(situation, 'focus_event', { id: 'nope' })).ok, false);
  const off = await runSituationAction(situation, 'set_situation_mode', { enabled: false });
  assert.equal(off.enabled, false);
});

test('without a situation room the actions say so', async () => {
  const result = await runSituationAction(null, 'show_card', { kind: 'quakes' });
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
});

test('every situation action has a schema, a z0live summary, and is offered to voice only in situation mode', () => {
  const names = new Set(GEV_ACTION_SCHEMAS.map((schema) => schema.name));
  for (const action of SITUATION_ACTIONS) assert.ok(names.has(action), action);
  const bridge = new Set(z0liveDisplayTools().map((tool) => tool.name));
  for (const action of SITUATION_ACTIONS) assert.ok(bridge.has(action), action);
  assert.deepEqual([...SITUATION_TOOLS].sort(), [...SITUATION_ACTIONS].sort());
  const plain = realtimeTools().map((tool) => tool.name);
  const room = realtimeTools({ situation: true }).map((tool) => tool.name);
  for (const action of SITUATION_ACTIONS) {
    assert.ok(!plain.includes(action), `${action} stays out of ordinary sessions`);
    assert.ok(room.includes(action), `${action} is offered in situation mode`);
  }
});

test('the bridge passes card results through to the caller', () => {
  const out = summarizeResult({
    ok: false,
    unavailable: true,
    error: 'Needs AISSTREAM_API_KEY',
    card: { id: 'card-1', kind: 'vessels', status: 'needs-key' },
  });
  assert.equal(out.card.id, 'card-1');
  assert.equal(out.unavailable, true);
  const focus = summarizeResult({ ok: true, event: { id: 'e' }, next_question: 'q?' });
  assert.equal(focus.event.id, 'e');
  assert.equal(focus.next_question, 'q?');
});

test('the geocoder falls back to the keyless one when the server has no key', async () => {
  const asked = [];
  const geocode = createSituationGeocoder({
    server: { resolve: async (name) => (asked.push(name), null) },
    serverAvailable: async () => false,
    keyless: async () => ({
      place: { lat: 1, lng: 2, label: 'Somewhere', viewport: { southwest: { lat: 0, lng: 1 }, northeast: { lat: 2, lng: 3 } } },
    }),
  });
  const place = await geocode('somewhere');
  assert.deepEqual(asked, [], 'no request to a server without a key');
  assert.deepEqual(place.bounds, { west: 1, south: 0, east: 3, north: 2 });
  assert.equal(place.geocoder, 'OpenStreetMap (Photon)');
  assert.equal(lineText({ text: 'A {b}', values: { b: 'c' } }), 'A c');
});
