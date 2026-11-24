/**
 * Situation cards: plain models built from real God's Eye View tool results.
 *
 * Each builder takes the tool's `{ summary, data }` (or the error it threw)
 * and returns a card the situation view renders and the receipt rail
 * remembers. A card always carries where its numbers came from: `source`,
 * `observedAt` (and whether that is the source's own observation time or
 * when it was retrieved), the freshness band to judge it by, the coverage it
 * speaks for, the unknowns it cannot answer, and a decision trail (which
 * tool, with which arguments, matched what). Text for people is a message
 * descriptor `{ text, values }` translated as it renders; feed values
 * (callsigns, place names, publishers) stay as they are.
 */

import { formatNumber, msg } from '../i18n/index.js';
import { timeMs } from './freshness.js';

/** Card kinds, in the order the situation view documents them. */
export const CARD_KINDS = Object.freeze([
  'aircraft',
  'vessels',
  'quakes',
  'fires',
  'satellite',
  'camera',
  'area',
  'distance',
  'news',
  'cyclones',
  'brief',
]);

/** The tag each card kind wears. */
export const CARD_KIND_TAGS = Object.freeze({
  aircraft: msg('AIRCRAFT'),
  vessels: msg('VESSELS'),
  quakes: msg('EARTHQUAKES'),
  fires: msg('FIRES'),
  satellite: msg('SATELLITE PASS'),
  camera: msg('CAMERAS'),
  area: msg('AREA'),
  distance: msg('DISTANCE'),
  news: msg('NEWS'),
  cyclones: msg('STORMS'),
  brief: msg('BRIEF'),
});

/** The tool each data card asks, and the GEV layer that shows its answer. */
export const CARD_TOOLS = Object.freeze({
  aircraft: 'aircraft_in_area',
  vessels: 'vessels_in_area',
  quakes: 'get_earthquakes',
  fires: 'get_active_fires',
  satellite: 'next_satellite_pass',
  camera: 'find_cctv_cameras',
  cyclones: 'get_cyclones',
});

const MAX_ROWS = 4;
const MAX_PINS = 40;

/** A message descriptor; `values` are interpolated after translation. */
export const say = (text, values) => (values ? { text, values } : { text });

const num = (value, digits = 0) =>
  Number.isFinite(value)
    ? formatNumber(value, {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      })
    : null;
const withUnit = (value, unit, digits = 0) => {
  const text = num(value, digits);
  return text === null ? '—' : `${text} ${unit}`;
};
const knots = (mps) =>
  withUnit(Number.isFinite(mps) ? mps * 1.943844 : NaN, 'kt');
const isoOrNull = (value) => {
  const ms = timeMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const pin = (row, label, kind, extra = {}) =>
  Number.isFinite(row?.lat) && Number.isFinite(row?.lon)
    ? { lat: row.lat, lon: row.lon, label: label ?? null, kind, ...extra }
    : null;

/** The camera a tool suggested for its answer, as a fly-to target. */
function focusOf(data, fallback) {
  const camera = data?.view?.camera;
  if (Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon))
    return {
      lat: camera.lat,
      lon: camera.lon,
      altitude_m: Number.isFinite(camera.altitude_m)
        ? camera.altitude_m
        : 400_000,
    };
  return fallback ?? null;
}

/** Arguments as the trail shows them: compact JSON, no nesting noise. */
export function argsText(args) {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '{}';
  }
}

function baseCard({ kind, tool, args, request, calledAt, origin, result }) {
  return {
    id: null,
    kind,
    status: 'ok',
    origin: origin ?? 'agent',
    createdAt: calledAt,
    request: request ?? null,
    tool: tool ?? null,
    summary: result?.summary ?? null,
    title: request?.label ?? request?.place ?? null,
    answer: null,
    line: null,
    columns: [],
    rows: [],
    pins: [],
    focus: focusOf(result?.data),
    layers: [...(result?.data?.view?.layers ?? [])],
    source: null,
    observedAt: null,
    observedKind: 'observed',
    band: 'feed',
    stale: false,
    coverage: null,
    unknowns: [],
    trail: tool
      ? [
          { label: msg('Tool'), value: tool },
          { label: msg('Arguments'), value: argsText(args) },
        ]
      : [],
    sections: [],
    image: null,
    missing: [],
  };
}

function areaLabel(request, fallback) {
  return request?.label || request?.place || fallback || null;
}

function truncationUnknown(data) {
  return data?.truncated
    ? say(msg('Showing {returned} of {total}'), {
        returned: data.returned,
        total: data.total,
      })
    : null;
}

/** aircraft_in_area → an aircraft card. */
export function aircraftCard(input) {
  const { result, request } = input;
  const data = result.data;
  const card = baseCard({
    ...input,
    kind: 'aircraft',
    tool: 'aircraft_in_area',
  });
  const rows = data.rows ?? [];
  const airborne = rows.filter((row) => !row.on_ground);
  const nearest = rows[0];
  card.title = areaLabel(request, data.view?.title);
  card.answer = { value: data.total ?? rows.length, unit: msg('AIRCRAFT') };
  card.line = nearest
    ? say(
        msg(
          'Nearest {callsign} at {altitude}, {speed}, {distance} from centre',
        ),
        {
          callsign: nearest.callsign || nearest.id,
          altitude: nearest.on_ground
            ? 'GND'
            : withUnit(nearest.altitude_m, 'm'),
          speed: knots(nearest.speed_mps),
          distance: withUnit(nearest.distance_km, 'km', 1),
        },
      )
    : say(msg('No aircraft reported in this area right now'));
  card.columns = [msg('CALLSIGN'), msg('ALT'), msg('SPEED'), msg('RANGE')];
  card.rows = rows.slice(0, MAX_ROWS).map((row) => ({
    cells: [
      row.callsign || row.id,
      row.on_ground ? 'GND' : withUnit(row.altitude_m, 'm'),
      knots(row.speed_mps),
      withUnit(row.distance_km, 'km', 1),
    ],
    lat: row.lat,
    lon: row.lon,
  }));
  card.pins = rows
    .slice(0, MAX_PINS)
    .map((row, index) =>
      pin(row, index < 3 ? row.callsign || row.id : null, 'aircraft', {
        course: row.course_deg,
      }),
    )
    .filter(Boolean);
  card.source = data.source || null;
  card.observedAt = isoOrNull(data.observed_at);
  card.band = 'live';
  card.stale = data.freshness === 'stale';
  card.coverage = data.coverage || null;
  const noType = rows.filter((row) => !row.type_code).length;
  card.unknowns = [
    truncationUnknown(data),
    noType
      ? say(msg('{count} of {total} report no aircraft type'), {
          count: noType,
          total: rows.length,
        })
      : null,
    /regional/i.test(data.coverage || '')
      ? say(msg('Regional feed: aircraft outside its coverage are not counted'))
      : null,
    implausibleSpeeds(rows)
      ? say(
          msg(
            '{count} report speeds implausible for their altitude; shown as the feed reports them',
          ),
          {
            count: implausibleSpeeds(rows),
          },
        )
      : null,
    say(
      msg(
        'Positions are ADS-B broadcasts; aircraft not transmitting are absent',
      ),
    ),
  ].filter(Boolean);
  card.trail.push(
    { label: msg('Matched'), value: `${data.total ?? rows.length}` },
    { label: msg('Airborne'), value: `${airborne.length}` },
  );
  return card;
}

/** Airborne above 3,000 m yet slower than 80 kt: a feed value to doubt. */
function implausibleSpeeds(rows) {
  return rows.filter(
    (row) =>
      !row.on_ground &&
      Number(row.altitude_m) > 3000 &&
      Number.isFinite(row.speed_mps) &&
      row.speed_mps * 1.943844 < 80,
  ).length;
}

/** "16 SEP": a compact UTC day for table cells. */
function shortDay(value) {
  const ms = timeMs(value);
  if (!Number.isFinite(ms)) return '—';
  const date = new Date(ms);
  const month = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ][date.getUTCMonth()];
  return `${date.getUTCDate()} ${month}`;
}

/** vessels_in_area → a vessel card, optionally narrowed to a destination. */
export function vesselsCard(input) {
  const { result, request } = input;
  const data = result.data;
  const card = baseCard({ ...input, kind: 'vessels', tool: 'vessels_in_area' });
  const all = data.rows ?? [];
  const wanted = String(request?.filter || '')
    .trim()
    .toLowerCase();
  const matches = wanted
    ? all.filter((row) =>
        String(row.destination || '')
          .toLowerCase()
          .includes(wanted),
      )
    : all;
  card.title = areaLabel(request);
  card.answer = {
    value: wanted ? matches.length : (data.total ?? all.length),
    unit: wanted ? msg('HEADED THERE') : msg('VESSELS'),
  };
  card.line = wanted
    ? say(
        msg(
          '{matched} of {total} vessels in the area report "{filter}" as destination',
        ),
        {
          matched: matches.length,
          total: data.total ?? all.length,
          filter: request.filter,
        },
      )
    : say(msg('{total} vessels reporting in the area'), {
        total: data.total ?? all.length,
      });
  card.columns = [msg('VESSEL'), msg('TYPE'), msg('DEST'), msg('SPEED')];
  card.rows = matches.slice(0, MAX_ROWS).map((row) => ({
    cells: [
      row.name || row.mmsi || row.id,
      row.type || '—',
      row.destination || '—',
      knots(row.speed_mps),
    ],
    lat: row.lat,
    lon: row.lon,
  }));
  card.pins = matches
    .slice(0, MAX_PINS)
    .map((row, index) =>
      pin(row, index < 3 ? row.name || row.mmsi : null, 'vessel', {
        course: row.course_deg,
      }),
    )
    .filter(Boolean);
  card.source = data.source || 'AIS';
  card.observedAt = isoOrNull(data.observed_at);
  card.band = 'live';
  card.stale = data.freshness === 'stale';
  card.coverage = data.coverage || null;
  const noDest = all.filter((row) => !row.destination).length;
  card.unknowns = [
    truncationUnknown(data),
    noDest
      ? say(msg('{count} vessels broadcast no destination'), { count: noDest })
      : null,
    say(
      msg('Destinations are typed by crews and are often stale or abbreviated'),
    ),
  ].filter(Boolean);
  if (wanted)
    card.trail.push({
      label: msg('Destination filter'),
      value: request.filter,
    });
  return card;
}

/** get_earthquakes → a quake card. */
export function quakesCard(input) {
  const { result, request, calledAt } = input;
  const data = result.data;
  const card = baseCard({ ...input, kind: 'quakes', tool: 'get_earthquakes' });
  const rows = data.rows ?? [];
  const strongest = rows[0];
  card.title = areaLabel(request, msg('Worldwide'));
  card.answer = {
    value: data.total ?? rows.length,
    unit: msg('QUAKES · 24 H'),
  };
  card.line = strongest
    ? say(msg('Strongest M{magnitude} {place}, {depth} deep'), {
        magnitude: num(strongest.magnitude, 1),
        place: strongest.place || '',
        depth: withUnit(strongest.depth_km, 'km'),
      })
    : say(msg('No M2.5+ earthquakes here in the last 24 hours'));
  card.columns = [msg('MAG'), msg('PLACE'), msg('TIME'), msg('DEPTH')];
  card.rows = rows.slice(0, MAX_ROWS).map((row) => ({
    cells: [
      `M${num(row.magnitude, 1)}`,
      row.place || '—',
      row.time ? `${row.time.slice(11, 16)}Z` : '—',
      withUnit(row.depth_km, 'km'),
    ],
    lat: row.lat,
    lon: row.lon,
  }));
  card.pins = rows
    .slice(0, MAX_PINS)
    .map((row, index) =>
      pin(row, index < 3 ? `M${num(row.magnitude, 1)}` : null, 'quake', {
        magnitude: row.magnitude,
      }),
    )
    .filter(Boolean);
  card.source = 'USGS';
  card.observedAt = isoOrNull(calledAt);
  card.observedKind = 'retrieved';
  card.band = 'feed';
  card.coverage = say(msg('M2.5+ in the last 24 hours, {area}'), {
    area: card.title,
  });
  const newest = rows
    .map((row) => timeMs(row.time))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  card.unknowns = [
    truncationUnknown(data),
    say(
      msg(
        'Quakes under M2.5 are not in this feed; outside the US it lists mostly M4.5+',
      ),
    ),
  ].filter(Boolean);
  if (Number.isFinite(newest))
    card.trail.push({
      label: msg('Newest event'),
      value: new Date(newest).toISOString(),
    });
  return card;
}

/**
 * Fires: FIRMS detections when the server has a key, and mapped WFIGS
 * perimeters either way. `perimeters` is the get_fire_perimeters result or
 * error; `result`/`error` are get_active_fires'.
 */
export function firesCard(input) {
  const { result, error, perimeters, request, calledAt } = input;
  const card = baseCard({
    ...input,
    kind: 'fires',
    tool: 'get_active_fires',
    result: result ?? perimeters?.result,
  });
  card.title = areaLabel(request);
  const detections = result?.data?.rows ?? null;
  const mapped = perimeters?.result?.data?.rows ?? null;
  const active = (mapped ?? []).filter(
    (row) => !(Number(row.contained_pct) >= 100),
  );
  const sources = [];
  if (detections) sources.push('NASA FIRMS');
  if (mapped) sources.push('NIFC WFIGS');
  card.source = sources.join(' · ') || null;
  if (!detections && !mapped) {
    return unavailableCard({
      ...input,
      kind: 'fires',
      error: error ?? perimeters?.error,
    });
  }
  if (detections) {
    card.answer = {
      value: result.data.total ?? detections.length,
      unit: msg('HOTSPOTS · 24 H'),
    };
    card.line = say(
      msg(
        '{detections} satellite detections; {active} of {mapped} mapped fires not yet contained',
      ),
      {
        detections: result.data.total ?? detections.length,
        active: active.length,
        mapped: mapped?.length ?? 0,
      },
    );
    card.observedAt = isoOrNull(
      result.data.window_end ?? result.data.fetched_at,
    );
    card.stale = result.data.stale === true;
  } else {
    card.answer = { value: active.length, unit: msg('UNCONTAINED FIRES') };
    card.line = active.length
      ? say(msg('{active} of {mapped} mapped fires not yet contained'), {
          active: active.length,
          mapped: mapped.length,
        })
      : say(msg('{mapped} mapped fires, all contained'), {
          mapped: mapped.length,
        });
    card.observedAt = isoOrNull(
      perimeters.result.data.retrieved_at ?? calledAt,
    );
    card.observedKind = 'retrieved';
    card.stale = perimeters.result.data.stale === true;
  }
  card.band = 'daily';
  const perimeterRows = [
    ...active,
    ...(mapped ?? []).filter((r) => !active.includes(r)),
  ];
  card.columns = [msg('FIRE'), msg('ACRES'), msg('CONT.'), msg('GREW')];
  card.rows = perimeterRows.slice(0, MAX_ROWS).map((row) => ({
    cells: [
      row.name || row.id,
      num(row.acres) ?? '—',
      Number.isFinite(row.contained_pct) ? `${row.contained_pct}%` : '—',
      shortDay(row.last_growth),
    ],
    lat: row.lat,
    lon: row.lon,
  }));
  card.pins = [
    ...(detections ?? [])
      .slice(0, MAX_PINS)
      .map((row) => pin(row, null, 'fire', { frp: row.frp_mw })),
    ...perimeterRows.slice(0, 12).map((row, index) =>
      pin(row, index < 3 ? row.name : null, 'perimeter', {
        contained: row.contained_pct,
      }),
    ),
  ].filter(Boolean);
  card.coverage = detections
    ? say(
        msg(
          'Satellite detections in the last 24 hours and US mapped perimeters, {area}',
        ),
        {
          area: card.title,
        },
      )
    : say(msg('US mapped wildfire perimeters (WFIGS), {area}'), {
        area: card.title,
      });
  if (!detections && neededKey(error)) card.missing = ['NASA FIRMS'];
  card.unknowns = [
    !detections
      ? say(
          msg(
            'Satellite hotspots (NASA FIRMS) need a FIRMS key on this server',
          ),
        )
      : null,
    say(
      msg(
        'Perimeters cover US incidents that crews have mapped; new starts appear later',
      ),
    ),
  ].filter(Boolean);
  if (perimeters)
    card.trail.push({
      label: msg('Also asked'),
      value: `get_fire_perimeters ${argsText(perimeters.args)}`,
    });
  if (!detections && error)
    card.trail.push({
      label: msg('Error'),
      value: `NASA FIRMS: ${errorText(error)}`,
    });
  return card;
}

/** next_satellite_pass → a pass card. */
export function satelliteCard(input) {
  const { result, request, calledAt } = input;
  const data = result.data;
  const card = baseCard({
    ...input,
    kind: 'satellite',
    tool: 'next_satellite_pass',
  });
  const pass = data.pass;
  card.title = data.satellite || request?.satellite || null;
  const rise = timeMs(pass?.rise);
  const minutes = Number.isFinite(rise)
    ? Math.max(0, Math.round((rise - calledAt) / 60_000))
    : null;
  card.answer = pass
    ? { value: minutes === null ? '—' : `${minutes}`, unit: msg('MIN TO RISE') }
    : { value: '—', unit: msg('NO PASS FOUND') };
  card.line = pass
    ? say(
        msg(
          'Rises {direction} at {rise}, peaks {elevation}° at {peak} over {place}',
        ),
        {
          direction: pass.rise_direction || '',
          rise: pass.rise ? `${pass.rise.slice(11, 16)}Z` : '—',
          elevation: num(pass.max_elevation_deg),
          peak: pass.peak ? `${pass.peak.slice(11, 16)}Z` : '—',
          place: areaLabel(request, data.location?.label),
        },
      )
    : say(msg('No pass above the horizon in the search window'));
  card.columns = [msg('RISE'), msg('PEAK'), msg('SET'), msg('VISIBLE')];
  card.rows = pass
    ? [
        {
          cells: [
            pass.rise ? `${pass.rise.slice(11, 19)}Z` : '—',
            pass.peak ? `${pass.peak.slice(11, 19)}Z` : '—',
            pass.set ? `${pass.set.slice(11, 19)}Z` : '—',
            pass.visible ? 'YES' : 'NO',
          ],
        },
      ]
    : [];
  card.pins = [
    pin(data.location, areaLabel(request, data.location?.label), 'observer'),
  ].filter(Boolean);
  card.source = 'CelesTrak TLE · SGP4';
  card.observedAt = isoOrNull(calledAt);
  card.observedKind = 'retrieved';
  card.band = 'catalog';
  card.stale = data.stale === true;
  card.coverage = say(
    msg('Predicted from the latest orbital elements for {place}'),
    {
      place: areaLabel(request, data.location?.label),
    },
  );
  card.unknowns = [
    say(
      msg(
        'A prediction, not an observation; manoeuvres after the TLE epoch are not included',
      ),
    ),
    pass && !pass.visible
      ? say(msg('Not naked-eye visible on this pass (lighting or sky)'))
      : null,
  ].filter(Boolean);
  card.trail.push({ label: msg('NORAD'), value: `${data.norad ?? '—'}` });
  return card;
}

/** find_cctv_cameras (+ optional get_cctv_snapshot) → a camera card. */
export function cameraCard(input) {
  const { result, request, calledAt, snapshot } = input;
  const data = result.data;
  const card = baseCard({
    ...input,
    kind: 'camera',
    tool: 'find_cctv_cameras',
  });
  const rows = data.rows ?? [];
  const nearest = rows[0];
  card.title = areaLabel(request);
  card.answer = {
    value: data.total ?? rows.length,
    unit: msg('PUBLIC CAMERAS'),
  };
  card.line = nearest
    ? say(msg('Nearest: {name} ({provider}), {distance} from centre'), {
        name: nearest.name || nearest.id,
        provider: nearest.provider || '—',
        distance: withUnit(nearest.distance_km, 'km', 1),
      })
    : say(msg('No public cameras listed in this area'));
  card.columns = [msg('CAMERA'), msg('PROVIDER'), msg('FEED'), msg('RANGE')];
  card.rows = rows.slice(0, MAX_ROWS).map((row) => ({
    cells: [
      row.name || row.id,
      row.provider || '—',
      row.feed_type || '—',
      withUnit(row.distance_km, 'km', 1),
    ],
    lat: row.lat,
    lon: row.lon,
  }));
  card.pins = rows
    .slice(0, MAX_PINS)
    .map((row, index) => pin(row, index < 2 ? row.name : null, 'camera'))
    .filter(Boolean);
  const providers = [
    ...new Set(rows.map((row) => row.provider).filter(Boolean)),
  ];
  card.source = providers.slice(0, 3).join(' · ') || 'GEV CCTV catalog';
  card.observedAt = isoOrNull(snapshot?.at ?? calledAt);
  card.observedKind = snapshot?.at ? 'observed' : 'retrieved';
  card.band = snapshot?.at ? 'live' : 'catalog';
  card.coverage = data.catalog_trimmed
    ? say(msg('Catalog listing, trimmed here; {area}'), { area: card.title })
    : say(msg('Public camera catalog, {area}'), { area: card.title });
  if (snapshot?.image)
    card.image = {
      src: `data:${snapshot.image.mimeType};base64,${snapshot.image.data}`,
      caption: nearest?.name || null,
    };
  card.unknowns = [
    truncationUnknown(data),
    data.complete === false
      ? say(msg('The catalog lists only some cameras in this area'))
      : null,
    snapshot?.image
      ? null
      : say(msg('No frame fetched; open the camera to see it live')),
  ].filter(Boolean);
  return card;
}

/** get_cyclones → a storm card. */
export function cyclonesCard(input) {
  const { result, calledAt } = input;
  const data = result.data;
  const card = baseCard({ ...input, kind: 'cyclones', tool: 'get_cyclones' });
  const storms = data.storms ?? [];
  card.title = msg('Tropical cyclones');
  card.answer = { value: storms.length, unit: msg('ACTIVE STORMS') };
  card.line = storms.length
    ? say(msg('Strongest: {name}'), {
        name: storms[0].name || storms[0].id || '—',
      })
    : say(msg('No active tropical cyclones in the agencies’ basins'));
  card.columns = [msg('STORM'), msg('BASIN'), msg('WIND'), msg('MOVING')];
  card.rows = storms.slice(0, MAX_ROWS).map((storm) => ({
    cells: [
      storm.name || storm.id || '—',
      storm.basin || '—',
      Number.isFinite(storm.wind_kt) ? `${storm.wind_kt} kt` : '—',
      typeof storm.movement === 'string' ? storm.movement : '—',
    ],
    lat: storm.lat,
    lon: storm.lon,
  }));
  card.pins = storms
    .map((storm) => pin(storm, storm.name || null, 'cyclone'))
    .filter(Boolean);
  card.source = data.source || 'NOAA NHC · JTWC';
  const issued = storms
    .map((storm) => timeMs(storm.issued_at))
    .filter(Number.isFinite);
  card.observedAt = isoOrNull(issued.length ? Math.max(...issued) : calledAt);
  card.observedKind = issued.length ? 'observed' : 'retrieved';
  card.band = 'daily';
  card.stale = data.stale === true;
  card.coverage = data.coverage || null;
  card.unknowns = [say(msg('Agency advisories update every 3–6 hours'))];
  return card;
}

/** A card from news reports already geolocated by the stream. */
export function newsCard({ reports, request, calledAt, origin }) {
  const card = baseCard({ kind: 'news', request, calledAt, origin });
  card.title = areaLabel(request, msg('Worldwide'));
  card.answer = { value: reports.length, unit: msg('REPORTS') };
  card.line = reports[0]
    ? say(msg('Latest: {title}'), { title: reports[0].title })
    : say(msg('No geolocated reports here in the feed window'));
  card.columns = [msg('HEADLINE'), msg('PUBLISHER'), msg('TIME')];
  card.rows = reports.slice(0, MAX_ROWS).map((report) => ({
    cells: [
      report.title,
      report.publisher || '—',
      report.at ? `${new Date(report.at).toISOString().slice(11, 16)}Z` : '—',
    ],
    lat: report.lat,
    lon: report.lon,
  }));
  card.pins = reports
    .slice(0, MAX_PINS)
    .map((report) => pin(report, null, 'news'))
    .filter(Boolean);
  card.source = 'GDELT Project';
  const newest = reports
    .map((r) => r.at)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  card.observedAt = isoOrNull(newest ?? calledAt);
  card.band = 'feed';
  card.coverage = say(msg('Geolocated news reports, {area}'), {
    area: card.title,
  });
  card.unknowns = [
    say(
      msg('Locations are inferred from article text; city precision at best'),
    ),
    say(msg('Unverified reporting: headlines are not confirmed events')),
  ];
  card.trail = [
    { label: msg('Feed'), value: '/api/news/feed' },
    { label: msg('Matched'), value: `${reports.length}` },
  ];
  return card;
}

/** A place outline: its size, and what the live stream holds inside it. */
export function areaCard({
  place,
  inside,
  request,
  calledAt,
  origin,
  geocoder,
}) {
  const card = baseCard({ kind: 'area', request, calledAt, origin });
  card.title = place.label;
  const widthKm = boxWidthKm(place.bounds);
  const heightKm = boxHeightKm(place.bounds);
  card.answer = {
    value: Number.isFinite(widthKm) ? `${num(widthKm)}×${num(heightKm)}` : '—',
    unit: msg('KM ACROSS'),
  };
  card.line = say(msg('Centre {lat}, {lon}; {events} live events inside'), {
    lat: num(place.lat, 3),
    lon: num(place.lon, 3),
    events: inside.length,
  });
  card.columns = [msg('EVENT'), msg('KIND'), msg('TIME')];
  card.rows = inside.slice(0, MAX_ROWS).map((event) => ({
    cells: [
      event.title,
      event.kind,
      Number.isFinite(event.at)
        ? `${new Date(event.at).toISOString().slice(11, 16)}Z`
        : '—',
    ],
    lat: event.lat,
    lon: event.lon,
  }));
  card.pins = [pin(place, place.label, 'area')].filter(Boolean);
  card.focus = {
    lat: place.lat,
    lon: place.lon,
    altitude_m: Math.min(
      12_000_000,
      Math.max(20_000, ((Math.max(widthKm, heightKm) || 100) * 1000) / 0.55),
    ),
  };
  card.outline = place.bounds ?? null;
  card.source = geocoder || 'OpenStreetMap (Photon)';
  card.observedAt = isoOrNull(calledAt);
  card.observedKind = 'retrieved';
  card.band = 'catalog';
  card.coverage = say(
    msg('Place outline from the geocoder; events from the live stream'),
  );
  card.unknowns = [
    say(msg('The outline is a bounding box, not the legal boundary')),
  ];
  card.trail = [
    { label: msg('Geocoder'), value: geocoder || 'Photon' },
    { label: msg('Query'), value: request?.place ?? place.label },
  ];
  return card;
}

/** Great-circle distance and initial bearing between two resolved places. */
export function distanceCard({
  from,
  to,
  request,
  calledAt,
  origin,
  geocoder,
}) {
  const card = baseCard({ kind: 'distance', request, calledAt, origin });
  const km = greatCircleKm(from, to);
  const bearing = initialBearing(from, to);
  card.title = `${from.label} → ${to.label}`;
  card.answer = { value: num(km), unit: msg('KM GREAT CIRCLE') };
  card.line = say(msg('{nm} nautical miles, initial bearing {bearing}°'), {
    nm: num(km / 1.852),
    bearing: num(bearing),
  });
  card.pins = [pin(from, from.label, 'area'), pin(to, to.label, 'area')].filter(
    Boolean,
  );
  card.line2 = [from, to];
  const mid = midpoint(from, to);
  card.focus = {
    lat: mid.lat,
    lon: mid.lon,
    altitude_m: Math.min(15_000_000, Math.max(50_000, (km * 1000) / 0.45)),
  };
  card.source = geocoder || 'OpenStreetMap (Photon)';
  card.observedAt = isoOrNull(calledAt);
  card.observedKind = 'retrieved';
  card.band = 'catalog';
  card.coverage = say(msg('Between the geocoded centres of both places'));
  card.unknowns = [
    say(msg('Centre to centre; routes by road, sea or air are longer')),
  ];
  card.trail = [
    {
      label: msg('From'),
      value: `${from.label} (${num(from.lat, 3)}, ${num(from.lon, 3)})`,
    },
    {
      label: msg('To'),
      value: `${to.label} (${num(to.lat, 3)}, ${num(to.lon, 3)})`,
    },
  ];
  return card;
}

/** "AISSTREAM_API_KEY not set" → the key the server needs, or null. */
export function neededKey(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (/key-required|key required|need[s]? a .*key|not set/i.test(text)) {
    const named = text.match(/[A-Z][A-Z0-9_]{3,}_(?:KEY|TOKEN|SECRET)/);
    if (named) return named[0];
    if (/FIRMS/i.test(text)) return 'FIRMS_MAP_KEY';
    return 'API key';
  }
  return null;
}

export function errorText(error) {
  if (!error) return '';
  return String(error.message || error).slice(0, 200);
}

/** A card that says honestly why its data could not be shown. */
export function unavailableCard({
  kind,
  tool,
  args,
  error,
  request,
  calledAt,
  origin,
}) {
  const card = baseCard({ kind, tool, args, request, calledAt, origin });
  const key = neededKey(error);
  card.status = key ? 'needs-key' : 'unavailable';
  card.title = areaLabel(request);
  card.answer = {
    value: '—',
    unit: key ? msg('NEEDS KEY') : msg('UNAVAILABLE'),
  };
  card.line = key
    ? say(msg('This server has no {key}; no data was shown or invented'), {
        key,
      })
    : say(msg('The source did not answer: {reason}'), {
        reason: errorText(error),
      });
  card.needsKey = key;
  card.missing = key ? [SOURCE_FOR_KIND[kind] ?? key] : [];
  card.source = SOURCE_FOR_KIND[kind] ?? null;
  card.observedAt = isoOrNull(calledAt);
  card.observedKind = 'retrieved';
  card.unknowns = [say(msg('Everything this card would show'))];
  card.trail.push({ label: msg('Error'), value: errorText(error) });
  return card;
}

export const SOURCE_FOR_KIND = Object.freeze({
  aircraft: 'ADS-B',
  vessels: 'AISStream',
  quakes: 'USGS',
  fires: 'NASA FIRMS · NIFC WFIGS',
  satellite: 'CelesTrak',
  camera: 'GEV CCTV catalog',
  cyclones: 'NOAA NHC · JTWC',
  news: 'GDELT Project',
});

/**
 * A brief: an agent's own text (title, markdown-lite body, sources) or one
 * composed from several tool answers (`sections`). Sources and unknowns are
 * always listed; a brief without a source says so.
 */
export function briefCard({
  title,
  body,
  sources = [],
  unknowns = [],
  sections = [],
  request,
  calledAt,
  origin,
  focus,
  pins = [],
}) {
  const card = baseCard({ kind: 'brief', request, calledAt, origin });
  card.title = title || areaLabel(request) || msg('Brief');
  card.body = parseMarkdownLite(body || '');
  card.sections = sections;
  const listed = [
    ...sources,
    ...sections.flatMap((section) =>
      section.source
        ? [{ name: section.source, observedAt: section.observedAt ?? null }]
        : [],
    ),
  ];
  const seen = new Set();
  card.sourceList = listed
    .filter((source) => source?.name)
    .filter((source) => {
      const key = source.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((source) => ({
      name: String(source.name).slice(0, 80),
      url: safeUrl(source.url),
      observedAt: isoOrNull(source.observedAt),
    }));
  card.source =
    card.sourceList.map((source) => source.name).join(' · ') || null;
  const times = [
    ...card.sourceList.map((source) => timeMs(source.observedAt)),
    ...sections.map((section) => timeMs(section.observedAt)),
  ].filter(Number.isFinite);
  card.observedAt = isoOrNull(times.length ? Math.min(...times) : calledAt);
  card.observedKind = times.length ? 'observed' : 'retrieved';
  card.band = 'feed';
  card.answer = {
    value: `${sections.filter((section) => section.status === 'ok').length || card.sourceList.length}`,
    unit: msg('SOURCES'),
  };
  // The title names the place; the sections say what each source covers.
  card.coverage = null;
  card.unknowns = [
    ...unknowns.map((text) => String(text).slice(0, 160)),
    ...sections
      .filter((section) => section.status !== 'pending')
      .map((section) => section.unknown),
    ...(card.sourceList.length
      ? []
      : [say(msg('No sources were given for this brief'))]),
  ].filter(Boolean);
  card.missing = [
    ...sections
      .filter((section) => section.status === 'needs-key')
      .map((section) => section.source),
    ...sections.map((section) => section.missing),
  ].filter(Boolean);
  card.pins = pins;
  card.focus = focus ?? null;
  card.trail = [
    {
      label: msg('Composed'),
      value: origin === 'agent' && body ? 'agent text' : 'GEV tools',
    },
    ...sections.map((section) => ({
      label: msg('Section'),
      value: `${section.tool || section.id}: ${section.status}`,
    })),
  ];
  return card;
}

function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Markdown-lite: paragraphs, `- ` bullets, `**bold**`. Returns blocks of
 * runs; nothing is ever turned into HTML, so agent text cannot inject markup.
 */
export function parseMarkdownLite(text) {
  const blocks = [];
  const lines = String(text).slice(0, 4000).split(/\r?\n/);
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'p', runs: runs(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flush();
      if (!list) {
        list = { type: 'ul', items: [] };
        blocks.push(list);
      }
      list.items.push(runs(bullet[1]));
      continue;
    }
    list = null;
    if (!line) flush();
    else paragraph.push(line);
  }
  flush();
  return blocks.slice(0, 24);
}

function runs(text) {
  const out = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let match; (match = pattern.exec(text));) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ text: match[1], strong: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const RAD = Math.PI / 180;
export function greatCircleKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function initialBearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) *
      Math.cos(b.lat * RAD) *
      Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

function midpoint(a, b) {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const bx = Math.cos(lat2) * Math.cos(dLon);
  const by = Math.cos(lat2) * Math.sin(dLon);
  const lat = Math.atan2(
    Math.sin(lat1) + Math.sin(lat2),
    Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2),
  );
  const lon = a.lon * RAD + Math.atan2(by, Math.cos(lat1) + bx);
  return { lat: lat / RAD, lon: ((lon / RAD + 540) % 360) - 180 };
}

function boxWidthKm(bounds) {
  if (!bounds) return NaN;
  const lat = (bounds.north + bounds.south) / 2;
  const span = (bounds.east - bounds.west + 360) % 360 || 360;
  return span * 111.32 * Math.cos(lat * RAD);
}

function boxHeightKm(bounds) {
  if (!bounds) return NaN;
  return (bounds.north - bounds.south) * 110.57;
}

/**
 * The one-line receipt a card leaves behind: when, what, where, the answer
 * and its source. Plain values only, so a receipt survives a locale change.
 */
export function receiptOf(card) {
  return {
    id: card.id,
    kind: card.kind,
    status: card.status,
    at: card.createdAt,
    title: card.title,
    value: card.answer?.value ?? null,
    unit: card.answer?.unit ?? null,
    source: card.source,
    observedAt: card.observedAt,
  };
}
