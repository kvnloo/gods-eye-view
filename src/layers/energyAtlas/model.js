/**
 * Model-only Energy Atlas calculations.
 *
 * No fetching, geography inference, renderer, real-time telemetry, or source
 * selection. A caller must supply compatible, attributed annual observations.
 * Source facts remain separate from illustrative annual-average equivalents.
 */

export const ENERGY_METRICS = Object.freeze([
  'total_final_energy',
  'primary_energy_supply',
  'electricity_consumption',
]);

const METRICS = new Set(ENERGY_METRICS);
const STATES = new Set([
  'measured',
  'official_estimate',
  'modeled',
  'missing',
]);
const AREA_TYPES = new Set([
  'world',
  'country',
  'region',
  'state',
  'county',
  'local_authority',
]);
const COVERAGE = new Set(['complete', 'partial', 'unknown']);

const text = (value) =>
  typeof value === 'string' ? value.trim() : '';

/** Calendar years only; no local time zones or instantaneous measurements. */
export function hoursInCalendarYear(year) {
  if (!Number.isInteger(year) || year < 1800 || year > 2100)
    return null;
  const leap =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 8784 : 8760;
}

/** Derived mean power in watts from one calendar year's energy in TWh. */
export function annualAveragePowerW(annualTWh, calendarYear) {
  const hours = hoursInCalendarYear(calendarYear);
  if (
    hours === null ||
    typeof annualTWh !== 'number' ||
    !Number.isFinite(annualTWh) ||
    annualTWh < 0
  )
    return null;
  const watts = (annualTWh * 1e12) / hours;
  return Number.isFinite(watts) ? watts : null;
}

/**
 * Sagan's logarithmic Kardashev interpolation (educational power scale).
 * Must only be presented as a civilization/planet-scale analogy by the caller;
 * this scalar formula does not claim that a city has a civilization type.
 */
export function saganKardashevIndex(powerW) {
  return typeof powerW === 'number' &&
    Number.isFinite(powerW) &&
    powerW > 0
    ? (Math.log10(powerW) - 6) / 10
    : null;
}

function validIsoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validArea(area) {
  if (!area || typeof area !== 'object' || Array.isArray(area))
    return false;
  if (
    !AREA_TYPES.has(area.type) ||
    !text(area.boundaryDataset) ||
    !text(area.boundaryRevision)
  )
    return false;
  if (area.type === 'world') return area.id === 'WORLD';
  if (area.type === 'country') return /^ISO3:[A-Z]{3}$/.test(area.id);
  // Pilot constraint: only versioned UK administrative GSS codes are accepted.
  return /^GSS:[A-Z]\d{8}$/.test(area.id);
}

function validSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return false;
  if (
    !text(source.publisher) ||
    !text(source.datasetVersion) ||
    !text(source.licence) ||
    !text(source.attribution) ||
    typeof source.url !== 'string' ||
    !validIsoDay(text(source.releasedAt))
  )
    return false;
  try {
    const url = new URL(source.url);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a versioned, attributed annual energy observation.
 * A missing/suppressed value stays null, never zero. Malformed input rejects
 * the whole record rather than manufacturing an area, metric, or source.
 */
export function normalizeEnergyObservation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    return null;
  if (
    row.schemaVersion !== 1 ||
    !validArea(row.area) ||
    !METRICS.has(row.metric) ||
    hoursInCalendarYear(row.calendarYear) === null ||
    !STATES.has(row.status) ||
    !COVERAGE.has(row.geographyCoverage) ||
    !validSource(row.source)
  )
    return null;
  if (row.status === 'missing') {
    if (row.annualTWh != null) return null;
  } else if (
    typeof row.annualTWh !== 'number' ||
    !Number.isFinite(row.annualTWh) ||
    row.annualTWh < 0
  )
    return null;

  const area = Object.freeze({
    id: row.area.id,
    type: row.area.type,
    boundaryDataset: text(row.area.boundaryDataset),
    boundaryRevision: text(row.area.boundaryRevision),
  });
  const source = Object.freeze({
    publisher: text(row.source.publisher),
    url: row.source.url,
    datasetVersion: text(row.source.datasetVersion),
    releasedAt: row.source.releasedAt,
    licence: text(row.source.licence),
    attribution: text(row.source.attribution),
  });
  return Object.freeze({
    schemaVersion: 1,
    area,
    metric: row.metric,
    calendarYear: row.calendarYear,
    annualTWh: row.status === 'missing' ? null : row.annualTWh,
    status: row.status,
    source,
    geographyCoverage: row.geographyCoverage,
  });
}

/** Atomic validation: duplicate area+metric+year claims reject the batch. */
export function normalizeEnergySnapshot(rows) {
  if (!Array.isArray(rows)) return null;
  const normalized = [];
  const keys = new Set();
  for (const raw of rows) {
    const row = normalizeEnergyObservation(raw);
    if (!row) return null;
    const key = [row.area.id, row.metric, row.calendarYear].join('|');
    if (keys.has(key)) return null;
    keys.add(key);
    normalized.push(row);
  }
  return Object.freeze(normalized);
}

/**
 * Conservative comparison of like-for-like annual values, not aggregation.
 * Cross-level, cross-source or partial geography comparisons must be reviewed
 * explicitly by a downstream owner instead of silently mixing measurements.
 */
export function sameComparableMetric(a, b) {
  const left = normalizeEnergyObservation(a);
  const right = normalizeEnergyObservation(b);
  return Boolean(
    left &&
    right &&
    left.annualTWh !== null &&
    right.annualTWh !== null &&
    left.status === right.status &&
    left.status !== 'modeled' &&
    left.geographyCoverage === 'complete' &&
    right.geographyCoverage === 'complete' &&
    left.metric === right.metric &&
    left.calendarYear === right.calendarYear &&
    left.area.type === right.area.type &&
    left.area.boundaryDataset === right.area.boundaryDataset &&
    left.area.boundaryRevision === right.area.boundaryRevision &&
    left.source.publisher === right.source.publisher &&
    left.source.url === right.source.url &&
    left.source.datasetVersion === right.source.datasetVersion
  );
}

/**
 * Planetary educational display gate. City, state, and country observations
 * never yield a Kardashev "type" from this model.
 */
export function worldKardashevEstimate(record) {
  const observation = normalizeEnergyObservation(record);
  if (
    !observation ||
    observation.area.type !== 'world' ||
    observation.metric !== 'primary_energy_supply' ||
    observation.annualTWh === null ||
    observation.status === 'modeled'
  )
    return null;
  const averagePowerW = annualAveragePowerW(
    observation.annualTWh,
    observation.calendarYear,
  );
  const index = saganKardashevIndex(averagePowerW);
  if (index === null) return null;
  return Object.freeze({
    index,
    averagePowerW,
    year: observation.calendarYear,
    coverage: observation.geographyCoverage,
    source: observation.source,
    kind: 'educational_annual_average',
  });
}
