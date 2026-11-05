import assert from 'node:assert/strict';
import test from 'node:test';
import { createProposal, makeScenarioReceipt, feature } from './03-world-builder.js';

test('proposals reject nonfinite and out-of-bounds locations', () => {
  assert.throws(() => createProposal({ scenario: 'A', type: 'park', lat: Infinity, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'C', type: 'park', lat: 0, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'B', type: 'other', lat: 0, lon: 0 }));
  assert.throws(() => createProposal({ scenario: 'B', type: 'bridge', lat: 0, lon: -181 }));
});

test('receipts distinguish hypothetical branches and never claim modelled outcomes', () => {
  const a = createProposal({ scenario: 'A', type: 'park', lat: 30.26720009, lon: -97.74 });
  const b = createProposal({ scenario: 'B', type: 'cooling-center', lat: 30.26, lon: -97.7 });
  const receipt = makeScenarioReceipt([a, b], '2026-10-16T00:00:00Z');
  assert.equal(receipt.modeledOutcomes, false);
  assert.equal(receipt.scenarios.A[0].lat, 30.2672);
  assert.deepEqual(receipt.scenarios.B, [b]);
  assert.match(receipt.provenance, /hypothetical/);
});
test('world-builder teardown removes handlers and cannot resurrect Cesium markers', () => {
  const elements = [];
  const doc = { body: { append() {} } };
  doc.createElement = (tag) => {
    const handlers = new Map();
    const element = {
      tag, ownerDocument: doc, textContent: '', value: '', style: {}, handlers,
      append() {},
      setAttribute() {},
      addEventListener(event, handler) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event).add(handler);
      },
      removeEventListener(event, handler) {
        handlers.get(event)?.delete(handler);
      },
      fire(event) {
        for (const handler of [...(handlers.get(event) ?? [])]) handler({});
      },
    };
    elements.push(element);
    return element;
  };
  const entities = new Set();
  let renderCalls = 0;
  const viewer = {
    scene: {
      canvas: { clientWidth: 300, clientHeight: 200 },
      requestRender() { renderCalls += 1; },
    },
    camera: { pickEllipsoid() { return {}; } },
    entities: {
      add(options) {
        const entity = { options };
        entities.add(entity);
        return entity;
      },
      remove(entity) { entities.delete(entity); },
    },
  };
  const Cesium = {
    Cartesian2: class {},
    Cartesian3: { fromDegrees() { return {}; } },
    Cartographic: {
      fromCartesian() { return { latitude: 0, longitude: 0 }; },
    },
    Ellipsoid: { WGS84: {} },
    Math: { toDegrees(value) { return value; } },
    Color: { LIME: 1, CYAN: 2, BLACK: 3, WHITE: 4 },
  };
  const dispose = feature.mount({
    root: { ownerDocument: doc, append() {} },
    services: { viewer, Cesium },
  });
  const byText = (label) =>
    elements.find((element) => element.tag === 'button' && element.textContent === label);
  const addButton = byText('Add at crosshair');
  const undoButton = byText('Undo');
  const exportButton = byText('Export JSON');
  const scenarioSelect = elements.find((element) =>
    element.tag === 'select' && element.textContent === '' &&
    element.handlers.has('change'));
  assert.ok(addButton && undoButton && exportButton && scenarioSelect);
  addButton.fire('click');
  assert.equal(entities.size, 1, 'mounted What-if can add a hypothetical marker');
  dispose();
  assert.equal(entities.size, 0, 'teardown removes every Cesium marker');
  for (const [node, event] of [
    [addButton, 'click'], [undoButton, 'click'],
    [exportButton, 'click'], [scenarioSelect, 'change'],
  ]) assert.equal(node.handlers.get(event)?.size, 0, 'teardown releases each mode listener');
  const previousRenders = renderCalls;
  // A detached button may still be held by a queued callback or test handle.
  addButton.fire('click');
  undoButton.fire('click');
  exportButton.fire('click');
  scenarioSelect.fire('change');
  assert.equal(entities.size, 0, 'stale controls cannot revive removed markers');
  assert.equal(renderCalls, previousRenders, 'stale controls cannot render a closed mode');
  dispose();
  assert.equal(renderCalls, previousRenders, 'disposal is idempotent');
});
