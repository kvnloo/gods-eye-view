import { createHash } from 'node:crypto';
import { greatCircleKm } from '../../src/geoDistance.js';

const DAY = 86400000;
const MAX_EVENTS = 1000;
function validRule(rule, sources) {
  if (!rule || typeof rule.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id) ||
      !Object.hasOwn(sources, rule.source) || typeof rule.enabled !== 'boolean' ||
      !Number.isFinite(rule.lat) || Math.abs(rule.lat) > 90 ||
      !Number.isFinite(rule.lon) || Math.abs(rule.lon) > 180 ||
      !Number.isFinite(rule.radiusKm) || rule.radiusKm <= 0 || rule.radiusKm > 20040 ||
      (rule.source === 'firms'
        ? !Number.isFinite(rule.minFrp) || rule.minFrp < 0
        : !Number.isFinite(rule.minMagnitude) || rule.minMagnitude < 2.5 || rule.minMagnitude > 10) ||
      !Number.isFinite(rule.maxAgeMs) || rule.maxAgeMs <= 0 || rule.maxAgeMs > DAY ||
      !Number.isFinite(rule.cooldownMs) || rule.cooldownMs < 0 || rule.cooldownMs > 7 * DAY)
    throw new TypeError('Invalid watch rule');
  if (rule.quietHours && (!Number.isInteger(rule.quietHours.start) || rule.quietHours.start < 0 || rule.quietHours.start > 23 || !Number.isInteger(rule.quietHours.end) || rule.quietHours.end < 0 || rule.quietHours.end > 23 || rule.quietHours.start === rule.quietHours.end))
    throw new TypeError('Quiet hours require distinct UTC hours 0–23');
  return { id: rule.id, source: rule.source, enabled: rule.enabled, lat: rule.lat, lon: rule.lon, radiusKm: rule.radiusKm, ...(rule.source === 'firms' ? { minFrp: rule.minFrp } : { minMagnitude: rule.minMagnitude }), maxAgeMs: rule.maxAgeMs, cooldownMs: rule.cooldownMs, ...(rule.quietHours ? { quietHours: { ...rule.quietHours } } : {}) };
}
function quiet(rule, now) {
  if (!rule.quietHours) return false;
  const h = new Date(now).getUTCHours();
  const { start, end } = rule.quietHours;
  return start < end ? h >= start && h < end : h >= start || h < end;
}
function eligible(event, rule, now) {
  return typeof event?.id === 'string' && event.id.length > 0 && event.id.length <= 256 &&
    Number.isFinite(event.observedAt) && event.observedAt <= now && now - event.observedAt <= rule.maxAgeMs &&
    Number.isFinite(event.lat) && Math.abs(event.lat) <= 90 && Number.isFinite(event.lon) && Math.abs(event.lon) <= 180 &&
    (rule.source === 'firms' ? Number.isFinite(event.frp) && event.frp >= rule.minFrp : Number.isFinite(event.magnitude) && event.magnitude >= rule.minMagnitude) && greatCircleKm(event, rule) <= rule.radiusKm;
}
function publicEvent(event, rule, now) {
  const url = new URL(event.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('Invalid source link');
  return { id: createHash('sha256').update(`${rule.id}\0${event.id}`).digest('hex'), ruleId: rule.id, source: String(event.source).slice(0, 80), sourceId: event.id, observedAt: event.observedAt, lat: event.lat, lon: event.lon, ...(rule.source === 'firms' ? { frp: event.frp, confidence: event.confidence ?? null } : { magnitude: event.magnitude }), title: String(event.title || 'Hazard observation').slice(0, 240), url: url.href, matchedAt: now, deliveredAt: null, status: 'queued', attempts: 0, nextAttemptAt: now };
}

/** Node-only watch owner. Sources and notification transport are explicit dependencies. */
export async function createWatchRuntime({ rules, sources, notifier, store, now = Date.now }) {
  if (!Array.isArray(rules) || rules.length > 100 || !notifier?.send || !store?.load || !sources)
    throw new TypeError('Watch runtime requires bounded rules, sources, notifier and store');
  const configured = rules.map((r) => validRule(r, sources));
  if (new Set(configured.map((r) => r.id)).size !== configured.length) throw new TypeError('Duplicate rule ID');
  for (const source of Object.values(sources)) {
    if (typeof source.getSnapshot !== 'function' || !Number.isFinite(source.intervalMs) || source.intervalMs < 1000)
      throw new TypeError('Source requires explicit cadence');
  }
  let state;
  try {
    const saved = await store.load();
    if (saved && (saved.version !== 1 || !Array.isArray(saved.rules) || !Array.isArray(saved.events) || saved.events.length > MAX_EVENTS || !saved.sources || !saved.lastDelivered))
      throw new Error('Invalid persisted watch state');
    state = saved || { version: 1, rules: configured, events: [], sources: {}, lastDelivered: {} };
    // Config owns rule definitions; persisted pause is preserved for unchanged IDs.
    state.rules = configured.map((r) => ({ ...r, enabled: saved?.rules.find((s) => s.id === r.id)?.enabled ?? r.enabled }));
    for (const e of state.events) if (e.status === 'sending') e.status = 'uncertain';
    await store.save(state);
  } catch (error) { await store.close(); throw error; }
  let serial = Promise.resolve();
  let closed = false;
  const abort = new AbortController();
  const enqueue = (fn) => {
    if (closed) return Promise.reject(new Error('Watch runtime closed'));
    const pending = serial.then(fn);
    serial = pending.catch(() => {});
    return pending;
  };
  async function cycle() {
    const time = now();
    for (const id of new Set(state.rules.filter((r) => r.enabled).map((r) => r.source))) {
      if (abort.signal.aborted) return;
      const previous = state.sources[id];
      if (previous && time - previous.lastAttemptAt < sources[id].intervalMs) continue;
      state.sources[id] = { ...previous, lastAttemptAt: time, status: 'loading' };
      try {
        const rows = await sources[id].getSnapshot({ signal: abort.signal });
        if (!Array.isArray(rows)) throw new Error('Invalid source snapshot');
        state.sources[id] = { status: 'current', lastAttemptAt: time, lastSuccessAt: now() };
        for (const rule of state.rules.filter((r) => r.enabled && r.source === id)) {
          for (const row of rows) {
            if (!eligible(row, rule, now())) continue;
            let event;
            try { event = publicEvent(row, rule, now()); } catch { continue; }
            if (!state.events.some((e) => e.id === event.id)) {
              if (state.events.length >= MAX_EVENTS) {
                const removable = state.events.findIndex((e) => ['delivered', 'expired'].includes(e.status) && now() - e.observedAt > 7 * DAY);
                if (removable < 0) { state.sources[id].status = 'capacity-limited'; break; }
                state.events.splice(removable, 1);
              }
              state.events.push(event);
            }
          }
        }
      } catch {
        state.sources[id] = { ...state.sources[id], status: 'unavailable' };
      }
    }
    await store.save(state);
    for (const event of state.events) {
      if (abort.signal.aborted) return;
      if (!['queued', 'retry'].includes(event.status)) continue;
      const rule = state.rules.find((r) => r.id === event.ruleId);
      if (!rule?.enabled || quiet(rule, now()) || event.nextAttemptAt > now()) continue;
      if (now() - event.observedAt > rule.maxAgeMs) { event.status = 'expired'; continue; }
      if (now() - (state.lastDelivered[rule.id] ?? -Infinity) < rule.cooldownMs) continue;
      event.status = 'sending';
      event.attempts++;
      await store.save(state);
      try {
        const severity = rule.source === 'firms' ? `FRP ${event.frp} MW (detection, not perimeter)` : `M${event.magnitude}`;
        await notifier.send({ id: event.id, title: `GEV watch: ${event.title}`, message: `${event.source} ${severity} · ${new Date(event.observedAt).toISOString()} · matched ${rule.id} within ${rule.radiusKm} km. Observation only, not an emergency warning.`, url: event.url, signal: abort.signal });
        event.status = 'delivered';
        event.deliveredAt = now();
        state.lastDelivered[rule.id] = now();
      } catch (error) {
        event.status = error.retryable === true && event.attempts < 5 ? 'retry' : 'uncertain';
        event.nextAttemptAt = now() + Math.min(3600000, 60000 * 2 ** (event.attempts - 1));
      }
      await store.save(state);
    }
    await store.save(state);
  }
  return {
    tick: () => enqueue(cycle),
    getState: () => structuredClone({ tier: 'watch', rules: state.rules, events: [...state.events].reverse(), sources: state.sources }),
    setRuleEnabled: (id, enabled) => enqueue(async () => {
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
      const rule = state.rules.find((r) => r.id === id);
      if (!rule) throw new Error('Unknown watch');
      rule.enabled = enabled;
      await store.save(state);
      return { id, enabled };
    }),
    async close() {
      if (closed) return;
      closed = true;
      abort.abort();
      await serial;
      await store.close();
    },
  };
}
