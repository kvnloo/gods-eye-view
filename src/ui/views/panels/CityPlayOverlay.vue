<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import UiBadge from '../../kit/UiBadge.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { boundsOf, placeBeside, placeWheel, stackPins, wheelBounds, wheelLayout, wheelSize } from '../../cityPlayModel.js';

// City builder play mode on the globe: the resource bar, the plot's radial
// wheel and tag, in-world callouts and pins, and the concept carousel. The
// globe owner (src/standalone/cityPlay.js) publishes the view and the screen
// anchors; every click goes back through its controls.
const { view, anchors, controls } = storeToRefs(useCityPlayStore());

const viewport = ref({ width: 1440, height: 900 });
const measure = () => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
};
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));

const active = computed(() => Boolean(view.value?.active));
const mobile = computed(() => viewport.value.width < 600);
const tier = computed(() => view.value?.tier ?? 'plot');
const plotPoint = computed(() => anchors.value?.plot ?? null);
const wheelWanted = computed(() => Boolean(view.value?.plot && view.value.wheelOpen && tier.value === 'plot'));
// On a phone the wheel and the carousel take turns; on desktop both fit.
const showCarousel = computed(
  () =>
    Boolean(view.value?.plot) &&
    tier.value === 'plot' &&
    !(mobile.value && wheelWanted.value) &&
    (view.value.cards.length > 0 || view.value.pending),
);

const size = computed(() => wheelSize(viewport.value));
// The desktop dock stands about 360 px above the bottom; the legend owns the left.
const inset = computed(() => ({
  top: mobile.value ? 196 : 128,
  bottom: mobile.value ? 176 : showCarousel.value ? 372 : 120,
  side: 12,
  ...(view.value?.legend && !mobile.value ? { left: 376 } : {}),
}));
// Untried kinds fill the carousel as ghost slots that reimagine the plot.
const ghosts = computed(() =>
  view.value?.plot
    ? ['park', 'plaza', 'bike-lane']
        .filter((kind) => !view.value.cards.some((c) => c.kind === kind))
        .map((kind) => ({ kind, icon: kind === 'park' ? 'park' : kind === 'plaza' ? 'deck' : 'pedal_bike' }))
    : [],
);
const wheel = computed(() => {
  if (!wheelWanted.value) return null;
  return placeWheel(plotPoint.value, viewport.value, size.value, inset.value);
});
const offsets = computed(() => wheelLayout(view.value?.actions.length ?? 0, size.value.radius));

const statLabels = computed(() => ({
  plots: t('Plots'),
  worlds: t('Worlds'),
  concepts: t('Concepts'),
  trees: t('Trees'),
  shade: t('Avg shade'),
  walk: t('Walk access'),
}));
const actionLabels = computed(() => ({
  reimagine: t('Reimagine'),
  park: t('Park'),
  plaza: t('Plaza'),
  'bike-lane': t('Bike lane'),
  inspect: t('Inspect'),
  zone: t('Zone'),
  housing: t('Housing'),
  'mixed-use': t('Mixed use'),
  civic: t('Civic'),
  'open-space': t('Open space'),
  'clear-use': t('Clear'),
  back: t('Back'),
}));
const useLabel = (use) => actionLabels.value[use] ?? use;
// Earth lanes (kvnloo#145): the sourced map is Observed, every authored world is Possible.
const laneLabels = computed(() => ({ observed: t('Observed Earth'), possible: t('Possible Earth') }));
const chipLabels = computed(() => ({
  trees: t('Trees'),
  shade: t('Shade'),
  width: t('Width'),
  walk: t('Walk access'),
}));
function chipValue(chip) {
  if (chip.unit === 'm') return t('{value} m', { value: formatNumber(chip.value) });
  if (chip.unit === '%') return `${formatNumber(chip.value)}%`;
  return formatNumber(chip.value);
}
function kindLabel(kind) {
  return kind === 'park' ? t('Park') : kind === 'plaza' ? t('Plaza') : t('Bike lane');
}
const focusedCard = computed(() => view.value?.cards.find((c) => c.focused) ?? view.value?.cards.at(-1) ?? null);
// Callout labels sit on a short leader above their point, outward from the plot centre.
const callouts = computed(() =>
  (view.value?.callouts ?? [])
    .map((c) => ({ ...c, at: anchors.value?.callouts?.[c.id] }))
    .filter((c) => c.at)
    .map((c) => {
      const dx = c.fx < 0.5 ? -46 : 46;
      return { ...c, end: { x: c.at.x + dx, y: c.at.y - 44 }, side: c.fx < 0.5 ? 'start' : 'end' };
    }),
);
// Pins do not wrap: estimate each width from its longest line (12 px mono).
const pinWidth = (p) =>
  70 +
  7.8 *
    Math.max(
      (p.title ?? useLabel(p.use)).length,
      [p.trees !== null && `${t('Trees')} +${p.trees}`, p.shade !== null && `${t('Shade')} ${p.shade}%`, p.title && p.use && useLabel(p.use), `${t('Walk access')} ${p.walk ?? '—'}`, p.built && t('Kept')]
        .filter(Boolean)
        .join('  ').length,
    );
const pins = computed(() =>
  stackPins(
    (view.value?.pins ?? [])
      .map((p) => ({ ...p, at: anchors.value?.pins?.[p.plotId], width: pinWidth(p) }))
      .filter((p) => p.at),
  ),
);
// The plot tag sits beside the wheel's bounds (never across a button), clear of
// the resource bar, tethered to the projected plot centre.
const tagEl = ref(null);
const tagSize = ref({ width: 330, height: 56 });
onUpdated(() => {
  const el = tagEl.value;
  if (el?.offsetWidth && (el.offsetWidth !== tagSize.value.width || el.offsetHeight !== tagSize.value.height))
    tagSize.value = { width: el.offsetWidth, height: el.offsetHeight };
});
const tag = computed(() => {
  const from = plotPoint.value;
  if (!from || !wheel.value) return null;
  const bar = document.querySelector('[data-city-play-bar]')?.getBoundingClientRect();
  const placed = placeBeside({
    target: wheelBounds(wheel.value, size.value),
    size: tagSize.value,
    viewport: viewport.value,
    keepOut: bar?.width ? [bar] : [],
    gap: 14,
  });
  return { x: placed.x, y: placed.y, from, to: placed.leader.from };
});
const holoTag = computed(() => {
  const at = anchors.value?.holo;
  if (!at || wheel.value || !view.value?.focused?.concept || tier.value === 'district') return null;
  // The tag sits beside the holo's top edge on a short leader, clear of the resource bar.
  const width = mobile.value ? 170 : 240;
  const side = at.x + 150 + width < viewport.value.width - 12 ? 1 : -1;
  const x = side > 0 ? at.x + 150 : Math.max(12, at.x - 150 - width);
  const y = Math.min(Math.max(at.y, inset.value.top + 40), viewport.value.height - 260);
  return { x, y, from: { x: at.x + side * 60, y: Math.max(at.y + 24, inset.value.top + 40) }, side };
});
// The stats card sits beside the plot footprint on a leader, clear of the map
// credits, the command dock, the resource bar, the callouts and the holo tag.
const KEEP_OUT = ['#cesium-credits .cesium-widget-credits', '#command-dock', '#top-center-actions', '[data-city-play-bar]'];
const statsEl = ref(null);
const statsSize = ref({ width: 260, height: 172 });
onUpdated(() => {
  const el = statsEl.value;
  if (el?.offsetWidth && (el.offsetWidth !== statsSize.value.width || el.offsetHeight !== statsSize.value.height))
    statsSize.value = { width: el.offsetWidth, height: el.offsetHeight };
});
const statsPlace = computed(() => {
  if (tier.value !== 'detail' || !view.value?.focused) return null;
  const keepOut = KEEP_OUT.flatMap((selector) => [...document.querySelectorAll(selector)])
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  for (const c of callouts.value) {
    const left = c.side === 'end' ? c.at.x + 40 : c.at.x - 200;
    keepOut.push({ left, right: left + 160, top: c.at.y - 62, bottom: c.at.y - 28 });
  }
  if (holoTag.value) {
    const width = mobile.value ? 170 : 240;
    keepOut.push({ left: holoTag.value.x, right: holoTag.value.x + width, top: holoTag.value.y - 26, bottom: holoTag.value.y + 26 });
  }
  // Only a fully projected footprint anchors the card; up close it would land on the plot.
  const footprint = anchors.value?.footprint;
  return placeBeside({ target: footprint?.every(Boolean) ? boundsOf(footprint) : null, size: statsSize.value, viewport: viewport.value, keepOut });
});
const bars = computed(() => {
  const p = view.value?.focused?.parameters;
  if (!p) return [];
  return [
    { id: 'trees', label: t('Trees'), value: formatNumber(p.trees), fill: p.trees / 200 },
    { id: 'shade', label: t('Shade'), value: `${formatNumber(p.shadePercent)}%`, fill: p.shadePercent / 100 },
    { id: 'width', label: t('Width'), value: t('{value} m', { value: formatNumber(p.widthMeters) }), fill: p.widthMeters / 20 },
  ];
});
</script>

<template>
  <div v-if="active" class="city-play" data-city-play :data-city-play-tier="tier" :aria-label="t('City builder play mode')" role="region">
    <div class="city-play-bar" data-city-play-bar>
      <span v-for="stat in view.stats" :key="stat.id" class="city-play-stat" :data-city-play-stat="stat.id">
        <span class="city-play-stat-label">{{ statLabels[stat.id] }}</span>
        <span class="city-play-stat-value" translate="no">{{ stat.value }}</span>
      </span>
      <button type="button" class="city-play-bar-records" data-city-play-records="bar" :disabled="view.pending" :aria-label="t('Project records')" :title="t('Project records')" @click="controls?.openRecords()">
        <UiIcon name="folder_open" :size="16" />
      </button>
    </div>
    <p v-if="!view.plot" class="city-play-hint" data-city-play-hint>
      <span>{{ t('Click a plot of land to reimagine it') }}</span>
      <span class="city-play-hint-key">{{ t('Esc exits') }}</span>
    </p>

    <svg v-if="tag || holoTag || statsPlace || (wheel && plotPoint) || callouts.length || pins.some((p) => p.lift)" class="city-play-tethers" aria-hidden="true" :viewBox="`0 0 ${viewport.width} ${viewport.height}`">
      <line v-if="tag" :x1="tag.from.x" :y1="tag.from.y" :x2="tag.to.x" :y2="tag.to.y" />
      <line v-if="holoTag" :x1="holoTag.from.x" :y1="holoTag.from.y" :x2="holoTag.side > 0 ? holoTag.x : holoTag.x + (mobile ? 170 : 240)" :y2="holoTag.y" />
      <circle v-if="holoTag" class="city-play-tether-end" :cx="holoTag.from.x" :cy="holoTag.from.y" r="4" />
      <line v-if="wheel && plotPoint && wheel.clamped" class="city-play-tether-dim" :x1="wheel.x" :y1="wheel.y" :x2="plotPoint.x" :y2="plotPoint.y" />
      <circle v-if="plotPoint && tier !== 'detail'" :cx="plotPoint.x" :cy="plotPoint.y" r="5" />
      <line v-for="callout in callouts" :key="callout.id" class="city-play-leader" :x1="callout.at.x" :y1="callout.at.y" :x2="callout.end.x" :y2="callout.end.y" />
      <line v-for="pin in pins.filter((p) => p.lift)" :key="`pin-${pin.plotId}`" class="city-play-leader" :x1="pin.at.x" :y1="pin.at.y" :x2="pin.at.x" :y2="pin.top" />
      <template v-if="statsPlace">
        <line class="city-play-leader" data-city-play-stats-leader :x1="statsPlace.leader.from.x" :y1="statsPlace.leader.from.y" :x2="statsPlace.leader.to.x" :y2="statsPlace.leader.to.y" />
        <circle class="city-play-tether-end" :cx="statsPlace.leader.to.x" :cy="statsPlace.leader.to.y" r="3.5" />
      </template>
    </svg>

    <div v-if="tag" ref="tagEl" class="city-play-tag" data-city-play-tag :style="{ left: `${tag.x}px`, top: `${tag.y}px` }">
      <UiBadge v-if="view.plot.lane" class="city-play-lane" :class="`city-play-lane--${view.plot.lane}`" :data-city-play-lane="view.plot.lane">{{ laneLabels[view.plot.lane] }}</UiBadge>
      <strong translate="no">{{ t('Plot {code}', { code: view.plot.code }) }}</strong>
      <span>{{ t('{area} m²', { area: formatNumber(view.plot.area) }) }}</span>
      <span v-if="view.plot.use" class="city-play-tag-use" :class="`city-play-use--${view.plot.use}`" data-city-play-tag-use>{{ useLabel(view.plot.use) }}</span>
      <span v-if="view.plot.lane === 'observed'" class="city-play-tag-note" data-city-play-source>{{ t('Map imagery: {source}', { source: view.plot.source }) }}</span>
      <span v-if="!mobile" class="city-play-tag-note">{{ t('40 m grid cell, not a surveyed parcel') }}</span>
    </div>

    <nav v-if="wheel" class="city-play-wheel" data-city-play-wheel :aria-label="t('City builder actions for this plot')" :style="{ left: `${wheel.x}px`, top: `${wheel.y}px`, '--wheel-radius': `${size.radius}px`, '--wheel-button': `${size.button}px` }">
      <span class="city-play-wheel-ring" aria-hidden="true"></span>
      <button
        v-for="(action, index) in view.actions"
        :key="action.id"
        type="button"
        class="city-play-wheel-button"
        :class="{ 'is-selected': action.selected }"
        :data-city-play-action="action.id"
        :aria-pressed="action.selected === undefined ? undefined : String(action.selected)"
        :disabled="action.disabled"
        :style="{ transform: `translate(${offsets[index].x}px, ${offsets[index].y}px)` }"
        @click="controls?.act(action.id)"
      >
        <UiIcon :name="action.icon" :size="mobile ? 22 : 28" />
        <span>{{ actionLabels[action.id] }}</span>
      </button>
    </nav>

    <div v-if="holoTag" class="city-play-holo-tag" data-city-play-holo-tag :style="{ left: `${holoTag.x}px`, top: `${holoTag.y}px` }">
      <strong translate="no">{{ t('Plot {code}', { code: view.plot.code }) }}</strong>
      <span class="city-play-accent">{{ t('Reimagined') }}</span>
      <UiBadge v-if="view.plot.lane" class="city-play-lane" :class="`city-play-lane--${view.plot.lane}`" :data-city-play-lane="view.plot.lane">{{ laneLabels[view.plot.lane] }}</UiBadge>
    </div>

    <div v-for="callout in callouts" :key="callout.id" class="city-play-callout" :data-city-play-callout="callout.id" :style="{ left: `${callout.at.x}px`, top: `${callout.at.y}px` }">
      <span class="city-play-callout-dot" aria-hidden="true"></span>
      <span class="city-play-callout-label" :class="`city-play-callout-label--${callout.side}`">
        <template v-if="callout.id === 'kind'">{{ kindLabel(callout.kind) }}</template>
        <template v-else>{{ chipLabels[callout.id] }} · {{ chipValue(callout) }}</template>
      </span>
    </div>

    <aside v-if="statsPlace" ref="statsEl" class="city-play-stats" data-city-play-stats :data-city-play-stats-side="statsPlace.side" :style="{ left: `${statsPlace.x}px`, top: `${statsPlace.y}px` }">
      <h3>{{ t('Proposed parameters') }}</h3>
      <p class="city-play-stats-title">
        <UiIcon :name="view.focused.icon" :size="16" />
        <span>{{ view.focused.title }}</span>
      </p>
      <div v-for="bar in bars" :key="bar.id" class="city-play-stats-row">
        <span>{{ bar.label }}</span>
        <span class="city-play-stats-bar" aria-hidden="true"><span :style="{ width: `${Math.round(Math.min(1, bar.fill) * 100)}%` }"></span></span>
        <span translate="no">{{ bar.value }}</span>
      </div>
      <p class="city-play-stats-note">{{ t('Version') }} {{ view.focused.revision }} · {{ t('AI concept, not a plan or an approval') }}</p>
    </aside>

    <button
      v-for="pin in pins"
      :key="pin.plotId"
      type="button"
      class="city-play-pin"
      :class="pin.kind ? `city-play-pin--${pin.kind}` : `city-play-use--${pin.use}`"
      :data-city-play-pin="pin.plotId"
      :style="{ left: `${pin.at.x}px`, top: `${pin.top}px` }"
    >
      <UiIcon :name="pin.icon" :size="18" />
      <span class="city-play-pin-text">
        <span>{{ pin.title ?? useLabel(pin.use) }}</span>
        <span class="city-play-pin-yields">
          <span v-if="pin.trees !== null">{{ t('Trees') }} +{{ formatNumber(pin.trees) }}</span>
          <span v-if="pin.shade !== null">{{ t('Shade') }} {{ formatNumber(pin.shade) }}%</span>
          <span v-if="pin.use && pin.title" class="city-play-pin-use" :class="`city-play-use--${pin.use}`" data-city-play-pin-use>{{ useLabel(pin.use) }}</span>
          <span data-city-play-pin-walk>{{ t('Walk access') }} {{ pin.walk ?? '—' }}</span>
          <span v-if="pin.built" class="city-play-pin-kept">{{ t('Kept') }}</span>
        </span>
      </span>
    </button>

    <aside v-if="view.legend && !(mobile && wheel)" class="city-play-legend" data-city-play-legend :aria-label="t('Proposed land use')">
      <h3>{{ t('Proposed land use') }}</h3>
      <div class="city-play-legend-row city-play-legend-head">
        <span></span>
        <span></span>
        <span>{{ t('Plots') }}</span>
        <span>{{ t('Land area') }}</span>
        <span>{{ t('Share') }}</span>
      </div>
      <div v-for="row in view.legend.rows" :key="row.use" class="city-play-legend-row" :data-city-play-legend-row="row.use">
        <span class="city-play-swatch" :class="`city-play-use--${row.use}`" aria-hidden="true"></span>
        <span>{{ useLabel(row.use) }}</span>
        <span translate="no" data-legend-plots>{{ formatNumber(row.plots) }}</span>
        <span translate="no" data-legend-area>{{ t('{area} m²', { area: formatNumber(row.areaSquareMeters) }) }}</span>
        <span translate="no" data-legend-share>{{ row.sharePercent === null ? '—' : `${formatNumber(row.sharePercent)}%` }}</span>
      </div>
      <p class="city-play-legend-note">{{ t('Hypothetical land use for 40 m grid cells, not the city’s zoning.') }}</p>
      <p class="city-play-legend-note">{{ t('Walk access shows the existing estimate; land use does not recompute it.') }}</p>
    </aside>

    <section v-if="showCarousel" class="city-play-dock" data-city-play-carousel :aria-label="t('Possible worlds for this plot')">
      <div class="city-play-cards">
        <button
          v-for="card in view.cards"
          :key="card.id"
          type="button"
          class="city-play-card"
          :class="{ 'is-focused': card.focused, 'is-built': card.built, 'is-pending': card.pending }"
          :data-city-play-card="card.id"
          :aria-pressed="String(card.focused)"
          @click="controls?.focus(card.id)"
        >
          <span class="city-play-card-image">
            <img v-if="card.image" :src="card.image" :alt="t('AI concept, not a plan or an approval')">
            <span v-else class="city-play-card-empty"><UiIcon :name="card.icon" :size="30" /><span>{{ card.pending ? t('Imagining…') : t('No concept yet') }}</span></span>
            <span v-if="card.built" class="city-play-card-kept">{{ t('Kept') }}</span>
            <UiBadge class="city-play-lane city-play-card-lane" :class="`city-play-lane--${card.lane}`" :data-city-play-lane="card.lane">{{ laneLabels[card.lane] }}</UiBadge>
          </span>
          <span class="city-play-card-title">{{ card.title }}</span>
          <span class="city-play-card-meta">{{ kindLabel(card.kind) }} · {{ t('Version') }} {{ card.revision }}</span>
          <span class="city-play-chips">
            <span v-for="chip in card.chips" :key="chip.id" class="city-play-chip" :data-city-play-chip="chip.id">
              <span>{{ chipLabels[chip.id] }}</span>
              <strong translate="no">{{ chipValue(chip) }}</strong>
            </span>
          </span>
        </button>
        <button
          v-for="ghost in view.framing ? [] : ghosts"
          :key="ghost.kind"
          type="button"
          class="city-play-card city-play-card--ghost"
          :data-city-play-ghost="ghost.kind"
          :disabled="view.pending"
          @click="controls?.act(ghost.kind)"
        >
          <span class="city-play-card-image"><span class="city-play-card-empty"><UiIcon :name="ghost.icon" :size="30" /><span>+ {{ kindLabel(ghost.kind) }}</span></span></span>
          <span class="city-play-card-title">{{ t('Reimagine') }}</span>
          <span class="city-play-card-meta">{{ kindLabel(ghost.kind) }}</span>
        </button>
        <div v-if="view.framing" class="city-play-card is-pending city-play-card--framing" data-city-play-framing>
          <span class="city-play-card-image"><span class="city-play-card-empty"><UiIcon name="auto_awesome" :size="30" /><span>{{ t('Framing plot…') }}</span></span></span>
        </div>
      </div>
      <div class="city-play-actions">
        <button type="button" class="city-play-action city-play-action--primary" data-city-play-build :disabled="!focusedCard || !focusedCard.image || view.pending" @click="controls?.build(focusedCard.id)">
          <UiIcon name="location_city" :size="20" />
          <span>{{ t('Build') }}</span>
        </button>
        <button type="button" class="city-play-action" data-city-play-reroll :disabled="!focusedCard || view.pending" @click="controls?.reroll(focusedCard.id)">
          <UiIcon name="casino" :size="20" />
          <span>{{ t('Reroll') }}</span>
        </button>
        <button type="button" class="city-play-action city-play-action--quiet" data-city-play-records="carousel" :disabled="view.pending" @click="controls?.openRecords()">
          <UiIcon name="folder_open" :size="18" />
          <span>{{ t('Project records') }}</span>
        </button>
        <span class="city-play-ai-chip" data-city-play-ai-label>{{ t('AI concept, not a plan or an approval') }}</span>
      </div>
    </section>

    <p v-if="view.error" class="city-play-status city-play-status--error" role="alert" data-city-play-error>{{ view.error }}</p>
    <p v-else-if="view.pending" class="city-play-status" role="status" data-city-play-pending>{{ view.framing ? t('Framing plot…') : t('Imagining…') }}</p>
  </div>
</template>
