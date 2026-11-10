import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocale, setLocale } from '../i18n/index.js';
import {
  createCommandPalette,
  isPaletteShortcut,
  paletteCommandLabel,
} from './commandPalette.js';

function fixture(run = async () => ({ ok: true })) {
  let layers = [
    {
      id: 'earthquakes',
      name: 'Earthquakes (24h)',
      source: 'USGS',
      enabled: false,
    },
    { id: 'cctv', name: 'CCTV', source: 'Cameras', enabled: true },
    { id: 'private-layer', name: 'Private', enabled: false },
    {
      id: 'military-awareness',
      name: 'Global Context',
      showInTogglePanel: false,
    },
  ];
  let view;
  const calls = [];
  const controller = createCommandPalette({
    getLayers: () => layers,
    run: (...args) => {
      calls.push(args);
      return run(...args);
    },
    publish: (next) => {
      view = next;
    },
  });
  return {
    controller,
    calls,
    get view() {
      return view;
    },
    set layers(next) {
      layers = next;
    },
  };
}

test('palette searches commands and live supported layers without changing layer ownership', async () => {
  const f = fixture();
  f.controller.open();
  f.controller.setQuery('USGS');
  assert.equal(f.view.results.length, 1);
  assert.equal(f.view.results[0].action.name, 'set_layer_visibility');
  assert.deepEqual(f.view.results[0].action.args, {
    layerId: 'earthquakes',
    enabled: true,
  });
  await f.controller.execute();
  assert.equal(f.view.open, false);
  assert.deepEqual(f.calls[0].slice(0, 2), [
    'set_layer_visibility',
    { layerId: 'earthquakes', enabled: true },
  ]);
  f.controller.open();
  f.controller.setQuery('Private');
  assert.equal(f.view.results.length, 0);
  f.controller.setQuery('Open Cameras');
  await f.controller.execute();
  assert.deepEqual(f.calls[1].slice(0, 2), [
    'set_panel_open',
    { panelId: 'cctv-panel', open: true },
  ]);
});

test('selection wraps, resets after search, and empty results never execute', async () => {
  const f = fixture();
  f.controller.open();
  f.controller.move(-1);
  assert.equal(f.view.selected, f.view.results.length - 1);
  f.controller.move(1);
  assert.equal(f.view.selected, 0);
  f.controller.setQuery('no such command');
  f.controller.move(1);
  await f.controller.execute();
  assert.equal(f.calls.length, 0);
  assert.equal(f.view.selected, -1);
  f.controller.setQuery('thermal');
  assert.equal(f.view.selected, 0);
  assert.equal(f.view.results[0].id, 'style-thermal');
});

test('duplicate activation and close/reopen cannot reissue an in-flight action or steal dismissal', async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.controller.open();
  f.controller.setQuery('Open Cameras');
  const pending = f.controller.execute();
  assert.equal(f.view.pending, true);
  await f.controller.execute();
  f.controller.close();
  f.controller.open();
  await f.controller.execute();
  assert.equal(f.calls.length, 1);
  finish({ ok: true });
  await pending;
  assert.equal(
    f.view.open,
    true,
    'completion from a prior opening must not close the new dialog',
  );
  assert.equal(f.view.pending, false);
});

test('failures stay visible, never claim success, and can be retried', async () => {
  let fail = true;
  const f = fixture(async () =>
    fail ? { ok: false, error: 'Provider unavailable' } : { ok: true },
  );
  f.controller.open();
  await f.controller.execute();
  assert.equal(f.view.open, true);
  assert.ok(f.view.error);
  assert.equal(f.view.pending, false);
  fail = false;
  await f.controller.execute();
  assert.equal(f.view.open, false);
});

test('thrown errors are visible and teardown aborts execution and ignores late completion', async () => {
  const f = fixture(() => {
    throw new Error('network');
  });
  f.controller.open();
  await f.controller.execute();
  assert.ok(f.view.error);
  let finish;
  const g = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  g.controller.open();
  const pending = g.controller.execute();
  g.controller.destroy();
  g.controller.destroy();
  assert.equal(g.calls[0][2].signal.aborted, true);
  const view = g.view;
  finish({ ok: true });
  await pending;
  g.controller.open();
  assert.equal(g.view, view);
});

test('layer actions retain the advertised target state and reject removed layers', async () => {
  const f = fixture();
  f.controller.open();
  f.controller.setQuery('USGS');
  f.layers = [{ id: 'earthquakes', name: 'Earthquakes (24h)', enabled: true }];
  await f.controller.execute();
  assert.equal(
    f.calls[0][1].enabled,
    true,
    'a stale Enable result must not turn an enabled layer off',
  );
  f.controller.open();
  f.controller.setQuery('earthquakes');
  f.layers = [];
  await f.controller.execute();
  assert.equal(f.calls.length, 1);
  assert.ok(f.view.error);
});

test('translated command and layer queries match the active language', () => {
  const previous = getLocale();
  try {
    setLocale('es');
    const f = fixture();
    f.controller.open();
    f.controller.setQuery('Abrir cámaras');
    assert.equal(f.view.results[0].id, 'open-cameras');
    setLocale('ru');
    f.controller.setQuery('тепловой');
    assert.equal(f.view.results[0].id, 'style-thermal');
    f.controller.destroy();
  } finally {
    setLocale(previous);
  }
});

test('P belongs to the palette only outside editing, modifiers, composition and held keys', () => {
  const event = { key: 'p', target: { closest: () => null } };
  assert.equal(isPaletteShortcut(event), true);
  assert.equal(isPaletteShortcut({ ...event, key: 'P' }), true);
  for (const flag of [
    'ctrlKey',
    'metaKey',
    'altKey',
    'repeat',
    'isComposing',
    'defaultPrevented',
  ]) {
    assert.equal(isPaletteShortcut({ ...event, [flag]: true }), false, flag);
  }
  assert.equal(
    isPaletteShortcut({ ...event, target: { closest: () => ({}) } }),
    false,
  );
  assert.equal(isPaletteShortcut({ ...event, key: 'k', ctrlKey: true }), false);
});

test('reopening a pending failure keeps its query and advertised command together', async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.controller.open();
  f.controller.setQuery('Open Cameras');
  const pending = f.controller.execute();
  f.controller.close();
  f.controller.open();
  assert.equal(f.view.query, 'Open Cameras');
  assert.equal(f.view.results[0].id, 'open-cameras');
  finish({ ok: false });
  await pending;
  assert.equal(f.view.open, true);
  assert.ok(f.view.error);
  assert.equal(f.view.query, 'Open Cameras');
});

test('layer labels remain message keys for search and interpolate only at presentation', () => {
  const previous = getLocale();
  try {
    setLocale('es');
    const f = fixture();
    f.controller.open();
    f.controller.setQuery('USGS');
    assert.equal(f.view.results[0].label, 'Earthquakes (24h)');
    assert.ok(paletteCommandLabel(f.view.results[0]).startsWith('Activar '));
    const shown = paletteCommandLabel(f.view.results[0]);
    f.controller.setQuery(shown);
    assert.equal(f.view.results[0].id, 'layer:earthquakes');
  } finally {
    setLocale(previous);
  }
});
