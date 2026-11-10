/** Own loading notices, traffic status, toast timing and visibility cleanup. */
import {
  aggregateLayerLoading,
  GUIDANCE_STATUSES,
  LOADING_FAILURE_DWELL_MS,
  createGlobalStatusNotice,
  createLoadingFeedbackState,
  createTrafficSyncFeedbackState,
  presentGlobalLoadingStatus,
  reduceLoadingFeedback,
  reduceTrafficSyncFeedback,
} from '../loadingFeedback.js';
import { getLocale, msg, onLocaleChange, t } from '../i18n/index.js';
import { localizeLayerName } from './layerPanel.js';
import { translateFeedError } from './statusText.js';
import { useStatusStore } from './stores/status.js';
import { createToast } from './toast.js';
import { applicationPinia } from './vueRuntime.js';
import { layerFeedState } from './layers.js';
import { resolveAttentionDisposition } from './attentionPolicy.js';

// Ignore transient work for retention; admission separately requires settlement.
function hasHealthyRefreshData(layer) {
  const stats = layer?.stats || {};
  return (
    layer?.enabled === true &&
    layer.lifecycleState === 'enabled' &&
    !layer.lifecycleUncertain &&
    Number.isFinite(stats.lastUpdate) &&
    stats.lastUpdate > 0 &&
    !stats.keyRequired &&
    !stats.missingKey &&
    !GUIDANCE_STATUSES.includes(String(stats.status || '').toLowerCase()) &&
    layerFeedState({ ...stats, loading: false }) === 'nominal'
  );
}

// The server also loads loadingFeedback.js (through the HUD summary), so its
// labels stay English. Translate the known ones; pass anything else (a live
// provider error) through.
const STATUS_LABEL_KEYS = Object.freeze({
  'LOADING LIVE DATA': msg('LOADING LIVE DATA'),
  'LOAD COMPLETE': msg('LOAD COMPLETE'),
  'REFRESH RECOVERED': msg('REFRESH RECOVERED'),
  'LOAD CANCELLED': msg('LOAD CANCELLED'),
  'LOAD FAILED': msg('LOAD FAILED'),
  'LIVE DATA OFF': msg('LIVE DATA OFF'),
  'MAPPED SITES LOADED': msg('MAPPED SITES LOADED'),
  'RETRYING MAPPED SITES': msg('RETRYING MAPPED SITES'),
  'FETCHING MAPPED SITES': msg('FETCHING MAPPED SITES'),
  'RETRYING ALPR CAMERAS': msg('RETRYING ALPR CAMERAS'),
  'FETCHING ALPR CAMERAS': msg('FETCHING ALPR CAMERAS'),
  'OVERPASS TEMPORARILY UNAVAILABLE': msg('OVERPASS TEMPORARILY UNAVAILABLE'),
  // The other mapped-site failure reasons (src/data/installationFeedback.js),
  // upper-cased by presentGlobalLoadingStatus.
  'OVERPASS RATE-LIMITED': msg('OVERPASS RATE-LIMITED'),
  'OVERPASS TIMED OUT': msg('OVERPASS TIMED OUT'),
  'OVERPASS COULD NOT COMPLETE THE QUERY': msg(
    'OVERPASS COULD NOT COMPLETE THE QUERY',
  ),
  'MAP TILES TEMPORARILY UNAVAILABLE': msg('MAP TILES TEMPORARILY UNAVAILABLE'),
  'MAPPED NAMES TEMPORARILY UNAVAILABLE': msg(
    'MAPPED NAMES TEMPORARILY UNAVAILABLE',
  ),
  'TURNING OFF LIVE DATA': msg('TURNING OFF LIVE DATA'),
  'REFRESHING LIVE DATA': msg('REFRESHING LIVE DATA'),
  'syncing road network': msg('syncing road network'),
});

// The ALPR retry chip shows the layer's English error upper-cased
// (loadingFeedback.js). These are the camera and vector tile failures it can
// carry, by their upper-cased text; each is translated through its own
// sentence-case key, the one the layer row shows, and upper-cased again.
const CHIP_ERROR_KEYS = new Map(
  [
    msg('Vector tile metadata unavailable'),
    msg('Vector tiles unavailable'),
    msg('Vector tile request timed out'),
    msg('Camera coverage unavailable'),
    msg('Camera source temporarily unavailable'),
    msg('Overpass returned an incomplete camera response'),
  ].map((key) => [key.toUpperCase(), key]),
);
const CHIP_TILE_HTTP_RE = /^VECTOR TILES UNAVAILABLE \(HTTP (\d+)\)$/;

function localizeStatusLabel(label) {
  if (typeof label !== 'string' || !label) return label;
  const text = label.trim();
  const key = STATUS_LABEL_KEYS[text];
  if (key) return t(key);
  const errorKey = CHIP_ERROR_KEYS.get(text);
  const http = errorKey ? null : CHIP_TILE_HTTP_RE.exec(text);
  if (!errorKey && !http) return label;
  return translateFeedError(
    errorKey || `Vector tiles unavailable (HTTP ${http[1]})`,
  ).toLocaleUpperCase(getLocale());
}

// A retry detail is "retrying in Ns" or "retry pending", optionally prefixed
// by the ALPR layer name (loadingFeedback.js). The prefix is kept in every
// language: it is what tells the chip apart from a mapped-sites retry.
const RETRY_DETAIL_RE =
  /^(?:(ALPR cameras) · )?(?:retrying in (\d+)s|(retry pending))$/;

function localizeStatusDetail(detail) {
  if (typeof detail !== 'string' || !detail) return detail;
  const match = detail.trim().match(RETRY_DETAIL_RE);
  if (match) {
    const [, prefix, seconds, pending] = match;
    const retry = pending
      ? t('retry pending')
      : t('retrying in {seconds}s', { seconds });
    return prefix ? `${t('ALPR cameras')} · ${retry}` : retry;
  }
  return localizeLayerRoster(detail);
}

// The loading detail is the active layers' English names joined by " · ",
// with " +N" when more are loading. Translate each known layer name; anything
// else (a provider such as "OpenStreetMap · Overpass") passes through.
function localizeLayerRoster(detail) {
  const [, names, suffix = ''] = detail.match(/^(.*?)( \+\d+)?$/s) || [];
  if (!names) return detail;
  return (
    names
      .split(' · ')
      .map((name) => localizeLayerName(name))
      .join(' · ') + suffix
  );
}

/** The chip's label and detail in the UI language (exported for tests). */
export function localizeLoadingPresentation(presentation) {
  if (!presentation) return presentation;
  return {
    ...presentation,
    label: localizeStatusLabel(presentation.label),
    detail: localizeStatusDetail(presentation.detail),
  };
}
export class ShellFeedback {
  /**
   * @param {object} options
   * @param {() => object[]} options.readLayers The data layers' states.
   * @param {object} [options.store] The status store the chips render from.
   */
  constructor({ readLayers, store = useStatusStore(applicationPinia()) }) {
    this.readLayers = readLayers;
    this.store = store;
    this.destroyed = false;
    // The chips keep the English they were given, to show it again in a new
    // locale.
    this._loadingSource = { label: msg('LOADING LIVE DATA'), detail: '' };
    this._trafficLabel = msg('syncing road network');
    this._offLocale = onLocaleChange(() => this._relocalize());
    this._loadingFeedbackState = createLoadingFeedbackState();
    this._trafficSyncFeedbackState = createTrafficSyncFeedbackState();
    this._loadingFeedbackEvent = null;
    // Only manager settlements establish failure/recovery episodes.
    this._refreshEpisodes = new Map();
    this._globalStatusNotice = null;
    this._loadingFeedbackTicker = this._trafficChipTicker = null;
    this._loadingVisibilityHandler = null;
    this._lastLoadingFeedbackUpdateAt = 0;
    this._lastTrafficChipUpdateAt = 0;
    this._lastTrafficGlobalUpdateAt = 0;
    // What the chips last showed; a label stays while its chip is hidden.
    this._loadingView = {
      hidden: true,
      state: null,
      label: t('LOADING LIVE DATA'),
      detail: '',
      stopped: false,
    };
    this._trafficView = {
      visible: false,
      label: t('syncing road network'),
      immediate: false,
      progress: '0%',
      stopped: false,
    };
    this._toast = createToast({ durationMs: 2000, store });
  }
  observeVisibility() {
    if (this.destroyed || this._loadingVisibilityHandler) return;
    this._loadingVisibilityHandler = () => {
      if (!document.hidden) this._updateGlobalLoadingFeedback();
      else this._stopLoadingFeedbackTicker();
    };
    document.addEventListener(
      'visibilitychange',
      this._loadingVisibilityHandler,
    );
  }
  _updateTrafficSyncChip(forceShow = false, now = performance.now()) {
    if (this.destroyed) return;
    const layers = this.readLayers();
    const traffic = Array.isArray(layers)
      ? layers.find((layer) => layer.id === 'traffic')
      : null;
    this._trafficSyncFeedbackState = reduceTrafficSyncFeedback(
      this._trafficSyncFeedbackState,
      {
        enabled: traffic?.enabled === true,
        stats: traffic?.stats || {},
        forceShow,
      },
      now,
    );
    const presentation = this._trafficSyncFeedbackState;
    // The label flaps only when it changes; completion swaps it in, a timing
    // signal rather than another animated loading stage. The progress is
    // written on every change INCLUDING the empty settled value: the reducer
    // clears it once the sync lands.
    if (presentation.label) this._trafficLabel = presentation.label;
    this._publishTraffic({
      visible: presentation.visible,
      ...(presentation.label && {
        label: localizeStatusLabel(presentation.label),
        immediate: !presentation.busy,
      }),
      progress: presentation.progressText,
    });
  }

  _updateGlobalLoadingFeedback(now = performance.now()) {
    if (this.destroyed) return;
    const layers = this.readLayers() || [];
    const summary = aggregateLayerLoading(layers);
    const event = this._loadingFeedbackEvent;
    const enabled = new Map(
      layers.filter((layer) => layer.enabled).map((layer) => [layer.id, layer]),
    );
    for (const id of this._refreshEpisodes.keys()) {
      if (!enabled.has(id)) this._refreshEpisodes.delete(id);
    }
    const notice = this._globalStatusNotice;
    if (notice?.recovery) {
      const { layerId, expiresAt } = notice.recovery;
      if (
        document.hidden ||
        !hasHealthyRefreshData(enabled.get(layerId)) ||
        (!Number.isFinite(notice.hideAt) && now >= expiresAt)
      )
        this._globalStatusNotice = null;
    }
    const layer = enabled.get(event?.layerId);
    const previous = this._refreshEpisodes.get(event?.layerId);
    if (
      layer &&
      Number.isSafeInteger(event.refreshEpoch) &&
      event.refreshEpoch > 0 &&
      event.refreshEpoch > (previous?.epoch || 0) &&
      ['refresh-failed', 'refresh'].includes(event.type)
    ) {
      const failed = event.type === 'refresh-failed';
      const healthy =
        hasHealthyRefreshData(layer) &&
        !layer.stats.loading &&
        !layer.stats.refreshing;
      const recovered =
        !failed &&
        healthy &&
        ['failed', 'recovered'].includes(previous?.health) &&
        previous.acceptedAt !== null &&
        layer.stats.lastUpdate > previous.acceptedAt;
      const acceptedAt = Number.isFinite(layer.stats?.lastUpdate)
        ? Math.max(0, layer.stats.lastUpdate)
        : 0;
      this._refreshEpisodes.set(layer.id, {
        epoch: event.refreshEpoch,
        health: failed ? 'failed' : recovered ? 'recovered'
          : healthy && previous?.acceptedAt == null ? 'healthy'
          : previous?.health || 'healthy',
        // A throwing getStats() must not erase evidence already observed.
        acceptedAt: Math.max(previous?.acceptedAt || 0, acceptedAt) || null,
      });
      if (failed && this._globalStatusNotice?.recovery?.layerId === layer.id)
        this._globalStatusNotice = null;
      if (recovered) {
        const decision = resolveAttentionDisposition({
          freshnessTransition: 'recovered',
          repeated: previous.health === 'recovered',
        });
        const current = this._globalStatusNotice;
        const occupied =
          current && (!Number.isFinite(current.hideAt) || now < current.hideAt);
        if (
          decision.disposition === 'activity' &&
          !document.hidden &&
          !occupied
        ) {
          this._globalStatusNotice = {
            ...createGlobalStatusNotice('REFRESH RECOVERED', now, {
              state: 'recovered',
              detail: layer.name || layer.id,
            }),
            // A retry can retain a new failure dwell after its success. Bound
            // waiting separately from the notice's dwell once it is visible.
            recovery: {
              layerId: layer.id,
              expiresAt: now + 2 * LOADING_FAILURE_DWELL_MS,
            },
          };
        }
      }
    }
    // Capture a baseline before the first failure, including enable-time data.
    for (const layer of enabled.values()) {
      if (!this._refreshEpisodes.has(layer.id)) {
        this._refreshEpisodes.set(layer.id, {
          epoch: 0, health: 'healthy',
          acceptedAt: Number.isFinite(layer.stats?.lastUpdate) && layer.stats.lastUpdate > 0
            ? layer.stats.lastUpdate : null,
        });
      }
    }
    this._loadingFeedbackState = reduceLoadingFeedback(
      this._loadingFeedbackState,
      summary,
      now,
      this._loadingFeedbackEvent,
    );
    this._loadingFeedbackEvent = null;
    const presentation = presentGlobalLoadingStatus(
      this._globalStatusNotice,
      this._loadingFeedbackState,
      summary,
      now,
    );
    if (
      this._globalStatusNotice?.persistent !== true &&
      Number.isFinite(this._globalStatusNotice?.hideAt) &&
      now >= this._globalStatusNotice.hideAt
    ) {
      this._globalStatusNotice = null;
    }
    // Loading phases and universal notices both have time-driven transitions.
    // Compute this after arbitration: a queued finite notice starts its dwell
    // only on its first visible frame, then keeps the ticker alive to expiry.
    const noticeNeedsTicker = Number.isFinite(this._globalStatusNotice?.hideAt);
    if (this._loadingFeedbackState?.phase !== 'idle' || noticeNeedsTicker) {
      this._armLoadingFeedbackTicker();
    }
    if (!presentation) {
      this._publishLoading({ hidden: true, state: null });
      return;
    }
    this._loadingSource = presentation;
    const localized = localizeLoadingPresentation(presentation);
    // The LABEL flaps ("LOADING LIVE DATA" -> "LOAD COMPLETE") only when it
    // changes, which matters here: this runs on every 60 ms and 500 ms tick.
    // The detail is the live layer roster inside an ellipsised, width-capped
    // span; flapping a list that churns as layers join would be noise.
    this._publishLoading({
      hidden: false,
      state: presentation.state,
      label: localized.label,
      detail: localized.detail,
    });
  }

  /** Show the chips' last text in the current locale. */
  _relocalize() {
    if (this.destroyed) return;
    if (this._loadingSource) {
      const { label, detail } = localizeLoadingPresentation(
        this._loadingSource,
      );
      this._publishLoading({ label, detail });
    }
    if (this._trafficLabel)
      this._publishTraffic({ label: localizeStatusLabel(this._trafficLabel) });
  }

  _publishLoading(patch) {
    const next = { ...this._loadingView, ...patch };
    if (Object.keys(next).every((key) => next[key] === this._loadingView[key]))
      return;
    this._loadingView = next;
    this.store.publishLoading(next);
  }

  _publishTraffic(patch) {
    const next = { ...this._trafficView, ...patch };
    if (Object.keys(next).every((key) => next[key] === this._trafficView[key]))
      return;
    this._trafficView = next;
    this.store.publishTraffic(next);
  }

  /** Drop any retained notice and hide the loading status. */
  clearLoadingStatus() {
    this._globalStatusNotice = null;
    this._publishLoading({ hidden: true, state: null });
  }

  _showGlobalStatusNotice(message, options = {}) {
    if (this.destroyed) return;
    const now = performance.now();
    this._globalStatusNotice = createGlobalStatusNotice(message, now, options);
    this._updateGlobalLoadingFeedback(now);
  }

  _startTrafficChipTicker() {
    if (this.destroyed) return;
    if (this._trafficChipTicker) return;
    this._trafficChipTicker = setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      // Poll busy traffic promptly; retain the idle/global 500 ms read budget.
      if (
        this._trafficSyncFeedbackState.busy ||
        now - this._lastTrafficChipUpdateAt >= 500
      ) {
        this._lastTrafficChipUpdateAt = now;
        this._updateTrafficSyncChip(false, now);
      }
      if (now - this._lastTrafficGlobalUpdateAt >= 500) {
        this._lastTrafficGlobalUpdateAt = now;
        this._updateGlobalLoadingFeedback(now);
      }
    }, 100);
  }

  _armLoadingFeedbackTicker() {
    if (this.destroyed) return;
    // Never arm behind a hidden tab: the reducer cannot usefully advance a
    // chip nobody can see, and the old `return` INSIDE the interval left the
    // 60ms timer scheduled for the entire hidden period (a batch completing
    // while hidden could never clear it — the idle check sat behind the
    // hidden guard). visibilitychange resamples and re-arms on return.
    if (this._loadingFeedbackTicker || document.hidden) return;
    this._loadingFeedbackTicker = setInterval(() => {
      if (document.hidden) {
        this._stopLoadingFeedbackTicker();
        return;
      }
      const now = performance.now();
      this._lastLoadingFeedbackUpdateAt = now;
      this._updateGlobalLoadingFeedback(now);
      const noticeNeedsTicker = Number.isFinite(
        this._globalStatusNotice?.hideAt,
      );
      if (this._loadingFeedbackState?.phase === 'idle' && !noticeNeedsTicker) {
        this._stopLoadingFeedbackTicker();
      }
    }, 60);
  }

  _stopLoadingFeedbackTicker() {
    if (document.hidden && this._globalStatusNotice?.recovery)
      this._globalStatusNotice = null;
    if (!this._loadingFeedbackTicker) return;
    clearInterval(this._loadingFeedbackTicker);
    this._loadingFeedbackTicker = null;
  }

  _showToast(message) {
    if (this.destroyed) return;
    this._toast.show(message);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._refreshEpisodes.clear();
    this._globalStatusNotice = null;
    this._offLocale();
    this._stopLoadingFeedbackTicker();
    clearInterval(this._trafficChipTicker);
    this._trafficChipTicker = null;
    if (this._loadingVisibilityHandler)
      document.removeEventListener(
        'visibilitychange',
        this._loadingVisibilityHandler,
      );
    this._loadingVisibilityHandler = null;
    this._toast.hide();
    // The labels rest at once; a cascade does not outlive its owner.
    this._publishLoading({ hidden: true, state: null, stopped: true });
    this._publishTraffic({ stopped: true });
  }
}
