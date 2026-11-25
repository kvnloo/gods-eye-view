<script setup>
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { t } from '../../../i18n/index.js';
import { useCastStore } from '../../stores/cast.js';

// The Cast button: a tab in the phone tab bar, an icon in the desktop globe
// actions. Both open the same menu (CastMenu.vue).
const props = defineProps({ variant: { type: String, default: 'toolbar' } });
const cast = useCastStore();
const { menuOpen, casting } = storeToRefs(cast);
const label = computed(() =>
  casting.value
    ? t('Cast: playing on {name}', { name: casting.value.name })
    : t('Cast: play on a TV'),
);
const onClick = (event) => {
  navigator.vibrate?.(5);
  cast.toggle(event.currentTarget);
};
</script>

<template>
  <button v-if="props.variant === 'tab'" type="button" class="mobile-tab mobile-tab-cast" data-mobile-action="cast" aria-haspopup="dialog" aria-controls="cast-menu" :aria-expanded="String(menuOpen)" :aria-pressed="String(Boolean(casting))" :aria-label="label" @click="onClick"><span class="material-symbols-outlined mobile-tab-icon" aria-hidden="true">{{ casting ? 'cast_connected' : 'cast' }}</span><span class="mobile-tab-label" aria-hidden="true">{{ t('Cast') }}</span></button>
  <button v-else id="cast-btn" type="button" aria-haspopup="dialog" aria-controls="cast-menu" :aria-expanded="String(menuOpen)" :aria-pressed="String(Boolean(casting))" :aria-label="label" :title="label" @click="onClick">
    <span class="material-symbols-outlined" aria-hidden="true">{{ casting ? 'cast_connected' : 'cast' }}</span>
  </button>
</template>
