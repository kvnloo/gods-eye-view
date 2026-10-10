import * as Cesium from 'cesium';
import { createFireHistoryLayer } from '../../layers/fireHistory/index.js';
import { createFireHistoryRendering } from '../../layers/fireHistory/rendering.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { announceNavigationAuthority } from '../../navigationPolicy.js';

/** Bind Historic Fires to the application viewer/navigation owners. */
export function createApplicationFireHistory({ source }) {
  return createFireHistoryLayer({
    source,
    createRenderer: (viewer) =>
      createFireHistoryRendering({
        viewer,
        cesium: Cesium,
        requestRender: governorRequestRender,
      }),
    focusSphere(viewer, sphere) {
      if (!viewer?.camera || !sphere) return false;
      announceNavigationAuthority('fire-history-focus');
      viewer.camera.cancelFlight?.();
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-55),
          Math.max(50_000, sphere.radius * 2.4),
        ),
      });
      return true;
    },
  });
}
