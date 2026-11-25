/**
 * A TV view reports its boot to the relay before the globe exists, so a TV
 * that never shows GEV is diagnosable from the phone or the server: no
 * `html` stage means the page never loaded; `html` without the full
 * heartbeat means the app failed or is still starting (its errors ride along).
 */

import { parseTvMode } from './castTargets.js';

/**
 * @param {string} stage 'html' | 'failed'
 * @param {object} [extra]
 * @returns {boolean} Whether this page is a TV view (and so reported).
 */
export function reportTvBoot(
  stage,
  extra = {},
  { windowRef = globalThis.window, fetchImpl = globalThis.fetch } = {},
) {
  const tv = parseTvMode(windowRef?.location?.search ?? '');
  if (!tv?.room || typeof fetchImpl !== 'function') return false;
  const send = (status) =>
    fetchImpl('/api/cast/tv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room: tv.room,
        kind: tv.kind,
        after: 0,
        status: { name: tv.name, boot: stage, ...status },
      }),
    }).catch(() => {});
  send({
    ...extra,
    ua: String(windowRef.navigator?.userAgent ?? '').slice(0, 160),
    w: windowRef.innerWidth,
    h: windowRef.innerHeight,
  });
  if (stage === 'html') {
    windowRef.addEventListener?.('error', (event) =>
      send({ error: String(event.message).slice(0, 200) }),
    );
    windowRef.addEventListener?.('unhandledrejection', (event) =>
      send({
        error: String(event.reason?.message ?? event.reason).slice(0, 200),
      }),
    );
  }
  return true;
}
