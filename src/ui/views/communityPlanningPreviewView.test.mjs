// src/ui/views/communityPlanningPreviewView.test.mjs — the Scene panel renders
// the planning preview launcher and comparison the owner presents, and sends
// clicks back to it.
import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { mountCommunityPlanningPreview } from '../communityPlanningPreview.js';
import { useCommunityPlanningStore } from '../stores/communityPlanning.js';
import { createSyntheticCommunityPlanningFixture } from '../../standalone/communityPlanningFixture.js';
import CommunityPlanningPreview from './panels/CommunityPlanningPreview.vue';

async function mount(t) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useCommunityPlanningStore(pinia);
  const app = createApp(CommunityPlanningPreview).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  const dispose = mountCommunityPlanningPreview(
    createSyntheticCommunityPlanningFixture(),
    { pinia },
  );
  t.after(() => {
    dispose();
    app.unmount();
  });
  await nextTick();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const settle = async () => {
    await nextTick();
    await nextTick();
  };
  return { store, dispose, $, $$, settle };
}

test('nothing renders until an owner offers the launcher', async (t) => {
  document.body.replaceChildren();
  const pinia = createPinia();
  const app = createApp(CommunityPlanningPreview).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  await nextTick();
  assert.equal(
    document.querySelector('[data-community-planning-preview-open]'),
    null,
  );
  assert.equal(
    document.querySelector('[data-community-planning-preview]'),
    null,
  );
});

test('the launcher opens the comparison with two cards and five markers', async (t) => {
  const { $, $$, settle } = await mount(t);
  const launcher = $('[data-community-planning-preview-open]');
  assert.equal(launcher.textContent, 'COMPARE PARK PROPOSALS · FIXTURE');
  launcher.click();
  await settle();
  const dialog = $('dialog[data-community-planning-preview]');
  assert.ok(dialog, 'the comparison renders');
  assert.equal(dialog.parentElement, document.body, 'teleported to the body');
  assert.equal(
    dialog.getAttribute('aria-label'),
    'Community planning · hypothetical preview',
  );
  assert.equal(document.activeElement, dialog.querySelector('h2'));
  const cards = $$('[data-alternative-id]');
  assert.deepEqual(
    cards.map((card) => [card.dataset.alternativeId, card.hidden]),
    [
      ['play-first', false],
      ['trees-first', false],
    ],
  );
  assert.equal(dialog.querySelectorAll('svg circle').length, 5);
  assert.deepEqual(
    $$('.planning-author-credit').map((node) => node.textContent),
    [
      'Recorded author: bob (unverified identity)',
      'Recorded author: alice (unverified identity)',
    ],
  );
  assert.equal($$('[data-planning-source-provenance]').length, 1);
  assert.equal($('[data-planning-focus-navigation]').hidden, true);
  assert.equal(
    $('[data-planning-mode="co-op"]').getAttribute('aria-pressed'),
    'true',
  );
  // Only negated approval wording appears.
  assert.doesNotMatch(
    dialog.textContent.replaceAll('NOT APPROVED', ''),
    /approved/i,
  );
});

test('Game focuses one card; Inspect switches it; Co-op restores both', async (t) => {
  const { $, $$, settle } = await mount(t);
  $('[data-community-planning-preview-open]').click();
  await settle();
  $('[data-planning-mode="game"]').click();
  await settle();
  const hidden = () => $$('[data-alternative-id]').map((card) => card.hidden);
  assert.deepEqual(hidden(), [false, true]);
  assert.equal($('[data-planning-focus-navigation]').hidden, false);
  assert.match(
    $('[data-planning-mode-status]').textContent,
    /^View: game · inspecting Play/,
  );
  $('[data-planning-focus-id="trees-first"]').click();
  await settle();
  assert.deepEqual(hidden(), [true, false]);
  assert.equal(
    $('[data-planning-focus-id="trees-first"]').getAttribute('aria-pressed'),
    'true',
  );
  // Focus inside Inspect moves to the Co-op control before Inspect hides.
  $('[data-planning-focus-id="trees-first"]').focus();
  $('[data-planning-mode="co-op"]').click();
  await settle();
  assert.deepEqual(hidden(), [false, false]);
  assert.equal(document.activeElement, $('[data-planning-mode="co-op"]'));
  assert.equal(
    $('[data-planning-mode-status]').textContent,
    'View: co-op · neither mode grants authority',
  );
});

test('Cancel closes, returns focus to the launcher, and teardown removes both', async (t) => {
  const { $, dispose, settle } = await mount(t);
  const launcher = $('[data-community-planning-preview-open]');
  launcher.click();
  await settle();
  $('[data-planning-cancel]').click();
  await settle();
  assert.equal($('[data-community-planning-preview]'), null);
  assert.equal(document.activeElement, launcher);
  launcher.click();
  await settle();
  assert.ok($('[data-community-planning-preview]'));
  dispose();
  await settle();
  assert.equal($('[data-community-planning-preview]'), null);
  assert.equal($('[data-community-planning-preview-open]'), null);
  launcher.click();
  await settle();
  assert.equal(
    $('[data-community-planning-preview]'),
    null,
    'a detached launcher cannot reopen',
  );
});
