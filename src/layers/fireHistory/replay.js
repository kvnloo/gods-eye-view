/**
 * Historic Fires replay clock.
 *
 * Original replay design and event-time semantics: @lleon-at-navteca, upstream
 * #609. This recut is intentionally pure: no Cesium, DOM, row chips, network,
 * storage or animation-loop ownership.
 */

export const FIRE_REPLAY_BASE_HOURS_PER_SECOND = 6;
export const FIRE_REPLAY_SPEEDS = Object.freeze([0.5, 1, 2, 4]);
export const FIRE_REPLAY_ACTIVE_WINDOW_MS = 12 * 3600_000;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function utcDayMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
    ? ms
    : NaN;
}

export function fireReplayEventRange(event) {
  const directStart = Number(event?.startMs);
  const directEnd = Number(event?.endMs);
  if (
    Number.isFinite(directStart) &&
    Number.isFinite(directEnd) &&
    directEnd > directStart
  )
    return { startMs: directStart, endMs: directEnd };

  const startMs = utcDayMs(event?.startDate);
  const endDayMs = utcDayMs(event?.endDate);
  return Number.isFinite(startMs) &&
    Number.isFinite(endDayMs) &&
    endDayMs >= startMs
    ? { startMs, endMs: endDayMs + DAY_MS }
    : { startMs: NaN, endMs: NaN };
}

const freeze = (state) => (state ? Object.freeze(state) : state);

export function createFireReplayState(event, speed = 1) {
  const { startMs, endMs } = fireReplayEventRange(event);
  if (!(endMs > startMs)) return null;
  return freeze({
    status: 'idle',
    cursorMs: startMs,
    speed: FIRE_REPLAY_SPEEDS.includes(speed) ? speed : 1,
    startMs,
    endMs,
  });
}

export function advanceFireReplay(state, elapsedMs) {
  if (!state || state.status !== 'playing') return state;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const eventMs =
    (elapsed / 1000) *
    FIRE_REPLAY_BASE_HOURS_PER_SECOND *
    HOUR_MS *
    state.speed;
  const cursorMs = state.cursorMs + eventMs;
  if (cursorMs >= state.endMs)
    return freeze({ ...state, cursorMs: state.endMs, status: 'ended' });
  return freeze({ ...state, cursorMs });
}

export function playFireReplay(state) {
  if (!state) return state;
  const restart = state.status === 'idle' || state.status === 'ended';
  return freeze({
    ...state,
    status: 'playing',
    cursorMs: restart ? state.startMs : state.cursorMs,
  });
}

export function pauseFireReplay(state) {
  return state?.status === 'playing'
    ? freeze({ ...state, status: 'paused' })
    : state;
}

export function resetFireReplay(state) {
  return state
    ? freeze({ ...state, status: 'idle', cursorMs: state.startMs })
    : state;
}

export function seekFireReplay(state, fraction) {
  if (!state) return state;
  const value = Number(fraction);
  const bounded = Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
  const cursorMs = state.startMs + (state.endMs - state.startMs) * bounded;
  const status =
    state.status === 'idle' || state.status === 'ended'
      ? 'paused'
      : state.status;
  return freeze({ ...state, cursorMs, status });
}

export function cycleFireReplaySpeed(speed) {
  const index = FIRE_REPLAY_SPEEDS.indexOf(speed);
  return FIRE_REPLAY_SPEEDS[(index + 1) % FIRE_REPLAY_SPEEDS.length];
}

export function setFireReplaySpeed(state, speed) {
  return state && FIRE_REPLAY_SPEEDS.includes(speed)
    ? freeze({ ...state, speed })
    : state;
}

export function fireReplayActive(state) {
  return Boolean(state) && state.status !== 'idle';
}

export function fireDetectionPhase(
  record,
  cursorMs,
  activeMs = FIRE_REPLAY_ACTIVE_WINDOW_MS,
) {
  const acquired = Number(record?.acqMs);
  if (!Number.isFinite(acquired) || !Number.isFinite(cursorMs))
    return 'pending';
  if (acquired > cursorMs) return 'pending';
  return cursorMs - acquired < activeMs ? 'active' : 'cooled';
}

/**
 * Count sorted acquired records visible at a replay cursor.
 * Malformed acquisition times never inflate the visible/active totals.
 */
export function fireReplayCounts(
  records,
  cursorMs,
  activeMs = FIRE_REPLAY_ACTIVE_WINDOW_MS,
) {
  let shown = 0;
  let active = 0;
  for (const record of records || []) {
    const acquired = Number(record?.acqMs);
    if (!Number.isFinite(acquired)) continue;
    if (acquired > cursorMs) break;
    shown += 1;
    if (cursorMs - acquired < activeMs) active += 1;
  }
  return { shown, active };
}

export function formatFireReplayClock(ms) {
  if (!Number.isFinite(ms)) return '';
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

export function fireReplayLabel(state) {
  if (!fireReplayActive(state)) return '';
  const verb =
    state.status === 'playing'
      ? 'REPLAY'
      : state.status === 'paused'
        ? 'PAUSED'
        : 'REPLAY END';
  return `${verb} · ${formatFireReplayClock(state.cursorMs)} · ${state.speed}×`;
}
