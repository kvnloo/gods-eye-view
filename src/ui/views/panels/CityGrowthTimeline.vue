<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../../i18n/index.js';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { growthLines, growthStageLabel } from '../../cityGrowthLines.js';

// The growth timeline of a district (behind ?massing=1), once play mode holds
// one (shift-click a second plot): GROWTH stands a block on every plot of it,
// one rail steps through NOW, 5 YR and 15 YR, and each stage states its
// figures once. The globe owner (src/standalone/cityMassing.js) publishes the
// plan (src/data/cityGrowth.js) and where its sun-locked blocks are on screen;
// every click goes back through its controls.
const { growth, growthAnchors, massingControls } = storeToRefs(useCityPlayStore());

const width = ref(1440);
const measure = () => {
  width.value = window.innerWidth;
};
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));

// A phone has no room for the timeline beside the district: desktop only.
const timeline = computed(() => (width.value >= 600 ? growth.value : null));
const lines = computed(() => (timeline.value ? growthLines(timeline.value.plan, timeline.value.stage) : []));
const stops = computed(() => timeline.value.plan.stages.map((stage, index) => ({ id: stage.id, index, label: growthStageLabel(stage) })));
const storeys = computed(() => timeline.value.plan.stages[timeline.value.stage].storeys);
const locks = computed(() => (timeline.value?.on ? (growthAnchors.value?.locks ?? []) : []));
</script>

<template>
  <section v-if="timeline" class="city-massing city-growth" data-city-growth :data-city-growth-on="timeline.on" :aria-label="t('Growth timeline for this district')">
    <button type="button" class="city-massing-toggle" data-city-growth-toggle :aria-pressed="String(timeline.on)" @click="massingControls?.growth()">
      <span class="city-massing-led" aria-hidden="true"></span>{{ t('Growth timeline') }}
    </button>
    <p class="city-growth-line" data-city-growth-line="district">{{ lines[0].text }}</p>
    <template v-if="timeline.on">
      <div class="city-growth-rail" data-city-growth-rail role="group" :aria-label="t('Timeline stage')">
        <button
          v-for="stop in stops"
          :key="stop.id"
          type="button"
          class="city-growth-stop"
          :data-city-growth-stop="stop.id"
          :aria-pressed="String(stop.index === timeline.stage)"
          @click="massingControls?.stage(stop.index)"
        >
          {{ stop.label }}
        </button>
      </div>
      <div class="city-growth-lines" data-city-growth-lines aria-live="polite">
        <p v-for="line in lines.slice(1)" :key="line.id" class="city-growth-line" :class="`city-growth-line--${line.id}`" :data-city-growth-line="line.id">
          <span data-city-growth-text>{{ line.text }}</span>
          <span v-if="line.id === 'floors'" class="city-growth-steps">
            <button type="button" class="city-massing-step" data-city-growth-step="-1" :aria-label="t('Remove a storey')" :disabled="storeys <= 1" @click="massingControls?.stepStage(-1)">−</button>
            <button type="button" class="city-massing-step" data-city-growth-step="1" :aria-label="t('Add a storey')" :disabled="storeys >= timeline.maxStoreys" @click="massingControls?.stepStage(1)">+</button>
          </span>
        </p>
      </div>
    </template>
  </section>
  <span
    v-for="lock in locks"
    :key="lock.plotId"
    class="city-growth-lock"
    data-city-growth-lock
    :title="t('LOCKED PLOTS KEEP THEIR SUN FIT')"
    :style="{ left: `${lock.at.x}px`, top: `${lock.at.y}px` }"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z" /></svg>{{ t('Sun fit') }}
  </span>
</template>
