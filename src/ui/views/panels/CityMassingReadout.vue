<script setup>
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { boundsOf, placeBeside } from '../../cityPlayModel.js';

// Massing v0 (behind ?massing=1), beside the selected plot: the assumed block's
// height, storeys, FAR and floor area, with one storeys stepper. The globe
// owner (src/standalone/cityMassing.js) publishes the numbers and the screen
// points of the block and its shadow; every click goes back through its controls.
const { view, anchors, massing, massingAnchors, massingControls } = storeToRefs(useCityPlayStore());

const shown = computed(() => Boolean(view.value?.active && view.value.plot && view.value.tier !== 'district' && massing.value?.plotId === view.value.plot.id));
const on = computed(() => Boolean(massing.value?.on));
// Missing stays a dash, never zero.
const number = (value, options) => (Number.isFinite(value) ? formatNumber(value, options) : '—');
const rows = computed(() => {
  const m = massing.value;
  if (!m?.on) return [];
  return [
    { id: 'height', label: t('Height'), value: t('{value} m', { value: number(m.heightMeters, { maximumFractionDigits: 1 }) }), est: true },
    { id: 'storeys', label: t('Storeys'), value: number(m.storeys), stepper: true },
    {
      id: 'far',
      label: t('FAR', { context: 'floor area ratio' }),
      title: t('Floor area ratio: floor area ÷ plot area'),
      value: number(m.far, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    },
    { id: 'floor', label: t('Floor area'), value: t('{area} m²', { area: number(m.floorAreaSquareMeters, { maximumFractionDigits: 0 }) }) },
  ];
});
const assumed = computed(() =>
  t('Assumed {height} m per storey and a {setback} m setback', {
    height: number(massing.value?.storeyHeightMeters, { maximumFractionDigits: 1 }),
    setback: number(massing.value?.setbackMeters),
  }),
);

// Beside the plot, the wheel, the block and its shadow; clear of the HUD.
const KEEP_OUT = [
  '#cesium-credits .cesium-widget-credits',
  '#command-dock',
  '#gev-voice-control',
  '#mobile-tab-bar',
  '#top-center-actions',
  '[data-city-play-bar]',
  '[data-city-play-tag]',
  '[data-city-play-holo-tag]',
  '[data-city-play-stats]',
  '[data-city-play-legend]',
  '[data-city-play-carousel]',
];
const rects = (selector) =>
  [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
const corners = (r) => [
  { x: r.left, y: r.top },
  { x: r.right, y: r.bottom },
];
const viewport = ref({ width: 1440, height: 900 });
const box = ref(null);
const place = ref(null);
function layout() {
  if (!shown.value) {
    place.value = null;
    return;
  }
  const wheel = rects('[data-city-play-action], [data-city-play-wheel] .city-play-wheel-ring');
  const target = boundsOf([...(anchors.value?.footprint ?? []), ...(massingAnchors.value?.points ?? []), ...wheel.flatMap(corners)]);
  const size = box.value?.offsetWidth ? { width: box.value.offsetWidth, height: box.value.offsetHeight } : on.value ? { width: 240, height: 176 } : { width: 150, height: 52 };
  const placed = placeBeside({ target, size, viewport: viewport.value, keepOut: KEEP_OUT.flatMap(rects), gap: viewport.value.width < 600 ? 8 : 16 });
  // With no clear spot (the plot fills the view) the toggle still stays on screen.
  const clamp = (v, high) => Math.min(Math.max(v, 12), Math.max(12, high - 12));
  place.value = placed && { ...placed, x: clamp(placed.x, viewport.value.width - size.width), y: clamp(placed.y, viewport.value.height - size.height) };
}
let frame = 0;
const schedule = () => {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
};
// With the flag off (no massing view) play mode's per-frame anchors cost nothing here.
watch([view, anchors, massing, massingAnchors], () => {
  if (massing.value || place.value) nextTick(schedule);
});
const measure = () => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  schedule();
};
onMounted(() => {
  measure();
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
  cancelAnimationFrame(frame);
});
</script>

<template>
  <section
    v-if="shown"
    ref="box"
    class="city-massing"
    data-city-massing
    :data-city-massing-on="on"
    :aria-label="t('Massing estimate for this plot')"
    :style="place ? { left: `${place.x}px`, top: `${place.y}px` } : { visibility: 'hidden' }"
  >
    <button type="button" class="city-massing-toggle" data-city-massing-toggle :aria-pressed="String(on)" @click="massingControls?.toggle()">
      <span class="city-massing-led" aria-hidden="true"></span>{{ t('Massing') }}
    </button>
    <dl v-if="on" class="city-massing-rows" data-city-massing-rows aria-live="polite">
      <div v-for="row in rows" :key="row.id" class="city-massing-row" :data-city-massing-row="row.id">
        <dt :title="row.title">{{ row.label }}</dt>
        <dd>
          <button v-if="row.stepper" type="button" class="city-massing-step" data-city-massing-step="-1" :aria-label="t('Remove a storey')" :disabled="massing.storeys <= 1" @click="massingControls?.step(-1)">−</button>
          <span class="city-massing-value" data-city-massing-value>{{ row.value }}</span>
          <span v-if="row.est" class="city-massing-est" data-city-massing-est :title="assumed">{{ t('EST', { context: 'estimated value' }) }}</span>
          <button v-if="row.stepper" type="button" class="city-massing-step" data-city-massing-step="1" :aria-label="t('Add a storey')" :disabled="massing.storeys >= massing.maxStoreys" @click="massingControls?.step(1)">+</button>
        </dd>
      </div>
    </dl>
  </section>
  <svg v-if="shown && place" class="city-massing-leader" data-city-massing-leader aria-hidden="true">
    <line :x1="place.leader.from.x" :y1="place.leader.from.y" :x2="place.leader.to.x" :y2="place.leader.to.y" />
  </svg>
</template>
