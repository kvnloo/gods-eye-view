/** Pure, platform-independent summary of browser/Cesium frame traces. */

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Report software fallback explicitly; a masked WebGL string is not GPU proof. */
export function isSoftwareRenderer(renderer) {
  return typeof renderer === 'string' &&
    /swiftshader|llvmpipe|softpipe|software|basic render driver|d3d11 warp/i.test(renderer);
}

export function percentile(values, p) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (!finite(p) || p < 0 || p > 1) throw new RangeError('percentile must be 0..1');
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function intervals(timestamps) {
  const result = [];
  let invalid = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (!finite(timestamps[i])) { invalid++; continue; }
    if (i === 0) continue;
    const previous = timestamps[i - 1];
    if (!finite(previous) || timestamps[i] <= previous) {
      invalid++;
      continue;
    }
    result.push(timestamps[i] - previous);
  }
  return { samples: result, invalid };
}

const round = (value) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Invariant: postRender gives *scene-render completion*, NOT displayed pixels.
 * rAF alone cannot prove that Cesium rendered: an idle globe still has rAF.
 * Request-render idle gaps are not stutters, so only evaluate frame interval
 * budgets on explicitly driven motion windows.
 */
export function summarizeFrameTrace(trace) {
  const {
    mode,
    durationMs,
    sceneTimestampsMs = [],
    rafTimestampsMs = [],
    inputSamples = [],
    longTaskDurationsMs = [],
    longAnimationFrameDurationsMs = [],
    cameraChangedFrames = 0,
  } = trace;
  if (!['motion', 'drag', 'idle'].includes(mode)) throw new TypeError('invalid trace mode');
  if (!finite(durationMs) || durationMs <= 0) throw new RangeError('durationMs must be positive');
  const scene = intervals(sceneTimestampsMs);
  const raf = intervals(rafTimestampsMs);
  const latency = [];
  let unmatchedInputs = 0;
  let invalidInputs = 0;
  // Invalid capture times or responses that never occurred on a scene frame
  // must not turn into apparently good percentile measurements.
  const invalidTiming = [...sceneTimestampsMs, ...rafTimestampsMs].filter(
    (ms) => !finite(ms) || ms < 0 || ms > durationMs + 1,
  ).length + [...longTaskDurationsMs, ...longAnimationFrameDurationsMs].filter(
    (ms) => !finite(ms) || ms < 0,
  ).length;
  for (const { atMs, firstChangedSceneAtMs } of inputSamples) {
    if (!finite(atMs) || atMs < 0 || atMs > durationMs + 1) { invalidInputs++; continue; }
    if (firstChangedSceneAtMs == null) { unmatchedInputs++; continue; }
    if (!finite(firstChangedSceneAtMs) || firstChangedSceneAtMs < atMs ||
      !sceneTimestampsMs.some((sceneMs) => finite(sceneMs) && Math.abs(sceneMs - firstChangedSceneAtMs) < 0.5)) {
      invalidInputs++;
      continue;
    }
    latency.push(firstChangedSceneAtMs - atMs);
  }
  const active = mode !== 'idle';
  const sceneP95 = active ? percentile(scene.samples, 0.95) : null;
  const summary = {
    measurement: 'browser-to-Cesium-postRender; not photons, compositor, or GPU busy',
    mode,
    durationMs: round(durationMs),
    sceneFrames: sceneTimestampsMs.length,
    rafTicks: rafTimestampsMs.length,
    sceneFps: round((sceneTimestampsMs.length * 1000) / durationMs),
    rafHz: round((rafTimestampsMs.length * 1000) / durationMs),
    cameraChangedFrames,
    sceneFrameIntervalMs: active ? {
      p50: round(percentile(scene.samples, 0.5)),
      p95: round(sceneP95),
      p99: round(percentile(scene.samples, 0.99)),
      worst: round(scene.samples.length ? Math.max(...scene.samples) : null),
      over33ms: scene.samples.filter((ms) => ms > 33.333).length,
      over50ms: scene.samples.filter((ms) => ms > 50).length,
      over100ms: scene.samples.filter((ms) => ms > 100).length,
    } : null,
    rafIntervalP95Ms: round(percentile(raf.samples, 0.95)),
    longTasksOver50ms: longTaskDurationsMs.filter((ms) => finite(ms) && ms >= 50).length,
    longTasksOver100ms: longTaskDurationsMs.filter((ms) => finite(ms) && ms > 100).length,
    longAnimationFramesOver50ms: longAnimationFrameDurationsMs.filter((ms) => finite(ms) && ms >= 50).length,
    inputToChangedSceneRenderMs: {
      samples: latency.length,
      p50: round(percentile(latency, 0.5)),
      p95: round(percentile(latency, 0.95)),
      worst: round(percentile(latency, 1)),
      unmatched: unmatchedInputs,
    },
    invalidSamples: scene.invalid + raf.invalid + invalidInputs + invalidTiming,
  };
  // Never return a plausible '0 ms' for a renderer that failed to draw.
  const enoughMotion = scene.samples.length >= 2 && cameraChangedFrames >= 1;
  const enoughDrag = mode !== 'drag' || (inputSamples.length > 0 && latency.length > 0);
  summary.valid = summary.invalidSamples === 0 && (!active || enoughMotion) && enoughDrag;
  summary.invalidReason = summary.valid ? null : summary.invalidSamples
    ? 'invalid timestamp/input samples'
    : !enoughMotion && active ? 'motion missing scene frames or changed camera'
    : 'drag missing responsive pointer-to-scene samples';
  return summary;
}

/** Fail closed: an A/B comparison must use the same display/scene cohort. */
export function compareFrameTraces(before, after) {
  const keys = [
    'mode', 'style', 'viewport', 'dpr', 'canvas', 'renderer',
    'softwareRenderer', 'rendererVerified', 'sourceCounts', 'profile', 'userAgent', 'focused',
  ];
  const mismatches = keys.filter((key) =>
    before.environment?.[key] === undefined || after.environment?.[key] === undefined ||
    JSON.stringify(before.environment[key]) !== JSON.stringify(after.environment[key]));
  // Matching displays cannot rescue mismatched sampling windows or missing
  // source populations. In particular null !== a verified zero records.
  if (!before.environment?.rendererVerified || !after.environment?.rendererVerified)
    mismatches.push('unverified renderer');
  if (!before.environment?.focused || !after.environment?.focused)
    mismatches.push('unfocused');
  const unknownPopulation = (env) => Object.values(env?.sourceCounts ?? {}).some(
    (count) => !Number.isFinite(count) || count < 0,
  );
  if (unknownPopulation(before.environment) || unknownPopulation(after.environment))
    mismatches.push('unknown source population');
  if (!finite(before.durationMs) || !finite(after.durationMs) ||
      Math.abs(before.durationMs - after.durationMs) > Math.max(100, 0.05 * Math.max(before.durationMs, after.durationMs)))
    mismatches.push('window duration');
  const b = summarizeFrameTrace(before);
  const a = summarizeFrameTrace(after);
  if (!b.valid || !a.valid) mismatches.push('invalid trace');
  if (mismatches.length) return { comparable: false, mismatches };
  return {
    comparable: true,
    // Lower is better; no generic CI pass/fail threshold for GPU timing.
    p95SceneIntervalDeltaMs: b.sceneFrameIntervalMs && a.sceneFrameIntervalMs
      ? round(a.sceneFrameIntervalMs.p95 - b.sceneFrameIntervalMs.p95)
      : null,
    p95InputToRenderDeltaMs: b.inputToChangedSceneRenderMs.p95 !== null && a.inputToChangedSceneRenderMs.p95 !== null
      ? round(a.inputToChangedSceneRenderMs.p95 - b.inputToChangedSceneRenderMs.p95)
      : null,
  };
}
