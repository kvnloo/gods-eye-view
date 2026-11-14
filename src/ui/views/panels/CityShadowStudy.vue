<script setup>
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useCityPlayStore } from '../../stores/cityPlay.js';
import { boundsOf, placeBeside } from '../../cityPlayModel.js';
import { hudFigure } from '../../cityHudFigure.js';
import { shadowTip } from '../../cityShadowTip.js';

// The shadow study of massing v0 (behind ?massing=1), beside the massing
// readout once MASSING is on: PROTECT SIDEWALK holds the block's shadow against
// an edge across the street. The globe owner (src/standalone/cityMassing.js)
// publishes the plan (src/data/cityShadowFit.js) and where its ground lines end
// on screen; this panel words it and sends every click back through the controls.
const { massing, massingAnchors, massingControls } = storeToRefs(useCityPlayStore());

const viewport = ref({ width: 1440, height: 900 });
// A phone has no room beside the wheel for a second panel: desktop only.
const study = computed(() => (massing.value?.on && viewport.value.width >= 600 ? (massing.value.shadow ?? null) : null));
const plan = computed(() => (study.value?.on ? study.value.plan : null));
const est = () => t('EST', { context: 'estimated value' });
const meters = (value) => hudFigure({ value: Math.abs(Math.round(value)), unit: 'm', estimate: true });
// Missing stays a dash, never zero.
const rows = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const { now, was } = p;
  const sun = massing.value.sunElevationDeg;
  const reaches = now.overMeters > 0;
  return [
    { id: 'sun', label: t('Sun altitude'), value: sun > 0 ? `${formatNumber(sun, { maximumFractionDigits: 0 })}° ${est()}` : '—' },
    { id: 'floors', label: t('Floors'), value: hudFigure({ before: was?.storeys, value: now.storeys, estimate: true }) },
    {
      id: 'edge',
      label: now.overMeters === null ? t('Shadow') : reaches ? t('Onto sidewalk') : t('Clears sidewalk by'),
      value: now.overMeters === null ? '—' : meters(now.overMeters),
      alert: reaches,
    },
  ];
});
// What FIT TO SUN would leave, while it can still cut.
const fitFloors = computed(() => {
  const p = plan.value;
  return p?.canFit ? hudFigure({ before: p.now.storeys, value: p.fit.storeys, estimate: true }) : null;
});
const note = computed(() => {
  const p = plan.value;
  if (study.value?.picking) return t('Click the ground across the street');
  if (!p) return null;
  if (!p.fit) return t('The sun is down: no shadow to fit');
  if (p.cannotClear) return t('Even one storey reaches the sidewalk');
  return null;
});

// Under or over the readout; the tips beside the far side of their lines. All
// clear of the HUD, the block with its shadow and each other where the screen
// allows. The play wheel steps aside while the study is on (city-massing.css).
const KEEP_OUT = [
  '#cesium-credits .cesium-widget-credits',
  '#command-dock',
  '#gev-voice-control',
  '#top-center-actions',
  '[data-city-play-bar]',
  '[data-city-play-tag]',
  '[data-city-massing]',
];
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const rectAt = ({ x, y }, size) => ({ left: x, top: y, right: x + size.width, bottom: y + size.height });
const rects = (selector) =>
  [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
const box = ref(null);
const place = ref(null);
const tipBoxes = {};
const tips = ref([]);
let settled = '';
function layout() {
  const readout = rects('[data-city-massing]')[0];
  if (!study.value || !readout) {
    place.value = null;
    tips.value = [];
    settled = '';
    return;
  }
  const { width, height } = viewport.value;
  const block = boundsOf(massingAnchors.value?.points ?? []);
  const keepOut = [...KEEP_OUT.flatMap(rects), ...(block ? [block] : [])];
  const size = box.value?.offsetWidth ? { width: box.value.offsetWidth, height: box.value.offsetHeight } : { width: 240, height: 52 };
  // Under the readout, then over it, on either of its sides: the first spot
  // on screen that covers nothing, else wherever beside it covers least.
  const free = (spot) => {
    const r = rectAt(spot, size);
    return r.left >= 12 && r.top >= 12 && r.right <= width - 12 && r.bottom <= height - 12 && !keepOut.some((k) => k !== readout && overlaps(r, k));
  };
  place.value =
    [readout.bottom + 8, readout.top - 8 - size.height].flatMap((y) => [readout.left, readout.right - size.width].map((x) => ({ x, y }))).find(free) ??
    placeBeside({ target: readout, size, viewport: viewport.value, keepOut, gap: 8 });
  const used = [...keepOut, rectAt(place.value, size)];
  tips.value = (plan.value?.lines ?? []).flatMap((line) => {
    const [a, b] = massingAnchors.value?.tips?.[line.kind] ?? [];
    const text = shadowTip(line);
    if (!a || !b || !text) return [];
    const el = tipBoxes[line.kind];
    const tipSize = el?.offsetWidth ? { width: el.offsetWidth, height: el.offsetHeight } : { width: text.length * 8.4 + 26, height: 30 };
    const tries = [14, 48, 96].map((gap) => placeBeside({ target: boundsOf([a, b]), size: tipSize, viewport: viewport.value, keepOut: used, gap }));
    const spot = tries.find((s) => s.clear) ?? tries[0];
    used.push(rectAt(spot, tipSize));
    return [{ kind: line.kind, text, at: spot.leader.to, x: spot.x, y: spot.y, from: spot.leader.from }];
  });
  // Once more when the outcome moved: the boxes are measured after they render.
  const outcome = JSON.stringify([place.value, tips.value]);
  if (outcome !== settled) {
    settled = outcome;
    nextTick(schedule);
  }
}
let frame = 0;
const schedule = () => {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
};
// The readout (mounted before this panel) places itself first in the same frame.
watch([massing, massingAnchors], () => {
  if (study.value || place.value) nextTick(schedule);
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
    v-if="study"
    ref="box"
    class="city-massing city-shadow"
    data-city-shadow
    :data-city-shadow-on="study.on"
    :aria-label="t('Shadow on the sidewalk across the street')"
    :style="place ? { left: `${place.x}px`, top: `${place.y}px` } : { visibility: 'hidden' }"
  >
    <button type="button" class="city-massing-toggle" data-city-shadow-toggle :aria-pressed="String(study.on)" @click="massingControls?.study()">
      <span class="city-massing-led" aria-hidden="true"></span>{{ t('Protect sidewalk') }}
    </button>
    <dl v-if="study.on" class="city-massing-rows" data-city-shadow-rows aria-live="polite">
      <div class="city-massing-row" data-city-shadow-row="distance">
        <dt>{{ t('Far sidewalk') }}</dt>
        <dd>
          <button type="button" class="city-massing-step" data-city-shadow-edge="-1" :aria-label="t('Sidewalk 1 m nearer')" :disabled="study.edgeMeters <= 1" @click="massingControls?.stepEdge(-1)">−</button>
          <span class="city-massing-value" data-city-shadow-value>{{ hudFigure({ value: study.edgeMeters, unit: 'm' }) }}</span>
          <button type="button" class="city-massing-step" data-city-shadow-edge="1" :aria-label="t('Sidewalk 1 m farther')" @click="massingControls?.stepEdge(1)">+</button>
        </dd>
      </div>
      <div class="city-massing-row city-shadow-set">
        <dt>
          <span v-if="!study.edgeSet" class="city-massing-est" data-city-shadow-assumed :title="t('Assumed until you set it: metres from the block face, along the shadow')">{{ t('Assumed') }}</span>
        </dt>
        <dd>
          <button type="button" class="city-shadow-button" data-city-shadow-pick :aria-pressed="String(study.picking)" @click="massingControls?.pickEdge()">{{ t('Set on map') }}</button>
        </dd>
      </div>
      <template v-for="row in rows" :key="row.id">
        <div class="city-massing-row" :class="{ 'city-shadow-alert': row.alert }" :data-city-shadow-row="row.id">
          <dt>{{ row.label }}</dt>
          <dd>
            <span class="city-massing-value" data-city-shadow-value>{{ row.value }}</span>
          </dd>
        </div>
        <div v-if="row.id === 'sun' && !study.winter" class="city-massing-row city-shadow-set">
          <dt></dt>
          <dd>
            <button type="button" class="city-shadow-button" data-city-shadow-winter :title="t('Set the scene to solar noon on the winter solstice here')" @click="massingControls?.winterNoon()">{{ t('Winter noon') }}</button>
          </dd>
        </div>
      </template>
      <button type="button" class="city-shadow-button city-shadow-fit" data-city-shadow-fit :disabled="!fitFloors" @click="massingControls?.fit()">
        {{ t('Fit to sun') }}<template v-if="fitFloors"> · {{ t('Floors') }} {{ fitFloors }}</template>
      </button>
      <p v-if="note" class="city-shadow-note" data-city-shadow-note>{{ note }}</p>
    </dl>
  </section>
  <svg v-if="study && tips.length" class="city-massing-leader" data-city-shadow-leaders aria-hidden="true">
    <template v-for="tip in tips" :key="tip.kind">
      <line :x1="tip.from.x" :y1="tip.from.y" :x2="tip.at.x" :y2="tip.at.y" />
      <circle :cx="tip.at.x" :cy="tip.at.y" r="5" />
    </template>
  </svg>
  <p
    v-for="tip in study ? tips : []"
    :key="tip.kind"
    :ref="(el) => (tipBoxes[tip.kind] = el)"
    class="city-shadow-tip"
    :data-city-shadow-tip="tip.kind"
    :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
  >
    {{ tip.text }}
  </p>
</template>
