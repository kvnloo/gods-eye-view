/**
 * The live event stream: geolocated events from GEV's own feeds (USGS
 * quakes, GDELT news, NHC/JTWC storms, WFIGS fire perimeters) in one shape,
 * and the ranking behind "what matters now": the few changes worth a look,
 * each with the next question to ask about it. Pure.
 */

import { msg } from '../i18n/index.js';
import { timeMs } from './freshness.js';
import { say } from './cardModels.js';

export const EVENT_KINDS = Object.freeze([
  'quake',
  'news',
  'cyclone',
  'perimeter',
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finitePoint = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180;

/** get_earthquakes rows → events. */
export function quakeEvents(rows = []) {
  return rows
    .filter(
      (row) => finitePoint(row.lat, row.lon) && Number.isFinite(row.magnitude),
    )
    .map((row) => ({
      id: `quake:${row.id}`,
      kind: 'quake',
      title: `M${row.magnitude.toFixed(1)} ${row.place || ''}`.trim(),
      place: row.place || null,
      lat: row.lat,
      lon: row.lon,
      at: timeMs(row.time),
      severity: clamp01((row.magnitude - 2.5) / 5),
      magnitude: row.magnitude,
      source: 'USGS',
    }));
}

const NEWS_WEIGHT = { core: 1, related: 0.7, minor: 0.35 };

/** /api/news/feed reports → events (mappable, located ones only). */
export function newsEvents(reports = []) {
  const out = [];
  for (const report of reports) {
    const geo = report?.geo;
    if (!geo?.mappable || !finitePoint(geo.lat, geo.lon)) continue;
    const severity = Number.isFinite(report.severity) ? report.severity : 1;
    out.push({
      id: `news:${report.id}`,
      kind: 'news',
      title: String(report.title || '').slice(0, 160),
      place: geo.place || null,
      lat: geo.lat,
      lon: geo.lon,
      at: timeMs(report.publishedAt),
      severity: clamp01(
        (severity / 5) * (NEWS_WEIGHT[report.relevance] ?? 0.35) +
          Math.min(0.15, (report.copies || 0) * 0.02),
      ),
      category: report.category || null,
      relevance: report.relevance || null,
      copies: Number(report.copies) || 0,
      publisher: report.publisher || report.source?.name || null,
      url: report.url || null,
      source: 'GDELT',
    });
  }
  return dedupeNews(out);
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const words = (title) => new Set(title.toLowerCase().match(WORD) ?? []);

/**
 * One event per story: reports within 100 km whose titles share most of
 * their words are the same story; the most carried (then newest) stays.
 */
export function dedupeNews(events) {
  const kept = [];
  const sorted = [...events].sort(
    (a, b) => (b.copies || 0) - (a.copies || 0) || (b.at || 0) - (a.at || 0),
  );
  for (const event of sorted) {
    const mine = words(event.title);
    const twin = kept.find((other) => {
      if (nearKm(other, event) > 100) return false;
      const theirs = words(other.title);
      let shared = 0;
      for (const word of mine) if (theirs.has(word)) shared += 1;
      return shared / Math.max(1, Math.min(mine.size, theirs.size)) >= 0.6;
    });
    if (twin) twin.copies = (twin.copies || 0) + 1;
    else kept.push({ ...event });
  }
  return kept;
}

/** Whether a news event is solid enough to rank among what matters. */
export function rankableNews(event) {
  return (
    event.kind !== 'news' ||
    ((event.relevance === 'core' || (event.copies || 0) >= 3) &&
      !['other', 'opinion'].includes(event.category))
  );
}

/** get_cyclones storms → events. */
export function cycloneEvents(storms = []) {
  return storms
    .filter((storm) => finitePoint(storm.lat, storm.lon))
    .map((storm) => ({
      id: `cyclone:${storm.id ?? storm.name}`,
      kind: 'cyclone',
      title: storm.name || storm.id || '—',
      place: storm.basin || null,
      lat: storm.lat,
      lon: storm.lon,
      at: timeMs(storm.position_at ?? storm.issued_at),
      severity: clamp01(0.5 + (Number(storm.wind_kt) || 0) / 300),
      source: 'NHC/JTWC',
    }));
}

/** get_fire_perimeters rows → events for fires still growing or uncontained. */
export function perimeterEvents(rows = []) {
  return rows
    .filter(
      (row) =>
        finitePoint(row.lat, row.lon) && !(Number(row.contained_pct) >= 100),
    )
    .map((row) => ({
      id: `perimeter:${row.id}`,
      kind: 'perimeter',
      title: `${row.name || row.id} fire`,
      place: [row.county, row.state].filter(Boolean).join(', ') || null,
      lat: row.lat,
      lon: row.lon,
      at: timeMs(row.last_growth ?? row.updated),
      severity: clamp01(
        0.25 +
          Math.log10(Math.max(1, Number(row.acres) || 1)) / 8 +
          (100 - (Number(row.contained_pct) || 0)) / 400,
      ),
      acres: row.acres ?? null,
      contained: row.contained_pct ?? null,
      source: 'WFIGS',
    }));
}

/** Recency weight: 1 for now, half at `halfLifeMs`, never below 0.05. */
export function recencyWeight(at, now, halfLifeMs = 6 * 3_600_000) {
  if (!Number.isFinite(at)) return 0.3;
  const age = Math.max(0, now - at);
  return Math.max(0.05, 0.5 ** (age / halfLifeMs));
}

/** Events newest first, deduplicated by id, capped. */
export function mergeEvents(groups, { limit = 120 } = {}) {
  const byId = new Map();
  for (const group of groups)
    for (const event of group) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

/** Score for ranking; `firstSeen` (id → ms) boosts what is new this session. */
export function eventScore(event, now, firstSeen) {
  const seenAt = firstSeen?.get?.(event.id);
  const novel = Number.isFinite(seenAt) && now - seenAt < 15 * 60_000;
  const halfLife =
    event.kind === 'perimeter'
      ? 72 * 3_600_000
      : event.kind === 'cyclone'
        ? 24 * 3_600_000
        : 6 * 3_600_000;
  return (
    event.severity * recencyWeight(event.at, now, halfLife) * (novel ? 1.25 : 1)
  );
}

/**
 * The top few changes, at most `perKind` of one kind and none within 150 km
 * of a higher-ranked one, each with why it ranks and the next question.
 */
export function rankMatters(
  events,
  now,
  { firstSeen, limit = 3, perKind = 2 } = {},
) {
  const scored = events
    .filter(rankableNews)
    .map((event) => ({ event, score: eventScore(event, now, firstSeen) }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  const kinds = new Map();
  for (const { event, score } of scored) {
    if (picked.length >= limit) break;
    if ((kinds.get(event.kind) ?? 0) >= perKind) continue;
    if (picked.some(({ event: other }) => nearKm(other, event) < 150)) continue;
    kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
    picked.push({ event, score });
  }
  return picked.map(({ event, score }, index) => ({
    rank: index + 1,
    id: event.id,
    kind: event.kind,
    title: event.title,
    place: event.place,
    lat: event.lat,
    lon: event.lon,
    at: event.at,
    source: event.source,
    score: Number(score.toFixed(3)),
    why: whyItRanks(event, now, firstSeen),
    next: nextQuestion(event),
  }));
}

function whyItRanks(event, now, firstSeen) {
  const seenAt = firstSeen?.get?.(event.id);
  const novel = Number.isFinite(seenAt) && now - seenAt < 15 * 60_000;
  if (event.kind === 'quake')
    return say(
      novel
        ? msg('New: strongest recent quake in the feed')
        : msg('Among the strongest quakes in 24 h'),
    );
  if (event.kind === 'cyclone') return say(msg('Active tropical cyclone'));
  if (event.kind === 'perimeter') return say(msg('Uncontained mapped fire'));
  return say(
    novel
      ? msg('New: high-severity report')
      : msg('High-severity report, widely carried'),
  );
}

/**
 * The question this event invites, as words to show and the card action
 * that answers it. Places are the event's own coordinates, so the answer is
 * about exactly where the event is.
 */
export function nextQuestion(event) {
  const where = {
    latitude: Number(event.lat.toFixed(4)),
    longitude: Number(event.lon.toFixed(4)),
    label: event.place || event.title,
  };
  if (event.kind === 'quake')
    return {
      text: say(msg('Any aircraft near the {title}?'), { title: event.title }),
      action: {
        name: 'show_card',
        args: { kind: 'aircraft', ...where, radiusKm: 200 },
      },
    };
  if (event.kind === 'cyclone')
    return {
      text: say(msg('Which ships are near {name}?'), { name: event.title }),
      action: {
        name: 'show_card',
        args: { kind: 'vessels', ...where, radiusKm: 400 },
      },
    };
  if (event.kind === 'perimeter')
    return {
      text: say(msg('Show cameras near the {name}'), { name: event.title }),
      action: {
        name: 'show_card',
        args: { kind: 'camera', ...where, radiusKm: 40 },
      },
    };
  if (['disaster', 'fire', 'casualties', 'weather'].includes(event.category))
    return {
      text: say(msg('Any public cameras near {place}?'), {
        place: event.place || event.title,
      }),
      action: {
        name: 'show_card',
        args: { kind: 'camera', ...where, radiusKm: 30 },
      },
    };
  return {
    text: say(msg('What is flying over {place} right now?'), {
      place: event.place || event.title,
    }),
    action: {
      name: 'show_card',
      args: { kind: 'aircraft', ...where, radiusKm: 150 },
    },
  };
}

/** Events inside a bounding box (longitudes may wrap). */
export function eventsInBounds(events, bounds) {
  if (!bounds) return [];
  const { west, east, south, north } = bounds;
  return events.filter((event) => {
    if (event.lat < south || event.lat > north) return false;
    return west <= east
      ? event.lon >= west && event.lon <= east
      : event.lon >= west || event.lon <= east;
  });
}

/** Events within `radiusKm` of a point, nearest first. */
export function eventsNear(events, point, radiusKm) {
  return events
    .map((event) => ({ event, km: nearKm(point, event) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .map(({ event }) => event);
}

function nearKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Labels for the event kinds, for the list and the pins. */
export const EVENT_KIND_LABELS = Object.freeze({
  quake: msg('QUAKE'),
  news: msg('NEWS'),
  cyclone: msg('STORM'),
  perimeter: msg('FIRE'),
});
