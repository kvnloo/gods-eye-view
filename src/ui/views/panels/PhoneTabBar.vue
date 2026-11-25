<script setup>
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { t } from '../../../i18n/index.js';
import { useDisplayStore } from '../../stores/display.js';
import CastButton from './CastButton.vue';
import { useSpaceMissionsStore } from '../../stores/spaceMissions.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';

// The phone shell's tab bar, sheet backdrop and the open sheet's grab handle.
// They join the end of the page when the shell first publishes, after the
// scene's credits, and leave it when the shell is destroyed; desktop CSS
// hides them meanwhile. The shell (mobileShell.js) takes their clicks and
// drags from the document; Cast opens its own menu.
const { phoneShell: phone } = storeToRefs(useDisplayStore());
const snapLabel = (snap) =>
  snap === 'peek' ? t('Peek') : snap === 'full' ? t('Full') : t('Half');
const grabLabel = computed(() =>
  t('Resize sheet, now {size}', { size: snapLabel(phone.value?.snap) }),
);
const { enabled: missionsEnabled } = storeToRefs(useSpaceMissionsStore());
const tabs = computed(() =>
  phone.value?.tabs.filter((tab) => tab.sheet !== 'missions' || missionsEnabled.value),
);
</script>

<template>
  <Teleport v-if="phone" to="body">
    <div id="mobile-sheet-backdrop" :hidden="!phone.sheet"></div>
    <button v-if="phone.sheet && phone.snap" id="mobile-sheet-grab" type="button" :aria-label="grabLabel" aria-keyshortcuts="ArrowUp ArrowDown" :data-snap="phone.snap"><span class="mobile-sheet-grab-bar" aria-hidden="true"></span></button>
    <nav id="mobile-tab-bar" :aria-label="t('Panels')" :aria-hidden="String(!phone.enabled)">
      <template v-for="tab in tabs" :key="tab.sheet ?? tab.action">
        <CastButton v-if="tab.action === 'cast'" variant="tab" />
        <UiButton v-else class="mobile-tab" :data-mobile-sheet="tab.sheet" :aria-expanded="String(phone.sheet === tab.sheet)"><UiIcon class="mobile-tab-icon" :name="tab.icon" :size="null" /><span class="mobile-tab-label">{{ t(tab.label) }}</span></UiButton>
      </template>
    </nav>
  </Teleport>
</template>
