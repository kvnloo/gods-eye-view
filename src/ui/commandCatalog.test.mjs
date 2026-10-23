import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMAND_CATALOG,
  createCommandCatalog,
  searchCommandCatalog,
} from './commandCatalog.js';
import { getLocale, setLocale } from '../i18n/index.js';

test('default commands are schema-valid typed actions with unique ids', () => {
  assert.ok(DEFAULT_COMMAND_CATALOG.length >= 10);
  assert.equal(
    new Set(DEFAULT_COMMAND_CATALOG.map(({ id }) => id)).size,
    DEFAULT_COMMAND_CATALOG.length,
  );
  assert.ok(
    DEFAULT_COMMAND_CATALOG.every(({ action }) => action?.name && action?.args),
  );
});

test('catalog rejects actions or arguments that are not in the canonical schema', () => {
  assert.throws(
    () =>
      createCommandCatalog([
        {
          id: 'made-up',
          label: 'Made Up',
          group: 'Test',
          keywords: [],
          action: { name: 'does_not_exist', args: {} },
        },
      ]),
    /Unknown command action/,
  );

  assert.deepEqual(
    createCommandCatalog([
      {
        id: 'open-weather',
        label: 'Open Weather',
        group: 'Panels',
        keywords: ['weather'],
        action: {
          name: 'set_panel_open',
          args: { panelId: 'weather-panel', open: true },
        },
      },
    ])[0].action.args,
    { panelId: 'weather-panel', open: true },
    'weather-panel is now a supported typed action',
  );

  assert.throws(
    () =>
      createCommandCatalog([
        {
          id: 'invalid-panel',
          label: 'Invalid Panel',
          group: 'Panels',
          keywords: [],
          action: {
            name: 'set_panel_open',
            args: { panelId: 'no-such-panel', open: true },
          },
        },
      ]),
    /schema enum/,
    'unknown panel ids still fail before execution',
  );

  assert.throws(
    () =>
      createCommandCatalog([
        {
          id: 'bad-panel-args',
          label: 'Bad Panel Args',
          group: 'Panels',
          keywords: [],
          action: {
            name: 'set_panel_open',
            args: { panelId: 'cctv-panel' },
          },
        },
      ]),
    /missing required open/,
  );
});

test('search ranks exact and label-prefix matches ahead of keyword-only matches', () => {
  const catalog = createCommandCatalog();
  assert.equal(
    searchCommandCatalog(catalog, 'open cameras')[0].id,
    'open-cameras',
  );
  assert.equal(searchCommandCatalog(catalog, 'thermal')[0].id, 'style-thermal');
  assert.equal(searchCommandCatalog(catalog, 'weather')[0].id, 'open-weather');
  assert.equal(
    searchCommandCatalog(catalog, 'missions')[0].id,
    'space-missions-context',
  );
});

test('multi-token search requires every token and stays deterministic', () => {
  const catalog = createCommandCatalog();
  assert.deepEqual(
    searchCommandCatalog(catalog, 'camera panel').map(({ id }) => id),
    ['open-cameras'],
  );
  assert.deepEqual(searchCommandCatalog(catalog, 'does not exist'), []);
  assert.deepEqual(
    searchCommandCatalog(catalog, '', { limit: 2 }).map(({ id }) => id),
    ['open-data-layers', 'open-cameras'],
  );
});

test('catalog metadata cannot mutate the canonical action schema', () => {
  const catalog = createCommandCatalog();
  assert.throws(() => {
    catalog[0].action.args.open = false;
  }, TypeError);
});

function reviewCommand(name, args, overrides = {}) {
  return {
    id: 'review-probe',
    label: 'Review Probe',
    group: 'Test',
    keywords: [],
    action: { name, args },
    ...overrides,
  };
}

test('real action schema alternatives and string constraints fail closed', () => {
  assert.throws(
    () => createCommandCatalog([reviewCommand('track_entity', {})]),
    /schema alternative/,
    'track_entity needs a query or referent',
  );
  assert.throws(
    () => createCommandCatalog([reviewCommand('track_entity', { query: '' })]),
    /schema minimum/,
  );
  assert.throws(
    () => createCommandCatalog([reviewCommand('track_entity', { query: '   ' })]),
    /schema pattern/,
  );
  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('track_entity', { query: '   ', referent: 1 }),
      ]),
    /schema pattern/,
    'an allowed alternative cannot bypass an invalid supplied property',
  );
  assert.doesNotThrow(() =>
    createCommandCatalog([reviewCommand('track_entity', { query: 'aircraft' })]),
  );
  assert.doesNotThrow(() =>
    createCommandCatalog([reviewCommand('track_entity', { referent: 1 })]),
  );

  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('control_radio', {
          action: 'select',
          stationQuery: 'a'.repeat(500),
        }),
      ]),
    /schema maximum/,
    'radio stationQuery is limited to 120 characters',
  );
  assert.doesNotThrow(() =>
    createCommandCatalog([
      reviewCommand('control_radio', {
        action: 'select',
        stationQuery: '🚀'.repeat(120),
      }),
    ]),
  );

  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('next_satellite_pass', { target: '' }),
      ]),
    /schema minimum/,
  );
  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('next_satellite_pass', { target: 'x'.repeat(121) }),
      ]),
    /schema maximum/,
  );
  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('annotate_map', {
          annotations: [{ type: 'pin', target: 'x'.repeat(201) }],
        }),
      ]),
    /schema maximum/,
    'string limits apply inside typed action arrays',
  );
});

test('catalog rejects non-string human metadata without coercing labels', () => {
  for (const label of [42, {}]) {
    assert.throws(
      () =>
        createCommandCatalog([
          reviewCommand('stop_tracking', {}, { label }),
        ]),
      /required/,
    );
  }
  assert.throws(
    () =>
      createCommandCatalog([
        reviewCommand('stop_tracking', {}, { keywords: [23] }),
      ]),
    /bounded text/,
  );
});

test('search caps query work and clamps zero limits without changing defaults', () => {
  const catalog = createCommandCatalog();
  assert.equal(searchCommandCatalog(catalog, '').length, 10);
  assert.deepEqual(
    searchCommandCatalog(catalog, '', { limit: 0 }).map(({ id }) => id),
    ['open-data-layers'],
  );
  assert.deepEqual(
    searchCommandCatalog(catalog, '', { limit: -3 }).map(({ id }) => id),
    ['open-data-layers'],
  );
  assert.equal(
    searchCommandCatalog(catalog, '', { limit: 500 }).length,
    catalog.length,
  );
  assert.deepEqual(searchCommandCatalog(catalog, 'thermal '.repeat(60)), []);
});

test('catalog search matches active translations and still matches source text', () => {
  const previous = getLocale();
  const catalog = createCommandCatalog();
  try {
    setLocale('es');
    assert.equal(
      searchCommandCatalog(catalog, 'Abrir cámaras')[0].id,
      'open-cameras',
    );
    assert.equal(
      searchCommandCatalog(catalog, 'open cameras')[0].id,
      'open-cameras',
    );
    setLocale('ru');
    assert.equal(
      searchCommandCatalog(catalog, 'тепловой')[0].id,
      'style-thermal',
    );
    assert.equal(
      searchCommandCatalog(catalog, 'thermal')[0].id,
      'style-thermal',
    );
  } finally {
    setLocale(previous);
  }
});
