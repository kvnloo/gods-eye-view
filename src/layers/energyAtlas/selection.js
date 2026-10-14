import {
  annualAveragePowerW,
  normalizeEnergySnapshot,
} from './model.js';

const YEARLY_AVERAGE = 'annual_average_equivalent_not_live';
const LAD_CODE = /^[EWSN]\d{8}$/;

const label = (value) =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Validate a versioned ONS local-authority identity without claiming to load
 * or verify geometry. The rendering owner must obtain the actual polygon.
 */
export function normalizeEnergyBoundary(boundary) {
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary))
    return null;
  const code = label(boundary.code);
  if (
    boundary.type !== 'local_authority' ||
    boundary.codeField !== 'LAD24CD' ||
    boundary.dataset !== 'ONS LAD2024' ||
    boundary.revision !== '2024-12' ||
    !LAD_CODE.test(code) ||
    !label(boundary.name)
  )
    return null;
  return Object.freeze({
    id: 'GSS:' + code,
    type: 'local_authority',
    name: label(boundary.name),
    codeField: 'LAD24CD',
    dataset: 'ONS LAD2024',
    revision: '2024-12',
  });
}

function unavailable(reason, area = null) {
  return Object.freeze({
    schemaVersion: 1,
    state: 'unavailable',
    reason,
    area,
    annualTWh: null,
    averagePowerGW: null,
    live: false,
    counterKind: YEARLY_AVERAGE,
  });
}

/**
 * Resolve a selected administrative area to an attributable annual readout.
 * This is a data-to-map boundary, not a polygon renderer or telemetry feed.
 * A changed selection, year or source revision must never reuse the last value.
 */
export function resolveEnergySelection({
  boundary,
  observations,
  metric,
  calendarYear,
  sourceRevision,
} = {}) {
  const area = normalizeEnergyBoundary(boundary);
  if (!area) return unavailable('boundary-unverified');
  if (
    typeof metric !== 'string' ||
    !Number.isInteger(calendarYear) ||
    !label(sourceRevision)
  )
    return unavailable('selector-incomplete', area);

  const records = normalizeEnergySnapshot(observations);
  if (!records) return unavailable('snapshot-invalid', area);

  const row = records.find(
    (item) =>
      item.area.id === area.id &&
      item.area.type === area.type &&
      item.metric === metric &&
      item.calendarYear === calendarYear,
  );
  if (!row) return unavailable('observation-missing', area);
  if (
    row.area.boundaryDataset !== area.dataset ||
    row.area.boundaryRevision !== area.revision
  )
    return unavailable('boundary-revision-mismatch', area);
  if (row.source.datasetVersion !== sourceRevision)
    return unavailable('source-revision-mismatch', area);
  if (row.annualTWh === null)
    return unavailable('value-missing', area);
  if (row.geographyCoverage !== 'complete')
    return unavailable('coverage-incomplete', area);
  if (row.status === 'modeled')
    return unavailable('modeled-not-observed', area);

  const averagePowerW = annualAveragePowerW(
    row.annualTWh,
    row.calendarYear,
  );
  if (averagePowerW === null)
    return unavailable('power-unavailable', area);

  return Object.freeze({
    schemaVersion: 1,
    state: 'ready',
    reason: null,
    area,
    metric: row.metric,
    calendarYear: row.calendarYear,
    status: row.status,
    annualTWh: row.annualTWh,
    averagePowerGW: averagePowerW / 1e9,
    source: row.source,
    live: false,
    counterKind: YEARLY_AVERAGE,
  });
}
