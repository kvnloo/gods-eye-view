<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSituationStore } from '../stores/situation.js';
import { formatDate, t, translateKnown } from '../../i18n/index.js';
import { compactAge, utcClock } from '../../situation/freshness.js';
import { EVENT_KIND_LABELS } from '../../situation/eventStream.js';
import { CARD_KIND_TAGS } from '../../situation/cardModels.js';
import UiButton from '../kit/UiButton.vue';

// The situation room (?situation=1): top bar, live event list, what matters
// now, ephemeral cards and the receipt rail, over the globe. Everything here
// comes from the situation controller; nothing is computed from feeds here.
const store = useSituationStore();
const { room, pins } = storeToRefs(store);
const on = computed(() => room.value?.enabled === true);
const now = computed(() => room.value?.now ?? Date.now());

const say = (line) => {
  if (!line) return '';
  if (typeof line === 'string') return translateKnown(line);
  return t(line.text, line.values);
};
const label = (text) => (text ? translateKnown(text) : '');

const localTime = computed(() =>
  formatDate(now.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }),
);
const localZone = computed(() => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(now.value);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
});
const utcLine = computed(() => {
  const iso = new Date(now.value).toISOString();
  return `${iso.slice(11, 16)}Z`;
});
const dateLine = computed(() =>
  formatDate(now.value, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase(),
);

const sources = computed(() => room.value?.sources ?? []);
const liveSources = computed(() => sources.value.filter((s) => s.state === 'live'));
const staleSources = computed(() => sources.value.filter((s) => s.state === 'stale'));
const keySources = computed(() => sources.value.filter((s) => s.state === 'needs-key'));
const downSources = computed(() => sources.value.filter((s) => s.state === 'down'));
const pendingSources = computed(() => sources.value.filter((s) => s.state === 'pending'));

const age = (at) => {
  if (!Number.isFinite(at)) return '—';
  const value = compactAge(now.value - at);
  return value ? `${value.value} ${value.unit}` : '—';
};

const events = computed(() => room.value?.events ?? []);
const matters = computed(() => room.value?.matters ?? []);
const cards = computed(() => room.value?.cards ?? []);
const lead = computed(() => cards.value.find((card) => card.phase !== 'dissolving') ?? cards.value[0] ?? null);
const others = computed(() => cards.value.filter((card) => card !== lead.value));
const receipts = computed(() => (room.value?.receipts ?? []).slice(0, 4));

const freshnessText = (card) => {
  const state = card.freshness?.state ?? 'unknown';
  const value = compactAge(card.freshness?.ageMs);
  const ago = value ? `${value.value} ${value.unit}` : '';
  if (state === 'live') return t('LIVE · {age}', { age: ago });
  if (state === 'recent') return t('RECENT · {age}', { age: ago });
  if (state === 'stale') return t('STALE · {age}', { age: ago });
  return t('AGE UNKNOWN');
};
const observedLabel = (card) => (card.observedKind === 'retrieved' ? t('RETRIEVED') : t('OBSERVED'));
const holdLeft = (card) => {
  if (card.pinned || card.phase === 'dissolving') return 1;
  const total = Math.max(1, card.holdUntil - card.shownAt);
  return Math.max(0, Math.min(1, (card.holdUntil - now.value) / total));
};

const act = (name, ...args) => store.handlers?.[name]?.(...args);

// Where the panels sit (CSS px at 1920×1080): a pin under one is not drawn,
// and a label that would run into one is left off.
const ZONES = [
  { left: 0, top: 0, right: 1920, bottom: 100 },
  { left: 0, top: 100, right: 530, bottom: 864 },
  { left: 0, top: 858, right: 1380, bottom: 1080 },
  { left: 1358, top: 100, right: 1920, bottom: 1080 },
];
const inZone = (x, y, right = x, bottom = y) =>
  ZONES.some((z) => right > z.left && x < z.right && bottom > z.top && y < z.bottom);
const shownPins = computed(() =>
  pins.value
    .filter((p) => !inZone(p.x, p.y))
    .map((p) => {
      if (!p.label) return p;
      const width = 24 + p.label.length * 11;
      const flip = inZone(p.x, p.y - 14, p.x + width, p.y + 14);
      const fits = !flip || !inZone(p.x - width, p.y - 14, p.x, p.y + 14);
      return { ...p, flip, label: fits ? p.label : null };
    }),
);

const pinLabelClass = (pin) => [
  'sit-pin',
  `sit-pin--${pin.kind}`,
  `sit-pin--${pin.emphasis}`,
  pin.flip ? 'sit-pin--left' : '',
];
</script>

<template>
  <div v-if="on" id="situation-room" class="sit-root" :data-cards="cards.length">
    <!-- Pins over the globe: the live stream's events and the cards' answers. -->
    <div class="sit-pins" aria-hidden="true">
      <div v-for="p in shownPins" :key="p.id" :class="pinLabelClass(p)" :style="{ transform: `translate(${p.x}px, ${p.y}px)` }">
        <span class="sit-pin-dot" :style="p.course != null ? { '--course': `${p.course}deg` } : undefined"></span>
        <span v-if="p.label" class="sit-pin-label" translate="no">{{ p.label }}</span>
      </div>
    </div>

    <!-- Top bar: clock and per-source status. -->
    <header class="sit-top">
      <div class="sit-clock">
        <span class="sit-clock-local" translate="no">{{ localTime }}</span>
        <span class="sit-clock-zone" translate="no">{{ localZone }}</span>
        <span class="sit-clock-utc" translate="no">{{ utcLine }} · {{ dateLine }}</span>
      </div>
      <div class="sit-sources" role="status" :aria-label="t('SOURCES')">
        <span v-for="s in liveSources" :key="s.id" class="sit-src sit-src--live" :title="s.provider">
          <span class="sit-dot"></span>{{ label(s.label) }}
        </span>
        <span v-if="pendingSources.length" class="sit-src-group sit-src--pending">
          <span class="sit-src-head">{{ t('CHECKING') }}</span>
          <span v-for="s in pendingSources" :key="s.id" class="sit-src-name">{{ label(s.label) }}</span>
        </span>
        <span v-if="staleSources.length" class="sit-src-group sit-src--stale">
          <span class="sit-src-head">{{ t('STALE') }}</span>
          <span v-for="s in staleSources" :key="s.id" class="sit-src-name">{{ label(s.label) }}</span>
        </span>
        <span v-if="keySources.length" class="sit-src-group sit-src--key">
          <span class="sit-src-head">{{ t('NEEDS KEY') }}</span>
          <span v-for="s in keySources" :key="s.id" class="sit-src-name">{{ label(s.label) }}</span>
        </span>
        <span v-if="downSources.length" class="sit-src-group sit-src--down">
          <span class="sit-src-head">{{ t('DOWN') }}</span>
          <span v-for="s in downSources" :key="s.id" class="sit-src-name">{{ label(s.label) }}</span>
        </span>
      </div>
    </header>

    <!-- The live event stream, ranked. -->
    <section class="sit-panel sit-events" :aria-label="t('LIVE EVENTS')">
      <h2 class="sit-head">
        <span>{{ t('LIVE EVENTS') }}</span>
        <span class="sit-head-count" translate="no">{{ room.eventCount ?? 0 }}</span>
      </h2>
      <ol class="sit-event-list">
        <li v-for="e in events" :key="e.id" class="sit-event" :class="[`sit-kind--${e.kind}`, { 'sit-event--focus': e.focused }]">
          <div class="sit-event-meta">
            <span class="sit-tag">{{ label(EVENT_KIND_LABELS[e.kind]) }}</span>
            <span class="sit-event-age" translate="no">{{ age(e.at) }}</span>
            <span class="sit-event-src" translate="no">{{ e.source }}</span>
          </div>
          <div class="sit-event-title" translate="no">{{ e.title }}</div>
        </li>
        <li v-if="!events.length" class="sit-empty">{{ t('Waiting for the first feeds…') }}</li>
      </ol>
    </section>

    <!-- What matters now, and the question to ask next. -->
    <section class="sit-matters" :aria-label="t('WHAT MATTERS NOW')">
      <h2 class="sit-head sit-head--inline">{{ t('WHAT MATTERS NOW') }}</h2>
      <UiButton v-for="m in matters" :key="m.id" class="sit-matter" :class="`sit-kind--${m.kind}`" @click="act('ask', m.next.action.args)">
        <span class="sit-matter-rank" translate="no">{{ m.rank }}</span>
        <span class="sit-matter-body">
          <span class="sit-matter-title" translate="no">{{ m.title }}</span>
          <span class="sit-matter-why">{{ say(m.why) }} · <span translate="no">{{ m.source }} · {{ age(m.at) }}</span></span>
          <span class="sit-matter-next"><span class="sit-ask">{{ t('ASK') }}</span> {{ say(m.next.text) }}</span>
        </span>
      </UiButton>
      <div v-if="!matters.length" class="sit-empty">{{ t('Ranking changes as feeds arrive…') }}</div>
    </section>

    <!-- Ephemeral cards: the newest in full, older ones condensed. -->
    <section class="sit-cards" :aria-label="t('BRIEF')">
      <article v-if="lead" :key="lead.id" class="sit-card" :class="[`sit-card--${lead.phase}`, `sit-card--${lead.status}`, `sit-kind--${lead.kind}`, { 'sit-card--pinned': lead.pinned, 'sit-card--open': lead.expanded }]" :data-card-id="lead.id">
        <div class="sit-card-hold" :style="{ transform: `scaleX(${holdLeft(lead)})` }"></div>
        <header class="sit-card-head">
          <span class="sit-tag">{{ label(CARD_KIND_TAGS[lead.kind]) }}</span>
          <span class="sit-fresh" :class="`sit-fresh--${lead.freshness?.state}`"><span class="sit-dot"></span>{{ freshnessText(lead) }}</span>
        </header>
        <h3 class="sit-card-title" translate="no">{{ label(lead.title) }}</h3>
        <div v-if="lead.kind !== 'brief'" class="sit-answer">
          <span class="sit-answer-value" translate="no">{{ lead.answer?.value }}</span>
          <span class="sit-answer-unit">{{ label(lead.answer?.unit) }}</span>
        </div>
        <p class="sit-card-line">{{ say(lead.line) }}</p>
        <img v-if="lead.image" class="sit-card-image" :src="lead.image.src" :alt="lead.image.caption || ''" />
        <table v-if="lead.rows.length" class="sit-table">
          <thead><tr><th v-for="c in lead.columns" :key="c">{{ label(c) }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in lead.rows" :key="i"><td v-for="(cell, j) in r.cells" :key="j" translate="no">{{ cell }}</td></tr>
          </tbody>
        </table>
        <div v-if="lead.kind === 'brief'" class="sit-brief">
          <div v-for="block in lead.body ?? []" :key="JSON.stringify(block).slice(0, 60)" class="sit-brief-block">
            <p v-if="block.type === 'p'" translate="no"><template v-for="(run, k) in block.runs" :key="k"><strong v-if="run.strong">{{ run.text }}</strong><template v-else>{{ run.text }}</template></template></p>
            <ul v-else translate="no"><li v-for="(item, k) in block.items" :key="k"><template v-for="(run, m) in item" :key="m"><strong v-if="run.strong">{{ run.text }}</strong><template v-else>{{ run.text }}</template></template></li></ul>
          </div>
          <div v-for="s in lead.sections" :key="s.id" class="sit-brief-row" :class="`sit-brief-row--${s.status}`">
            <span class="sit-tag">{{ label(s.label) }}</span>
            <span class="sit-brief-line">{{ say(s.line) }}</span>
            <span class="sit-brief-src" translate="no">{{ s.observedAt ? utcClock(s.observedAt) : '' }}</span>
          </div>
        </div>
        <footer class="sit-card-meta">
          <span><b>{{ t('SOURCE') }}</b> <span translate="no">{{ lead.source || t('none given') }}</span></span>
          <span><b>{{ observedLabel(lead) }}</b> <span translate="no">{{ utcClock(lead.observedAt) || '—' }}</span></span>
          <span v-if="lead.missing?.length" class="sit-card-missing"><b>{{ t('NEEDS KEY') }}</b> <span translate="no">{{ lead.missing.join(' · ') }}</span></span>
          <span v-if="lead.coverage" class="sit-card-coverage"><b>{{ t('COVERAGE') }}</b> {{ say(lead.coverage) }}</span>
        </footer>
        <div class="sit-card-actions">
          <UiButton class="sit-btn" :aria-expanded="String(Boolean(lead.expanded))" @click="act('expand', lead.id, !lead.expanded)">{{ lead.expanded ? t('HIDE WHY') : t('WHY · SOURCES · TRAIL') }}</UiButton>
          <UiButton class="sit-btn" :pressed="Boolean(lead.pinned)" @click="act('pin', lead.id, !lead.pinned)">{{ lead.pinned ? t('PINNED') : t('PIN') }}</UiButton>
          <UiButton class="sit-btn" @click="act('dismiss', lead.id)">{{ t('DISMISS') }}</UiButton>
        </div>
        <div v-if="lead.expanded" class="sit-trail">
          <h4 class="sit-head">{{ t('UNKNOWNS') }}</h4>
          <ul class="sit-unknowns"><li v-for="(u, i) in lead.unknowns" :key="i">{{ say(u) }}</li></ul>
          <template v-if="lead.sourceList?.length">
            <h4 class="sit-head">{{ t('SOURCES') }}</h4>
            <ul class="sit-unknowns"><li v-for="s in lead.sourceList" :key="s.name" translate="no">{{ s.name }}{{ s.observedAt ? ` · ${utcClock(s.observedAt)}` : '' }}</li></ul>
          </template>
          <h4 class="sit-head">{{ t('DECISION TRAIL') }}</h4>
          <dl class="sit-trail-list">
            <template v-for="(row, i) in lead.trail" :key="i"><dt>{{ label(row.label) }}</dt><dd translate="no">{{ row.value }}</dd></template>
          </dl>
        </div>
      </article>
      <article v-for="c in others" :key="c.id" class="sit-card sit-card--compact" :class="[`sit-card--${c.phase}`, `sit-card--${c.status}`, `sit-kind--${c.kind}`, { 'sit-card--pinned': c.pinned }]" :data-card-id="c.id">
        <span class="sit-tag">{{ label(CARD_KIND_TAGS[c.kind]) }}</span>
        <span class="sit-compact-title" translate="no">{{ label(c.title) }}</span>
        <span class="sit-compact-value" translate="no">{{ c.answer?.value }}</span>
        <span class="sit-compact-src" translate="no">{{ c.source }} · {{ utcClock(c.observedAt) }}</span>
      </article>
    </section>

    <!-- Receipts: what each card answered, after it dissolved. -->
    <section class="sit-receipts" :aria-label="t('RECEIPTS')">
      <h2 class="sit-head">{{ t('RECEIPTS') }}</h2>
      <ol>
        <li v-for="r in receipts" :key="r.id" class="sit-receipt" :class="`sit-receipt--${r.status}`">
          <span class="sit-receipt-time" translate="no">{{ utcClock(r.at) }}</span>
          <span class="sit-tag">{{ label(CARD_KIND_TAGS[r.kind]) }}</span>
          <span class="sit-receipt-title" translate="no">{{ label(r.title) }}</span>
          <span class="sit-receipt-value" translate="no">{{ r.value }} </span>
          <span class="sit-receipt-unit">{{ label(r.unit) }}</span>
        </li>
        <li v-if="!receipts.length" class="sit-empty">{{ t('Answered cards leave a line here.') }}</li>
      </ol>
    </section>
  </div>
</template>
