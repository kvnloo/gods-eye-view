import { createRailCards } from './railCards.js';
import { createRailTimeline } from './railTimeline.js';

/**
 * Shared-rail presentation for Historic Fires.
 *
 * The original feature/panel design is by @lleon-at-navteca in upstream #609.
 * This recut deliberately owns presentation only: acquisition stays with the
 * fire-history provider, perimeter acquisition stays with the shared fire
 * perimeter owner, and the future layer owns map rendering/replay time.
 */

const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};

const utcDay = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};

export function fireHistoryTimelineTicks(timeline = []) {
  return timeline
    .map((entry) => utcDay(entry?.date))
    .filter(Boolean)
    .map((day) => `${day}T00:00:00Z`);
}

export function fireHistoryTimelineIndex(ticks, replay) {
  if (!ticks.length) return 0;
  const cursor = Number(replay?.cursorMs);
  if (!Number.isFinite(cursor)) return ticks.length - 1;
  const index = ticks.findLastIndex((tick) => Date.parse(tick) <= cursor);
  return Math.max(0, index);
}

export function formatFireHistoryHectares(value) {
  const ha = Number(value);
  return Number.isFinite(ha) && ha > 0
    ? `${Math.round(ha).toLocaleString('en-US')} HA`
    : 'UNAVAILABLE';
}

function eventCard(event, selected, open, actions) {
  const year = String(event.startDate || '').slice(0, 4);
  const lines = [
    {
      id: 'region',
      text: event.region || 'Region unavailable',
      muted: true,
    },
    {
      id: 'window',
      text: `${event.startDate || '—'} → ${event.endDate || '—'}`,
    },
    {
      id: 'burned',
      text: `Burned area · ${formatFireHistoryHectares(event.burnedHa)}`,
    },
    ...(event.summary
      ? [{ id: 'summary', text: event.summary, muted: true }]
      : []),
  ];
  const actionItems = [];
  if (!selected) {
    actionItems.push({
      id: 'select',
      label: 'Show',
      title: `Show ${event.name}`,
      onClick: () => actions.selectEvent?.(event.id),
    });
  } else {
    actionItems.push({
      id: 'focus',
      label: 'Focus',
      title: `Frame ${event.name}`,
      onClick: () => actions.focus?.(),
    });
  }
  for (const [index, reference] of (event.references || []).entries()) {
    if (!/^https:\/\//.test(String(reference?.url || ''))) continue;
    actionItems.push({
      id: `reference-${index}`,
      label: reference.label || 'Source',
      href: reference.url,
      title: `Open ${reference.label || 'source'}`,
    });
  }
  return {
    id: event.id,
    icon: '🔥',
    title: `${event.name}${year ? ` · ${year}` : ''}`,
    badge: selected ? 'SELECTED' : '',
    open,
    compact: `${event.region || 'Region unavailable'} · ${event.startDate || '—'} → ${event.endDate || '—'}`,
    blocks: [
      { id: 'details', type: 'lines', lines },
      ...(actionItems.length
        ? [{ id: 'actions', type: 'actions', actions: actionItems }]
        : []),
    ],
  };
}

function replayReadout(snapshot) {
  if (snapshot.loading) return 'LOADING ARCHIVE';
  if (snapshot.keyRequired) return 'FIRMS KEY REQUIRED';
  if (snapshot.error) return snapshot.error;
  const replay = snapshot.replay;
  if (replay?.status && replay.status !== 'idle') {
    const shown = Number.isFinite(replay.shown) ? replay.shown : snapshot.count;
    const active = Number.isFinite(replay.active) ? replay.active : 0;
    return `${String(replay.status).toUpperCase()} · ${shown ?? 0} shown · ${active} burning`;
  }
  if (snapshot.event) {
    return `${snapshot.count ?? 0} detections · ${snapshot.complete === false ? 'PARTIAL' : 'COMPLETE'}`;
  }
  return 'Select an event';
}

/**
 * Render Historic Fires through the repository's shared rail cards + timeline.
 *
 * update() accepts the future layer's plain snapshot; callbacks are explicit so
 * this component never imports acquisition, Cesium, storage or share state.
 */
export function createFireHistoryPanel({
  container,
  actions = {},
} = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement || !container) return null;

  const root = document.createElement('section');
  root.className = 'fire-history-readout';
  root.hidden = true;
  root.setAttribute('aria-label', 'Historic fires');

  const heading = document.createElement('h3');
  heading.className = 'panel-title';
  heading.textContent = 'Historic fires';
  const cardsHost = document.createElement('div');
  cardsHost.className = 'fire-history-cards';
  const timelineHost = document.createElement('div');
  timelineHost.className = 'fire-history-timeline';

  root.append(heading, cardsHost, timelineHost);
  container.appendChild(root);

  let snapshot = { events: [], timeline: [] };
  let openId = null;
  let destroyed = false;

  const timeline = createRailTimeline({
    container: timelineHost,
    document,
    heading: false,
    onCommit: (tick, index) => actions.seek?.(tick, index),
    onPreview: (tick) => {
      const day = utcDay(tick);
      return day ? `${day} UTC` : '';
    },
    onStep: (direction) => actions.step?.(direction),
    onLatest: () => actions.reset?.(),
    onPlay: () => actions.togglePlay?.(),
  });

  const cards = createRailCards({
    container: cardsHost,
    document,
    cardClassName: 'fire-history-card',
    onOpen: (id) => {
      openId = id;
      render();
    },
  });

  const render = () => {
    if (destroyed) return;
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const selectedId = snapshot.selectedId || snapshot.event?.id || null;
    if (!openId || !events.some(({ id }) => id === openId))
      openId = selectedId || events[0]?.id || null;

    cards.update(
      events.map((event) =>
        eventCard(
          event,
          event.id === selectedId,
          event.id === openId,
          actions,
        ),
      ),
    );

    const ticks = fireHistoryTimelineTicks(snapshot.timeline);
    const index = fireHistoryTimelineIndex(ticks, snapshot.replay);
    timeline.update({
      ticks,
      index,
      mode: snapshot.replay?.status === 'idle' ? 'latest' : 'history',
      playing: snapshot.replay?.status === 'playing',
      readout: replayReadout(snapshot),
      disabled: !snapshot.event || ticks.length < 2,
    });

    set(timelineHost, 'hidden', !snapshot.event);
    set(root, 'hidden', events.length === 0);
  };

  return {
    update(next = {}) {
      snapshot = {
        events: Array.isArray(next.events) ? next.events : [],
        selectedId: next.selectedId || next.event?.id || null,
        event: next.event || null,
        timeline: Array.isArray(next.timeline) ? next.timeline : [],
        replay: next.replay || null,
        count: Number.isFinite(next.count) ? next.count : 0,
        complete: next.complete,
        loading: Boolean(next.loading),
        keyRequired: Boolean(next.keyRequired),
        error: next.error || null,
      };
      render();
    },
    destroy() {
      destroyed = true;
      timeline.destroy();
      cards.destroy();
      root.remove();
    },
  };
}
