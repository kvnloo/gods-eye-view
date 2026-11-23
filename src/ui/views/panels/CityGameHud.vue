<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import UiChip from '../../kit/UiChip.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { hudFigure } from '../../cityHudFigure.js';
import { MAX_ZONED_PLOTS } from '../../../data/cityLandUse.js';
import { nearestCity } from '../../../data/wikidataCities.js';
import { pageHudFlags, tickFigure, topBarModel, trayModel, trayShortcut } from '../../../data/cityGameHud.js';
import '../../styles/city-game-hud.css';

// FORK-ONLY (exp/city-game-hud, ?cityHud=game|bar): the game HUD of play
// mode, after the owner's wintercats references: one slim top resource bar and
// one bottom icon build tray, in GEV glass. It replaces the pill stats bar and
// the card dock (city-game-hud.css hides them); every verb goes back through
// the same play-mode and massing controls, and every figure is the app's own
// (src/data/cityGameHud.js), estimates marked EST, unknowns a dash.
const flags = pageHudFlags();
const { view, controls, massing, massingControls, growth } = storeToRefs(useCityPlayStore());
const active = computed(() => Boolean(flags.bar && view.value?.active));
const BODY_CLASS = 'gev-city-hud-bar';
onMounted(() => flags.bar && document.body.classList.add(BODY_CLASS));
onBeforeUnmount(() => document.body.classList.remove(BODY_CLASS));

// --- the place: the nearest city in GEV's own Wikidata city table ---------
const place = ref(null);
let placeFor = '';
watch(
  () => view.value?.active && (view.value?.plot?.id ?? 'none'),
  async () => {
    const at = window.__godsEyeView?.viewer?.camera?.positionCartographic;
    if (!at) return;
    const lat = (at.latitude * 180) / Math.PI;
    const lon = (at.longitude * 180) / Math.PI;
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (key === placeFor) return;
    placeFor = key;
    try {
      const city = await nearestCity(lat, lon);
      place.value = city?.name ?? null;
    } catch {
      place.value = null;
    }
  },
  { immediate: true },
);

// --- the top bar ------------------------------------------------------------
const zoned = computed(() => view.value?.zoned ?? 0);
const goals = computed(() => (view.value?.cards?.find((c) => c.focused) ?? view.value?.cards?.at(-1))?.moves ?? []);
const bar = computed(() =>
  topBarModel({
    place: place.value,
    growth: growth.value?.on ? growth.value : null,
    massing: massing.value?.on ? massing.value : null,
    zoned: zoned.value,
    zoneCap: MAX_ZONED_PLOTS,
    stats: view.value?.stats ?? [],
    kept: (view.value?.cards ?? []).filter((c) => c.built).length,
    goals: goals.value,
  }),
);
// Score chips tick up to a new figure (the build's juice), then hold.
const shown = ref({});
const bump = ref({});
let raf = 0;
watch(
  () => bar.value.chips.map((c) => `${c.id}:${c.value}`).join(),
  () => {
    const from = { ...shown.value };
    const to = Object.fromEntries(bar.value.chips.map((c) => [c.id, c.value]));
    const deltas = {};
    for (const [id, v] of Object.entries(to))
      if (Number.isFinite(v) && Number.isFinite(from[id]) && v > from[id]) deltas[id] = v - from[id];
      else if (Number.isFinite(v) && !Number.isFinite(from[id]) && v > 0 && from[id] !== undefined) deltas[id] = v;
    bump.value = deltas;
    cancelAnimationFrame(raf);
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 900);
      shown.value = Object.fromEntries(Object.entries(to).map(([id, v]) => [id, tickFigure(from[id], v, k)]));
      if (k < 1) raf = requestAnimationFrame(step);
      else setTimeout(() => (bump.value = {}), 1400);
    };
    step();
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(raf));

const chipIcon = { residents: 'location_city', homes: 'view_in_ar', zoning: 'category', concepts: 'auto_awesome', trees: 'park' };
const chipLabel = computed(() => ({
  residents: t('Residents'),
  homes: t('Homes'),
  zoning: t('Zoning'),
  concepts: t('Concepts'),
  trees: t('Trees'),
}));
function chipText(chip) {
  const v = shown.value[chip.id] ?? chip.value;
  if (chip.id === 'zoning') return chip.cap ? `${v ?? 0}/${chip.cap}` : hudFigure({ value: v }) ?? '—';
  if (chip.id === 'homes' && Number.isFinite(chip.low) && chip.low !== chip.high && !growth.value?.on)
    return `${hudFigure({ value: chip.low })}–${hudFigure({ value: chip.high })}`;
  return hudFigure({ value: v }) ?? '—';
}
const moveLabels = computed(() => ({ canopy_pct: t('Canopy'), bike_m: t('Bike lane') }));
const stageLabels = computed(() => ({ now: t('Now'), '5yr': t('Year 5'), '15yr': t('Year 15') }));

// --- the tray ---------------------------------------------------------------
const category = ref('build');
const tray = computed(() =>
  trayModel({
    category: category.value,
    plot: Boolean(view.value?.plot),
    pending: Boolean(view.value?.pending),
    full: Boolean(view.value?.actions?.find((a) => a.id === 'park')?.disabled && !view.value?.pending),
    zoneFull: zoned.value >= MAX_ZONED_PLOTS && !view.value?.plot?.use,
    use: view.value?.plot?.use ?? null,
    massingOn: Boolean(massing.value?.on),
    massing: Boolean(massingControls.value),
  }),
);
const toolLabels = computed(() => ({
  housing: t('Housing'),
  'mixed-use': t('Mixed use'),
  civic: t('Civic'),
  'open-space': t('Open space'),
  'clear-use': t('Clear'),
  massing: t('Block'),
  reimagine: t('Reimagine'),
  inspect: t('Inspect'),
  park: t('Park'),
  plaza: t('Plaza'),
  'bike-lane': t('Bike lane'),
}));
const categoryLabels = computed(() => ({ zone: t('Zone'), build: t('Build'), park: t('Park'), transit: t('Transit'), trees: t('Trees') }));
const reasonLabels = computed(() => ({
  'no-plot': t('Pick a plot first'),
  pending: t('Imagining…'),
  full: t('No concept slot left'),
  budget: t('Zoning budget spent'),
  'no-use': t('No land use to clear'),
  unavailable: t('Massing is off'),
}));
function useTool(tool) {
  if (tool.disabled) return;
  if (tool.verb === 'massing') massingControls.value?.toggle();
  else controls.value?.act(tool.id);
  controls.value?.arm?.(tool.id);
}
const focused = computed(() => view.value?.cards?.find((c) => c.focused) ?? view.value?.cards?.at(-1) ?? null);
function onKey(event) {
  if (!active.value) return;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
  if (String(event.key).toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (focused.value?.image && !view.value?.pending) {
      event.preventDefault();
      controls.value?.build(focused.value.id);
    }
    return;
  }
  const hit = trayShortcut(event, tray.value);
  if (!hit) return;
  event.preventDefault();
  if (hit.type === 'category') category.value = hit.id;
  else useTool(hit.tool);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="active" class="city-game-hud" data-city-game-hud>
    <header class="city-game-top" data-city-game-top :aria-label="t('City resources')">
      <span class="city-game-place" data-city-game-place>
        <UiIcon name="location_city" :size="15" />
        <span translate="no">{{ bar.place ?? t('City') }}</span>
      </span>
      <span class="city-game-sep" aria-hidden="true"></span>
      <span v-for="chip in bar.chips.filter((c) => c.shown)" :key="chip.id" class="city-game-chip" :class="{ 'is-bumped': bump[chip.id] }" :data-city-game-chip="chip.id" :title="chip.id === 'residents' ? t('Homes × 2.3 people (assumed)') : undefined">
        <UiIcon :name="chipIcon[chip.id]" :size="15" />
        <span class="city-game-chip-label">{{ chipLabel[chip.id] }}</span>
        <strong translate="no">{{ chipText(chip) }}</strong>
        <span v-if="chip.estimate && chip.value != null" class="city-game-est">{{ t('EST', { context: 'estimated value' }) }}</span>
        <span v-if="bump[chip.id]" class="city-game-bump" aria-hidden="true">+{{ hudFigure({ value: bump[chip.id] }) }}</span>
      </span>
      <template v-if="bar.goals.length">
        <span class="city-game-sep" aria-hidden="true"></span>
        <span v-for="goal in bar.goals" :key="goal.id" class="city-game-chip city-game-goal" :data-city-game-goal="goal.id">
          <UiIcon name="star" :size="15" />
          <span class="city-game-chip-label">{{ moveLabels[goal.id] ?? goal.id }}</span>
          <strong translate="no">{{ hudFigure({ value: goal.value, before: goal.before, unit: goal.unit }) ?? '—' }}</strong>
          <span class="city-game-est">{{ t('EST', { context: 'estimated value' }) }}</span>
        </span>
      </template>
      <span class="city-game-sep" aria-hidden="true"></span>
      <span class="city-game-chip city-game-turn" data-city-game-turn>
        <UiIcon name="schedule" :size="15" />
        <strong translate="no">{{ bar.turn.stage ? stageLabels[bar.turn.stage] : t('Now') }}</strong>
        <span class="city-game-chip-label">{{ t('Kept') }} {{ bar.turn.kept }}</span>
      </span>
    </header>

    <section class="city-game-tray" data-city-game-tray :aria-label="t('Build tray')">
      <i class="city-game-corner city-game-corner--tl" aria-hidden="true"></i><i class="city-game-corner city-game-corner--br" aria-hidden="true"></i>
      <nav class="city-game-tabs" role="tablist">
        <UiButton
          v-for="c in tray.categories"
          :key="c.id"
          class="city-game-tab"
          :class="{ 'is-open': c.open }"
          :data-city-game-tab="c.id"
          :pressed="c.open"
          @click="category = c.id"
        >
          <UiIcon :name="c.icon" :size="15" />
          <span>{{ categoryLabels[c.id] }}</span>
          <kbd>{{ c.key }}</kbd>
        </UiButton>
      </nav>
      <div class="city-game-tools">
        <UiButton
          v-for="tool in tray.tools"
          :key="`${tray.open}-${tool.id}`"
          class="city-game-tool"
          :class="{ 'is-active': tool.active }"
          :data-city-game-tool="tool.id"
          :disabled="tool.disabled"
          :pressed="tool.active"
          :title="tool.reason ? reasonLabels[tool.reason] : toolLabels[tool.id]"
          @click="useTool(tool)"
        >
          <span class="city-game-tool-art"><UiIcon :name="tool.icon" :size="28" /></span>
          <span class="city-game-tool-label">{{ tool.as === 'trees' && tool.id === 'park' ? t('Trees') : toolLabels[tool.id] }}</span>
          <kbd v-if="tool.key">{{ tool.key.toUpperCase() }}</kbd>
        </UiButton>
        <span v-if="view.cards?.length" class="city-game-divider" aria-hidden="true"></span>
        <UiButton
          v-for="card in view.cards ?? []"
          :key="card.id"
          class="city-game-tool city-game-world"
          :class="{ 'is-active': card.focused, 'is-kept': card.built }"
          :data-city-game-world="card.id"
          :pressed="Boolean(card.focused)"
          :title="card.title"
          @click="controls?.focus(card.id)"
        >
          <span class="city-game-tool-art"><img v-if="card.image" :src="card.image" :alt="t('AI concept, not a plan or an approval')" /><UiIcon v-else :name="card.icon" :size="26" /></span>
          <span class="city-game-tool-label">{{ card.title }}</span>
        </UiButton>
      </div>
      <div class="city-game-verbs">
        <UiButton class="city-game-build" data-city-game-build :disabled="!focused || !focused.image || view.pending" @click="controls?.build(focused.id)">
          <UiIcon name="location_city" :size="18" /><span>{{ t('Build') }}</span><kbd>B</kbd>
        </UiButton>
        <UiButton class="city-game-reroll" data-city-game-reroll :disabled="!focused || view.pending" @click="controls?.reroll(focused.id)">
          <UiIcon name="casino" :size="16" /><span>{{ t('Reroll') }}</span>
        </UiButton>
        <UiChip class="city-game-ai" data-city-game-ai>{{ t('AI concept, not a plan or an approval') }}</UiChip>
      </div>
    </section>
  </div>
</template>
