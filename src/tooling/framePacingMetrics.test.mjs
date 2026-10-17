import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentile, summarizeFrameTrace, compareFrameTraces } from '../../scripts/frame-pacing-metrics.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL('../../scripts/fixtures/frame-pacing/' + name + '.json', import.meta.url), 'utf8'));

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
  candidate.sceneTimestampsMs = Array.from({ length: 20 }, (_, i) => i * 16);
  candidate.inputSamples[0].firstChangedSceneAtMs = 48;
  candidate.inputSamples[1].firstChangedSceneAtMs = 256;
  const result = compareFrameTraces(original, candidate);
  assert.equal(result.comparable, true);
  assert.equal(result.p95SceneIntervalDeltaMs, -184);
});

test('pointerless drag cannot pass on unrelated scene motion', () => {
  const trace = { ...fixture('render-starvation'), mode: 'drag', inputSamples: [] };
  const result = summarizeFrameTrace(trace);
  assert.equal(result.valid, false);
  assert.match(result.invalidReason, /drag missing/);
});

test('drag input matched to a changed postRender is measurable, not photons', () => {
  const trace = { ...fixture('render-starvation'), mode: 'drag' };
  const result = summarizeFrameTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.inputToChangedSceneRenderMs.p95, 187);
  assert.match(result.measurement, /not photons/);
});

test('A/B refuses missing focus and browser identity even when both are absent', () => {
  const before = fixture('render-starvation');
  const after = structuredClone(before);
  delete before.environment.focused;
  delete after.environment.focused;
  delete before.environment.userAgent;
  delete after.environment.userAgent;
  assert.deepEqual(compareFrameTraces(before, after).mismatches, ['userAgent', 'focused', 'unfocused']);
});

test('A/B rejects different measurement windows even with matched display and source', () => {
  const a = fixture('render-starvation');
  const b = structuredClone(a);
  b.durationMs = 5000;
  assert.equal(compareFrameTraces(a, b).comparable, false);
  assert.ok(compareFrameTraces(a, b).mismatches.includes('window duration'));
});

test('A/B rejects unverified renderer and unfocused runs', () => {
  const a = fixture('render-starvation');
  const b = structuredClone(a);
  a.environment.rendererVerified = false;
  b.environment.rendererVerified = false;
  a.environment.focused = false;
  b.environment.focused = false;
  const r = compareFrameTraces(a, b);
  assert.equal(r.comparable, false);
  assert.ok(r.mismatches.includes('unverified renderer'));
  assert.ok(r.mismatches.includes('unfocused'));
});

test('A/B never calls unknown enabled-layer populations equivalent', () => {
  const a = fixture('render-starvation');
  const b = structuredClone(a);
  a.environment.sourceCounts = { vessels: null };
  b.environment.sourceCounts = { vessels: null };
  const r = compareFrameTraces(a, b);
  assert.equal(r.comparable, false);
  assert.ok(r.mismatches.includes('unknown source population'));
});

test('timestamps outside the trace and impossible input responses invalidate a capture', () => {
  const a = fixture('render-starvation');
  a.sceneTimestampsMs = [0, 16, 1010];
  assert.equal(summarizeFrameTrace(a).valid, false);
  const b = fixture('render-starvation');
  b.inputSamples[0].firstChangedSceneAtMs = 345;
  assert.equal(summarizeFrameTrace(b).valid, false);
});

test('software WARP, SwiftShader, llvmpipe fail hardware identity classification', async () => {
  const { isSoftwareRenderer } = await import('../../scripts/frame-pacing-metrics.mjs');
  for (const renderer of ['ANGLE (Microsoft Basic Render Driver, D3D11 WARP)', 'Google SwiftShader', 'Mesa llvmpipe', 'Software Rasterizer'])
    assert.equal(isSoftwareRenderer(renderer), true, renderer);
  assert.equal(isSoftwareRenderer('ANGLE (NVIDIA GeForce RTX 3080 Ti Direct3D11)'), false);
});

test('terminal render starvation remains visible when completed intervals look smooth', () => {
  const stalled = fixture('render-starvation');
  stalled.sceneTimestampsMs = [0, 16, 32];
  stalled.cameraChangedFrames = 2;
  const summary = summarizeFrameTrace(stalled);
  assert.equal(summary.sceneFrameIntervalMs.p95, 16);
  assert.equal(summary.sceneFrameIntervalMs.unfinishedTailMs, 968);
  assert.equal(summary.sceneFrameIntervalMs.worstObservedGapMs, 968);
  assert.equal(summary.sceneFrameIntervalMs.unresolvedTailOver100ms, true);
});

test('large performance traces do not overflow Math.max argument limits', () => {
  const timestamps = Array.from({ length: 150000 }, (_, i) => i * 16);
  const trace = {
    mode: 'motion',
    durationMs: 150000 * 16,
    sceneTimestampsMs: timestamps,
    rafTimestampsMs: [],
    cameraChangedFrames: 1,
  };
  const s = summarizeFrameTrace(trace);
  assert.equal(s.valid, true);
  assert.equal(s.sceneFrameIntervalMs.worst, 16);
  assert.equal(s.sceneFrameIntervalMs.worstObservedGapMs, 16);
});
