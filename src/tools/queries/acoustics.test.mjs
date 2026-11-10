import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCatalog, coreTools } from '../index.js';
import { SPEED_OF_SOUND_MPS, flyoverFromTrack } from './acoustics.js';

const C = SPEED_OF_SOUND_MPS;
const listener = { lat: 42.48, lon: -76.45, elevationM: 100 };
const M_PER_DEG_LAT = 111194.9;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((listener.lat * Math.PI) / 180);
const T0 = Date.UTC(2026, 10, 8, 18, 0, 0);

/** A straight, level pass: east at `v`, `north` metres off, CPA at T0. */
function pass({ v = 60, north = 2000, agl = 500, every = 5, span = 300 } = {}) {
  const points = [];
  for (let s = -span; s <= span; s += every)
    points.push({
      timeMs: T0 + s * 1000,
      lat: listener.lat + north / M_PER_DEG_LAT,
      lon: listener.lon + (v * s) / mPerDegLon,
      altitudeM: listener.elevationM + agl,
    });
  return points;
}

test('a straight pass gives slant distance, speed and heard time with sound delay', () => {
  const f = flyoverFromTrack(pass(), listener);
  const slant = Math.hypot(2000, 500);
  assert.ok(Math.abs(f.slantM - slant) < 2, `slant ${f.slantM}`);
  assert.ok(Math.abs(f.speedMps - 60) < 0.5, `speed ${f.speedMps}`);
  assert.ok(Math.abs(f.heardCpaMs - (T0 + (slant / C) * 1000)) < 1200);
  assert.ok(Math.abs(f.altitudeAglM - 500) < 1);
});

test('the Doppler curve falls through 1 at the closest approach and matches theory', () => {
  const v = 60;
  const f = flyoverFromTrack(pass({ v }), listener);
  const ratios = f.curve.map((c) => c.ratio);
  for (let i = 1; i < ratios.length; i += 1)
    assert.ok(ratios[i] <= ratios[i - 1]);
  const mid = f.curve.find((c) => Math.abs(c.heard_offset_s) < 4);
  assert.ok(Math.abs(mid.ratio - 1) < 0.01, `mid ${mid.ratio}`);
  // Far from the closest approach the ratio tends to c/(c ∓ v·cosθ).
  assert.ok(f.ratioHigh < C / (C - v) && f.ratioHigh > 1.1);
  assert.ok(f.ratioLow > C / (C + v) && f.ratioLow < 0.92);
});

test('tracks that stay beyond the slant limit, or end at their closest point, are not flyovers', () => {
  assert.equal(flyoverFromTrack(pass({ north: 15000 }), listener), null);
  const approaching = pass().filter((p) => p.timeMs <= T0 - 60000);
  assert.equal(flyoverFromTrack(approaching, listener), null);
});

test('gaps over two minutes are not bridged', () => {
  const sparse = pass({ every: 200, span: 400 });
  assert.equal(flyoverFromTrack(sparse, listener), null);
});

test('aircraft_flyovers reads nearby tracks and reports flyovers newest first', async () => {
  const toTrack = (points) => ({
    records: points.map((p) => ({
      observedAtMs: p.timeMs,
      latitude: p.lat,
      longitude: p.lon,
      baroAltitudeM: p.altitudeM,
      onGround: false,
    })),
  });
  const tracks = {
    aaa111: toTrack(pass({ v: 60, north: 1500 })),
    bbb222: toTrack(
      pass({ v: 90, north: 4000 }).map((p) => ({
        ...p,
        timeMs: p.timeMs + 600000,
      })),
    ),
    ccc333: toTrack(pass({ north: 40000 })),
  };
  const aircraft = {
    async getSnapshot() {
      return {
        source: 'Test feed',
        observedAtMs: T0 + 900000,
        records: Object.keys(tracks).map((id, i) => ({
          id,
          latitude: listener.lat + 0.1 * i,
          longitude: listener.lon,
          onGround: false,
          callsign: `T${i}`,
          typeCode: 'C172',
        })),
      };
    },
    async getTrack(id) {
      return tracks[id];
    },
  };
  const catalog = composeCatalog({ tools: coreTools, services: { aircraft } });
  const result = await catalog.call('aircraft_flyovers', {
    lat: listener.lat,
    lon: listener.lon,
    ground_elevation_m: listener.elevationM,
    curves: true,
  });
  assert.deepEqual(
    result.data.rows.map((r) => r.id),
    ['bbb222', 'aaa111'],
  );
  assert.equal(result.data.rows[1].slant_m, Math.round(Math.hypot(1500, 500)));
  assert.ok(result.data.rows[0].curve.length > 10);
  assert.match(result.summary, /^2 flyovers within 10 km/);
});
