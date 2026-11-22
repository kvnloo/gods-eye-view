<script setup>
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { boundsOf, placeBeside } from '../../cityPlayModel.js';

// Massing v0 (behind ?massing=1), beside the selected plot: the assumed block's
// height, storeys, FAR, floor area, homes and shadow reach, with one storeys stepper. The globe
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
    {
      id: 'homes',
      label: t('Homes'),
      value: number(m.homes),
      est: true,
      assumed: t('Assumed {share}% of the floor area is homes of {size} m² each', {
        share: number(m.residentialShare * 100, { maximumFractionDigits: 0 }),
        size: number(m.homeSquareMeters),
      }),
    },
    {
      id: 'shadow',
      label: t('Shadow reach'),
      value: t('{value} m', { value: number(m.shadowReachMeters, { maximumFractionDigits: 0 }) }),
      est: true,
      assumed: t('Height ÷ tan(sun altitude {altitude}°), on level ground', {
        altitude: number(m.sunElevationDeg, { maximumFractionDigits: 1 }),
      }),
    },
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
// A phone's free band under the wheel holds two lines: there HOMES and SHADOW
// REACH stand in a strip above the plot tag instead.
const EXTRA = ['homes', 'shadow'];
const phone = computed(() => viewport.value.width < 600);
const mainRows = computed(() => (phone.value ? rows.value.filter((r) => !EXTRA.includes(r.id)) : rows.value));
const extraRows = computed(() => (phone.value ? rows.value.filter((r) => EXTRA.includes(r.id)) : []));
const extraBox = ref(null);
const extraPlace = ref(null);
function layout() {
  if (!shown.value) {
    place.value = null;
    extraPlace.value = null;
    return;
  }
  const wheel = rects('[data-city-play-action], [data-city-play-wheel] .city-play-wheel-ring');
  const target = boundsOf([...(anchors.value?.footprint ?? []), ...(massingAnchors.value?.points ?? []), ...wheel.flatMap(corners)]);
  const size = box.value?.offsetWidth ? { width: box.value.offsetWidth, height: box.value.offsetHeight } : on.value ? { width: 240, height: 176 } : { width: 150, height: 52 };
  const placed = placeBeside({ target, size, viewport: viewport.value, keepOut: KEEP_OUT.flatMap(rects), gap: phone.value ? 8 : 16 });
  // With no clear spot (the plot fills the view) the toggle still stays on screen.
  const clamp = (v, high) => Math.min(Math.max(v, 12), Math.max(12, high - 12));
  place.value = placed && { ...placed, x: clamp(placed.x, viewport.value.width - size.width), y: clamp(placed.y, viewport.value.height - size.height) };
  if (!extraRows.value.length || !place.value) {
    extraPlace.value = null;
    return;
  }
  // Beside the wheel and the plot tag together, clear of the readout and the HUD.
  const extraSize = extraBox.value?.offsetWidth ? { width: extraBox.value.offsetWidth, height: extraBox.value.offsetHeight } : { width: 300, height: 34 };
  const readout = { left: place.value.x, top: place.value.y, right: place.value.x + size.width, bottom: place.value.y + size.height };
  const extra = placeBeside({
    target: boundsOf([{ x: target.left, y: target.top }, { x: target.right, y: target.bottom }, ...rects('[data-city-play-tag]').flatMap(corners)]),
    size: extraSize,
    viewport: viewport.value,
    keepOut: [...KEEP_OUT.flatMap(rects), readout],
    gap: 8,
  });
  extraPlace.value = extra && { x: clamp(extra.x, viewport.value.width - extraSize.width), y: clamp(extra.y, viewport.value.height - extraSize.height) };
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
      <div v-for="row in mainRows" :key="row.id" class="city-massing-row" :data-city-massing-row="row.id">
        <dt :title="row.title">{{ row.label }}</dt>
        <dd>
          <button v-if="row.stepper" type="button" class="city-massing-step" data-city-massing-step="-1" :aria-label="t('Remove a storey')" :disabled="massing.storeys <= 1" @click="massingControls?.step(-1)">−</button>
          <span class="city-massing-value" data-city-massing-value>{{ row.value }}</span>
          <span v-if="row.est" class="city-massing-est" data-city-massing-est :title="row.assumed ?? assumed">{{ t('EST', { context: 'estimated value' }) }}</span>
          <button v-if="row.stepper" type="button" class="city-massing-step" data-city-massing-step="1" :aria-label="t('Add a storey')" :disabled="massing.storeys >= massing.maxStoreys" @click="massingControls?.step(1)">+</button>
        </dd>
      </div>
    </dl>
  </section>
  <section
    v-if="shown && extraRows.length"
    ref="extraBox"
    class="city-massing city-massing-extra"
    data-city-massing-extra
    :aria-label="t('Massing estimate for this plot')"
    :style="extraPlace ? { left: `${extraPlace.x}px`, top: `${extraPlace.y}px` } : { visibility: 'hidden' }"
  >
    <dl class="city-massing-rows" aria-live="polite">
      <div v-for="row in extraRows" :key="row.id" class="city-massing-row" :data-city-massing-row="row.id">
        <dt>{{ row.label }}</dt>
        <dd>
          <span class="city-massing-value" data-city-massing-value>{{ row.value }}</span>
          <span class="city-massing-est" data-city-massing-est :title="row.assumed">{{ t('EST', { context: 'estimated value' }) }}</span>
        </dd>
      </div>
    </dl>
  </section>
  <svg v-if="shown && place" class="city-massing-leader" data-city-massing-leader aria-hidden="true">
    <line :x1="place.leader.from.x" :y1="place.leader.from.y" :x2="place.leader.to.x" :y2="place.leader.to.y" />
  </svg>
</template>
