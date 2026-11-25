<script setup>
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { t } from '../../../i18n/index.js';
import { useCastStore } from '../../stores/cast.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';

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
  <UiButton v-if="props.variant === 'tab'" class="mobile-tab mobile-tab-cast" data-mobile-action="cast" aria-haspopup="dialog" aria-controls="cast-menu" :aria-expanded="String(menuOpen)" :pressed="Boolean(casting)" :label="label" :native-title="false" @click="onClick"><UiIcon class="mobile-tab-icon" :name="casting ? 'cast_connected' : 'cast'" :size="null" /><span class="mobile-tab-label" aria-hidden="true">{{ t('Cast') }}</span></UiButton>
  <UiButton v-else id="cast-btn" aria-haspopup="dialog" aria-controls="cast-menu" :aria-expanded="String(menuOpen)" :pressed="Boolean(casting)" :label="label" @click="onClick">
    <UiIcon :name="casting ? 'cast_connected' : 'cast'" :size="null" />
  </UiButton>
</template>
