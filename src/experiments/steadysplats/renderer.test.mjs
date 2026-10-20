import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND,
  createDemoGaussians,
  createSteadySplatsExperiment,
  gaussianAlpha,
  psnr,
  rayColorVariance,
} from './renderer.js';

test('Gaussian alpha and color-variance regularizer are finite and bounded', () => {
  const red = { x: 0, y: 0, sx: 4, sy: 4, opacity: 0.7, depth: 1, color: [1, 0, 0] };
  const twin = { ...red, depth: 2 };
  assert.equal(gaussianAlpha(red, 0, 0), 0.7);
  assert.equal(gaussianAlpha(red, 100, 100), 0);
  assert.equal(rayColorVariance([red, twin], 0, 0), 0);
  assert.ok(rayColorVariance([red, { ...twin, color: [0, 1, 0] }], 0, 0) > 0);
  assert.equal(rayColorVariance([], 0, 0), 0);
});

test('one-sample stochastic alpha visibility converges to sorted blend', () => {
  const red = { x: 0.5, y: 0.5, sx: 1e5, sy: 1e5, opacity: 0.6, depth: 1, color: [1, 0, 0] };
  const green = { ...red, opacity: 0.5, depth: 2, color: [0, 1, 0] };
  const lab = createSteadySplatsExperiment({ width: 1, height: 1, gaussians: [green, red], historySize: 1 });
  const sum = [0, 0, 0];
  let reference;
  for (let frame = 0; frame < 4096; frame++) {
    const result = lab.render({ frame, temporalWeight: 0 });
    reference = result.reference;
    for (let c = 0; c < 3; c++) sum[c] += result.raw[c];
  }
  for (let c = 0; c < 3; c++) {
    const expected = [0.6 + 0.2 * BACKGROUND[0], 0.2 + 0.2 * BACKGROUND[1], 0.2 * BACKGROUND[2]][c];
    assert.ok(Math.abs(reference[c] - expected) < 1e-6, 'sorted reference channel ' + c);
    assert.ok(Math.abs(sum[c] / 4096 - expected) < 0.035, 'stochastic mean channel ' + c);
  }
});

test('identical seed and camera path give deterministic output', () => {
  const options = { width: 32, height: 24, historySize: 4, seed: 13 };
  const a = createSteadySplatsExperiment(options);
  const b = createSteadySplatsExperiment(options);
  for (let frame = 0; frame < 8; frame++) {
    const args = { frame, cameraX: frame * 0.4 };
    const left = a.render(args);
    const right = b.render(args);
    assert.deepEqual(left.raw, right.raw);
    assert.deepEqual(left.spatial, right.spatial);
    assert.deepEqual(left.output, right.output);
  }
});

test('history is bounded, resets, and frame buffers have expected shape', () => {
  const lab = createSteadySplatsExperiment({ width: 24, height: 16, historySize: 4 });
  for (let frame = 0; frame < 12; frame++) {
    const result = lab.render({ frame });
    for (const name of ['raw', 'spatial', 'output', 'reference']) {
      assert.equal(result[name].length, 24 * 16 * 3);
      assert.ok(result[name].every(Number.isFinite));
    }
    assert.ok(lab.getHistoryLength() <= 3);
  }
  lab.reset();
  assert.equal(lab.getHistoryLength(), 0);
});

test('K-history spatial and temporal reuse reduce static-scene error', () => {
  const lab = createSteadySplatsExperiment({ width: 96, height: 72, historySize: 4 });
  let raw = 0;
  let spatial = 0;
  let temporal = 0;
  for (let frame = 0; frame < 12; frame++) {
    const { scores } = lab.render({ frame });
    raw += scores.raw;
    spatial += scores.spatial;
    temporal += scores.temporal;
  }
  assert.ok(spatial > raw + 5, 'importance spatial reuse must beat raw stochastic sampling');
  assert.ok(temporal > spatial + 0.5, 'reprojected history must improve static scene');
});

test('large camera jump does not leak stale pixels', () => {
  const lab = createSteadySplatsExperiment({ width: 32, height: 24 });
  lab.render({ frame: 1, cameraX: 0 });
  const result = lab.render({ frame: 2, cameraX: 10000 });
  assert.deepEqual(result.output, result.spatial);
  assert.deepEqual(result.reference, result.spatial);
});

test('empty scene is background and bad configuration fails closed', () => {
  const lab = createSteadySplatsExperiment({ width: 4, height: 3, gaussians: [] });
  const result = lab.render({ frame: 0 });
  assert.deepEqual(result.output, result.reference);
  assert.deepEqual(Array.from(result.raw.slice(0, 3)), Array.from(result.reference.slice(0, 3)));
  assert.equal(psnr(result.raw, result.reference), Infinity);
  assert.throws(() => psnr(new Float32Array(1), new Float32Array(2)), RangeError);
  assert.throws(() => createSteadySplatsExperiment({ historySize: 0 }), RangeError);
  assert.throws(() => createSteadySplatsExperiment({ width: -1 }), RangeError);
  assert.throws(() => createSteadySplatsExperiment({ gaussians: [{ x: 0 }] }), TypeError);
  assert.throws(() => lab.render({ temporalWeight: 3 }), RangeError);
  assert.equal(createDemoGaussians().length, 8);
});
