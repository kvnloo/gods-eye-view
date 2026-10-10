import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFireHistoryPanel,
  fireHistoryTimelineIndex,
  fireHistoryTimelineTicks,
  formatFireHistoryHectares,
} from './fireHistoryPanel.js';
import { railFixture } from './railTestFixture.mjs';

const CAMP = {
  id: 'camp-fire-2018',
  name: 'Camp Fire',
  region: 'Butte County, California, USA',
  startDate: '2018-11-08',
  endDate: '2018-11-25',
  burnedHa: 62053,
  summary: 'Historic event fixture',
  references: [
    {
      label: 'CAL FIRE',
      url: 'https://www.fire.ca.gov/incidents/2018/11/8/camp-fire/',
    },
  ],
};
const LAHAINA = {
  id: 'lahaina-2023',
  name: 'Lahaina Fire',
  region: 'Maui, Hawaii, USA',
  startDate: '2023-08-08',
  endDate: '2023-08-12',
  burnedHa: 878,
  references: [],
};
const TIMELINE = [
  { date: '2018-11-08', count: 10 },
  { date: '2018-11-09', count: 20 },
  { date: '2018-11-10', count: 30 },
];

test('timeline helpers use UTC days and clamp a replay cursor to the visible day', () => {
  const ticks = fireHistoryTimelineTicks(TIMELINE);
  assert.deepEqual(ticks, [
    '2018-11-08T00:00:00Z',
    '2018-11-09T00:00:00Z',
    '2018-11-10T00:00:00Z',
  ]);
  assert.equal(
    fireHistoryTimelineIndex(ticks, {
      cursorMs: Date.parse('2018-11-09T15:00:00Z'),
    }),
    1,
  );
  assert.equal(fireHistoryTimelineIndex(ticks, null), 2);
  assert.equal(formatFireHistoryHectares(62053), '62,053 HA');
  assert.equal(formatFireHistoryHectares(null), 'UNAVAILABLE');
});

test('Historic Fires presentation is composed from shared rail cards and timeline', () => {
  const f = railFixture();
  const panel = createFireHistoryPanel({ container: f.container });
  panel.update({
    enabled: true,
    events: [CAMP, LAHAINA],
    selectedId: CAMP.id,
    event: CAMP,
    timeline: TIMELINE,
    replay: { status: 'idle' },
    count: 5490,
    complete: true,
  });

  const root = f.find((node) => node.className === 'fire-history-readout');
  assert.equal(root.hidden, false);
  const cards = f.find((node) => node.className === 'fire-history-cards');
  assert.equal(cards.children.length, 2);
  assert.ok(
    cards.children.every((node) => node.classList.contains('rail-card')),
  );
  assert.ok(
    f.find((node) => node.className === 'rail-timeline'),
    'shared timeline is mounted',
  );
  assert.ok(
    f.find(
      (node) =>
        node.classList?.contains('rail-card-badge') &&
        node.textContent === 'SELECTED',
    ),
  );

  panel.destroy();
  assert.equal(f.container.children.length, 0);
});

test('event selection, focus and replay transport stay explicit callbacks', () => {
  const f = railFixture();
  const calls = [];
  const panel = createFireHistoryPanel({
    container: f.container,
    actions: {
      selectEvent: (id) => calls.push(['select', id]),
      focus: () => calls.push(['focus']),
      seek: (tick, index) => calls.push(['seek', tick, index]),
      step: (direction) => calls.push(['step', direction]),
      reset: () => calls.push(['reset']),
      togglePlay: () => calls.push(['play']),
    },
  });
  panel.update({
    enabled: true,
    events: [CAMP, LAHAINA],
    selectedId: CAMP.id,
    event: CAMP,
    timeline: TIMELINE,
    replay: { status: 'paused', cursorMs: Date.parse('2018-11-09T00:00:00Z') },
    count: 100,
  });

  const select = f.find((node) => node.dataset?.actionId === 'select');
  select.click();
  assert.deepEqual(calls.at(-1), ['select', LAHAINA.id]);

  const focus = f.find((node) => node.dataset?.actionId === 'focus');
  focus.click();
  assert.deepEqual(calls.at(-1), ['focus']);

  const timeline = f.find((node) => node.className === 'rail-timeline');
  const slider = f.find((node) => node.tagName === 'INPUT', timeline);
  slider.value = '2';
  slider.dispatchEvent(new Event('change'));
  assert.deepEqual(calls.at(-1), [
    'seek',
    '2018-11-10T00:00:00Z',
    2,
  ]);

  const play = f.find(
    (node) => node.tagName === 'BUTTON' && node.textContent === 'Play',
    timeline,
  );
  play.click();
  assert.deepEqual(calls.at(-1), ['play']);

  panel.destroy();
});

test('partial/key/loading state stays presentation-only and does not invent data', () => {
  const f = railFixture();
  const panel = createFireHistoryPanel({ container: f.container });
  panel.update({
    enabled: true,
    events: [CAMP],
    selectedId: CAMP.id,
    event: CAMP,
    timeline: TIMELINE,
    loading: true,
    count: 0,
    complete: false,
  });
  assert.ok(
    f.find((node) => node.textContent === 'LOADING ARCHIVE'),
  );

  panel.update({
    enabled: true,
    events: [CAMP],
    selectedId: CAMP.id,
    event: CAMP,
    timeline: TIMELINE,
    keyRequired: true,
    count: 0,
    complete: false,
  });
  assert.ok(
    f.find((node) => node.textContent === 'FIRMS KEY REQUIRED'),
  );

  panel.update({
    enabled: true,
    events: [CAMP],
    selectedId: CAMP.id,
    event: CAMP,
    timeline: TIMELINE,
    count: 10,
    complete: false,
  });
  assert.ok(
    f.find((node) => node.textContent === '10 detections · PARTIAL'),
  );

  panel.destroy();
});
