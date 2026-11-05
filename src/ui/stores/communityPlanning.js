import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';

/**
 * The opt-in community planning preview as its view renders it. The preview
 * owner (src/ui/communityPlanningPreview.js) offers the Scene panel launcher
 * and presents its one open comparison here; the view sends clicks back to
 * the connected controls.
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

    /** `{open, close, setMode, inspect}`, or null while no owner is wired. */
    const controls = shallowRef(null);

    /** @param {?object} next The controls, or null to disconnect. */
    function connect(next) {
      controls.value = next && markRaw(next);
    }

    return { launcher, offerLauncher, preview, publish, controls, connect };
  },
);
