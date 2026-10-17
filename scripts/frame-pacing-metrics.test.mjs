import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentile, summarizeFrameTrace, compareFrameTraces } from './frame-pacing-metrics.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL('./fixtures/frame-pacing/' + name + '.json', import.meta.url), 'utf8'));

test('nearest-rank percentiles are deterministic; empty samples stay unknown', () => {
  assert.equal(percentile([3, 1, 2, Infinity], 0.5), 2);
  assert.equal(percentile([], 0.95), null);
  assert.throws(() => percentile([1], 1.1), RangeError);
});

test('rAF can report an apparently smooth clock while Cesium drops frames', () => {
  const result = summarizeFrameTrace(fixture('render-starvation'));
  assert.equal(result.valid, true);
  assert.equal(result.sceneFrameIntervalMs.worst, 200);
  assert.equal(result.sceneFrameIntervalMs.p95, 200);
  assert.equal(result.sceneFrameIntervalMs.over100ms, 1);
  assert.equal(result.rafIntervalP95Ms, 16);
  assert.equal(result.longTasksOver50ms, 2);
  assert.equal(result.longTasksOver100ms, 1);
  assert.equal(result.inputToChangedSceneRenderMs.p95, 187);
  assert.equal(result.inputToChangedSceneRenderMs.unmatched, 1);
});

test('idle request-render gaps are not wrongly marked as frame hitches', () => {
  const result = summarizeFrameTrace(fixture('idle'));
  assert.equal(result.valid, true);
  assert.equal(result.sceneFps, 0);
  assert.equal(result.sceneFrameIntervalMs, null);
  assert.equal(result.inputToChangedSceneRenderMs.p95, null);
});

test('zero scene frames during scripted motion invalidate the capture', () => {
  const trace = { ...fixture('idle'), mode: 'motion' };
  const result = summarizeFrameTrace(trace);
  assert.equal(result.valid, false);
  assert.match(result.invalidReason, /motion missing/);
});

test('out-of-order timestamps and events preceding capture never appear healthy', () => {
  const trace = {
    ...fixture('render-starvation'),
    sceneTimestampsMs: [0, 20, 19, 24],
    inputSamples: [{ atMs: 100, firstChangedSceneAtMs: 99 }],
  };
  assert.equal(summarizeFrameTrace(trace).valid, false);
});

test('A/B disallows different resolution, renderer, style, source population, or profile', () => {
  const original = fixture('render-starvation');
  const candidate = structuredClone(original);
  candidate.environment.canvas = '720x450';
  candidate.environment.profile = 'potato';
  candidate.environment.sourceCounts = { flights: 0 };
  const comparison = compareFrameTraces(original, candidate);
  assert.equal(comparison.comparable, false);
  assert.deepEqual(comparison.mismatches, ['canvas', 'sourceCounts', 'profile']);
});

test('matched captures report descriptive deltas without inventing a CI speedup', () => {
  const original = fixture('render-starvation');
  const candidate = structuredClone(original);
  candidate.sceneTimestampsMs = [0, 16, 32, 48, 64, 80];
  const result = compareFrameTraces(original, candidate);
  assert.equal(result.comparable, true);
  assert.equal(result.p95SceneIntervalDeltaMs, -184);
});
