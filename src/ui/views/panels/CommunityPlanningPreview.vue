<script setup>
import { storeToRefs } from 'pinia';
import { nextTick, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import { useCommunityPlanningStore } from '../../stores/communityPlanning.js';
import CityBuilderEditor from './CityBuilderEditor.vue';
import CityRoomPanel from './CityRoomPanel.vue';

// The opt-in park proposal comparison, as src/ui/communityPlanningPreview.js
// presents it: a Scene panel launcher and, while open, one modal. Choosing a
// mode or card is presentation only and never changes proposal data.
const { launcher, preview, controls } = storeToRefs(useCommunityPlanningStore());

const root = useTemplateRef('root');
const heading = useTemplateRef('heading');
const launcherButton = useTemplateRef('launcherButton');
const inspectNav = useTemplateRef('inspectNav');
const coopButton = useTemplateRef('coopButton');

// Remember which of the two visible launchers opened this dialog.
let returnFocus = null;
watch(
  () => Boolean(preview.value),
  async (open, wasOpen) => {
    if (open && !wasOpen) returnFocus = document.activeElement?.closest?.('[data-city-builder-open], [data-community-planning-preview-open]');
    await nextTick();
    if (open && !wasOpen) {
      root.value?.showModal?.();
      heading.value?.focus({ preventScroll: true });
    } else if (!open && wasOpen && launcher.value) {
      const target = returnFocus?.isConnected ? returnFocus : launcherButton.value?.$el;
      target?.focus?.({ preventScroll: true });
      returnFocus = null;
    }
  },
);
onBeforeUnmount(() => {
  if (root.value?.open) root.value.close();
});

async function setMode(mode, event) {
  // Rehome focus before Inspect is hidden, rather than dropping to <body>.
  if (mode === 'co-op' && inspectNav.value?.contains(document.activeElement))
    coopButton.value?.$el?.focus({ preventScroll: true });
  controls.value?.setMode(mode);
  // A keyboard activation of Game hands focus to the selected Inspect control;
  // pointer and touch keep it on the mode control.
  if (mode === 'game' && event?.detail === 0) {
    await nextTick();
    inspectNav.value
      ?.querySelector('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }
}

const dialogStyle = { background: '#08141e', color: '#e3faff', border: '1px solid #397080', borderRadius: '6px', padding: '20px', width: 'min(900px,calc(100vw - 32px))', boxSizing: 'border-box', position: 'fixed', inset: '0', margin: 'auto', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', overflowWrap: 'anywhere', font: '14px/1.5 sans-serif' };
const buttonStyle = { background: '#10242e', color: '#e3faff', border: '1px solid #397080', borderRadius: '3px', padding: '7px 11px', margin: '6px 6px 6px 0', cursor: 'pointer', font: 'inherit' };
const cardStyle = { flex: '1 1 245px', minWidth: '0', padding: '12px', background: '#10242e', border: '1px solid #397080', borderRadius: '6px' };
</script>

<template>
  <div v-if="launcher" class="scene-controls">
    <UiButton ref="launcherButton" type="button" class="gev-action-button scene-btn" data-community-planning-preview-open @click="controls?.open()">{{ launcher.label }}</UiButton>
  </div>
  <Teleport to="body">
    <dialog v-if="preview" ref="root" data-community-planning-preview :aria-label="preview.title" :style="[dialogStyle, preview.city ? { width: 'min(1200px,calc(100vw - 32px))' } : null]" @cancel.prevent="controls?.close()">
      <h2 ref="heading" tabindex="-1" style="margin-bottom: 12px">{{ preview.title }}</h2>
      <p style="color: #aad3db">{{ preview.intro }}</p>
      <p data-planning-local-only style="color: #aad3db">{{ preview.localOnly }}</p>
      <p v-for="(source, index) in preview.sources" :key="index" data-planning-source-provenance>{{ source }}</p>
      <p>{{ preview.compareNote }}</p>
      <p class="planning-record-status" data-planning-record-summary>{{ preview.recordSummary }}</p>
      <details v-if="preview.additional" data-planning-additional-details>
        <summary>{{ preview.additional.summary }}</summary>
        <ul>
          <li v-for="(item, index) in preview.additional.items" :key="index" data-planning-additional-record>{{ item }}</li>
          <li v-if="preview.additional.more">{{ preview.additional.more }}</li>
        </ul>
      </details>
      <details v-if="preview.excluded" data-planning-excluded-details>
        <summary>{{ preview.excluded.summary }}</summary>
        <ul>
          <li v-for="(item, index) in preview.excluded.items" :key="index" data-planning-excluded-record>{{ item }}</li>
          <li v-if="preview.excluded.more">{{ preview.excluded.more }}</li>
        </ul>
      </details>
      <p v-if="preview.unavailable" class="planning-comparison-unavailable" role="status" data-planning-comparison-unavailable>{{ preview.unavailable }}</p>
      <nav ref="inspectNav" data-planning-focus-navigation :aria-label="t('Inspect a hypothetical proposal')" :hidden="!preview.inspect.length">
        <UiButton v-for="item in preview.inspect" :key="item.id" :style="buttonStyle" :pressed="item.pressed" :data-planning-focus-id="item.id" @click="controls?.inspect(item.id)">{{ item.label }}</UiButton>
      </nav>
      <CityBuilderEditor v-if="preview.city && !preview.city.room?.active" :city="preview.city" :controls="controls" />
      <div v-if="!preview.city?.room?.active" data-planning-alternatives style="display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch">
        <article v-if="preview.city?.reference" data-planning-baseline :style="cardStyle">
          <h3>{{ t('Reference-only baseline') }}</h3>
          <img :src="preview.city.reference.image" :alt="t('Captured baseline reference')" style="width: 100%; object-fit: contain">
          <p>{{ t('Captured globe pixels, not verified parcel geometry or permission to build.') }}</p>
          <time :datetime="preview.city.reference.capturedAt">{{ preview.city.reference.capturedAt }}</time>
        </article>
        <article v-for="card in preview.cards" :key="card.id" :data-alternative-id="card.id" :aria-label="card.label" :hidden="card.hidden" :style="cardStyle">
          <h3>{{ card.title }}</h3>
          <p v-if="card.description" data-planning-description>{{ card.description }}</p>
          <figure v-if="card.concept" data-planning-concept style="margin: 12px 0">
            <img :src="card.concept.image" :alt="t('AI concept, not a plan or an approval')" style="display: block; width: 100%; object-fit: contain">
            <figcaption>{{ t('AI concept, not a plan or an approval') }}</figcaption>
            <p>{{ t('Concept provider') }}: {{ card.concept.provider }}</p>
            <time :datetime="card.concept.generatedAt">{{ card.concept.generatedAt }}</time>
            <details><summary>{{ t('Concept prompt') }}</summary><p>{{ card.concept.prompt }}</p></details>
          </figure>
          <p style="color: #d5b67b">{{ t('HYPOTHETICAL · NOT APPROVED') }}</p>
          <p class="planning-author-credit">{{ card.author }}</p>
          <p class="planning-edit-provenance">{{ card.edit }}</p>
          <p>{{ card.revision }}</p>
          <svg v-if="!preview.city" viewBox="0 0 300 150" width="100%" height="150" role="img" :aria-label="card.plotLabel">
            <rect x="1" y="1" width="298" height="148" rx="6" fill="#0b2630" stroke="#3d6372" />
            <circle v-for="marker in card.markers" :key="marker.id" :cx="marker.x" :cy="marker.y" r="7" :fill="marker.color" stroke="#f0f7f8" stroke-width="1.5"><title>{{ marker.label }}</title></circle>
          </svg>
          <p>{{ card.features }}</p>
          <p>{{ card.impact }}</p>
          <p>{{ card.approval }}</p>
          <p v-for="(assumption, index) in card.assumptions" :key="index">{{ assumption }}</p>
        </article>
      </div>
      <CityRoomPanel v-if="preview.city?.room" :room="preview.city.room" :controls="controls?.room" />
      <p data-planning-mode-status role="status" aria-live="polite" aria-atomic="true">{{ preview.modeStatus }}</p>
      <p role="status">{{ preview.status }}</p>
      <div>
        <UiButton :style="buttonStyle" data-planning-cancel @click="controls?.close()">{{ t('Cancel') }}</UiButton>
        <UiButton v-if="!preview.city?.room?.active" ref="coopButton" :style="buttonStyle" data-planning-mode="co-op" :pressed="preview.mode === 'co-op'" @click="setMode('co-op', $event)">{{ t('Co-op view') }}</UiButton>
        <UiButton v-if="!preview.city?.room?.active" :style="buttonStyle" data-planning-mode="game" :pressed="preview.mode === 'game'" :disabled="preview.gameDisabled" :title="preview.gameDisabled ? preview.gameDisabledReason : undefined" @click="setMode('game', $event)">{{ t('Game view') }}</UiButton>
      </div>
    </dialog>
  </Teleport>
</template>
