/**
 * @module render/cesium/adaptiveResolution
 * @description The scene's pixel ratio at the display's own (a 3x phone
 * draws 3 drawing-buffer pixels per CSS pixel), stepped down while frames
 * run over budget and back up once they have room.
 *
 * Every drawn frame is timed from the one before it. Gaps longer than
 * `GAP_MS` are the idle loop drawing on demand, not load, and start a new
 * run. Once a second (`windowMs`), with at least `MIN_SAMPLES` frames in the
 * window, the median frame time decides:
 *
 * - over `budgetMs × SLOW` (one missed vsync in five at 60 Hz): one step
 *   down the ladder (3 → 2 → 1.5 → 1, from the display's ratio down);
 * - at or under `budgetMs × ROOM` for `upHoldMs` since the last change: one
 *   step back up. A step up that runs slow again doubles the wait before the
 *   next try at that ratio (up to `MAX_HOLD_MS`), so a scene at the edge
 *   does not flip between two ratios every few seconds.
 *
 * A vsync-locked loop cannot run faster than the display, so "room" is
 * "on time", not "well under": the next step is tried and kept or backed
 * off by what it measures. The controller is pure: time comes in through
 * `frame(t)`, the ratio goes out through `onChange`.
 */

/** Pixel ratios tried below the display's, highest first. */
export const RATIO_STEPS = Object.freeze([3, 2, 1.5, 1]);
/** One frame at 60 fps, ms. */
export const FRAME_BUDGET_MS = 1000 / 60;
/** Above this interval between drawn frames the loop was idle, ms. */
export const GAP_MS = 100;
/** Frames a window needs before it decides anything. */
export const MIN_SAMPLES = 20;
/** Median over budget × SLOW steps down (vsync jitter stays under it). */
export const SLOW = 1.2;
/** Median at or under budget × ROOM counts as on time. */
export const ROOM = 1.05;
export const UP_HOLD_MS = 3000;
export const MAX_HOLD_MS = 60000;

/** The ladder for a display ratio: the display's own, then each step below. */
export function ratioLadder(display, steps = RATIO_STEPS) {
  const top = Number.isFinite(display) && display > 0 ? display : 1;
  return [top, ...steps.filter((r) => r < top)];
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {{
 *   display?: () => number,
 *   onChange?: (ratio: number, why: {medianMs: number, from: number}) => void,
 *   budgetMs?: number,
 *   windowMs?: number,
 *   upHoldMs?: number,
 *   steps?: readonly number[],
 * }} [options] `display` is the device's pixel ratio (`devicePixelRatio`).
 */
export function createAdaptiveRatio({
  display = () => globalThis.devicePixelRatio || 1,
  onChange = () => {},
  budgetMs = FRAME_BUDGET_MS,
  windowMs = 1000,
  upHoldMs = UP_HOLD_MS,
  steps = RATIO_STEPS,
} = {}) {
  let shownDisplay = display();
  let ladder = ratioLadder(shownDisplay, steps);
  let index = 0;
  let last = null;
  let windowStart = null;
  let samples = [];
  let changedAt = -Infinity;
  /** Ratio → wait before trying it again after it ran slow, ms. */
  const holdFor = new Map();
  let lastMedian = null;

  function setIndex(next, t, medianMs) {
    const from = ladder[index];
    index = next;
    changedAt = t;
    samples = [];
    windowStart = t;
    onChange(ladder[index], { medianMs, from });
  }

  function decide(t) {
    if (samples.length < MIN_SAMPLES) return;
    const m = median(samples);
    lastMedian = m;
    samples = [];
    windowStart = t;
    if (m > budgetMs * SLOW && index < ladder.length - 1) {
      // The ratio just tried waits longer before its next try.
      const ratio = ladder[index];
      holdFor.set(
        ratio,
        Math.min(MAX_HOLD_MS, (holdFor.get(ratio) ?? upHoldMs / 2) * 2),
      );
      setIndex(index + 1, t, m);
    } else if (m <= budgetMs * ROOM && index > 0) {
      const wait = holdFor.get(ladder[index - 1]) ?? upHoldMs;
      if (t - changedAt >= wait) setIndex(index - 1, t, m);
    }
  }

  return {
    /** The ratio to draw at now. */
    ratio: () => ladder[index],
    /** The latest decided window's median frame time, ms (null before). */
    medianMs: () => lastMedian,
    /** A frame was drawn at `t` ms (performance.now()). */
    frame(t) {
      const d = display();
      if (d !== shownDisplay) {
        // Moved to another screen: start again at its ratio.
        shownDisplay = d;
        ladder = ratioLadder(d, steps);
        holdFor.clear();
        last = null;
        setIndex(0, t, lastMedian ?? 0);
        return;
      }
      if (last === null || t - last > GAP_MS) {
        last = t;
        windowStart ??= t;
        return;
      }
      samples.push(t - last);
      last = t;
      if (t - windowStart >= windowMs) decide(t);
    },
    /** Forget the run (the loop went idle or the setting changed). */
    reset() {
      last = null;
      samples = [];
      windowStart = null;
    },
  };
}
