import { createFireHistoryPanel } from './fireHistoryPanel.js';

/**
 * Bind the presentation-only shared-rail panel to one Historic Fires layer.
 * The layer remains the state owner; this adapter owns only subscription + DOM.
 */
export function createFireHistoryReadout({ container, layer } = {}) {
  if (!container || typeof layer?.subscribe !== 'function') return null;
  const panel = createFireHistoryPanel({
    container,
    actions: {
      selectEvent: (id) => layer.selectEvent?.(id, { focus: true }),
      focus: () => layer.focusEvent?.(),
      seek: (tick) => layer.seekToTick?.(tick),
      step: (direction) => layer.stepReplay?.(direction),
      reset: () => layer.resetReplay?.(),
      togglePlay: () => layer.toggleReplay?.(),
    },
  });
  if (!panel) return null;

  const unsubscribe = layer.subscribe((snapshot) => panel.update(snapshot));
  return {
    destroy() {
      unsubscribe?.();
      panel.destroy();
    },
  };
}
