/**
 * Wires Cast into the app: a TV view (`?tv=…`) follows its room; any other
 * page gets the Cast button's sender. See castTargets.js for the routes.
 */

import { t } from '../../i18n/index.js';
import { canvasOf, findFrame } from '../../render/rendererOf.js';
import { parseTvMode } from './castTargets.js';
import { createCastSender, startCastReceiver } from './castRuntime.js';

/**
 * A small JPEG of the globe as it was last drawn, for the phone's menu (and
 * as evidence of what the TV shows). The renderer clears its drawing buffer
 * after compositing, so the copy is taken in the frame's postRender phase.
 */
export function captureGlobeFrame(
  viewer,
  { width = 480, documentRef = globalThis.document } = {},
) {
  return new Promise((resolve) => {
    const frame = findFrame(viewer);
    const source = canvasOf(viewer);
    if (!frame || !source) return resolve(null);
    let done = false;
    let off = () => {};
    const finish = (value) => {
      if (done) return;
      done = true;
      off();
      resolve(value);
    };
    off = frame.on('postRender', () => {
      try {
        const canvas = documentRef.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(
          1,
          Math.round((source.height * width) / Math.max(1, source.width)),
        );
        canvas
          .getContext('2d')
          .drawImage(source, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        finish(null);
      }
    });
    frame.requestRender('cast-capture');
    setTimeout(() => finish(null), 3000);
  });
}

/**
 * @param {object} input
 * @param {ReturnType<import('../stores/cast.js').useCastStore>} input.store
 * @param {() => string|null} input.snapshotHash
 * @param {(hash: string) => boolean} input.restoreHash
 * @param {object} [input.viewer]
 * @param {(text: string) => void} [input.toast]
 */
export function initCast({
  store,
  snapshotHash,
  restoreHash,
  viewer,
  toast = () => {},
  windowRef = globalThis.window,
}) {
  const tv = parseTvMode(windowRef?.location?.search ?? '');
  if (tv) {
    const receiver = startCastReceiver({
      tv,
      restoreHash: (hash) => {
        if (restoreHash(hash)) return true;
        windowRef.location.hash = hash;
        return true;
      },
      captureFrame: () => captureGlobeFrame(viewer),
    });
    return { tv, destroy: () => receiver.stop() };
  }
  const sender = createCastSender({
    snapshotHash,
    publish: (state) => store.publish(state),
    toast: (name) => toast(t('Playing on {name}', { name })),
  });
  let prepared = false;
  store.connect({
    // The menu opening is the moment to learn the targets: the server's TV
    // and Google Cast (whose picker must later open inside a tap).
    prepare: () => {
      if (prepared) return;
      prepared = true;
      void sender.loadConfig();
      void sender.loadCastSdk();
    },
    choose: (id) => sender.choose(id),
    stop: () => {
      sender.stop();
      toast(t('Stopped casting'));
    },
  });
  store.publish(sender.state);
  void sender.resume();
  return {
    tv: null,
    destroy() {
      sender.destroy();
      store.connect(null);
      store.publish(null);
    },
  };
}
