import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import {
  getWorldPacket,
  semanticWorldPacketFingerprint,
} from './worldPacket.js';
import { createGevActionRunner } from '../voice/gevActions.js';

function harness() {
  const position = Cesium.Cartesian3.fromDegrees(-97.74, 30.26, 500);
  const viewer = {
    trackedEntity: undefined,
    clock: { onTick: { addEventListener: () => () => {} } },
    scene: {
      canvas: {
        clientWidth: 1200,
        clientHeight: 800,
        addEventListener() {},
        removeEventListener() {},
      },
      globe: { getHeight: () => 0 },
      tweens: [],
    },
    camera: {
      positionWC: position,
      positionCartographic: Cesium.Cartographic.fromCartesian(position),
      heading: 0,
      pitch: Cesium.Math.toRadians(-45),
      moveEnd: { addEventListener: () => () => {} },
      cancelFlight() {},
      lookAtTransform() {},
    },
  };
  const rows = [
    {
      id: 'traffic',
      name: 'Traffic',
      enabled: true,
      stats: {
        count: 3,
        source: 'fixture',
        lastUpdate: null,
      },
    },
  ];
  const dataManager = {
    layers: new Map([['traffic', { module: null }]]),
    getAll: () => rows,
  };
  const styleManager = {
    activeStyle: 'normal',
    getContextModeState: () => ({ mode: 'flights' }),
    getCockpitState: () => null,
    getControlState: () => ({ hud: { visible: 'auto' } }),
  };
  return { viewer, dataManager, styleManager };
}

function withoutVoicePresentation(result) {
  const packet = { ...result };
  delete packet.say;
  delete packet.display;
  delete packet.schedule;
  return packet;
}

test('World Packet preserves get_current_view_state parity', async () => {
  const { viewer, dataManager, styleManager } = harness();
  const packet = getWorldPacket({ viewer, dataManager, styleManager });
  const runner = createGevActionRunner({ viewer, dataManager, styleManager });
  const voice = await runner('get_current_view_state');

  assert.deepEqual(withoutVoicePresentation(voice), packet);
  assert.equal(packet.context.mode, 'contacts');
  assert.equal(packet.context.modeInternal, 'flights');
  assert.equal(packet.layers[0].feedState, 'nominal');
  assert.equal(packet.feedProvenance.overall, 'nominal');
});

test('World Packet keeps stale/unavailable feed semantics distinct from empty', () => {
  const { viewer, dataManager, styleManager } = harness();
  dataManager.getAll = () => [
    {
      id: 'traffic',
      name: 'Traffic',
      enabled: true,
      stats: {
        count: 0,
        source: 'fixture',
        error: 'fixture unavailable',
        lastUpdate: null,
      },
    },
  ];

  const packet = getWorldPacket({ viewer, dataManager, styleManager });
  assert.equal(packet.layers[0].count, 0);
  assert.notEqual(packet.layers[0].feedState, 'nominal');
  assert.notEqual(packet.feedProvenance.overall, 'nominal');
  assert.match(packet.feedProvenance.note, /fixture unavailable/i);
});

test('semantic fingerprint ignores narration prose but changes with observed state', () => {
  const { viewer, dataManager, styleManager } = harness();
  const packet = getWorldPacket({ viewer, dataManager, styleManager });
  const original = semanticWorldPacketFingerprint(packet);

  const proseOnly = structuredClone(packet);
  proseOnly.feedProvenance.note = 'different generated narration';
  assert.equal(semanticWorldPacketFingerprint(proseOnly), original);

  const changed = structuredClone(packet);
  changed.layers[0].count += 1;
  assert.notEqual(semanticWorldPacketFingerprint(changed), original);
});

// The 2026-10 main voice contract omits disabled layers from the model payload.
test('World Packet and voice preserve enabled-only payload and count disabled layers', async () => {
  const { viewer, dataManager, styleManager } = harness();
  const rows = dataManager.getAll();
  rows.push({
    id: 'earthquakes',
    name: 'Earthquakes',
    enabled: false,
    stats: { count: 99, source: 'fixture', error: 'stale' },
  });
  let reads = 0;
  dataManager.getAll = () => {
    reads += 1;
    return rows;
  };
  const packet = getWorldPacket({ viewer, dataManager, styleManager });
  assert.equal(reads, 1, 'collect the roster once rather than repeatedly');
  assert.equal(packet.disabledLayerCount, 1);
  assert.deepEqual(
    packet.layers.map((layer) => layer.id),
    ['traffic'],
  );
  assert.equal(packet.feedProvenance.overall, 'nominal');

  const runner = createGevActionRunner({ viewer, dataManager, styleManager });
  const voice = await runner('get_current_view_state');
  assert.deepEqual(withoutVoicePresentation(voice), packet);
});

test('World Packet fingerprints distinguish enabled state but ignore narrative churn', () => {
  const { viewer, dataManager, styleManager } = harness();
  const first = getWorldPacket({ viewer, dataManager, styleManager });
  const prose = structuredClone(first);
  prose.feedProvenance.note = 'new narration only';
  assert.equal(
    semanticWorldPacketFingerprint(first),
    semanticWorldPacketFingerprint(prose),
  );
  const hidden = structuredClone(first);
  hidden.disabledLayerCount += 1;
  assert.notEqual(
    semanticWorldPacketFingerprint(first),
    semanticWorldPacketFingerprint(hidden),
  );
});

test('fingerprint excludes feed age churn but retains real provenance changes', () => {
  const { viewer, dataManager, styleManager } = harness();
  const packet = getWorldPacket({ viewer, dataManager, styleManager });
  const base = semanticWorldPacketFingerprint(packet);
  const aged = structuredClone(packet);
  aged.feedProvenance.layers[0].ageSec = 300;
  aged.feedProvenance.layers[0].ageLabel = '5 minutes ago';
  assert.equal(semanticWorldPacketFingerprint(aged), base);

  const refreshed = structuredClone(packet);
  refreshed.feedProvenance.layers[0].lastUpdate = 1_730_000_000_000;
  assert.notEqual(semanticWorldPacketFingerprint(refreshed), base);

  const evidenceA = { ...packet, observed: { note: 'supported' } };
  const evidenceB = { ...packet, observed: { note: 'rejected' } };
  assert.notEqual(
    semanticWorldPacketFingerprint(evidenceA),
    semanticWorldPacketFingerprint(evidenceB),
  );
});

test('fingerprint preserves own prototype-like keys and fails closed on exotic data', () => {
  const a = { observed: JSON.parse('{"__proto__":{"kind":"a"}}') };
  const b = { observed: JSON.parse('{"__proto__":{"kind":"b"}}') };
  assert.notEqual(
    semanticWorldPacketFingerprint(a),
    semanticWorldPacketFingerprint(b),
  );
  // Own prototype-like keys at the root and nested values must be data,
  // never keys resolved through a prototype-chain lookup.
  const rootA = JSON.parse('{"__proto__":{"state":"a"}}');
  const rootB = JSON.parse('{"__proto__":{"state":"b"}}');
  assert.notEqual(
    semanticWorldPacketFingerprint(rootA),
    semanticWorldPacketFingerprint(rootB),
  );
  const constructorA = { constructor: { state: 'a' } };
  const constructorB = { constructor: { state: 'b' } };
  assert.notEqual(
    semanticWorldPacketFingerprint(constructorA),
    semanticWorldPacketFingerprint(constructorB),
  );
  assert.throws(
    () => semanticWorldPacketFingerprint({ observed: new Date(0) }),
    /plain-data/,
  );
  assert.throws(
    () => semanticWorldPacketFingerprint({ observed: new Map([['a', 1]]) }),
    /plain-data/,
  );
});

test('null World Packet options give the intended camera error', () => {
  assert.throws(() => getWorldPacket(null), /requires a viewer camera/);
});
