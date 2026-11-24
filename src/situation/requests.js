/**
 * Card requests: what a caller (voice, chat, the z0live `globe` tool, an
 * agent or a click on a suggestion) asked for, normalized, and the tool
 * arguments that answer it. Pure.
 */

import { CARD_KINDS } from './cardModels.js';

/** Smallest radius (km) each kind looks over around a place. */
export const MIN_RADIUS_KM = Object.freeze({
  aircraft: 120,
  vessels: 40,
  quakes: 300,
  fires: 25,
  camera: 20,
  news: 150,
});

const KIND_ALIASES = Object.freeze({
  flights: 'aircraft',
  planes: 'aircraft',
  aviation: 'aircraft',
  ships: 'vessels',
  boats: 'vessels',
  maritime: 'vessels',
  earthquakes: 'quakes',
  earthquake: 'quakes',
  seismic: 'quakes',
  wildfires: 'fires',
  fire: 'fires',
  satellites: 'satellite',
  iss: 'satellite',
  pass: 'satellite',
  cameras: 'camera',
  cctv: 'camera',
  storms: 'cyclones',
  hurricanes: 'cyclones',
  typhoons: 'cyclones',
  place: 'area',
});

/** A normalized request, or `{ error }` when it cannot be answered. */
export function normalizeCardRequest(args = {}) {
  const raw = String(args.kind || '')
    .trim()
    .toLowerCase();
  const kind = KIND_ALIASES[raw] ?? raw;
  if (!CARD_KINDS.includes(kind) || kind === 'brief')
    return { error: `Unknown card kind "${args.kind ?? ''}"` };
  const text = (value, max = 200) =>
    typeof value === 'string' && value.trim()
      ? value.trim().slice(0, max)
      : null;
  const lat = Number(args.latitude);
  const lon = Number(args.longitude);
  const hasPoint =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;
  const radius = Number(args.radiusKm);
  const request = {
    kind,
    place: text(args.place),
    label: text(args.label, 120),
    point: hasPoint ? { lat, lon } : null,
    radiusKm:
      Number.isFinite(radius) && radius > 0 ? Math.min(2000, radius) : null,
    filter: text(args.filter, 80),
    satellite: text(args.satellite, 80),
    to: text(args.to),
    hours: Number.isFinite(Number(args.hours)) ? Number(args.hours) : null,
    minMagnitude: Number.isFinite(Number(args.minMagnitude))
      ? Math.max(2.5, Math.min(10, Number(args.minMagnitude)))
      : null,
  };
  const needsPlace = !['quakes', 'cyclones', 'news'].includes(kind);
  if (needsPlace && !request.place && !request.point)
    return { error: `A ${kind} card needs a place or latitude/longitude` };
  if (kind === 'distance' && !(request.to && (request.place || request.point)))
    return { error: 'A distance card needs a place and a "to" place' };
  if (!request.label && request.place) request.label = request.place;
  return request;
}

/**
 * The tool `area` for a request: a resolved place's box, widened so the
 * kind's minimum radius fits, or a circle around a given point.
 */
export function areaFor(request, place) {
  const minimum = MIN_RADIUS_KM[request.kind] ?? 50;
  if (request.point && !place)
    return {
      lat: request.point.lat,
      lon: request.point.lon,
      radius_km: request.radiusKm ?? minimum,
    };
  if (!place) return null;
  if (request.radiusKm)
    return { lat: place.lat, lon: place.lon, radius_km: request.radiusKm };
  const bounds = place.bounds;
  if (!bounds) return { lat: place.lat, lon: place.lon, radius_km: minimum };
  const halfHeightKm = ((bounds.north - bounds.south) * 110.57) / 2;
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const halfWidthKm =
    ((bounds.east - bounds.west) * 111.32 * Math.cos(midLat)) / 2;
  if (Math.max(halfHeightKm, halfWidthKm) >= minimum)
    return { bbox: [bounds.west, bounds.south, bounds.east, bounds.north] };
  return { lat: place.lat, lon: place.lon, radius_km: minimum };
}

/** The point an area is about, for observer-style tools. */
export function pointFor(request, place) {
  if (place) return { lat: place.lat, lon: place.lon };
  return request.point;
}
