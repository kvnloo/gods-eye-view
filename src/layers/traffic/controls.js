import * as Cesium from 'cesium';
import {
  normalizeRoadMode,
  resolveRoadMode,
  TRAFFIC_ROAD_MODES,
} from './roadModes.js';
import {
  trafficBucketTier,
  trafficStyleProfile,
} from '../../data/trafficPresetStyle.js';
import { TRAFFIC_TIMING_ENABLED } from './policy.js';
import { t, translateKnown } from '../../i18n/index.js';

/**
 * Find the nearest point on the currently loaded road polylines.
 * @param {Array<{coords:number[][],type?:string}>} roads Parsed traffic roads.
 * @param {{lat:number,lon:number}} point Geographic observation.
 * @param {number} [maxDistanceM=18] Admission radius.
 * @returns {{lat:number,lon:number,distanceM:number,roadIndex:number,segmentIndex:number,t:number,roadType:string|null}|null}
 */
export function nearestRoadSnap(roads, point, maxDistanceM = 18) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  const maxDistance = Math.max(1, Number(maxDistanceM) || 18);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const metresLat = 111320;
  const metresLon = Math.max(1, metresLat * Math.cos((lat * Math.PI) / 180));
  let best = null;
  for (let roadIndex = 0; roadIndex < (roads || []).length; roadIndex++) {
    const road = roads[roadIndex];
    const coords = road?.coords;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    for (
      let segmentIndex = 0;
      segmentIndex < coords.length - 1;
      segmentIndex++
    ) {
      const a = coords[segmentIndex];
      const b = coords[segmentIndex + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const ax = (Number(a[0]) - lon) * metresLon;
      const ay = (Number(a[1]) - lat) * metresLat;
      const bx = (Number(b[0]) - lon) * metresLon;
      const by = (Number(b[1]) - lat) * metresLat;
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq <= 1e-6) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
      const x = ax + dx * t;
      const y = ay + dy * t;
      const distanceM = Math.hypot(x, y);
      if (distanceM > maxDistance || (best && distanceM >= best.distanceM))
        continue;
      best = {
        lat: lat + y / metresLat,
        lon: lon + x / metresLon,
        distanceM,
        roadIndex,
        segmentIndex,
        t,
        roadType: road.type || null,
      };
    }
  }
  return best;
}

export function createControls({ state: layerState, services, parts, source }) {
  /** One status line: feed, drawn road source, then degraded-coverage notes. */
  function roadStatusLabel(feed) {
    const source = layerState._roadSource;
    if (layerState._roadError)
      return t('UNAVAILABLE · {source} · Roads unavailable', { source });
    const notes = [feed.loadingLabel];
    if (!layerState._liveMode || feed.error)
      notes.push(t('Roads: {source}', { source }));
    // An explicit TomTom or Hybrid choice without a key draws OpenStreetMap.
    if (
      !layerState._liveMode &&
      ['tomtom', 'hybrid'].includes(layerState._roadMode)
    )
      notes.push(
        layerState._flowStatusUnavailable
          ? layerState._roadMode === 'tomtom'
            ? t(
                'TomTom roads unavailable while the traffic service is unreachable',
              )
            : t('Hybrid unavailable while the traffic service is unreachable')
          : layerState._roadMode === 'tomtom'
            ? t('TomTom roads need a TomTom key')
            : t('Hybrid needs a TomTom key'),
      );
    if (layerState._surfacePending)
      notes.push(t('Local surface still loading'));
    // The warning is a road-source message (source.js marks the known ones).
    if (layerState._roadWarning)
      notes.push(translateKnown(layerState._roadWarning));
    else if (layerState._roadPartial) notes.push(t('Partial coverage'));
    if (layerState._detailError) notes.push(t('Detailed roads unavailable'));
    else if (layerState._detailLimited)
      notes.push(t('Reduced detail coverage'));
    return notes.join(' · ');
  }

  const { getFlowSessionStats } = source;

  const methods = {
    id: 'traffic',

    name: 'Street Traffic',

    icon: '🚗',

    source: 'OpenStreetMap / TomTom',

    /** @type {number} Zero — layer is self-managed via camera listener + preRender */
    updateInterval: 0,

    /**
     * Update user-adjustable parameters (road source, density and speed scaling).
     *
     * @param {Object}  [params]
     * @param {'tomtom'|'osm'|'hybrid'|null} [params.roadMode] - Road source; null = default.
     * @param {number}  [params.densityScale] - Dot density multiplier (clamped 0.2–2.5).
     * @param {number}  [params.speedScale]   - Dot speed multiplier (clamped 0.3–3.0).
     * @param {{origin?:string}} [options] - Intent origin; restores never beat `?trafficRoads=`.
     */
    setParams(params = {}, { origin } = {}) {
      const previousDensity = layerState._densityScale;
      const previousSpeed = layerState._speedScale;
      if (
        Object.hasOwn(params, 'roadMode') &&
        (params.roadMode === null || normalizeRoadMode(params.roadMode))
      ) {
        const explicit = ['user', 'voice', 'tool'].includes(origin);
        const mode =
          !explicit && layerState._roadModeUrlOverride
            ? layerState._roadModeUrlOverride
            : params.roadMode;
        if (explicit) layerState._roadModeUrlOverride = null;
        if (mode !== layerState._roadMode) {
          layerState._roadMode = mode;
          // Redraw from scratch: a different source means different roads.
          parts.ingestion.cancelActiveFetch();
          clearTimeout(layerState._retryTimer);
          layerState._retryTimer = null;
          layerState._loadGeneration++;
          layerState._fetching = false;
          layerState._lastBounds = null;
          layerState._lastViewCenter = null;
          parts.animation.clearDots();
          if (layerState._enabled)
            parts.viewport.onCameraChanged({ immediate: true });
        }
      }
      if (typeof params.densityScale === 'number') {
        layerState._densityScale = Math.max(
          0.2,
          Math.min(2.5, params.densityScale),
        );
      }
      if (typeof params.speedScale === 'number') {
        layerState._speedScale = Math.max(
          0.3,
          Math.min(3.0, params.speedScale),
        );
      }
      if (layerState._speedScale !== previousSpeed) {
        const ratio = layerState._speedScale / previousSpeed;
        for (const dot of layerState._dots) {
          dot.baseMps *= ratio;
          dot.mps *= ratio;
        }
      }
      if (
        layerState._densityScale !== previousDensity &&
        layerState._enabled &&
        layerState._roads.length
      )
        parts.rendering.renderRoadsForAltitude(
          layerState._roads,
          layerState._lastRenderAltitude,
          'Density',
        );
      // Live-mode treatment of roads TomTom has no flow data for:
      // 'sim' (default) keeps them as today's white ambient dots — colored =
      // real data, white = simulation; 'hide' spawns nothing on them (strict
      // data-integrity view). Owner-explorable; re-render applies on the next
      // camera-driven load.
      if (params.uncoveredRoads === 'sim' || params.uncoveredRoads === 'hide') {
        layerState._uncoveredMode = params.uncoveredRoads;
      }
      // Jam-viz prototype toggle (owner A/B): 'none' = shipped main behavior;
      // live mode only, applies on the next camera-driven load like the
      // uncoveredRoads param above.
      if (['none', 'density', 'heatline', 'both'].includes(params.jamViz)) {
        layerState._jamViz = params.jamViz;
      }
      // Preset-aware dot styling kill switch (owner A/B): 'off' forces the
      // shipped palette under every post-FX preset. Applies immediately via
      // in-place restyle — no refetch — so A/B legs share identical dots.
      if (params.presetDots === 'on' || params.presetDots === 'off') {
        if (params.presetDots !== layerState._presetDots) {
          layerState._presetDots = params.presetDots;
          parts.style.restyleDotsInPlace();
        }
      }
    },

    /**
     * Return the current user-adjustable parameters.
     * @returns {{densityScale:number, speedScale:number}}
     */
    getParams() {
      return {
        roadMode: layerState._roadMode,
        densityScale: layerState._densityScale,
        speedScale: layerState._speedScale,
        uncoveredRoads: layerState._uncoveredMode,
        jamViz: layerState._jamViz,
        presetDots: layerState._presetDots,
      };
    },

    /** Road-source chips on the Street Traffic row (TomTom / OSM / Hybrid). */
    getRowControls() {
      const selected =
        layerState._roadMode || resolveRoadMode(null, layerState._liveMode);
      const live = layerState._liveMode;
      const titles = {
        tomtom: live
          ? t('TomTom roads only, each with its live flow')
          : t(
              'TomTom roads only, each with its live flow (needs a TomTom key)',
            ),
        osm: t('OpenStreetMap roads, with TomTom flow matched when available'),
        hybrid: live
          ? t('TomTom roads first; OpenStreetMap fills the rest, simulated')
          : t(
              'TomTom roads first; OpenStreetMap fills the rest, simulated (needs a TomTom key)',
            ),
      };
      // TomTom and OSM are provider names and stay as they are.
      const labels = { tomtom: 'TomTom', osm: 'OSM', hybrid: t('Hybrid') };
      return {
        chips: TRAFFIC_ROAD_MODES.map((mode) => ({
          id: `roads-${mode}`,
          label: labels[mode],
          title: titles[mode],
          active: mode === selected,
          params: { roadMode: mode },
        })),
      };
    },

    /**
     * Snap a CCTV-derived observation onto nearby loaded road geometry.
     * Returns the interpolated rendered-road Cartesian so observed contacts use
     * the same height datum as normal traffic dots.
     * @param {{lat:number,lon:number}} point
     * @param {{maxDistanceM?:number}} [options]
     * @returns {Object|null}
     */
    snapObservedPoint(point, options = {}) {
      const snap = nearestRoadSnap(
        layerState._roads,
        point,
        options.maxDistanceM,
      );
      if (!snap) return null;
      const road = layerState._roads[snap.roadIndex];
      const a = road?.waypoints?.[snap.segmentIndex];
      const b = road?.waypoints?.[snap.segmentIndex + 1];
      const position =
        a && b
          ? Cesium.Cartesian3.lerp(a, b, snap.t, new Cesium.Cartesian3())
          : Cesium.Cartesian3.fromDegrees(snap.lon, snap.lat, 2);
      return { ...snap, position };
    },

    /** Replace one producer's anonymous transient observed contacts. */
    replaceExternalVehicleObservations(sourceId, contacts, options = {}) {
      return parts.rendering.replaceExternalVehicleObservations(
        sourceId,
        contacts,
        options,
      );
    },

    /** Clear one producer, or every external observation when sourceId is null. */
    clearExternalVehicleObservations(sourceId = null) {
      return parts.rendering.clearExternalVehicleObservations(sourceId);
    },

    /**
     * Return a sub-sampled list of active dot positions for detection overlays
     * (e.g. CCTV bounding-box rendering).
     *
     * Uses a deterministic stride-based sampling so different seeds yield
     * non-overlapping subsets without sorting or shuffling.
     *
     * @param {Object}  [options]
     * @param {number}  [options.maxCount] - Maximum objects to return (defaults to all).
     * @param {number}  [options.seed]     - Integer seed to offset the sampling start.
     * @returns {Array<{position:Cesium.Cartesian3, id:string, type:string}>}
     */
    getDetectableObjects(options = {}) {
      if (!layerState._enabled) return [];
      const observed = parts.rendering.getExternalVehicleDetectableObjects();
      if (!layerState._dots.length && !observed.length) return [];
      const maxCount = Number.isFinite(options.maxCount)
        ? Math.max(1, Math.floor(options.maxCount))
        : layerState._dots.length + observed.length;
      const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
      // Stride-based sampling: step through dots evenly to get ~maxCount samples
      const stride = Math.max(1, Math.ceil(layerState._dots.length / maxCount));
      const start = seed % stride;

      const result = observed.slice(0, maxCount);
      if (result.length >= maxCount) return result;
      for (let i = start; i < layerState._dots.length; i += stride) {
        const pos = layerState._dots[i].point.position;
        if (!pos) continue;
        const entry = {
          position: pos,
          id: `VEH-${String(layerState._dots[i].id).padStart(4, '0')}`,
          type: 'VEH',
        };
        // Live mode: the detection bracket carries the congestion signal —
        // its canvas sits ABOVE the post-FX chain, so tier colors survive
        // every preset (owner round 2: "bounding boxes do the heavy
        // lifting"). Keyless mode sets no tier: contacts keep the stock
        // 'vehicle' bracket and the keyless experience stays untouched.
        if (layerState._liveMode) {
          const tier = trafficBucketTier(layerState._dots[i].bucket || 'sim');
          if (tier) entry.tier = tier;
        }
        result.push(entry);
        if (result.length >= maxCount) break;
      }
      return result;
    },

    /** Visit stable dot identities and their owning geometry without allocating snapshots. */
    visitMotionDots(visitor) {
      for (let i = 0; i < layerState._dots.length; i++) {
        const dot = layerState._dots[i];
        visitor(dot.id, dot.road.key, dot.point, dot.road);
      }
    },

    /**
     * Return current layer statistics for UI status chips.
     * `mode` is the CONFIGURED source — 'live' (a TomTom key is present) or
     * 'sim' (keyless simulation, which the manager renders as a FALLBACK chip);
     * `error` carries this instant's health, so a live-configured layer whose
     * flow feed went down reads DEGRADED with the reason instead of a stale
     * LIVE coverage number. `flowCoveragePct` is shown dots on matched roads /
     * all shown dots (0–100 int), excluding closures; `tilesFetched` counts flow-tile requests
     * issued to the proxy this session (decode-cache hits excluded).
     * @returns {{count:number, lastUpdate:number|null, loading:boolean,
     *   mode:'live'|'sim', error:string|null, flowCoveragePct:number,
     *   tilesFetched:number}}
     */
    getLoadingDiagnostics() {
      let movingWaypoints = 0,
        maxResidualM = 0;
      for (const road of layerState._roads) {
        if (!road.heightMoving) continue;
        for (let i = 0; i < road.waypoints.length; i++) {
          const a = road.waypoints[i],
            b = road.targetWaypoints[i];
          const residual = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          if (residual >= 0.01) movingWaypoints++;
          maxResidualM = Math.max(maxResidualM, residual);
        }
      }
      return {
        fetching: Boolean(layerState._fetching),
        flowPending: layerState._flowPending,
        surfaceRefining: Boolean(layerState._surfaceRefining),
        populationPending: Boolean(layerState._populationPending),
        heightPending: Boolean(layerState._heightPending),
        generation: layerState._loadGeneration,
        surfaceRevision: layerState._surfaceRevision,
        lastPaintStage: layerState._lastPaintStage || null,
        movingWaypoints,
        maxResidualM,
      };
    },

    getStats() {
      // Outstanding flow work counts as loading: the paint race can leave a
      // TomTom request in flight after the roads have settled, and the shared
      // loading batch has to stay open long enough to announce its failure.
      const loading =
        layerState._fetching ||
        layerState._flowPending > 0 ||
        Boolean(layerState._surfaceRefining) ||
        Boolean(layerState._populationPending) ||
        Boolean(layerState._heightPending);
      const { free, slow, jam, sim } = layerState._bucketCounts;
      const matched = free + slow + jam;
      const flowCoveragePct =
        matched + sim > 0 ? Math.round((100 * matched) / (matched + sim)) : 0;
      const feed = parts.model.trafficFeedPresentation({
        liveMode: layerState._liveMode,
        fetching: loading,
        flowError: layerState._flowError,
        stale: layerState._flowStale,
        coveragePct: flowCoveragePct,
        statusUnavailable: layerState._flowStatusUnavailable,
        roadSource: layerState._roadSource,
      });
      return {
        count: layerState._count,
        observedVehicles:
          parts.rendering?.getExternalVehicleObservationCount?.() ?? 0,
        motion: { ...layerState._motion },
        surfaceBudgetOmitted: layerState._surfaceBudgetOmitted || 0,
        lastUpdate: layerState._lastUpdate,
        loading,
        mode: feed.mode,
        // Cached proxy tiles (TomTom budget spent or upstream failing): the
        // manager reads this as STALE. Any error (flow, roads, detail) reads
        // DEGRADED instead.
        stale: Boolean(
          layerState._liveMode &&
          layerState._flowStale &&
          !(
            layerState._roadError ||
            layerState._roadWarning ||
            layerState._detailError ||
            feed.error
          ),
        ),
        oldestTileAt: layerState._flowOldestTileAt ?? null,
        error:
          layerState._roadError ||
          layerState._roadWarning ||
          layerState._detailError ||
          feed.error,
        roadBounds: layerState._lastBounds,
        surfacePending: layerState._surfacePending || 0,
        roadWarning: layerState._roadWarning || null,
        detailError: layerState._detailError || null,
        detailLimited: Boolean(layerState._detailLimited),
        flowCoveragePct,
        tilesFetched: getFlowSessionStats().tilesFetched,
        ...(TRAFFIC_TIMING_ENABLED
          ? { trafficTiming: parts.timing.getTrafficTimingDiagnostics() }
          : {}),
        // Per-bucket rendered-dot counts (sim = white ambient). Drives the
        // qa-traffic color assertions and the sync-chip mode label below.
        flowBuckets: { ...layerState._bucketCounts },
        closedRoads: layerState._closedRoads,
        // Jam-viz prototype diagnostics (additive — harness contract untouched).
        heatLines: layerState._heatLineCount,
        jamViz: layerState._jamViz,
        // Preset-styling diagnostics (additive): active style + profile.
        stylePreset: layerState._stylePreset,
        styleProfile:
          layerState._presetDots === 'on'
            ? trafficStyleProfile(layerState._stylePreset)
            : 'normal',
        // Sync-chip text: shown while busy, and flashed on its own for 1.5 s
        // after each completed load (ui.js _updateTrafficSyncChip semantics).
        // The settled flash carries NO progress number beside it — this label's
        // coverage figure is the chip's only percentage — so a label that ends
        // in one had better be the honest one. This is also where LIVE vs
        // SIMULATED mode is surfaced, and it must never imply a live feed the
        // layer does not have.
        roadMode: resolveRoadMode(layerState._roadMode, layerState._liveMode),
        roadModeRequested: layerState._roadMode,
        roadSource: layerState._roadSource,
        source: layerState._roadSource,
        loadingLabel: roadStatusLabel(feed),
      };
    },
  };

  return { methods };
}
