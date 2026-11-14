import test from 'node:test';
import assert from 'node:assert/strict';
import { createVesselDisplayFilters } from './displayFilters.js';
import { vesselModelCandidate } from './rendering.js';

test('vessel display controls retain the full searchable roster and immediately refresh the map', () => {
  const records = Array.from({ length: 120 }, (_, i) => ({
    mmsi: String(100000000 + i),
    name: `Boat ${String(i).padStart(3, '0')}`,
    type: i % 2 ? 71 : 80,
    speed: i % 2 ? 10 : 0,
    destination: 'Rotterdam',
    imo: 'IMO' + i,
    position: { x: i * 10, y: 0, z: 0 },
    billboard: { show: i % 3 === 0 },
  }));
  const state = {
    records: { all: records },
    selectedRecord: null,
    viewer: {
      camera: {
        positionCartographic: { height: 500000 },
        frustum: { fovy: Math.PI / 3 },
      },
      scene: { canvas: { clientHeight: 900 } },
    },
  };
  let ticks = 0,
    renders = 0,
    changes = 0,
    opened = 0;
  const display = createVesselDisplayFilters({
    vesselState: { state },
    parts: {
      rendering: { getVisual: (r) => r, updateVisibility: () => ticks++ },
    },
    services: { render: { governorRequestRender: () => renders++ } },
  });
  const layer = display.methods;
  layer.setRowControlsListener(() => changes++);
  layer.attachVesselPanel(() => opened++);
  display.prepare();
  assert.ok(records.filter(display.allows).length < 10);
  assert.equal(layer.getVesselList().matching, 120);
  assert.equal(layer.getVesselList().rows.length, 50);
  assert.equal(layer.getVesselList({ page: 2 }).rows.length, 20);
  assert.equal(
    layer.getVesselList({ search: 'IMO119' }).rows[0].id,
    records[119].mmsi,
  );
  assert.equal(layer.getVesselList({ search: 'rotterdam' }).matching, 120);
  layer
    .getRowControls()
    .chips.find((c) => c.id === 'vessel-list')
    .onClick();
  assert.equal(opened, 1);
  layer.setParams(
    layer.getRowControls().chips.find((c) => c.id === 'vessel-underway').params,
  );
  assert.equal(layer.getParams().displayFilters.underwayOnly, true);
  assert.equal(ticks, 1);
  assert.equal(renders, 1);
  assert.equal(changes, 1);
  assert.equal(layer.getVesselList().matching, 60);
  state.selectedRecord = records[0];
  display.prepare();
  assert.equal(display.allows(records[0]), true);
  assert.equal(layer.getVesselList().matching, 61);
  assert.equal(state.records.all.length, 120);
  display.resetVisuals();
  layer.setParams({
    displayFilters: { underwayOnly: false, declutterEnabled: false },
  });
  display.prepare();
  assert.equal(records.filter(display.allows).length, 120);
});

test('3D vessel candidates respect filters immediately and preserve selected contacts', () => {
  const waterline = { x: 3, y: 4, z: 0 };
  const stopped = {
    mmsi: '100000001',
    type: 71,
    speed: 0,
    position: waterline,
  };
  const moving = {
    mmsi: '100000002',
    type: 71,
    speed: 8,
    position: waterline,
  };
  const state = {
    records: { all: [stopped, moving] },
    selectedRecord: null,
    viewer: {
      camera: {
        positionCartographic: { height: 500 },
        frustum: { fovy: Math.PI / 3 },
      },
      scene: { canvas: { clientHeight: 900 } },
    },
  };
  const display = createVesselDisplayFilters({
    vesselState: { state },
    parts: {
      rendering: { getVisual: (record) => record, updateVisibility() {} },
    },
    services: { render: { governorRequestRender() {} } },
  });
  display.set({ underwayOnly: true, declutterEnabled: false });
  display.prepare();
  const cameraPosition = { x: 0, y: 0, z: 0 };
  const modelCandidate = (record, maxDistanceSquared = 100) =>
    vesselModelCandidate(
      record,
      waterline,
      display.allows,
      cameraPosition,
      maxDistanceSquared,
    );

  assert.equal(modelCandidate(stopped), false, 'stopped hull is filtered');
  assert.equal(modelCandidate(moving), true, 'moving hull remains eligible');
  state.selectedRecord = stopped;
  display.prepare();
  assert.equal(modelCandidate(stopped), true, 'selection bypasses filtering');
  assert.equal(modelCandidate(moving, 16), false, 'keep radius still applies');
  assert.equal(
    vesselModelCandidate(moving, null, display.allows, cameraPosition, 100),
    false,
    'missing model position is ineligible',
  );
});
