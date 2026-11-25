import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { castTargets } from '../cast/castTargets.js';

/**
 * The Cast button and its menu, in the phone tab bar and the desktop globe
 * actions. The shell connects the sender (cast/castRuntime.js) and publishes
 * its state; the views read it and answer through open/close/choose/stop.
 */
export const useCastStore = defineStore('gev-cast', () => {
  const menuOpen = ref(false);
  /** The sender's state; null until the shell connects one. */
  const sender = shallowRef(null);
  let actions = null;
  /** The button that opened the menu, for focus on close. */
  let opener = null;

  const casting = computed(() => sender.value?.casting ?? null);
  const targets = computed(() =>
    castTargets({
      samsungConfigured: Boolean(sender.value?.config?.samsung?.configured),
      secure: Boolean(globalThis.isSecureContext),
      castSdk: sender.value?.castSdk ?? 'none',
    }),
  );

  /** @param {object} state The sender's state. */
  function publish(state) {
    sender.value = state ? { ...state } : null;
  }

  /** @param {{ choose: Function, stop: Function, prepare?: Function }|null} next */
  function connect(next) {
    actions = next;
  }

  function open(from = null) {
    opener = from;
    menuOpen.value = true;
    actions?.prepare?.();
  }

  function close({ restoreFocus = true } = {}) {
    if (!menuOpen.value) return;
    menuOpen.value = false;
    if (restoreFocus) opener?.focus?.();
    opener = null;
  }

  function toggle(from = null) {
    if (menuOpen.value) close();
    else open(from);
  }

  function choose(id) {
    return actions?.choose?.(id);
  }

  function stop() {
    actions?.stop?.();
  }

  return {
    menuOpen,
    sender,
    casting,
    targets,
    publish,
    connect,
    open,
    close,
    toggle,
    choose,
    stop,
  };
});
