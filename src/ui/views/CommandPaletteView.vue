<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import { onLocaleChange, t, tn } from '../../i18n/index.js';
import { createCommandPalette, isPaletteShortcut, paletteCommandLabel } from '../commandPalette.js';
import { createSurfaceKeyboard } from '../surfaceKeyboard.js';

const props = defineProps({
  getLayers: { type: Function, required: true },
  run: { type: Function, required: true },
});
const view = shallowRef(null);
const controller = createCommandPalette({
  getLayers: props.getLayers,
  run: props.run,
  publish: (next) => { view.value = next; },
});
const root = useTemplateRef('root');
const input = useTemplateRef('input');
const trigger = useTemplateRef('trigger');
const optionId = (command) => `palette-option-${command.id}`;
const activeId = computed(() => {
  const command = view.value.results[view.value.selected];
  return command ? optionId(command) : undefined;
});
let keyboard;
const onShortcut = (event) => {
  if (!isPaletteShortcut(event) || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  controller.open();
};
function onSearchKey(event) {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    controller.move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) void controller.execute();
  }
}
// Window capture keeps document-level scene shortcuts behind the native modal.
function onModalKey(event) {
  if (!view.value.open) return;
  event.stopPropagation();
  if (!event.defaultPrevented && event.target === input.value) onSearchKey(event);
}
const offLocale = onLocaleChange(() => controller.refresh());
onMounted(() => {
  keyboard = createSurfaceKeyboard({
    root: root.value,
    eventTarget: window,
    isActive: () => view.value.open,
    onEscape: controller.close,
    fallbackFocus: () => trigger.value,
  });
  document.addEventListener('keydown', onShortcut);
});
watch(() => view.value.open, async (open) => {
  if (open) {
    keyboard.activate();
    window.addEventListener('keydown', onModalKey, true);
    root.value.showModal();
    await nextTick();
    if (view.value.open) input.value?.focus({ preventScroll: true });
  } else {
    root.value.close();
    window.removeEventListener('keydown', onModalKey, true);
    keyboard.deactivate({ restoreFocus: true });
  }
});
watch(activeId, async () => {
  await nextTick();
  if (view.value.open && activeId.value) {
    document.getElementById(activeId.value)?.scrollIntoView({ block: 'nearest' });
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onShortcut);
  window.removeEventListener('keydown', onModalKey, true);
  offLocale();
  controller.destroy();
  if (root.value?.open) root.value.close();
  keyboard?.destroy();
});
</script>

<template>
  <button id="command-palette-toggle" ref="trigger" type="button" class="palette-trigger" aria-haspopup="dialog" aria-controls="command-palette" :aria-expanded="String(view.open)" :title="t('Commands (P)')" @click="controller.open()">{{ t('Commands') }} <kbd translate="no">P</kbd></button>
  <Teleport to="body">
    <dialog id="command-palette" ref="root" class="command-palette" aria-modal="true" aria-labelledby="command-palette-title" aria-describedby="command-palette-help" @cancel.prevent="controller.close()">
      <header class="palette-heading">
        <h2 id="command-palette-title">{{ t('Command palette') }}</h2>
        <button id="command-palette-close" type="button" :aria-label="t('Close command palette')" @click="controller.close()">{{ t('Close') }}</button>
      </header>
      <input id="command-palette-search" ref="input" class="gev-field" type="text" role="combobox" aria-autocomplete="list" aria-controls="command-palette-results" aria-expanded="true" :aria-activedescendant="activeId" :aria-label="t('Search commands and layers')" :placeholder="t('Search commands and layers')" autocomplete="off" spellcheck="false" maxlength="256" :readonly="view.pending" :value="view.query" @input="controller.setQuery($event.target.value)" />
      <p class="palette-status" role="status" aria-live="polite">{{ view.pending ? t('Running command...') : tn(view.results.length, '{count} result', '{count} results') }}</p>
      <ul id="command-palette-results" class="palette-results ui-scroll" role="listbox" :aria-label="t('Commands and layers')" :aria-busy="String(view.pending)">
        <li v-for="(command, index) in view.results" :id="optionId(command)" :key="command.id" role="option" :aria-selected="String(index === view.selected)" :aria-disabled="String(view.pending)" :class="{ selected: index === view.selected }" @pointerdown.prevent @click="controller.execute(command.id)">
          <span>{{ paletteCommandLabel(command) }}</span><span class="palette-group">{{ t(command.group) }}</span>
        </li>
      </ul>
      <p v-if="!view.results.length" class="palette-empty">{{ t('No matching commands or layers.') }}</p>
      <p v-if="view.error" class="palette-error" role="alert">{{ t(view.error) }}</p>
      <p id="command-palette-help" class="palette-help">{{ t('Use arrow keys to choose, Enter to run, and Escape to close.') }}</p>
    </dialog>
  </Teleport>
</template>

<style scoped>
.palette-trigger {
  align-self: center;
  flex: 0 0 auto;
  border: 1px solid var(--accent-cyan-dim, #397080);
  border-radius: 6px;
  background: var(--panel-bg, #08141e);
  color: var(--text-primary, #e3faff);
  padding: 10px 12px;
  font: inherit;
  cursor: pointer;
}
.palette-trigger kbd { margin-inline-start: 8px; opacity: 0.6; }
.command-palette {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(620px, calc(100vw - 24px));
  max-height: calc(100dvh - 32px);
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--accent-cyan-dim, #397080);
  border-radius: 10px;
  background: var(--panel-bg, #08141e);
  color: var(--text-primary, #e3faff);
  box-shadow: 0 24px 80px #0009;
  font: 14px/1.5 var(--font-mono, monospace);
}
.command-palette::backdrop { background: #02080ebf; }
.palette-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.palette-heading h2 { margin: 0; font-size: 18px; }
.palette-heading button { background: transparent; color: inherit; border: 1px solid #397080; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
.command-palette input { width: 100%; box-sizing: border-box; padding: 12px; font: inherit; }
.palette-status, .palette-help { color: var(--text-secondary, #a1bac7); font-size: 12px; margin: 12px 0; }
.palette-results { max-height: min(48dvh, 360px); overflow: auto; list-style: none; margin: 0; padding: 0; }
.palette-results li { display: flex; justify-content: space-between; gap: 16px; padding: 12px; border-radius: 4px; cursor: pointer; }
.palette-results li.selected { background: #163b49; outline: 1px solid #66cadd; outline-offset: -1px; }
.palette-results li:hover { background: #163b49; }
.palette-group { color: var(--text-secondary, #a1bac7); font-size: 12px; flex-shrink: 0; }
.palette-error { color: #ffb8aa; }
.palette-empty { padding: 16px 0; }
.palette-trigger:focus-visible, .command-palette button:focus-visible, .command-palette input:focus-visible { outline: 2px solid #8be9ff; outline-offset: 2px; }
@media (max-width: 480px) {
  .command-palette { padding: 14px; }
  .palette-results li { flex-wrap: wrap; gap: 2px; }
}
</style>
