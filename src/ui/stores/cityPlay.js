import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';

/**
 * City builder play mode as its overlay renders it. The globe owner
 * (src/standalone/cityPlay.js) publishes the discrete view, places the
 * world-anchored screen points after each rendered frame, and connects the
 * controls the overlay calls back.
 */
export const useCityPlayStore = defineStore('gev-city-play', () => {
  /** The mode's presentation, or null while no owner is mounted. */
  const view = shallowRef(null);
  /** Screen points of world anchors from the last rendered frame. */
  const anchors = shallowRef(null);
  /** `{enter, toggle, exit, act, focus, build, reroll, openRecords}` or null. */
  const controls = shallowRef(null);

  /**
   * Massing v0 (src/standalone/cityMassing.js, only behind ?massing=1): the
   * selected plot's assumed block, the screen points of the block and its
   * shadow, and `{toggle, step}`. All null with the flag off.
   */
  const massing = shallowRef(null);
  const massingAnchors = shallowRef(null);
  const massingControls = shallowRef(null);

  function publish(next) {
    view.value = next && markRaw(next);
  }
  function place(next) {
    anchors.value = next && markRaw(next);
  }
  function connect(next) {
    controls.value = next && markRaw(next);
  }
  function publishMassing(next) {
    massing.value = next && markRaw(next);
  }
  function placeMassing(next) {
    massingAnchors.value = next && markRaw(next);
  }
  function connectMassing(next) {
    massingControls.value = next && markRaw(next);
  }
  return {
    view,
    anchors,
    controls,
    publish,
    place,
    connect,
    massing,
    massingAnchors,
    massingControls,
    publishMassing,
    placeMassing,
    connectMassing,
  };
});
