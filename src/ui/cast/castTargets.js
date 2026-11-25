/**
 * Cast: put the globe on a TV and keep the phone as its remote. The pure part
 * (targets, TV-view addresses, room codes); castRuntime.js talks to the relay
 * (server/standalone/castRelay.js) and the Cast SDK.
 *
 * Ported from Sound Atlas's "Play on a TV" (kvnloo/fframestudio
 * web/src/music-atlas/cast.js). Three routes, in the order the menu lists them:
 * - Samsung TV (Smart View): the server launches the GEV TV app over the LAN
 *   (tools/gev-tv), which opens the TV view and reports in its room.
 * - Google Cast (Chromecast, Google TV, Nest Hub): the Cast SDK starts the
 *   public DashCast receiver, which opens the TV view with a fresh room.
 *   Chrome only offers Google Cast on secure (https) pages.
 * - AirPlay: a web page can AirPlay a <video>, never a WebGL canvas, so the
 *   globe goes to an AirPlay TV only by mirroring the whole screen.
 */

import { msg } from '../../i18n/index.js';

export const ROOM_PATTERN = /^[a-z0-9]{6}$/;
export const DASHCAST_APP_ID = '84912283';
export const DASHCAST_NAMESPACE = 'urn:x-cast:com.madmod.dashcast';
export const CAST_SDK_URL =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A fresh six-character room code. */
export function newRoomCode(random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte & 31]).join('');
}

/**
 * The TV view this page is, if any: `?tv=samsung|cast|1&room=<code>&name=…`.
 * @param {string} search location.search
 * @returns {{ kind: string, room: string|null, name: string } | null}
 */
export function parseTvMode(search) {
  const params = new URLSearchParams(search);
  const kind = params.get('tv');
  if (kind == null) return null;
  const room = (params.get('room') ?? '').toLowerCase();
  return {
    kind: kind || '1',
    room: ROOM_PATTERN.test(room) ? room : null,
    name: params.get('name') || (kind === 'cast' ? 'Cast screen' : 'TV'),
  };
}

/**
 * The address a TV opens: the TV origin (the server's LAN address), the TV
 * query and the phone's current view as the share hash.
 */
export function tvViewUrl({ origin, kind, room, name, hash = '' }) {
  const url = new URL('/', origin);
  url.search = new URLSearchParams({ tv: kind, room, name }).toString();
  url.hash = hash ? String(hash).replace(/^#/, '') : '';
  return url.href;
}

export const CAST_TARGET_IDS = Object.freeze([
  'samsung',
  'chromecast',
  'airplay',
]);

/**
 * The menu's targets, each available or with the reason it is not.
 * @param {object} env
 * @param {boolean} env.samsungConfigured The server knows a Samsung TV.
 * @param {boolean} env.secure window.isSecureContext.
 * @param {'idle'|'loading'|'ready'|'none'} env.castSdk Google Cast in this browser.
 * @returns {{ id: string, label: string, detail: string, available: boolean, help?: boolean }[]}
 */
export function castTargets({ samsungConfigured, secure, castSdk }) {
  const chromecast = !secure
    ? {
        available: false,
        detail: msg('Open the https link: Chrome casts only from secure pages'),
      }
    : castSdk === 'ready'
      ? { available: true, detail: msg('Chrome picks the screen') }
      : castSdk === 'none'
        ? { available: false, detail: msg('Needs Chrome with Google Cast') }
        : { available: false, detail: msg('Loading Google Cast…') };
  return [
    {
      id: 'samsung',
      label: msg('Samsung TV · Smart View'),
      available: Boolean(samsungConfigured),
      detail: samsungConfigured
        ? msg('Opens GEV on the TV; this phone stays the remote')
        : msg('No Samsung TV is set up on this server'),
    },
    { id: 'chromecast', label: msg('Chromecast · Google TV'), ...chromecast },
    {
      id: 'airplay',
      label: msg('Apple TV · AirPlay'),
      available: true,
      help: true,
      detail: msg('Mirror the screen: Control Center, then Screen Mirroring'),
    },
  ];
}
