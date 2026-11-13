import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createSSRApp, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { useCommunityPlanningStore } from '../stores/communityPlanning.js';
import { useGlobeActionsStore } from '../stores/globeActions.js';
import CommunityPlanningPreview from './panels/CommunityPlanningPreview.vue';
import GlobeActions from './panels/GlobeActions.vue';
import { presentCityWalkAccess } from '../cityWalkAccess.js';

const conceptLabel = 'AI concept, not a plan or an approval';
const parameters = {
  kind: 'park',
  trees: 12,
  widthMeters: 3,
  shadePercent: 40,
};

function cityState(started = false) {
  return {
    projectTitle: started ? 'Community project' : null,
    reference: started
      ? {
          image: 'data:image/png;base64,BASELINE',
          capturedAt: '2026-11-10T12:00:00Z',
          camera: {},
          bounds: [0, 0, 1, 1],
          sources: [],
        }
      : null,
    alternatives: started
      ? ['park-a', 'park-b'].map((id, index) => ({
          id,
          title: `Possible world ${index + 1}`,
          description: `Description ${index + 1}`,
          parameters: { ...parameters },
          revision: 2,
          versionCount: 2,
          concept: {
            image: `data:image/png;base64,CONCEPT${index}`,
            provider: 'fixture',
            generatedAt: '2026-11-10T12:01:00Z',
            prompt: `Illustrate possibility ${index + 1}`,
          },
          history: [
            {
              revision: 1,
              title: 'Earlier world',
              description: 'Earlier description',
              parameters: { ...parameters, trees: 8 },
            },
          ],
        }))
      : [],
    editor: {
      projectTitle: 'Community project',
      id: null,
      parentRevision: null,
      title: 'A greener street',
      description: 'Add trees and places to sit',
      parameters: { ...parameters },
    },
    pending: false,
    status: null,
    error: null,
    provider: 'fixture',
    canLocal: true,
    persisted: false,
  };
}

function presentation(city) {
  return {
    title: 'City builder',
    intro: 'Explore possible worlds from the current view.',
    localOnly: 'Local project',
    sources: city.reference ? ['Baseline source attribution'] : [],
    compareNote: '',
    recordSummary: '',
    inspect: [],
    cards: city.alternatives.map((alternative) => ({
      ...alternative,
      label: alternative.title,
      hidden: false,
      author: '',
      edit: '',
      plotLabel: 'Hypothetical arrangement',
      markers: [],
      features: '',
      impact: '',
      approval: '',
      assumptions: [],
    })),
    mode: 'co-op',
    modeStatus: '',
    status: '',
    gameDisabled: false,
    city,
  };
}

async function mount(t, city = cityState()) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useCommunityPlanningStore(pinia);
  const globe = useGlobeActionsStore(pinia);
  const calls = [];
  const controls = Object.fromEntries(
    [
      'start',
      'editField',
      'saveAlternative',
      'editAlternative',
      'newAlternative',
      'restoreRevision',
      'importFile',
      'exportFile',
      'setProvider',
      'imagine',
      'setMode',
      'inspect',
    ].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  controls.open = () => {
    calls.push(['open']);
    store.publish(presentation(city));
  };
  controls.close = () => {
    calls.push(['close']);
    store.publish(null);
  };
  store.connect(controls);
  const app = createApp({
    render: () => h('div', [h(GlobeActions), h(CommunityPlanningPreview)]),
  }).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const settle = async () => {
    await nextTick();
    await nextTick();
  };
  const input = (selector, value, event = 'input') => {
    const element = $(selector);
    element.value = value;
    element.dispatchEvent(new Event(event, { bubbles: true }));
  };
  const open = async () => {
    store.offerLauncher({ label: 'Owner scene launcher' });
    await settle();
    $('[data-city-builder-open]').click();
    await settle();
  };
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('The UI must not request concept generation');
  });
  return { store, globe, city, calls, $, $$, settle, input, open, fetch };
}

test('the top-center launcher follows the planning store without changing globe actions', async (t) => {
  const { store, globe, calls, $, settle, fetch } = await mount(t);
  assert.equal($('[data-city-builder-open]'), null);
  const globeCalls = [];
  globe.connect(
    Object.fromEntries(
      ['clear', 'share', 'tilt', 'northUp', 'reset'].map((name) => [
        name,
        () => globeCalls.push(name),
      ]),
    ),
  );
  store.offerLauncher({ label: 'Owner scene launcher' });
  await settle();
  assert.equal(
    $('#top-center-actions [data-city-builder-open]').textContent,
    'City builder',
  );
  assert.equal(
    $('[data-community-planning-preview-open]').textContent,
    'Owner scene launcher',
  );
  for (const selector of [
    '#clear-selected-layers',
    '#share-btn',
    '#tilt-map-view',
    '#reset-globe-view',
  ])
    $(selector).click();
  assert.deepEqual(globeCalls, ['clear', 'share', 'tilt', 'reset']);
  assert.deepEqual(calls, []);
  $('[data-city-builder-open]').click();
  await settle();
  assert.ok($('[data-city-builder-editor]'));
  assert.deepEqual(calls, [['open']]);
  store.offerLauncher(null);
  await settle();
  assert.equal($('[data-city-builder-open]'), null);
  assert.equal(fetch.mock.callCount(), 0);
});

test('only city previews expand the dialog to a responsive 1200px width', async () => {
  // happy-dom drops CSS min() values, so inspect Vue's rendered style text.
  for (const [hasCity, width] of [
    [true, 1200],
    [false, 900],
  ]) {
    const pinia = createPinia();
    const view = presentation(cityState());
    if (!hasCity) delete view.city;
    useCommunityPlanningStore(pinia).publish(view);
    const context = {};
    await renderToString(
      createSSRApp(CommunityPlanningPreview).use(pinia),
      context,
    );
    assert.match(
      context.teleports.body,
      new RegExp(`width:min\\(${width}px,calc\\(100vw - 32px\\)\\)`),
    );
  }
});

test('an empty project forwards its title and start action without creating alternatives or concepts', async (t) => {
  const { city, store, calls, $, $$, settle, input, open, fetch } =
    await mount(t);
  await open();
  const dialog = $('dialog');
  assert.equal(dialog.open, true);
  assert.equal(document.activeElement, dialog.querySelector('h2'));
  assert.equal($('#city-builder-project-title').value, 'Community project');
  assert.equal($$('[data-alternative-id]').length, 0);
  assert.equal($('[data-city-builder-reference]'), null);
  assert.equal($('[data-city-builder-save]'), null);
  assert.equal($('[data-city-builder-export]').disabled, true);
  input('#city-builder-project-title', 'Our neighborhood');
  assert.equal(
    city.editor.projectTitle,
    'Community project',
    'only the owner changes the model',
  );
  city.editor.projectTitle = 'Our neighborhood';
  store.publish(presentation(city));
  await settle();
  $('[data-city-builder-start]').click();
  await settle();
  assert.deepEqual(calls, [
    ['open'],
    ['editField', 'projectTitle', 'Our neighborhood'],
    ['start', { title: 'Our neighborhood' }],
  ]);
  assert.match($('[data-city-builder-fixture]').textContent, /sample image/);
  assert.equal(calls.filter(([name]) => name === 'imagine').length, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('baseline and every concept stay separate, labeled, and retain source provenance', async (t) => {
  const { city, $, $$, open, calls, fetch } = await mount(t, cityState(true));
  await open();
  assert.equal(
    $('[data-city-builder-reference] img').getAttribute('src'),
    city.reference.image,
  );
  assert.deepEqual(
    $$('[data-planning-concept] img').map((image) => image.getAttribute('src')),
    city.alternatives.map((alternative) => alternative.concept.image),
  );
  assert.deepEqual(
    $$('[data-planning-concept] figcaption').map(
      (caption) => caption.textContent,
    ),
    [conceptLabel, conceptLabel],
  );
  assert.ok(
    $$('[data-planning-concept] img').every(
      (image) => image.alt === conceptLabel,
    ),
  );
  assert.deepEqual(
    $$('[data-planning-description]').map((node) => node.textContent),
    ['Description 1', 'Description 2'],
  );
  assert.equal(
    $('[data-planning-source-provenance]').textContent,
    'Baseline source attribution',
  );
  assert.match(
    $('[data-city-builder-alternative="park-a"]').textContent,
    /Earlier description/,
  );
  assert.match(
    $('[data-planning-concept]').textContent,
    /Illustrate possibility 1/,
  );
  assert.match(
    $('[data-city-builder-persistence]').textContent,
    /Export to keep a copy/,
  );
  for (const field of $$(
    '[data-city-builder-editor] input, [data-city-builder-editor] textarea, [data-city-builder-editor] select',
  )) {
    assert.ok(
      field.id && document.querySelector(`label[for="${field.id}"]`),
      `accessible label for ${field.id}`,
    );
  }
  assert.deepEqual(calls, [['open']]);
  assert.equal(fetch.mock.callCount(), 0);
});

test('edits, versions, files, and provider changes only forward to the owner; Imagine is explicit', async (t) => {
  const { city, store, calls, $, settle, input, open, fetch } = await mount(
    t,
    cityState(true),
  );
  const before = JSON.stringify(city);
  await open();
  input('#city-builder-title', 'Shared shade');
  input('#city-builder-description', 'More trees');
  input('#city-builder-kind', 'bike-lane', 'change');
  input('#city-builder-trees', '25');
  input('#city-builder-width', '4.5');
  input('#city-builder-shade', '65');
  $('[data-city-builder-save]').click();
  $('[data-city-builder-new]').click();
  $(
    '[data-city-builder-alternative="park-b"] [data-city-builder-edit]',
  ).click();
  $(
    '[data-city-builder-alternative="park-b"] [data-city-builder-restore]',
  ).click();
  input('#city-builder-provider', 'local', 'change');
  $('[data-city-builder-export]').click();
  const file = new File(['{}'], 'project.json', { type: 'application/json' });
  const picker = $('#city-builder-import');
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(picker.value, '', 'the same file can be selected again');
  Object.defineProperty(picker, 'files', { configurable: true, value: [] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(calls, [
    ['open'],
    ['editField', 'title', 'Shared shade'],
    ['editField', 'description', 'More trees'],
    ['editField', 'kind', 'bike-lane'],
    ['editField', 'trees', '25'],
    ['editField', 'widthMeters', '4.5'],
    ['editField', 'shadePercent', '65'],
    ['saveAlternative'],
    ['newAlternative'],
    ['editAlternative', 'park-b'],
    ['restoreRevision', 'park-b', 1],
    ['setProvider', 'local'],
    ['exportFile'],
    ['importFile', file],
  ]);
  assert.equal(
    JSON.stringify(city),
    before,
    'the component does not mutate owner state',
  );
  assert.equal(
    $('#city-builder-kind').value,
    'park',
    'select follows the unchanged owner value',
  );
  store.publish(
    presentation({
      ...city,
      editor: { ...city.editor, title: 'Owner revision' },
    }),
  );
  await settle();
  assert.equal($('#city-builder-title').value, 'Owner revision');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(calls.filter(([name]) => name === 'imagine').length, 0);
  const imagineSelector =
    '[data-city-builder-alternative="park-b"] [data-city-builder-imagine]';
  assert.equal($(imagineSelector).disabled, true);
  $(imagineSelector).click();
  assert.equal(calls.filter(([name]) => name === 'imagine').length, 0);
  store.publish(
    presentation({
      ...city,
      alternatives: city.alternatives.map((a) =>
        a.id === 'park-b' ? { ...a, revision: 3, concept: null } : a,
      ),
    }),
  );
  await settle();
  assert.equal($(imagineSelector).disabled, false);
  $(imagineSelector).click();
  assert.deepEqual(calls.at(-1), ['imagine', 'park-b']);
  assert.equal(calls.filter(([name]) => name === 'imagine').length, 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test('pending, local capability, persistence, status, and errors follow the owner', async (t) => {
  const city = {
    ...cityState(true),
    pending: true,
    canLocal: false,
    persisted: true,
    status: 'Saving project',
    error: 'Storage is unavailable',
  };
  const { $, $$, open, calls } = await mount(t, city);
  await open();
  assert.equal(
    $('[data-city-builder-editor]').getAttribute('aria-busy'),
    'true',
  );
  assert.ok(
    $$('[data-city-builder-editor] fieldset').every(
      (fieldset) => fieldset.disabled,
    ),
  );
  assert.ok(
    $$('[data-city-builder-editor] button').every((button) => button.disabled),
  );
  assert.equal($('#city-builder-import').disabled, true);
  assert.equal($('#city-builder-provider').disabled, true);
  assert.equal(
    $('#city-builder-provider option[value="local"]').disabled,
    true,
  );
  assert.match(
    $('[data-city-builder-persistence]').textContent,
    /Project saved on this device/,
  );
  assert.equal(
    $('[data-city-builder-editor] [role="alert"]').textContent,
    'Storage is unavailable',
  );
  assert.ok(
    $$('[data-city-builder-editor] [role="status"]').some(
      (node) => node.textContent === 'Saving project',
    ),
  );
  $('[data-city-builder-imagine]').click();
  assert.deepEqual(calls, [['open']]);
});

test('native dialog cancellation and Cancel preserve the existing focus behavior', async (t) => {
  const { $, open, settle, calls } = await mount(t);
  await open();
  const cancel = new Event('cancel', { cancelable: true });
  $('dialog').dispatchEvent(cancel);
  await settle();
  assert.equal(cancel.defaultPrevented, true);
  assert.equal($('dialog'), null);
  assert.equal(
    document.activeElement,
    $('[data-community-planning-preview-open]'),
  );
  $('[data-community-planning-preview-open]').click();
  await settle();
  assert.equal(document.activeElement, $('dialog h2'));
  $('[data-planning-cancel]').click();
  await settle();
  assert.equal($('dialog'), null);
  assert.deepEqual(calls, [['open'], ['close'], ['open'], ['close']]);
});

test('the comparison shows walk access for the baseline and each alternative; Site forwards to the owner', async (t) => {
  const city = cityState(true);
  city.alternatives[0].parameters = { ...parameters, site: 'site-b' };
  city.alternatives[1].parameters = { ...parameters, site: null };
  city.access = presentCityWalkAccess(city.alternatives);
  const { calls, $, $$, open, input, fetch } = await mount(t, city);
  await open();
  assert.deepEqual(
    $$('[data-city-access-row]').map((row) => [
      row.dataset.cityAccessRow,
      row.dataset.cityAccessState,
    ]),
    [
      ['baseline', 'evaluated'],
      ['park-a', 'evaluated'],
      ['park-b', 'unknown'],
    ],
  );
  assert.match($('[data-city-access-label]').textContent, /HYPOTHETICAL/);
  assert.match($('[data-city-access-network]').textContent, /synthetic/);
  const cell = (id, name) =>
    $(`[data-city-access-row="${id}"] [data-city-access-${name}]`).textContent;
  assert.equal(cell('baseline', 'mean'), '432 m');
  assert.equal(cell('park-a', 'worst'), '480 m');
  assert.match(cell('park-a', 'delta'), /−201 m/);
  assert.match(cell('park-b', 'note'), /choose a site/);
  assert.deepEqual(
    $$('[data-city-access-map]').map((map) => map.dataset.cityAccessMap),
    ['baseline', 'park-a'],
  );
  assert.equal(
    $$('[data-city-access-map="park-a"] rect[fill="#d5b67b"]').length,
    1,
  );
  // The access comparison comes before the cards, beside the baseline.
  assert.ok(
    $('[data-city-access]').compareDocumentPosition(
      $('[data-planning-alternatives]'),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.deepEqual(
    Array.from($('#city-builder-site').options, (o) => [
      o.value,
      o.textContent,
    ]),
    [
      ['', 'Not placed on the map'],
      ['site-a', 'Site A'],
      ['site-b', 'Site B'],
      ['site-c', 'Site C'],
      ['site-d', 'Site D'],
    ],
  );
  input('#city-builder-site', 'site-c', 'change');
  assert.deepEqual(calls.at(-1), ['editField', 'site', 'site-c']);
  assert.match(
    $('[data-city-builder-alternative="park-a"]').textContent,
    /Not placed on the map/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});
