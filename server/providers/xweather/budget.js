import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { normalizeBudget, utcMonthKey } from '../../../src/data/tileBudget.js';

/** Xweather's free Maps allowance, in map units per month. */
export const XWEATHER_FREE_MONTHLY_UNITS = 15_000;

/**
 * Monthly Xweather spend, counted from `x-cost-tokens` on each billed
 * response and persisted so restarts do not reset it. Before uncached work,
 * the proxy reserves estimated source-tile units against the local monthly
 * allowance; explicit paid-overage opt-in bypasses this limit.
 *
 * Writes are debounced 1s after `record()`. Each flush re-reads the file and
 * merges in only this process's own unflushed delta (a read-modify-write),
 * so multiple processes sharing one file add up instead of one clobbering
 * the other's units, except that two flushes overlapping exactly can lose
 * one delta (there is no lock between the read and the write). Within one
 * process, flushes are serialized onto a single chain, so a slow write can
 * never settle after, and overwrite, a later one. Units are attributed to
 * the month in which they are flushed (at most ~1s after they are recorded),
 * so a few units recorded right at a month boundary can land in the next
 * month's count.
 *
 * @param {object} options
 * @param {string} options.file - Path to the persisted `{date, count}` JSON.
 * @param {number} [options.allowance] - Free monthly units before `over`.
 * @param {() => number} [options.now] - Clock, for tests.
 * @param {typeof import('node:fs/promises')} [options.fs] - Injected fs.
 * @returns {{record(response: Response): void, snapshot(): Promise<{month:string, used:number, allowance:number, over:boolean}>, reserve(units: number, options?: {allowOverage?: boolean}): Promise<(() => void)|null>}}
 */
export function createXweatherBudget({
  file,
  allowance = XWEATHER_FREE_MONTHLY_UNITS,
  now = Date.now,
  fs = fsPromises,
}) {
  // {date, count} for the file as last observed by this process, refreshed
  // by every successful flush and by the one-time bootstrap read in
  // snapshot(). Never assumed current across a flush cycle: doFlush() always
  // re-reads before merging.
  let lastKnownFileCount = null;
  let pending = 0;
  // In-flight compositions must not independently spend the same allowance.
  const reservations = new Map(); // UTC month -> reserved source-tile units
  let timer = null;
  // Serializes flushes onto a single chain so at most one writeFile is ever
  // in flight; a flush queued behind a slow one starts only once it settles.
  let flushing = Promise.resolve();

  async function readFileState(month) {
    let raw = null;
    try {
      const text = await fs.readFile(file, 'utf8');
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const normalized = normalizeBudget(raw, month);
    lastKnownFileCount = normalized;
    return normalized;
  }

  async function doFlush() {
    const delta = pending;
    const month = utcMonthKey(now());
    const fileState = await readFileState(month);
    const nextState = { date: month, count: fileState.count + delta };
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(nextState));
      lastKnownFileCount = nextState;
      pending -= delta;
    } catch {
      // Counting continues in memory: `delta` stays pending (never
      // subtracted), so the next flush retries with the full total.
    }
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushing = flushing.then(doFlush).catch(() => {});
    }, 1000);
    timer.unref?.();
  }

  return {
    record(response) {
      const raw = response.headers.get('x-cost-tokens');
      const cost = raw === null ? NaN : Number(raw);
      pending += Number.isFinite(cost) && cost >= 0 ? cost : 1;
      scheduleFlush();
    },
    async snapshot() {
      const month = utcMonthKey(now());
      if (lastKnownFileCount === null) {
        // Route the bootstrap read through the same serialized chain as
        // flushes: reading directly here could interleave with an
        // in-flight flush's own read+write and, resolving later with
        // stale (pre-write) file state, clobber the count the flush just
        // established. Queued behind the chain, it runs only once
        // everything ahead of it has settled, and only reads at all if
        // nothing already set the count by then.
        flushing = flushing
          .then(async () => {
            if (lastKnownFileCount === null) await readFileState(month);
          })
          .catch(() => {});
        await flushing;
      }
      const used = normalizeBudget(lastKnownFileCount, month).count + pending;
      return { month, used, allowance, over: used > allowance };
    },
    async reserve(units, { allowOverage = false } = {}) {
      if (!Number.isSafeInteger(units) || units < 0)
        throw new RangeError('invalid Xweather budget reservation');
      if (allowOverage || units === 0) return () => {};
      // After the asynchronous bootstrap, the check and hold are synchronous:
      // two concurrent clients cannot both reserve the remaining units.
      const { month, used, allowance } = await this.snapshot();
      const held = reservations.get(month) ?? 0;
      if (used + held + units > allowance) return null;
      reservations.set(month, held + units);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (reservations.get(month) ?? 0) - units;
        if (remaining > 0) reservations.set(month, remaining);
        else reservations.delete(month);
      };
    },
  };
}
