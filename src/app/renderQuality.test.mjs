import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRenderQuality,
  normalizeRenderQualityName,
  readStoredRenderQuality,
  RENDER_QUALITY_DEFAULT,
  RENDER_QUALITY_PRESETS,
  renderQualityPreset,
  resolveRenderQualityName,
  writeStoredRenderQuality,
} from './renderQuality.js';

function fakeViewer() {
  return { resolutionScale: 1, scene: { msaaSamples: 4 } };
}

test('balanced is the maintainer-requested default while high preserves shipped fidelity', () => {
  assert.equal(RENDER_QUALITY_DEFAULT, 'balanced');
  assert.deepEqual(RENDER_QUALITY_PRESETS.balanced, {
    msaaSamples: 2,
    resolutionScale: 0.85,
    description: 'Balanced fidelity and GPU cost',
  });
  assert.equal(RENDER_QUALITY_PRESETS.high.msaaSamples, 4);
  assert.equal(RENDER_QUALITY_PRESETS.high.resolutionScale, 1);
});

test('valid URL override wins over stored preference', () => {
  assert.equal(
    resolveRenderQualityName({
      search: '?quality=performance',
      stored: 'high',
    }),
    'performance',
  );
});

test('stored preference wins when URL has no valid quality override', () => {
  for (const search of ['', '?foo=bar', '?quality=nonsense', '?quality=']) {
    assert.equal(resolveRenderQualityName({ search, stored: 'high' }), 'high');
  }
});

test('missing or invalid URL and storage fall back to balanced', () => {
  for (const stored of [null, undefined, '', 'nonsense', '__proto__']) {
    assert.equal(
      resolveRenderQualityName({ search: '?quality=nonsense', stored }),
      'balanced',
    );
  }
});

test('names are normalized but prototype keys are rejected', () => {
  assert.equal(normalizeRenderQualityName(' HIGH '), 'high');
  for (const value of ['__proto__', 'constructor', 'toString'])
    assert.equal(normalizeRenderQualityName(value), null);
});

test('storage helpers are best-effort and only persist valid names', () => {
  const state = new Map();
  const storage = {
    getItem: (key) => state.get(key) ?? null,
    setItem: (key, value) => state.set(key, value),
  };
  assert.equal(writeStoredRenderQuality('high', storage), true);
  assert.equal(readStoredRenderQuality(storage), 'high');
  assert.equal(writeStoredRenderQuality('ultra', storage), false);
  assert.equal(readStoredRenderQuality(storage), 'high');

  const unavailable = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readStoredRenderQuality(unavailable), null);
  assert.equal(writeStoredRenderQuality('balanced', unavailable), false);
});

test('every preset applies both Cesium knobs at runtime', () => {
  for (const name of ['performance', 'balanced', 'high']) {
    const viewer = fakeViewer();
    const preset = renderQualityPreset(name);
    assert.equal(applyRenderQuality(viewer, name), preset);
    assert.equal(viewer.scene.msaaSamples, preset.msaaSamples);
    assert.equal(viewer.resolutionScale, preset.resolutionScale);
  }
});

test('unknown application input uses balanced and incomplete viewers fail soft', () => {
  const viewer = fakeViewer();
  assert.equal(
    applyRenderQuality(viewer, 'ultra'),
    RENDER_QUALITY_PRESETS.balanced,
  );
  assert.equal(viewer.scene.msaaSamples, 2);
  assert.equal(viewer.resolutionScale, 0.85);
  assert.equal(applyRenderQuality(null, 'performance'), null);
  assert.equal(applyRenderQuality({}, 'performance'), null);
});
