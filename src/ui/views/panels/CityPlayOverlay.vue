<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import UiIcon from '../../kit/UiIcon.vue';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { placeWheel, wheelLayout, wheelSize } from '../../cityPlayModel.js';

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
const showCarousel = computed(
  () => Boolean(view.value?.plot) && tier.value !== 'district' && (view.value.cards.length > 0 || view.value.pending),
);

const size = computed(() => wheelSize(viewport.value));
const inset = computed(() => ({
  top: mobile.value ? 150 : 128,
  bottom: showCarousel.value ? (mobile.value ? 330 : 300) : mobile.value ? 150 : 120,
  side: 12,
}));
const wheel = computed(() => {
  if (!view.value?.plot || tier.value !== 'plot') return null;
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
}));
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
const callouts = computed(() =>
  (view.value?.callouts ?? [])
    .map((c) => ({ ...c, at: anchors.value?.callouts?.[c.id] }))
    .filter((c) => c.at),
);
const pins = computed(() =>
  (view.value?.pins ?? [])
    .map((p) => ({ ...p, at: anchors.value?.pins?.[p.plotId] }))
    .filter((p) => p.at),
);
const tag = computed(() => {
  const at = anchors.value?.tag;
  if (!at || !view.value?.plot || tier.value === 'district') return null;
  const x = Math.min(Math.max(at.x + 28, 12), viewport.value.width - (mobile.value ? 200 : 330));
  const y = Math.max(at.y - 64, inset.value.top);
  return { x, y, from: at };
});
const holoTag = computed(() => {
  const at = anchors.value?.holo;
  if (!at || !view.value?.focused?.concept || tier.value === 'district') return null;
  return { x: Math.min(Math.max(at.x, 140), viewport.value.width - 140), y: Math.max(at.y - 18, inset.value.top) };
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
    </div>
    <p v-if="!view.plot" class="city-play-hint" data-city-play-hint>
      <span>{{ t('Click a plot of land to reimagine it') }}</span>
      <span class="city-play-hint-key">{{ t('Esc exits') }}</span>
    </p>

    <svg v-if="tag || (wheel && plotPoint)" class="city-play-tethers" aria-hidden="true" :viewBox="`0 0 ${viewport.width} ${viewport.height}`">
      <line v-if="tag" :x1="tag.from.x" :y1="tag.from.y" :x2="tag.x" :y2="tag.y + 18" />
      <line v-if="wheel && plotPoint && wheel.clamped" class="city-play-tether-dim" :x1="wheel.x" :y1="wheel.y" :x2="plotPoint.x" :y2="plotPoint.y" />
      <circle v-if="plotPoint" :cx="plotPoint.x" :cy="plotPoint.y" r="5" />
    </svg>

    <div v-if="tag" class="city-play-tag" data-city-play-tag :style="{ left: `${tag.x}px`, top: `${tag.y}px` }">
      <strong translate="no">{{ t('Plot {code}', { code: view.plot.code }) }}</strong>
      <span>{{ t('{area} m²', { area: formatNumber(view.plot.area) }) }}</span>
      <span class="city-play-tag-note">{{ t('40 m grid cell, not a surveyed parcel') }}</span>
    </div>

    <nav v-if="wheel" class="city-play-wheel" data-city-play-wheel :aria-label="t('City builder actions for this plot')" :style="{ left: `${wheel.x}px`, top: `${wheel.y}px`, '--wheel-radius': `${size.radius}px`, '--wheel-button': `${size.button}px` }">
      <span class="city-play-wheel-ring" aria-hidden="true"></span>
      <button
        v-for="(action, index) in view.actions"
        :key="action.id"
        type="button"
        class="city-play-wheel-button"
        :data-city-play-action="action.id"
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
    </div>

    <div v-for="callout in callouts" :key="callout.id" class="city-play-callout" :data-city-play-callout="callout.id" :style="{ left: `${callout.at.x}px`, top: `${callout.at.y}px` }">
      <span class="city-play-callout-dot" aria-hidden="true"></span>
      <span class="city-play-callout-label">
        <template v-if="callout.id === 'kind'">{{ kindLabel(callout.kind) }}</template>
        <template v-else>{{ chipLabels[callout.id] }} · {{ chipValue(callout) }}</template>
      </span>
    </div>

    <aside v-if="tier === 'detail' && view.focused" class="city-play-stats" data-city-play-stats>
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
      :class="`city-play-pin--${pin.kind}`"
      :data-city-play-pin="pin.plotId"
      :style="{ left: `${pin.at.x}px`, top: `${pin.at.y}px` }"
    >
      <UiIcon :name="pin.icon" :size="18" />
      <span>{{ pin.title }}</span>
      <span v-if="pin.built" class="city-play-pin-kept">{{ t('Kept') }}</span>
    </button>

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
        <button type="button" class="city-play-action city-play-action--quiet" data-city-play-records :disabled="view.pending" @click="controls?.openRecords()">
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
