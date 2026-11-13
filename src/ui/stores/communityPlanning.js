import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';

/**
 * The City builder dialog (or, behind `?planningPreview=fixture`, the synthetic
 * park comparison) as its view renders it. One owner at a time offers the
 * launcher and publishes here; the view sends clicks back to the connected
 * controls.
 */
export const useCommunityPlanningStore = defineStore(
  'gev-community-planning',
  () => {
    /** The launcher's `{label}`, or null while no owner offers it. */
    const launcher = shallowRef(null);

    /** @param {?{label: string}} next */
    function offerLauncher(next) {
      launcher.value = next && markRaw(next);
    }

    /** The open comparison's presentation, or null while none is open. */
    const preview = shallowRef(null);

    /** @param {?object} next A fresh presentation; every publish re-renders. */
    function publish(next) {
      preview.value = next && markRaw(next);
    }

    /** The owner's controls (at least `{open, close, setMode, inspect}`), or null while no owner is wired. */
    const controls = shallowRef(null);

    /** @param {?object} next The controls, or null to disconnect. */
    function connect(next) {
      controls.value = next && markRaw(next);
    }

    return { launcher, offerLauncher, preview, publish, controls, connect };
  },
);
