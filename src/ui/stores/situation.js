import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';

/**
 * The situation room as its view renders it. The situation controller
 * (src/situation/situationController.js) publishes the view (sources, event
 * stream, what matters now, cards, receipts) and, each rendered frame that
 * moved them, the pins projected onto the globe. The view hands interactions
 * back through the connected handlers.
 */
export const useSituationStore = defineStore('gev-situation', () => {
  /** The published view, or `{ enabled: false }`. */
  const room = shallowRef({ enabled: false });
  /** Pins in CSS pixels: `{id, kind, x, y, label, emphasis, course}`. */
  const pins = shallowRef([]);
  /** `{ expand, pin, dismiss, ask, focus }`, or null. */
  const handlers = shallowRef(null);

  function publish(next) {
    room.value = markRaw(next ?? { enabled: false });
  }

  function publishPins(next) {
    pins.value = markRaw(Array.isArray(next) ? next : []);
  }

  function connect(next) {
    handlers.value = next && markRaw(next);
  }

  return { room, pins, handlers, publish, publishPins, connect };
});
