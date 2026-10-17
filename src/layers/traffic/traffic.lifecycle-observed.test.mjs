// Scope: actual lifecycle disable/destroy + observed owner; no Cesium drawing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycle } from './lifecycle.js';
import { createObservedTraffic, emptyObservedTrafficSnapshot } from './observed.js';

function fixture() {
  const calls = { roadsCancelled: 0, clearedDots: 0, flowReset: 0, releases: 0, observedReads: 0 };
  const pending = [];
  const notifications = [];
  const state = {
    _enabled: true, _loadGeneration: 0,
    _pointCollection: { show: true }, _tileCache: new Map(),
    _observedTrafficSnapshot: emptyObservedTrafficSnapshot(),
    _observedTrafficGeneration: 0, _observedTrafficLoading: false,
    _observedTrafficListeners: new Set(),
  };
  const observed = createObservedTraffic({ state, observedSource: {
    request() { calls.observedReads += 1; return new Promise((resolve) => pending.push(resolve)); },
  } });
  const parts = {
    observed,
    ingestion: { cancelActiveFetch() { calls.roadsCancelled += 1; } },
    animation: { clearDots() { calls.clearedDots += 1; } },
    viewport: { onCameraChanged() {} },
    rendering: { removeHeatLines() {} },
  };
  observed.methods.subscribeObservedTraffic?.((snapshot) => notifications.push(snapshot.state));
  const lifecycle = createLifecycle({ state, parts, services: {
    render: { holdContinuousRender() {}, releaseContinuousRender() { calls.releases += 1; } },
  }, source: { resetFlowTileCache() { calls.flowReset += 1; } } });
  const viewer = { camera: { changed: { removeEventListener() {} } }, scene: { primitives: { remove() {} } } };
  return { state, parts, observed, calls, pending, notifications, lifecycle, viewer };
}
const snapshot = () => ({ ...emptyObservedTrafficSnapshot(), configured: true, state: 'fresh', records: [{ id: 'synthetic' }] });

test('disable clears the previously published observed snapshot', async () => {
  const f = fixture();
  const request = f.observed.methods.refreshObservedTraffic();
  f.pending[0](snapshot()); await request;
  assert.equal(f.observed.methods.getObservedTrafficSnapshot().state, 'fresh');
  f.lifecycle.methods.disable(f.viewer);
  assert.equal(f.observed.methods.getObservedTrafficSnapshot().state, 'unconfigured');
  assert.equal(f.state._observedTrafficLoading, false);
  assert.equal(f.calls.observedReads, 1, 'reset starts no producer request');
});

test('late observed completion cannot republish after disable', async () => {
  const f = fixture();
  const request = f.observed.methods.refreshObservedTraffic();
  f.lifecycle.methods.disable(f.viewer);
  f.pending[0](snapshot()); await request;
  assert.equal(f.observed.methods.getObservedTrafficSnapshot().state, 'unconfigured');
  assert.equal(f.state._observedTrafficLoading, false);
  assert.ok(!f.notifications.includes('fresh'));
});

test('destroy clears evidence while preserving ordinary teardown', async () => {
  const f = fixture();
  const request = f.observed.methods.refreshObservedTraffic();
  f.pending[0](snapshot()); await request;
  f.lifecycle.methods.destroy(f.viewer);
  assert.equal(f.observed.methods.getObservedTrafficSnapshot().state, 'unconfigured');
  assert.equal(f.state._pointCollection, null);
  assert.equal(f.calls.flowReset, 1);
  assert.equal(f.calls.roadsCancelled, 1);
  assert.equal(f.calls.clearedDots, 1);
});

test('CCTV subscribers receive reset rather than retaining the old observation', async () => {
  const f = fixture();
  assert.equal(typeof f.observed.methods.subscribeObservedTraffic, 'function');
  const request = f.observed.methods.refreshObservedTraffic();
  f.pending[0](snapshot()); await request;
  f.lifecycle.methods.disable(f.viewer);
  assert.deepEqual(f.notifications, ['unconfigured', 'fresh', 'unconfigured']);
});

test('the optional observed part does not change a legacy Traffic teardown', () => {
  const f = fixture();
  delete f.parts.observed;
  f.lifecycle.methods.disable(f.viewer);
  assert.equal(f.calls.roadsCancelled, 1);
  assert.equal(f.calls.clearedDots, 1);
  assert.equal(f.calls.releases, 1);
  assert.equal(f.state._enabled, false);
});
