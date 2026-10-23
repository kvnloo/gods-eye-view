import test from 'node:test';
import assert from 'node:assert/strict';
import { Surface, View } from '@stencil-hq/tern';
import { buildSurfaceView } from './view.mjs';
import { normalizeSnapshot } from './projection.mjs';

const data = normalizeSnapshot({
  type: 'snapshot',
  change: 'selection',
  capturedAt: 2000,
  camera: { latitude: 40.1, longitude: -88.1, heightM: 1200, heading: 0, pitch: -45 },
  selected: { id: 'plane-1', name: 'Plane 1', layerId: 'flights', source: 'ADS-B', updatedAt: 1000 },
  layers: [
    { id: 'flights', name: 'Flights', enabled: true, feedState: 'stale', count: 1, source: 'ADS-B', lastUpdate: 1000 },
  ],
}, 2500);

function allTrees(tree, acc = []) {
  if (!tree) return acc;
  acc.push(tree);
  for (const child of tree.children) allTrees(child, acc);
  return acc;
}

test('negotiated kind set is respected; keys remain stable across refreshed snapshots', () => {
  const minimal = { kinds: ['col', 'text'], features: [] };
  const first = View.from(buildSurfaceView(data, {}, minimal));
  assert.equal(first.regions[1], undefined);
  assert.equal(first.regions[2], undefined);
  assert.ok(allTrees(first.regions[0]).every((node) => minimal.kinds.includes(node.kind)));
  const firstIds = allTrees(first.regions[0]).map((node) => node.id);
  assert.ok(firstIds.includes('main.selection'));
  assert.ok(firstIds.some((id) => id.includes('feed:flights')));
  const second = View.from(
    buildSurfaceView({ ...data, change: 'camera', camera: { ...data.camera, heightM: 900 } }, {}, minimal),
  );
  const secondIds = allTrees(second.regions[0]).map((node) => node.id);
  assert.deepEqual(secondIds, firstIds);
  assert.throws(() => buildSurfaceView(null, {}, { kinds: ['text'], features: [] }), /minimum/);
});

test('dock and help layer require terminal capabilities, not requested program features', () => {
  const nodes = ['col', 'text', 'card', 'el'];
  const rich = buildSurfaceView(data, { help: true }, { kinds: nodes, features: ['dock', 'aside'] });
  const view = View.from(rich);
  assert.ok(view.regions[1]);
  assert.ok(view.regions[2]);
  assert.ok(allTrees(view.regions[1]).some((node) => node.kind === 'el'));
  const noDock = View.from(buildSurfaceView(data, { help: true }, { kinds: nodes, features: [] }));
  assert.equal(noDock.regions[1], undefined);
  assert.equal(noDock.regions[2], undefined);
  assert.ok(allTrees(noDock.regions[0]).some((node) => node.id === 'main.help-content'));
});

test('native controls only invoke local read-only callbacks', async () => {
  let refreshed = 0;
  let paused = 0;
  let help = 0;
  const calls = { onRefresh: () => refreshed++, onTogglePause: () => paused++, onHelp: () => help++ };
  const inputs = buildSurfaceView(data, calls, {
    kinds: ['col', 'text', 'card', 'el'],
    features: ['dock'],
  });
  const writes = [];
  const surface = new Surface(
    { send: (out) => writes.push(out), credits: () => 2, dropped() {} },
    'gev',
    { mode: 'inline' },
  );
  surface.render(inputs);
  for (const id of ['dock.refresh', 'dock.pause', 'dock.help']) {
    const action = surface.dispatch({ ev: 'action', sf: 'gev', id, act: 'click' });
    assert.equal(typeof action, 'function', id);
    await action();
  }
  assert.deepEqual([refreshed, paused, help], [1, 1, 1]);
  assert.ok(writes.some((msg) => msg.verb === 'f'));
  await surface.close({ keep: false });
});

test('SDK frame credit blocks bursts and coalesces to the newest stable tree', async () => {
  const writes = [];
  const surface = new Surface(
    { send: (message) => writes.push(message), credits: () => 1, dropped() {} },
    'gev',
    { mode: 'inline' },
  );
  const caps = { kinds: ['col', 'text'], features: [] };
  surface.render(buildSurfaceView({ ...data, change: 'one' }, {}, caps));
  assert.equal(surface.seq, 1);
  assert.equal(surface.blocked, true);
  for (let i = 0; i < 15; i += 1)
    surface.render(buildSurfaceView({ ...data, change: 'burst-' + i }, {}, caps));
  assert.equal(surface.seq, 1);
  assert.equal(writes.filter((x) => x.verb === 'f').length, 1);
  surface.acknowledge(1);
  assert.equal(surface.seq, 2);
  assert.equal(writes.filter((x) => x.verb === 'f').length, 2);
  assert.match(JSON.stringify(writes.at(-1)), /burst-14/);
  assert.ok(!JSON.stringify(writes.at(-1)).includes('burst-13'));
  await surface.close({ keep: false });
});
