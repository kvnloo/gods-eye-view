import * as Cesium from 'cesium';
import { DEFAULT_OBSERVED_TRAFFIC_STALE_AFTER_MS } from './observed.js';

export const OBSERVED_TRAFFIC_RENDER_LIMIT = 128;

function recordTime(record) {
  return Number(record?.windowEnd ?? record?.observedAt) || 0;
}

function validPoint(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function primaryMeasurement(record) {
  const rate = Number(record?.flow?.vehiclesPerMin);
  if (Number.isFinite(rate) && rate >= 0)
    return `${Number.isInteger(rate) ? rate : rate.toFixed(1)} veh/min`;
  const counts = record?.flow?.counts;
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    const total = Object.values(counts).reduce((sum, raw) => {
      const value = Number(raw);
      return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
    }, 0);
    if (total > 0) return `${Math.round(total)} vehicles`;
  }
  return 'observed traffic';
}

/**
 * Plan a bounded observed-traffic render pass from normalized #830 records.
 * This is deliberately pure so state/limit/staleness semantics stay testable
 * without a Cesium viewer.
 */
export function planObservedTrafficRendering(
  snapshot,
  {
    now = Date.now(),
    limit = OBSERVED_TRAFFIC_RENDER_LIMIT,
    staleAfterMs = DEFAULT_OBSERVED_TRAFFIC_STALE_AFTER_MS,
  } = {},
) {
  if (!snapshot?.configured || !Array.isArray(snapshot.records)) return [];
  const cap = Math.max(
    1,
    Math.min(
      OBSERVED_TRAFFIC_RENDER_LIMIT,
      Math.floor(Number(limit) || OBSERVED_TRAFFIC_RENDER_LIMIT),
    ),
  );
  const staleLimit = Math.max(0, Number(staleAfterMs) || 0);

  return snapshot.records
    .filter((record) => {
      const geometry = record?.geometry;
      if (!geometry) return false;
      if (geometry.type === 'intersection')
        return validPoint(geometry.coordinates);
      return (
        ['road-segment', 'approach'].includes(geometry.type) &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length >= 2 &&
        geometry.coordinates.every(validPoint)
      );
    })
    .sort(
      (a, b) =>
        recordTime(b) - recordTime(a) ||
        String(a?.id || '').localeCompare(String(b?.id || '')),
    )
    .slice(0, cap)
    .map((record) => {
      const ageMs = Math.max(0, Number(now) - recordTime(record));
      const stale =
        Boolean(snapshot.error || snapshot.state === 'stale') ||
        ageMs > staleLimit;
      return {
        id: record.id,
        sourceId: record.sourceId,
        cameraId: record.cameraId || null,
        observedAt: record.observedAt,
        geometry: record.geometry,
        measurement: primaryMeasurement(record),
        stale,
        ageMs,
        quality: record.quality || null,
        provenance: record.provenance || null,
      };
    });
}

export function createObservedRendering({ state: layerState, parts }) {
  function clearObservedTraffic() {
    const viewer = layerState._viewer;
    for (const entity of layerState._observedTrafficEntities || [])
      viewer?.entities?.remove?.(entity);
    layerState._observedTrafficEntities = [];
    layerState._observedTrafficRendered = 0;
  }

  function entityColor(stale) {
    return stale
      ? Cesium.Color.ORANGE.withAlpha(0.9)
      : Cesium.Color.CYAN.withAlpha(0.95);
  }

  function syncObservedTraffic(
    snapshot = parts.observed?.methods?.getObservedTrafficSnapshot?.(),
  ) {
    clearObservedTraffic();
    if (!layerState._enabled || !layerState._viewer) return 0;

    const planned = planObservedTrafficRendering(snapshot);
    for (const item of planned) {
      const color = entityColor(item.stale);
      const common = {
        id: `traffic-observed-${item.id}`,
        properties: {
          gevSource: 'observed-traffic',
          observationId: item.id,
          sourceId: item.sourceId,
          cameraId: item.cameraId,
          observedAt: item.observedAt,
          stale: item.stale,
          qualityStatus: item.quality?.status || null,
          provenanceSource: item.provenance?.source || null,
        },
      };

      let entity;
      if (item.geometry.type === 'intersection') {
        const [lon, lat] = item.geometry.coordinates;
        entity = layerState._viewer.entities.add({
          ...common,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: 10,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            color,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(
              100,
              1.2,
              15_000,
              0.55,
            ),
          },
          label: {
            text: `OBSERVED · ${item.measurement}`,
            font: '11px monospace',
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              5000,
            ),
          },
        });
      } else {
        entity = layerState._viewer.entities.add({
          ...common,
          polyline: {
            positions: item.geometry.coordinates.map(([lon, lat]) =>
              Cesium.Cartesian3.fromDegrees(lon, lat),
            ),
            width: 4,
            material: color,
            clampToGround: true,
          },
        });
      }
      layerState._observedTrafficEntities.push(entity);
    }

    layerState._observedTrafficRendered =
      layerState._observedTrafficEntities.length;
    layerState._viewer.scene?.requestRender?.();
    return layerState._observedTrafficRendered;
  }

  return {
    clearObservedTraffic,
    syncObservedTraffic,
  };
}
