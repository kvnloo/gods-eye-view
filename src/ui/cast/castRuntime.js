/**
 * Cast in the browser: the phone (sender) and the TV view (receiver), both
 * talking to the relay at /api/cast (server/standalone/castRelay.js).
 *
 * The phone sends the share hash of its view whenever it changes; the TV
 * restores it, so the TV follows every fly-to, layer and style change the
 * share link records. The TV reports its state each second and a small
 * capture of its globe every few seconds, which the phone's menu shows.
 */

import { t } from '../../i18n/index.js';
import {
  CAST_SDK_URL,
  DASHCAST_APP_ID,
  DASHCAST_NAMESPACE,
  newRoomCode,
  tvViewUrl,
} from './castTargets.js';

const SEND_EVERY_MS = 300;
const PEEK_EVERY_MS = 2500;
const TV_POLL_MS = 400;
const TV_FRAME_EVERY_MS = 5000;

async function api(fetchImpl, route, body) {
  const response = await fetchImpl(`/api/cast/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? `cast ${response.status}`);
  return json;
}

/**
 * The phone side.
 * @param {object} input
 * @param {() => string|null} input.snapshotHash The current share hash.
 * @param {(state: object) => void} input.publish Menu state for the view.
 * @param {(text: string) => void} [input.toast]
 * @param {typeof fetch} [input.fetchImpl]
 * @param {Window} [input.windowRef]
 */
export function createCastSender({
  snapshotHash,
  publish,
  toast = () => {},
  fetchImpl = globalThis.fetch?.bind(globalThis),
  windowRef = globalThis.window,
  storage = globalThis.localStorage,
}) {
  const state = {
    casting: null, // { kind, name, room }
    busy: null, // the target being started
    error: null,
    config: null,
    castSdk: windowRef?.chrome ? 'idle' : 'none',
    tv: null, // { age, frameAge, name }
    frame: null,
  };
  let sendTimer = 0;
  let peekTimer = 0;
  let lastSent = null;
  let session = null;
  let sdk = null;
  const emit = () => publish({ ...state });

  const sendView = async (force = false) => {
    if (!state.casting) return;
    const hash = snapshotHash?.();
    if (!hash || (!force && hash === lastSent)) return;
    lastSent = hash;
    await api(fetchImpl, 'send', { room: state.casting.room, hash }).catch(
      () => {
        lastSent = null;
      },
    );
  };
  const peek = async () => {
    if (!state.casting) return;
    try {
      const reply = await api(fetchImpl, 'peek', { room: state.casting.room });
      state.tv = reply.tv
        ? { ...reply.tv, age: reply.age, frameAge: reply.frameAge }
        : null;
      if (reply.frameAge != null && reply.frameAge < PEEK_EVERY_MS * 2) {
        const frame = await api(fetchImpl, 'frame', {
          room: state.casting.room,
        }).catch(() => null);
        if (frame?.frame) state.frame = frame.frame;
      }
      emit();
    } catch {
      // The relay is best effort; the next peek tries again.
    }
  };

  const begin = (kind, name, room) => {
    state.casting = { kind, name, room };
    state.busy = null;
    state.error = null;
    lastSent = null;
    try {
      storage?.setItem('gev-casting', JSON.stringify(state.casting));
    } catch {}
    void sendView(true);
    clearInterval(sendTimer);
    clearInterval(peekTimer);
    sendTimer = setInterval(() => void sendView(), SEND_EVERY_MS);
    peekTimer = setInterval(() => void peek(), PEEK_EVERY_MS);
    emit();
    toast(name);
  };

  const fail = (message) => {
    state.busy = null;
    state.error = message;
    emit();
  };

  async function loadConfig() {
    try {
      state.config = await api(fetchImpl, 'config');
    } catch {
      state.config = { tvOrigin: null, samsung: { configured: false } };
    }
    emit();
    return state.config;
  }

  /** Google Cast's sender SDK; the picker must open inside the tap, so it loads ahead. */
  function loadCastSdk() {
    if (sdk) return sdk;
    if (!windowRef?.chrome || !windowRef.isSecureContext) {
      state.castSdk = 'none';
      emit();
      return (sdk = Promise.resolve(false));
    }
    state.castSdk = 'loading';
    emit();
    sdk = new Promise((resolve) => {
      windowRef.__onGCastApiAvailable = (available) => {
        if (available) {
          windowRef.cast.framework.CastContext.getInstance().setOptions({
            receiverApplicationId: DASHCAST_APP_ID,
            autoJoinPolicy: windowRef.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
          });
        }
        resolve(Boolean(available));
      };
      const script = windowRef.document.createElement('script');
      script.src = CAST_SDK_URL;
      script.onerror = () => resolve(false);
      windowRef.document.head.append(script);
      setTimeout(() => resolve(false), 15000);
    }).then((available) => {
      state.castSdk = available ? 'ready' : 'none';
      emit();
      return available;
    });
    return sdk;
  }

  async function castSamsung() {
    state.busy = 'samsung';
    state.error = null;
    emit();
    try {
      const { room, name } = await api(fetchImpl, 'samsung');
      begin('samsung', name, room);
    } catch (error) {
      fail(error.message);
    }
  }

  async function castGoogle() {
    const context = windowRef.cast.framework.CastContext.getInstance();
    try {
      await context.requestSession(); // the system picker; must run inside the tap
    } catch (error) {
      if (error !== 'cancel') fail(t('No Cast screen picked'));
      return;
    }
    state.busy = 'chromecast';
    emit();
    const current = context.getCurrentSession();
    const name = current.getCastDevice().friendlyName || 'Cast screen';
    const room = newRoomCode();
    const origin = state.config?.tvOrigin || windowRef.location.origin;
    const url = tvViewUrl({
      origin,
      kind: 'cast',
      room,
      name,
      hash: snapshotHash?.() ?? '',
    });
    await current
      .sendMessage(DASHCAST_NAMESPACE, {
        url,
        force: true,
        reload: false,
        reload_time: 0,
      })
      .catch(() => {});
    session = current;
    begin('cast', name, room);
  }

  async function choose(id) {
    if (id === 'samsung') return castSamsung();
    if (id === 'chromecast') return castGoogle();
    return undefined;
  }

  function stop() {
    if (!state.casting) return;
    try {
      session?.endSession(true);
    } catch {}
    session = null;
    clearInterval(sendTimer);
    clearInterval(peekTimer);
    try {
      storage?.removeItem('gev-casting');
    } catch {}
    Object.assign(state, { casting: null, busy: null, tv: null, frame: null });
    emit();
  }

  // A reload mid-cast picks the TV back up if it still reports in.
  async function resume() {
    let saved = null;
    try {
      saved = JSON.parse(storage?.getItem('gev-casting') ?? 'null');
    } catch {}
    if (!saved?.room) return;
    const reply = await api(fetchImpl, 'peek', { room: saved.room }).catch(
      () => null,
    );
    if (reply?.tv && reply.age < 5000)
      begin(saved.kind, saved.name, saved.room);
    else storage?.removeItem('gev-casting');
  }

  return {
    state,
    loadConfig,
    loadCastSdk,
    choose,
    stop,
    resume,
    destroy() {
      clearInterval(sendTimer);
      clearInterval(peekTimer);
    },
  };
}

/**
 * The TV side: follow the room, report in, send a small capture now and then.
 * @param {object} input
 * @param {{ kind: string, room: string, name: string }} input.tv parseTvMode()
 * @param {(hash: string) => boolean} input.restoreHash
 * @param {() => Promise<string|null>} [input.captureFrame] A JPEG data URL.
 */
export function startCastReceiver({
  tv,
  restoreHash,
  captureFrame = async () => null,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  documentRef = globalThis.document,
  windowRef = globalThis.window,
}) {
  documentRef.body.classList.add('gev-tv');
  documentRef.documentElement.classList.add('gev-tv');
  let after = 0;
  let lastFrameAt = 0;
  let timer = 0;
  let stopped = false;
  let error = null;
  windowRef?.addEventListener?.('error', (event) => {
    error = String(event.message).slice(0, 160);
  });
  const hw = {
    w: windowRef?.innerWidth,
    h: windowRef?.innerHeight,
    dpr: windowRef?.devicePixelRatio,
    ua: String(windowRef?.navigator?.userAgent ?? '').slice(0, 160),
  };
  const poll = async () => {
    if (stopped) return;
    let frame = null;
    if (Date.now() - lastFrameAt > TV_FRAME_EVERY_MS) {
      lastFrameAt = Date.now();
      frame = await captureFrame().catch(() => null);
    }
    try {
      const reply = await api(fetchImpl, 'tv', {
        room: tv.room,
        kind: tv.kind,
        after,
        status: {
          name: tv.name,
          hash: windowRef?.location?.hash?.slice(1, 300),
          error,
          hw,
        },
        frame,
      });
      if (reply.cmd && reply.seq > after) {
        after = reply.seq;
        restoreHash(reply.cmd.hash);
      } else if (reply.seq < after) after = reply.seq; // the relay restarted
    } catch {
      // keep polling; the relay may be restarting
    }
    timer = setTimeout(poll, TV_POLL_MS);
  };
  if (tv.room) void poll();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
