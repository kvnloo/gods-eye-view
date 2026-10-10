import {
  fireHistoryDetectionPixelSize,
  fireHistoryEventCenter,
  fireHistoryProgressRgb,
} from './model.js';
import { fireDetectionPhase, fireReplayActive } from './replay.js';

const COOLED_RGB = Object.freeze([92, 70, 66]);
const COOLED_ALPHA = 0.58;
const ACTIVE_BRIGHTEN = 34;
const ACTIVE_SIZE_BONUS = 2;

/**
 * Cesium resource owner for Historic Fires. It owns only point primitives and
 * focus geometry; acquisition/replay state stay outside this module.
 */
export function createFireHistoryRendering({
  viewer,
  cesium: C,
  requestRender = () => viewer.scene.requestRender?.(),
} = {}) {
  if (!viewer?.scene?.primitives || !C?.PointPrimitiveCollection)
    throw new TypeError('Historic fires rendering requires a Cesium viewer');

  const points = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
  points.show = false;
  let records = [];
  let pointByIndex = [];
  let event = null;
  let destroyed = false;
  const scratch = new C.Color();

  const render = (reason) => {
    if (!destroyed) requestRender(reason);
  };

  function staticStyle(record, point) {
    const [r, g, b] = fireHistoryProgressRgb(record.progress);
    point.show = true;
    point.color = C.Color.fromBytes(r, g, b, 255, scratch);
    point.pixelSize = fireHistoryDetectionPixelSize(record.frp, record.sensor);
  }

  function replayStyle(record, point, cursorMs) {
    const phase = fireDetectionPhase(record, cursorMs);
    if (phase === 'pending') {
      point.show = false;
      return;
    }
    point.show = true;
    const base = fireHistoryDetectionPixelSize(record.frp, record.sensor);
    if (phase === 'active') {
      const [r, g, b] = fireHistoryProgressRgb(record.progress);
      point.color = C.Color.fromBytes(
        Math.min(255, r + ACTIVE_BRIGHTEN),
        Math.min(255, g + ACTIVE_BRIGHTEN),
        Math.min(255, b + ACTIVE_BRIGHTEN),
        255,
        scratch,
      );
      point.pixelSize = base + ACTIVE_SIZE_BONUS;
      return;
    }
    point.color = C.Color.fromBytes(
      COOLED_RGB[0],
      COOLED_RGB[1],
      COOLED_RGB[2],
      Math.round(COOLED_ALPHA * 255),
      scratch,
    );
    point.pixelSize = Math.max(2, base - 1);
  }

  return {
    setVisible(visible) {
      points.show = Boolean(visible);
      render('fire-history-visibility');
    },

    setSnapshot(nextRecords, nextEvent) {
      records = Array.isArray(nextRecords) ? [...nextRecords] : [];
      event = nextEvent || null;
      pointByIndex = new Array(records.length);
      points.removeAll();
      for (const record of records) {
        const point = points.add({
          id:
            'fire-history:' +
            (event?.id || 'event') +
            ':' +
            String(record.index),
          position: C.Cartesian3.fromDegrees(record.lon, record.lat, 0),
          pixelSize: fireHistoryDetectionPixelSize(record.frp, record.sensor),
          color: C.Color.WHITE,
          outlineColor: C.Color.fromBytes(20, 8, 8, 200),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        pointByIndex[record.index] = point;
        staticStyle(record, point);
      }
      render('fire-history-snapshot');
    },

    setReplay(replay) {
      if (!records.length) return;
      const active = fireReplayActive(replay);
      for (const record of records) {
        const point = pointByIndex[record.index];
        if (!point) continue;
        if (active) replayStyle(record, point, replay.cursorMs);
        else staticStyle(record, point);
      }
      render('fire-history-replay');
    },

    getFocusSphere() {
      if (!event?.bbox || event.bbox.length !== 4) return null;
      const [west, south, east, north] = event.bbox;
      const center = fireHistoryEventCenter(event.bbox);
      if (!center) return null;
      const positions = [
        C.Cartesian3.fromDegrees(west, south, 0),
        C.Cartesian3.fromDegrees(west, north, 0),
        C.Cartesian3.fromDegrees(east, south, 0),
        C.Cartesian3.fromDegrees(east, north, 0),
        C.Cartesian3.fromDegrees(center.lon, center.lat, 0),
      ];
      const sphere = C.BoundingSphere.fromPoints(positions);
      sphere.radius = Math.max(sphere.radius, 25_000);
      return sphere;
    },

    clear() {
      records = [];
      pointByIndex = [];
      event = null;
      points.removeAll();
      render('fire-history-clear');
    },

    getDiagnostics() {
      return {
        points: records.length,
        visible: Boolean(points.show),
        eventId: event?.id || null,
      };
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      points.removeAll();
      viewer.scene.primitives.remove(points);
      records = [];
      pointByIndex = [];
      event = null;
    },
  };
}
