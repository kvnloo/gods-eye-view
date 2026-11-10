/**
 * Acoustic flyovers: when, how close and with what Doppler shift a listener
 * at a point heard the aircraft whose recent tracks pass near it. This is the
 * forward model behind locating a recording from the Doppler curves of the
 * aircraft audible in it: each curve gives a speed, a closest slant distance
 * and a heard time, which these rows can be matched against.
 */

import { defineTool, ToolError } from '../catalog.js';
import { LIMIT_SCHEMA, capRows, countNoun, isoTime } from '../results.js';

export const SPEED_OF_SOUND_MPS = 343;
const EARTH_RADIUS_M = 6371008.8;
const STEP_S = 1;
const MAX_GAP_S = 120;
const MAX_CANDIDATES = 40;
const CURVE_POINTS = 41;
// Below this a source (a hovering helicopter, a taxiing aircraft) draws no
// Doppler curve to match.
const MIN_SPEED_MPS = 10;

const round = (value, digits) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

/** East/north/up metres of a track point from the listener (local tangent plane). */
function localXYZ(point, listener) {
  const lat0 = (listener.lat * Math.PI) / 180;
  const x =
    (((point.lon - listener.lon) * Math.PI) / 180) *
    EARTH_RADIUS_M *
    Math.cos(lat0);
  const y = (((point.lat - listener.lat) * Math.PI) / 180) * EARTH_RADIUS_M;
  return [x, y, point.altitudeM - listener.elevationM];
}

/**
 * The flyover a listener heard from one track, or null when the track never
 * comes within `maxSlantM`. `points` are `{ timeMs, lat, lon, altitudeM }`
 * (altitude above sea level), in any order. Positions are interpolated at 1 s
 * across gaps up to two minutes; sound takes R/c to arrive, so heard times are
 * emission times plus travel time. The heard frequency is f0·c/(c + dR/dt).
 * Sources slower than 10 m/s draw no Doppler curve and are left out.
 */
export function flyoverFromTrack(points, listener, { maxSlantM = 10000 } = {}) {
  const track = points
    .filter(
      (p) =>
        Number.isFinite(p.timeMs) &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.altitudeM),
    )
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((p) => ({ t: p.timeMs / 1000, xyz: localXYZ(p, listener) }));
  const samples = [];
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    const span = b.t - a.t;
    if (span <= 0 || span > MAX_GAP_S) continue;
    for (let t = Math.ceil(a.t / STEP_S) * STEP_S; t < b.t; t += STEP_S) {
      const k = (t - a.t) / span;
      samples.push({ t, xyz: a.xyz.map((v, j) => v + k * (b.xyz[j] - v)) });
    }
  }
  if (samples.length < 3) return null;
  let best = 0;
  const range = samples.map((s, i) => {
    const r = Math.hypot(...s.xyz);
    if (r < Math.hypot(...samples[best].xyz)) best = i;
    return r;
  });
  const slant = range[best];
  if (slant > maxSlantM || best === 0 || best === samples.length - 1)
    return null;
  const at = (i) => Math.min(samples.length - 1, Math.max(0, i));
  const speed =
    Math.hypot(
      ...samples[at(best + 1)].xyz.map(
        (v, j) => v - samples[at(best - 1)].xyz[j],
      ),
    ) /
    (samples[at(best + 1)].t - samples[at(best - 1)].t);
  if (!(speed >= MIN_SPEED_MPS)) return null;
  const heardCpa = samples[best].t + slant / SPEED_OF_SOUND_MPS;
  // Doppler ratio f/f0 against heard time, around the closest approach.
  const curve = [];
  const half = Math.floor(CURVE_POINTS / 2);
  const stride = Math.max(1, Math.round(240 / CURVE_POINTS));
  for (let n = -half; n <= half; n += 1) {
    const i = best + n * stride;
    if (i < 1 || i >= samples.length - 1) continue;
    const rate =
      (range[i + 1] - range[i - 1]) / (samples[i + 1].t - samples[i - 1].t);
    curve.push({
      heard_offset_s: round(
        samples[i].t + range[i] / SPEED_OF_SOUND_MPS - heardCpa,
        1,
      ),
      ratio: round(SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS + rate), 4),
    });
  }
  const ratios = curve.map((c) => c.ratio);
  return {
    heardCpaMs: heardCpa * 1000,
    slantM: slant,
    speedMps: speed,
    altitudeAglM: samples[best].xyz[2],
    ratioHigh: Math.max(...ratios),
    ratioLow: Math.min(...ratios),
    curve,
  };
}

export const aircraftFlyovers = defineTool({
  name: 'aircraft_flyovers',
  title: 'Aircraft flyovers heard at a point',
  description:
    'Aircraft whose recent tracks passed within a slant distance of a point: ' +
    'when the closest approach was heard there (sound travel included), the ' +
    'slant distance, speed and Doppler pitch ratio, newest first. Reads the ' +
    'tracks of aircraft currently near the point, so aircraft that have left ' +
    'the area or landed are missing.',
  inputSchema: {
    type: 'object',
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      max_slant_km: { type: 'number', minimum: 0.5, maximum: 30 },
      ground_elevation_m: { type: 'number', minimum: -500, maximum: 9000 },
      curves: {
        type: 'boolean',
        description: 'Include each flyover’s Doppler ratio curve.',
      },
      limit: LIMIT_SCHEMA,
    },
    required: ['lat', 'lon'],
    additionalProperties: false,
  },
  requires: ['aircraft'],
  async run(args, { services, signal }) {
    const maxSlantM = (args.max_slant_km ?? 10) * 1000;
    let elevationM = args.ground_elevation_m;
    if (elevationM == null && services.terrain) {
      const [height] = await services.terrain
        .getHeights([{ lat: args.lat, lon: args.lon }], { signal })
        .catch(() => []);
      elevationM = height?.elevation;
    }
    const listener = {
      lat: args.lat,
      lon: args.lon,
      elevationM: Number.isFinite(elevationM) ? elevationM : 0,
    };
    const snapshot = await services.aircraft.getSnapshot(
      { latitude: args.lat, longitude: args.lon },
      { signal },
    );
    // Aircraft now within 100 km may have flown over in the last hours.
    const near = (r) =>
      Math.hypot(
        (r.latitude - args.lat) * 111,
        (r.longitude - args.lon) * 111 * Math.cos((args.lat * Math.PI) / 180),
      ) < 100;
    const candidates = snapshot.records
      .filter((r) => !r.onGround && near(r))
      .slice(0, MAX_CANDIDATES);
    if (!candidates.length && !snapshot.records.length)
      throw new ToolError(
        'unavailable',
        'No aircraft are reported near this point',
      );
    const tracks = await Promise.allSettled(
      candidates.map((r) => services.aircraft.getTrack(r.id, { signal })),
    );
    signal?.throwIfAborted();
    const rows = [];
    tracks.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const record = candidates[index];
      const flyover = flyoverFromTrack(
        result.value.records
          .filter((p) => !p.onGround)
          .map((p) => ({
            timeMs: p.observedAtMs,
            lat: p.latitude,
            lon: p.longitude,
            altitudeM: p.baroAltitudeM ?? p.ellipsoidAltitudeM,
          })),
        listener,
        { maxSlantM },
      );
      if (!flyover) return;
      rows.push({
        id: record.id,
        callsign: record.callsign || null,
        type_code: record.typeCode || null,
        heard_at: isoTime(flyover.heardCpaMs),
        slant_m: round(flyover.slantM, 0),
        altitude_agl_m: round(flyover.altitudeAglM, 0),
        speed_mps: round(flyover.speedMps, 1),
        doppler_high: flyover.ratioHigh,
        doppler_low: flyover.ratioLow,
        ...(args.curves ? { curve: flyover.curve } : {}),
      });
    });
    rows.sort((a, b) => Date.parse(b.heard_at) - Date.parse(a.heard_at));
    const failed = tracks.filter((t) => t.status === 'rejected').length;
    return {
      summary:
        `${countNoun(rows.length, 'flyover')} within ${maxSlantM / 1000} km of ` +
        `${args.lat.toFixed(3)}, ${args.lon.toFixed(3)} from ` +
        `${countNoun(candidates.length, 'nearby aircraft track')}` +
        (failed ? ` (${failed} tracks unavailable).` : '.'),
      data: {
        listener: {
          lat: listener.lat,
          lon: listener.lon,
          ground_elevation_m: round(listener.elevationM, 1),
        },
        speed_of_sound_mps: SPEED_OF_SOUND_MPS,
        ...capRows(rows, args.limit),
        tracks_checked: candidates.length,
        tracks_unavailable: failed,
        source: snapshot.source ?? null,
        observed_at: isoTime(snapshot.observedAtMs),
      },
    };
  },
});
