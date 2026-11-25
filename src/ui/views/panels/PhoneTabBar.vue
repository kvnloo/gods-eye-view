<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, ref } from 'vue';
import { t } from '../../../i18n/index.js';
import { useDisplayStore } from '../../stores/display.js';
import CastButton from './CastButton.vue';

// The phone shell's one bottom sheet (Sound Atlas's layout): a grab handle,
// the search field, the player row and the segmented panel tabs, with the
// open panel below them. Voice, Chat and Stories keep their own elements and
// ride the player row by CSS (styles/mobile-shell.css); Cast renders here.
// The sheet joins the end of the page when the shell first publishes, after
// the scene's credits, and leaves it when the shell is destroyed; desktop CSS
// hides it meanwhile. The shell (mobileShell.js) takes the clicks and drags
// from the document; Cast opens its own menu.
const { phoneShell: phone } = storeToRefs(useDisplayStore());
const snapLabel = (snap) =>
  snap === 'peek' ? t('Peek') : snap === 'full' ? t('Full') : t('Half');
const grabLabel = computed(() =>
  t('Resize sheet, now {size}', { size: snapLabel(phone.value?.snap) }),
);
const search = computed(() =>
  phone.value?.tabs.find((tab) => tab.sheet === 'search'),
);
// Share and Clear wait behind one toggle at the end of the globe-actions
// pill, so the pill at rest holds the three view tools.
const toolsOpen = ref(false);
const toggleTools = () => {
  toolsOpen.value = !toolsOpen.value;
  document.body.classList.toggle('mobile-tools-open', toolsOpen.value);
};
onBeforeUnmount(() => document.body.classList.remove('mobile-tools-open'));
const panelTabs = computed(
  () =>
    phone.value?.tabs.filter((tab) => tab.sheet && tab.sheet !== 'search') ??
    [],
);
</script>

<template>
  <Teleport v-if="phone" to="body">
    <div id="mobile-sheet-backdrop" :hidden="!phone.sheet"></div>
    <nav id="mobile-tab-bar" :aria-label="t('Panels')" :aria-hidden="String(!phone.enabled)" :data-sheet-open="phone.sheet ? 'true' : undefined">
      <button v-if="phone.sheet && phone.snap" id="mobile-sheet-grab" type="button" :aria-label="grabLabel" aria-keyshortcuts="ArrowUp ArrowDown" :data-snap="phone.snap"><span class="mobile-sheet-grab-bar" aria-hidden="true"></span></button>
      <span v-else class="mobile-sheet-handle" aria-hidden="true"><span class="mobile-sheet-grab-bar"></span></span>
      <button v-if="search" type="button" class="mobile-tab mobile-search-field" data-mobile-sheet="search" :aria-expanded="String(phone.sheet === 'search')" :aria-label="t(search.label)"><span class="material-symbols-outlined mobile-tab-icon" aria-hidden="true">search</span><span class="mobile-search-placeholder" aria-hidden="true">{{ t('Search any location...') }}</span></button>
      <div class="mobile-player-row">
        <span class="mobile-player-slot" aria-hidden="true"></span>
        <span class="mobile-stories-slot" aria-hidden="true"></span>
        <CastButton variant="tab" />
      </div>
      <div class="mobile-segments">
        <button v-for="tab in panelTabs" :key="tab.sheet" type="button" class="mobile-tab" :data-mobile-sheet="tab.sheet" :aria-expanded="String(phone.sheet === tab.sheet)"><span class="material-symbols-outlined mobile-tab-icon" aria-hidden="true">{{ tab.icon }}</span><span class="mobile-tab-label">{{ t(tab.label) }}</span></button>
      </div>
      <button id="mobile-tools-toggle" type="button" :aria-label="t('Globe actions')" aria-controls="top-center-actions" :aria-expanded="String(toolsOpen)" @click="toggleTools"><span class="material-symbols-outlined" aria-hidden="true">{{ toolsOpen ? 'chevron_right' : 'more_horiz' }}</span></button>
    </nav>
  </Teleport>
</template>
