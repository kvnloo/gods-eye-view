<script setup>
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { useCastStore } from '../../stores/cast.js';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';
import UiIcon from '../../kit/UiIcon.vue';

// The cast menu: the targets this browser can use (Samsung, Google Cast,
// AirPlay help), what the TV shows while casting, and Stop. Escape closes
// this menu first, before any phone sheet under it (capture phase).
const cast = useCastStore();
const { menuOpen, targets, casting, sender } = storeToRefs(cast);
const TARGET_ICONS = Object.freeze({ samsung: 'tv', chromecast: 'cast', airplay: 'airplay' });
const root = ref(null);
const helpOpen = ref(false);
const busy = computed(() => sender.value?.busy ?? null);
const error = computed(() => sender.value?.error ?? null);
const tv = computed(() => sender.value?.tv ?? null);
const frame = computed(() => sender.value?.frame ?? null);
const seen = computed(() =>
  tv.value?.age == null ? null : Math.max(0, Math.round(tv.value.age / 1000)),
);

const onKey = (event) => {
  if (event.key !== 'Escape' || !menuOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  cast.close();
};
const onPointer = (event) => {
  if (!menuOpen.value || root.value?.contains(event.target)) return;
  if (event.target?.closest?.('[aria-controls="cast-menu"]')) return;
  cast.close({ restoreFocus: false });
};
watch(menuOpen, async (open) => {
  if (open) {
    helpOpen.value = false;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    await nextTick();
    root.value?.querySelector('button:not([disabled])')?.focus();
  } else {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('pointerdown', onPointer, true);
});

const pick = (target) => {
  if (target.help) {
    helpOpen.value = !helpOpen.value;
    return;
  }
  if (!target.available) return;
  void cast.choose(target.id);
};
</script>

<template>
  <Teleport to="body">
    <div v-if="menuOpen" id="cast-menu" ref="root" role="dialog" aria-modal="false" aria-labelledby="cast-menu-title" class="cast-menu">
      <h2 id="cast-menu-title" class="cast-menu-title">{{ casting ? t('Casting to {name}', { name: casting.name }) : t('Play on a TV') }}</h2>
      <template v-if="casting">
        <p class="cast-menu-status" role="status">{{ seen == null ? t('Waiting for the TV…') : t('The TV answered {seconds} s ago', { seconds: seen }) }}</p>
        <img v-if="frame" class="cast-menu-frame" :src="frame" :alt="t('What the TV shows now')" />
        <UiButton class="cast-menu-item cast-menu-stop" @click="cast.stop()">
          <UiIcon name="cancel_presentation" :size="null" />
          <span>{{ t('Stop casting') }}</span>
        </UiButton>
      </template>
      <ul v-else class="cast-menu-list">
        <li v-for="target in targets" :key="target.id">
          <UiButton class="cast-menu-item" :data-cast-target="target.id" :disabled="!target.available || (busy != null)" :aria-busy="String(busy === target.id)" :aria-expanded="target.help ? String(helpOpen) : undefined" @click="pick(target)">
            <UiIcon :name="TARGET_ICONS[target.id]" :size="null" />
            <span class="cast-menu-text"><span class="cast-menu-label">{{ t(target.label) }}</span><span class="cast-menu-detail">{{ busy === target.id ? t('Opening on the TV…') : t(target.detail) }}</span></span>
          </UiButton>
          <p v-if="target.help && helpOpen" class="cast-menu-help">{{ t('Web pages can AirPlay a video but not the 3D globe. To show GEV on an AirPlay TV, open Control Center, tap Screen Mirroring and pick the TV; on a Samsung TV, Samsung TV · Smart View above works from any phone.') }}</p>
        </li>
      </ul>
      <p v-if="error" class="cast-menu-error" role="alert">{{ error }}</p>
      <UiCloseButton class="cast-menu-close" glyph="icon" bare :label="t('Close')" @click="cast.close()" />
    </div>
  </Teleport>
</template>
