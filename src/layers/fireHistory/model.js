/**
 * Historic Fires pure record/timeline model.
 *
 * Original event-progress and record-adaptation design: @lleon-at-navteca,
 * upstream #609. This recut deliberately omits row controls, DOM, Cesium,
 * perimeter presentation and overlay-label ownership.
 */
import { adaptFirmsRecords } from '../../data/firmsAdapt.js';
import { formatUtcDay, parseUtcDay } from '../../data/fireHistoryEvents.js';

const DAY_MS = 86_400_000;

const PROGRESS_STOPS = Object.freeze([
  [0, 255, 228, 92],
  [0.35, 255, 138, 31],
  [0.7, 232, 50, 26],
  [1, 107, 20, 20],
]);

export function fireHistoryEventRange(event) {
  const startMs = Number.isFinite(event?.startMs)
    ? event.startMs
    : parseUtcDay(event?.startDate);
  const endMs = Number.isFinite(event?.endMs)
    ? event.endMs
    : parseUtcDay(event?.endDate) + DAY_MS;
  return { startMs, endMs };
}

export function fireHistoryEventProgress(acqMs, event) {
  const { startMs, endMs } = fireHistoryEventRange(event);
  if (!Number.isFinite(acqMs) || !(endMs > startMs)) return 0;
  return Math.max(0, Math.min(1, (acqMs - startMs) / (endMs - startMs)));
}

export function fireHistoryProgressRgb(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  for (let i = 1; i < PROGRESS_STOPS.length; i += 1) {
    const [p1, r1, g1, b1] = PROGRESS_STOPS[i];
    if (p > p1) continue;
    const [p0, r0, g0, b0] = PROGRESS_STOPS[i - 1];
    const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
    return [
      Math.round(r0 + (r1 - r0) * t),
      Math.round(g0 + (g1 - g0) * t),
      Math.round(b0 + (b1 - b0) * t),
    ];
  }
  const [, r, g, b] = PROGRESS_STOPS.at(-1);
  return [r, g, b];
}

export function fireHistoryDetectionPixelSize(frp, sensor) {
  const base = sensor === 'MODIS' ? 6 : 4;
  const power = Number.isFinite(frp) && frp > 0 ? Math.log10(1 + frp) : 0;
  return Math.round(base + Math.min(5, power * 2));
}

export function adaptFireHistoryRecords(records, event) {
  const fires = adaptFirmsRecords(records)
    .filter((fire) => Number.isFinite(fire.acqMs) && fire.acqMs > 0)
    .sort((a, b) => a.acqMs - b.acqMs);

  return fires.map((fire, index) =>
    Object.freeze({
      ...fire,
      index,
      progress: fireHistoryEventProgress(fire.acqMs, event),
    }),
  );
}

export function buildFireHistoryTimeline(fires, event) {
  const { startMs, endMs } = fireHistoryEventRange(event);
  if (!(endMs > startMs)) return [];

  const days = Math.round((endMs - startMs) / DAY_MS);
  const timeline = Array.from({ length: days }, (_, index) => ({
    date: formatUtcDay(startMs + index * DAY_MS),
    count: 0,
    maxFrp: 0,
  }));

  for (const fire of fires || []) {
    if (!Number.isFinite(fire?.acqMs)) continue;
    const index = Math.floor((fire.acqMs - startMs) / DAY_MS);
    if (index < 0 || index >= days) continue;
    timeline[index].count += 1;
    if (Number.isFinite(fire.frp) && fire.frp > timeline[index].maxFrp)
      timeline[index].maxFrp = fire.frp;
  }

  return timeline.map(Object.freeze);
}

export function selectFireHistoryEvent(events, requestedId) {
  if (!Array.isArray(events) || !events.length) return null;
  return events.find((event) => event.id === requestedId) || events[0];
}

export function fireHistoryEventCenter(bbox) {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(Number.isFinite)
  )
    return null;
  const [west, south, east, north] = bbox;
  return {
    lon: (west + east) / 2,
    lat: (south + north) / 2,
  };
}
