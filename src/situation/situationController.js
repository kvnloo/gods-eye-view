/**
 * The situation room: polls GEV's own feeds into a live event stream and
 * per-source status, ranks what matters now, and shows ephemeral cards built
 * from real tool results. Voice, chat, the z0live `globe` tool and agents
 * reach it through the same app actions (situationActions.js); the view
 * reaches it through the store's handlers.
 *
 * Everything the view shows comes from `publish(view)`; pins are projected
 * onto the globe each rendered frame through `project`.
 */

import {
  CARD_TOOLS,
  aircraftCard,
  areaCard,
  briefCard,
  cameraCard,
  cyclonesCard,
  distanceCard,
  errorText,
  firesCard,
  newsCard,
  quakesCard,
  satelliteCard,
  say,
  unavailableCard,
  vesselsCard,
} from './cardModels.js';
import { createCardDeck } from './cardDeck.js';
import {
  cycloneEvents,
  eventScore,
  eventsInBounds,
  eventsNear,
  mergeEvents,
  newsEvents,
  perimeterEvents,
  quakeEvents,
  rankMatters,
} from './eventStream.js';
import { freshness } from './freshness.js';
import { msg } from '../i18n/index.js';
import { areaFor, normalizeCardRequest, pointFor } from './requests.js';
import { missingSources, recordPoll, sourceStatuses } from './sourceStatus.js';

/** The GEV layer that shows each card kind's answer on the globe. */
export const CARD_LAYERS = Object.freeze({
  aircraft: ['flights'],
  vessels: ['ais-live-vessels'],
  quakes: ['earthquakes'],
  fires: ['fire-perimeters'],
  satellite: ['satellites'],
  camera: ['cctv'],
  cyclones: ['weather-cyclones'],
  brief: ['flights'],
});

const POLLS = Object.freeze({
  quakes: 60_000,
  news: 120_000,
  aircraft: 60_000,
  storms: 600_000,
  perimeters: 900_000,
  fires: 900_000,
  vessels: 300_000,
  satellites: 1_800_000,
  cameras: 3_600_000,
});

/** Tools whose answers need a server key, by the key's variable. */
const KEYED_TOOLS = Object.freeze({
  vessels_in_area: 'AISSTREAM_API_KEY',
  find_vessel: 'AISSTREAM_API_KEY',
  get_active_fires: 'FIRMS_MAP_KEY',
});

const CALL_MS = 15_000;
const RETRY_MS = 30_000;
const BRIEF_ANSWER_MS = 7_000;
const SNAPSHOT_MS = 4_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LIST_LIMIT = 9;
const EVENT_PIN_LIMIT = 60;
const LABELED_EVENT_PINS = 3;

/**
 * `services()` resolves `{ catalog, news, geocode }`. `run(name, args)` is
 * the app's action runner (camera and layers). `publish(view)` hands the
 * view its state; `publishPins(pins)` its projected pins.
 */
export function createSituationController({
  services,
  run = null,
  publish = () => {},
  publishPins = () => {},
  project = null,
  onFrame = null,
  requestRender = () => {},
  now = () => Date.now(),
  setInterval: every = globalThis.setInterval?.bind(globalThis),
  clearInterval: stopEvery = globalThis.clearInterval?.bind(globalThis),
  setTimeout: setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeout: clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
  readLayerEnabled = null,
  logger = console,
  deckOptions = {},
  polls = POLLS,
  homePoint = { lat: 37.8, lon: -122.3 },
}) {
  const deck = createCardDeck({ now, ...deckOptions });
  const records = {};
  const firstSeen = new Map();
  let streams = { quakes: [], news: [], storms: [], perimeters: [] };
  let events = [];
  let matters = [];
  let enabled = false;
  let timers = [];
  let lifetime = null;
  let focusedEventId = null;
  let offFrame = null;
  let lastPinsKey = '';
  let lastFocusPoint = homePoint;
  const retrying = new Set();
  let retryTimers = [];
  // Layers the situation room turned on for its cards (not ones already on).
  const cardLayers = new Set();

  const safe = (fn) => {
    try {
      return fn();
    } catch (error) {
      logger?.warn?.('[situation]', error?.message || error);
      return undefined;
    }
  };

  /** Throws a needs-key error when the server reports the key unset. */
  async function requireKey(envVar) {
    const loaded = await services();
    const keys = loaded.keys ? await loaded.keys() : null;
    if (keys?.[envVar] === false)
      throw Object.assign(new Error(`${envVar} not set on this server`), {
        code: 'key-required',
      });
  }

  async function call(name, args, signal) {
    const need = KEYED_TOOLS[name];
    if (need) await requireKey(need);
    const { catalog } = await services();
    const timeout = AbortSignal.timeout(CALL_MS);
    return catalog.call(name, args, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }

  // ── Polling ────────────────────────────────────────────────────────────
  async function poll(id, task) {
    if (!enabled) return;
    const signal = lifetime?.signal;
    try {
      const { count, observedAt, stale } = (await task(signal)) ?? {};
      records[id] = recordPoll(records[id], {
        ok: true,
        at: now(),
        count,
        observedAt,
        stale,
      });
    } catch (error) {
      if (signal?.aborted) return;
      records[id] = recordPoll(records[id], { ok: false, at: now(), error });
      // A failure that is not a missing key is retried soon, not at the next
      // (possibly hourly) interval: a source warming up is not down.
      if (!records[id].needsKey && !retrying.has(id) && every) {
        retrying.add(id);
        const timer = setTimeoutFn(() => {
          retrying.delete(id);
          void poll(id, task);
        }, RETRY_MS);
        retryTimers.push(timer);
      }
    }
    rebuild();
  }

  const TASKS = {
    quakes: async (signal) => {
      const result = await call('get_earthquakes', { limit: 200 }, signal);
      streams.quakes = quakeEvents(result.data.rows);
      return { count: result.data.total };
    },
    news: async (signal) => {
      const { news } = await services();
      const payload = await news.getFeed(
        { limit: 200, relevance: 'core,related', geo: true },
        { signal },
      );
      const reports = payload.reports ?? [];
      streams.news = newsEvents(reports);
      const newest = Math.max(
        ...streams.news.map((event) => event.at).filter(Number.isFinite),
      );
      return {
        count: streams.news.length,
        observedAt: Number.isFinite(newest) ? newest : now(),
      };
    },
    aircraft: async (signal) => {
      const center = lastFocusPoint;
      const result = await call(
        'aircraft_in_area',
        {
          area: { lat: center.lat, lon: center.lon, radius_km: 250 },
          limit: 1,
        },
        signal,
      );
      return {
        count: result.data.total,
        observedAt: Date.parse(result.data.observed_at) || now(),
        stale: result.data.freshness === 'stale',
      };
    },
    storms: async (signal) => {
      const result = await call('get_cyclones', {}, signal);
      streams.storms = cycloneEvents(result.data.storms);
      return { count: result.data.storms.length, stale: result.data.stale };
    },
    perimeters: async (signal) => {
      const result = await call(
        'get_fire_perimeters',
        { area: { bbox: [-170, 15, -60, 72] }, limit: 200 },
        signal,
      );
      streams.perimeters = perimeterEvents(result.data.rows);
      return { count: result.data.total, stale: result.data.stale };
    },
    fires: async (signal) => {
      const result = await call(
        'get_active_fires',
        { area: { bbox: [-125, 32, -114, 42] }, limit: 1 },
        signal,
      );
      return {
        count: result.data.total,
        observedAt: Date.parse(result.data.window_end) || now(),
        stale: result.data.stale,
      };
    },
    vessels: async (signal) => {
      const center = lastFocusPoint;
      const result = await call(
        'vessels_in_area',
        { area: { lat: center.lat, lon: center.lon, radius_km: 60 }, limit: 1 },
        signal,
      );
      return {
        count: result.data.total,
        observedAt: Date.parse(result.data.observed_at) || now(),
        stale: result.data.freshness === 'stale',
      };
    },
    satellites: async (signal) => {
      const result = await call(
        'satellites_overhead',
        { location: { lat: lastFocusPoint.lat, lon: lastFocusPoint.lon } },
        signal,
      );
      return { count: result.data.total, stale: result.data.stale };
    },
    cameras: async (signal) => {
      const result = await call(
        'find_cctv_cameras',
        {
          area: {
            lat: lastFocusPoint.lat,
            lon: lastFocusPoint.lon,
            radius_km: 50,
          },
          limit: 1,
        },
        signal,
      );
      return { count: result.data.total };
    },
  };

  function startPolling() {
    for (const [id, task] of Object.entries(TASKS)) {
      void poll(id, task);
      if (every && polls[id])
        timers.push(every(() => void poll(id, task), polls[id]));
    }
    if (every) timers.push(every(() => tick(), 250));
    // Frames drive the pins while the camera moves; this catches a pose
    // change that drew no frame the situation room heard about.
    if (every) timers.push(every(() => projectPins(false), 500));
    if (every) timers.push(every(() => publishView(), 1000));
  }

  function stopPolling() {
    for (const timer of timers) stopEvery?.(timer);
    timers = [];
    for (const timer of retryTimers) clearTimeoutFn?.(timer);
    retryTimers = [];
    retrying.clear();
  }

  // ── Derived state ──────────────────────────────────────────────────────
  function rebuild() {
    const at = now();
    events = mergeEvents([
      streams.quakes.filter((event) => event.magnitude >= 4),
      streams.news,
      streams.storms,
      streams.perimeters,
    ]);
    for (const event of events)
      if (!firstSeen.has(event.id)) firstSeen.set(event.id, at);
    matters = rankMatters(events, at, { firstSeen });
    publishView();
    projectPins(true);
  }

  function ranked(limit) {
    const at = now();
    return events
      .map((event) => ({ event, score: eventScore(event, at, firstSeen) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ event }) => event);
  }

  function cardView(card, at) {
    return {
      ...card,
      freshness: freshness(card.observedAt, at, card.band, {
        stale: card.stale,
      }),
    };
  }

  function view() {
    const at = now();
    const snapshot = deck.snapshot();
    const statuses = sourceStatuses(records, at);
    return {
      enabled,
      now: at,
      sources: statuses,
      events: ranked(LIST_LIMIT).map((event) => ({
        ...event,
        focused: event.id === focusedEventId,
      })),
      eventCount: events.length,
      matters,
      cards: snapshot.cards.map((card) => cardView(card, at)),
      receipts: snapshot.receipts,
      focusedEventId,
    };
  }

  function publishView() {
    if (!enabled) return;
    safe(() => publish(view()));
    requestRender('situation');
  }

  function tick() {
    if (deck.tick()) {
      publishView();
      projectPins(true);
    }
  }

  // ── Pins on the globe ─────────────────────────────────────────────────
  function pinSources() {
    const out = [];
    const snapshot = deck.snapshot();
    for (const card of snapshot.cards)
      card.pins.forEach((pin, index) =>
        out.push({
          id: `${card.id}:${index}`,
          cardId: card.id,
          kind: pin.kind,
          lat: pin.lat,
          lon: pin.lon,
          label: pin.label,
          course: pin.course ?? null,
          emphasis: card.phase === 'dissolving' ? 'fading' : 'card',
        }),
      );
    ranked(EVENT_PIN_LIMIT).forEach((event, index) =>
      out.push({
        id: event.id,
        eventId: event.id,
        kind: event.kind,
        lat: event.lat,
        lon: event.lon,
        label:
          index < LABELED_EVENT_PINS || event.id === focusedEventId
            ? shortLabel(event)
            : null,
        emphasis: event.id === focusedEventId ? 'focus' : 'event',
      }),
    );
    return out;
  }

  function projectPins(force = false) {
    if (!enabled || !project) return;
    const projected = [];
    for (const pin of pinSources()) {
      const xy = safe(() => project(pin.lat, pin.lon));
      if (!xy) continue;
      projected.push({ ...pin, x: Math.round(xy.x), y: Math.round(xy.y) });
    }
    const key = projected
      .map(
        (pin) =>
          `${pin.id}@${pin.x},${pin.y},${pin.emphasis},${pin.label ?? ''}`,
      )
      .join('|');
    if (!force && key === lastPinsKey) return;
    lastPinsKey = key;
    safe(() => publishPins(projected));
  }

  // ── Cards ──────────────────────────────────────────────────────────────
  async function resolvePlace(name, signal) {
    if (!name) return null;
    const { geocode } = await services();
    return geocode(name, { signal });
  }

  async function settle(promise) {
    try {
      return { result: await promise };
    } catch (error) {
      return { error };
    }
  }

  async function buildCard(request, { origin, signal }) {
    const calledAt = now();
    const base = { request, calledAt, origin };
    const place =
      request.place && !request.point
        ? await resolvePlace(request.place, signal)
        : null;
    if (request.place && !request.point && !place)
      return unavailableCard({
        ...base,
        kind: request.kind,
        error: new Error(`No place matched "${request.place}"`),
      });
    if (place) request.label = request.label || place.label;
    const area = areaFor(request, place);
    const point = pointFor(request, place);
    if (point) lastFocusPoint = point;
    const ask = async (builder, tool, args, extra = {}) => {
      const outcome = await settle(call(tool, args, signal));
      if (outcome.error)
        return unavailableCard({
          ...base,
          kind: request.kind,
          tool,
          args,
          error: outcome.error,
        });
      return builder({ ...base, tool, args, result: outcome.result, ...extra });
    };
    switch (request.kind) {
      case 'aircraft':
        return ask(aircraftCard, CARD_TOOLS.aircraft, { area, limit: 50 });
      case 'vessels':
        return ask(vesselsCard, CARD_TOOLS.vessels, { area, limit: 200 });
      case 'quakes':
        return ask(quakesCard, CARD_TOOLS.quakes, {
          ...(area ? { area } : {}),
          ...(request.minMagnitude
            ? { min_magnitude: request.minMagnitude }
            : {}),
          limit: 50,
        });
      case 'fires': {
        const firmsArgs = { area, limit: 100 };
        const perimeterArgs = { area, limit: 50 };
        const [firms, perimeters] = await Promise.all([
          settle(call('get_active_fires', firmsArgs, signal)),
          settle(call('get_fire_perimeters', perimeterArgs, signal)),
        ]);
        return firesCard({
          ...base,
          args: firmsArgs,
          result: firms.result,
          error: firms.error,
          perimeters: { ...perimeters, args: perimeterArgs },
        });
      }
      case 'satellite':
        return ask(satelliteCard, CARD_TOOLS.satellite, {
          location: { lat: point.lat, lon: point.lon },
          satellite: request.satellite || 'ISS',
        });
      case 'camera': {
        const args = { area, limit: 25 };
        const outcome = await settle(call(CARD_TOOLS.camera, args, signal));
        if (outcome.error)
          return unavailableCard({
            ...base,
            kind: 'camera',
            tool: CARD_TOOLS.camera,
            args,
            error: outcome.error,
          });
        const nearest = outcome.result.data.rows?.[0];
        let snapshot = null;
        if (nearest) {
          const frame = await settle(
            call(
              'get_cctv_snapshot',
              { camera_id: nearest.id },
              signal
                ? AbortSignal.any([signal, AbortSignal.timeout(SNAPSHOT_MS)])
                : AbortSignal.timeout(SNAPSHOT_MS),
            ),
          );
          const image = frame.result?.images?.[0];
          if (image?.data && /^image\//.test(image.mimeType || ''))
            snapshot = {
              image,
              at:
                frame.result.data?.captured_at ??
                frame.result.data?.fetched_at ??
                null,
            };
        }
        return cameraCard({
          ...base,
          tool: CARD_TOOLS.camera,
          args,
          result: outcome.result,
          snapshot,
        });
      }
      case 'cyclones':
        return ask(cyclonesCard, CARD_TOOLS.cyclones, area ? { area } : {});
      case 'news': {
        const reports = (
          place?.bounds && !request.radiusKm
            ? eventsInBounds(streams.news, place.bounds)
            : point
              ? eventsNear(streams.news, point, request.radiusKm ?? 300)
              : streams.news
        ).map((event) => ({
          title: event.title,
          publisher: event.publisher,
          at: event.at,
          lat: event.lat,
          lon: event.lon,
        }));
        const card = newsCard({ ...base, reports });
        if (point)
          card.focus = { lat: point.lat, lon: point.lon, altitude_m: 900_000 };
        if (!records.news?.ok) {
          card.unknowns.unshift(
            say(msg('The news feed has not answered this session')),
          );
        }
        return card;
      }
      case 'area': {
        const inside = place?.bounds
          ? eventsInBounds(events, place.bounds)
          : [];
        return areaCard({
          ...base,
          place: place ?? {
            label: request.label,
            lat: point.lat,
            lon: point.lon,
            bounds: null,
          },
          inside,
          geocoder: place?.geocoder,
        });
      }
      case 'distance': {
        const to = await resolvePlace(request.to, signal);
        const from = place ?? {
          label:
            request.label || `${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}`,
          lat: point.lat,
          lon: point.lon,
        };
        if (!to)
          return unavailableCard({
            ...base,
            kind: 'distance',
            error: new Error(`No place matched "${request.to}"`),
          });
        return distanceCard({ ...base, from, to, geocoder: to.geocoder });
      }
      default:
        return unavailableCard({
          ...base,
          kind: request.kind,
          error: new Error('Unsupported card'),
        });
    }
  }

  /** Point the camera at a card and turn on the layer that shows it. */
  async function frameCard(card, signal) {
    if (!run) return;
    const trail = [];
    if (card.focus) {
      const result = await settle(
        run(
          'fly_to_location',
          {
            latitude: card.focus.lat,
            longitude: card.focus.lon,
            rangeM: Math.round(
              Math.min(20_000_000, Math.max(2_000, card.focus.altitude_m * 2)),
            ),
          },
          { signal },
        ),
      );
      trail.push(
        `fly_to_location: ${result.error ? errorText(result.error) : 'ok'}`,
      );
    }
    const wanted = new Set(
      card.status === 'ok' ? (CARD_LAYERS[card.kind] ?? []) : [],
    );
    // A layer an earlier card turned on goes off when this card does not
    // need it, so the globe shows this answer and not the last one's.
    for (const layerId of [...cardLayers]) {
      if (wanted.has(layerId)) continue;
      cardLayers.delete(layerId);
      const result = await settle(
        run('set_layer_visibility', { layerId, enabled: false }, { signal }),
      );
      trail.push(
        `${layerId}: ${result.error ? errorText(result.error) : 'off'}`,
      );
    }
    for (const layerId of wanted) {
      if (cardLayers.has(layerId)) continue;
      const already = safe(() => readLayerEnabled?.(layerId)) === true;
      const result = await settle(
        run('set_layer_visibility', { layerId, enabled: true }, { signal }),
      );
      const ok = !result.error && result.result?.ok !== false;
      if (ok && !already) cardLayers.add(layerId);
      trail.push(
        `${layerId}: ${result.error ? errorText(result.error) : ok ? 'on' : 'refused'}`,
      );
    }
    return trail;
  }

  function actionResult(card, id) {
    const answer = card.answer ?? {};
    const fresh = freshness(card.observedAt, now(), card.band, {
      stale: card.stale,
    });
    const ok = card.status === 'ok';
    return {
      ok,
      action: 'show_card',
      ...(ok
        ? {}
        : card.status === 'needs-key'
          ? {
              unavailable: true,
              error: `Needs ${card.needsKey} on the GEV server; the card says so and shows no data.`,
            }
          : {
              unavailable: true,
              error: lineText(card.line) || 'The source did not answer.',
            }),
      say: ok
        ? `${card.summary || lineText(card.line) || ''}`.trim()
        : undefined,
      card: {
        id,
        kind: card.kind,
        status: card.status,
        title: card.title,
        value: answer.value ?? null,
        unit: answer.unit ?? null,
        source: card.source,
        observed_at: card.observedAt,
        observed_kind: card.observedKind,
        freshness: fresh.state,
        unknowns: card.unknowns.map(lineText).filter(Boolean).slice(0, 4),
      },
    };
  }

  /** show_card: build a card from a real tool answer and put it on screen. */
  async function showCard(args, { origin = 'agent', signal } = {}) {
    const request = normalizeCardRequest(args);
    if (request.error)
      return { ok: false, action: 'show_card', error: request.error };
    if (!enabled) setEnabled(true);
    const card = await buildCard(request, { origin, signal });
    card.origin = origin;
    const id = deck.add(card);
    publishView();
    projectPins(true);
    // The camera and layers follow without holding the caller's answer: a
    // long flight must not turn a shown card into a timeout.
    void frameCard(card, lifetime?.signal).then((trail) => {
      if (trail?.length)
        deck.update(id, (entry) => {
          entry.trail = [
            ...entry.trail,
            ...trail.map((value) => ({
              label: msg('Camera and layers'),
              value,
            })),
          ];
        });
      publishView();
    });
    return actionResult(card, id);
  }

  /**
   * brief: an agent's own briefing (title, markdown-lite body, sources) or,
   * with only a place, one composed from GEV's tools. A composed brief shows
   * at once and fills in section by section as each source answers.
   */
  async function brief(args = {}, { origin = 'agent', signal } = {}) {
    if (!enabled) setEnabled(true);
    const calledAt = now();
    const place =
      typeof args.place === 'string' ? args.place.trim().slice(0, 200) : '';
    const sources = Array.isArray(args.sources)
      ? args.sources.slice(0, 12)
      : [];
    const unknowns = Array.isArray(args.unknowns)
      ? args.unknowns.slice(0, 8)
      : [];
    if (typeof args.body === 'string' && args.body.trim()) {
      const card = briefCard({
        title: typeof args.title === 'string' ? args.title.slice(0, 120) : null,
        body: args.body,
        sources: sources.map((source) =>
          typeof source === 'string' ? { name: source } : source,
        ),
        unknowns,
        request: place ? { place, label: place } : null,
        calledAt,
        origin,
      });
      const id = deck.add(card, { holdMs: 90_000 });
      publishView();
      return {
        ok: true,
        action: 'brief',
        say: `Brief "${card.title}" is on screen with ${card.sourceList.length} sources listed.`,
        card: {
          id,
          kind: 'brief',
          sources: card.sourceList.map((s) => s.name),
          unknowns: card.unknowns.map(lineText),
        },
      };
    }
    if (!place)
      return {
        ok: false,
        action: 'brief',
        error: 'A brief needs a body or a place.',
      };
    const resolved = await resolvePlace(place, signal);
    if (!resolved)
      return {
        ok: false,
        action: 'brief',
        error: `No place matched "${place}".`,
      };
    lastFocusPoint = { lat: resolved.lat, lon: resolved.lon };
    const request = { kind: 'brief', place, label: resolved.label };
    const area = areaFor(
      { kind: 'aircraft', radiusKm: Number(args.radiusKm) || null },
      resolved,
    );
    const plan = briefPlan(area, resolved);
    const sections = plan.map((step) => ({
      id: step.id,
      tool: step.tool,
      label: step.label,
      status: 'pending',
      line: say(msg('Asking {source}…'), { source: step.source }),
      source: null,
      observedAt: null,
    }));
    const focus = {
      lat: resolved.lat,
      lon: resolved.lon,
      altitude_m: 180_000,
    };
    const make = (pins = []) =>
      briefCard({
        title:
          typeof args.title === 'string' && args.title
            ? args.title.slice(0, 120)
            : null,
        sections,
        sources,
        unknowns,
        request,
        calledAt,
        origin,
        focus,
        pins,
      });
    const id = deck.add(make(), { holdMs: 120_000 });
    publishView();
    void frameCard({ focus, status: 'ok', kind: 'brief' }, lifetime?.signal);
    const pins = [];
    const filling = Promise.all(
      plan.map(async (step, index) => {
        const outcome = step.local
          ? await settle(Promise.resolve(step.local()))
          : await settle(call(step.tool, step.args, signal));
        sections[index] = step.read(outcome, now());
        if (sections[index].pins) pins.push(...sections[index].pins);
        deck.update(id, (entry) =>
          Object.assign(entry, make(pins.slice(0, 40)), { id }),
        );
        publishView();
        projectPins(true);
      }),
    );
    // A caller's answer cannot wait on the slowest source (the bridge gives
    // a command 11 s): answer with what has arrived and name what has not;
    // the card keeps filling in.
    await Promise.race([filling, wait(BRIEF_ANSWER_MS)]);
    const card = deck.find(id);
    const ok = sections.filter((section) => section.status === 'ok');
    const pending = sections.filter((section) => section.status === 'pending');
    return {
      ok: true,
      action: 'brief',
      say: (
        `Brief for ${resolved.label}: ${ok.map((section) => lineText(section.line)).join(' ')}` +
        (pending.length
          ? ` Still waiting on ${pending.map((section) => section.label).join(', ')}; the card fills in when they answer.`
          : '')
      ).slice(0, 1200),
      card: {
        id,
        kind: 'brief',
        sources: card?.sourceList?.map((source) => source.name) ?? [],
        unknowns: (card?.unknowns ?? []).map(lineText).filter(Boolean),
      },
    };
  }

  function briefPlan(area, place) {
    const at = (iso) => (iso ? Date.parse(iso) : null);
    const section = (id, label, source, status, line, extra = {}) => ({
      id,
      label,
      source,
      status,
      line,
      ...extra,
    });
    const fail = (id, label, source, outcome, tool) => {
      const key = outcome.error
        ? /key/i.test(outcome.error.message || '')
        : false;
      return section(
        id,
        label,
        source,
        key ? 'needs-key' : 'unavailable',
        key
          ? say(msg('{source} needs a key on this server'), { source })
          : say(msg('{source} did not answer'), { source }),
        {
          tool,
          unknown: key
            ? say(msg('{label}: {source} needs a key on this server'), {
                label,
                source,
              })
            : say(msg('{label}: {source} did not answer'), { label, source }),
        },
      );
    };
    return [
      {
        id: 'air',
        tool: 'aircraft_in_area',
        label: msg('AIR'),
        source: 'ADS-B',
        args: { area, limit: 50 },
        read: (outcome) => {
          if (outcome.error)
            return fail(
              'air',
              msg('AIR'),
              'ADS-B',
              outcome,
              'aircraft_in_area',
            );
          const data = outcome.result.data;
          const airborne = data.rows.filter((row) => !row.on_ground).length;
          return section(
            'air',
            'AIR',
            data.source || 'ADS-B',
            'ok',
            say(
              msg(
                '{count} aircraft reporting, {airborne} of the nearest {listed} airborne',
              ),
              {
                count: data.total,
                airborne,
                listed: data.rows.length,
              },
            ),
            {
              tool: 'aircraft_in_area',
              observedAt: data.observed_at,
              pins: data.rows.slice(0, 15).map((row) => ({
                lat: row.lat,
                lon: row.lon,
                kind: 'aircraft',
                label: null,
                course: row.course_deg,
              })),
            },
          );
        },
      },
      {
        id: 'weather',
        tool: 'get_weather',
        label: msg('WX'),
        source: 'Open-Meteo',
        args: { location: { lat: place.lat, lon: place.lon } },
        read: (outcome) => {
          if (outcome.error)
            return fail(
              'weather',
              msg('WX'),
              'Open-Meteo',
              outcome,
              'get_weather',
            );
          const w = outcome.result.data.weather;
          return section(
            'weather',
            'WX',
            'Open-Meteo',
            'ok',
            say(
              msg(
                '{conditions}, {temperature}°C, wind {wind} km/h, visibility {visibility} km',
              ),
              {
                conditions: w.conditions,
                temperature: Math.round(w.temperature_c),
                wind: Math.round(w.wind_kph),
                visibility: Number.isFinite(w.visibility_m)
                  ? Math.round(w.visibility_m / 1000)
                  : '—',
              },
            ),
            { tool: 'get_weather', observedAt: w.observed_at },
          );
        },
      },
      {
        id: 'quakes',
        tool: 'get_earthquakes',
        label: msg('QUAKES'),
        source: 'USGS',
        args: {
          area: { lat: place.lat, lon: place.lon, radius_km: 300 },
          limit: 10,
        },
        read: (outcome, readAt) => {
          if (outcome.error)
            return fail(
              'quakes',
              msg('QUAKES'),
              'USGS',
              outcome,
              'get_earthquakes',
            );
          const rows = outcome.result.data.rows;
          return section(
            'quakes',
            'QUAKES',
            'USGS',
            'ok',
            rows.length
              ? say(
                  msg(
                    '{count} M2.5+ within 300 km in 24 h; largest M{magnitude} {place}',
                  ),
                  {
                    count: rows.length,
                    magnitude: rows[0].magnitude.toFixed(1),
                    place: rows[0].place || '',
                  },
                )
              : say(msg('No M2.5+ quakes within 300 km in 24 h')),
            {
              tool: 'get_earthquakes',
              observedAt: new Date(readAt).toISOString(),
              pins: rows.slice(0, 5).map((row) => ({
                lat: row.lat,
                lon: row.lon,
                kind: 'quake',
                label: `M${row.magnitude.toFixed(1)}`,
              })),
            },
          );
        },
      },
      {
        id: 'fires',
        tool: 'get_active_fires + get_fire_perimeters',
        label: msg('FIRES'),
        source: 'FIRMS · WFIGS',
        local: async () => {
          const [firms, perimeters] = await Promise.all([
            settle(
              call('get_active_fires', {
                area: { lat: place.lat, lon: place.lon, radius_km: 150 },
                limit: 50,
              }),
            ),
            settle(
              call('get_fire_perimeters', {
                area: { lat: place.lat, lon: place.lon, radius_km: 150 },
                limit: 20,
              }),
            ),
          ]);
          return { firms, perimeters };
        },
        read: (outcome) => {
          const { firms, perimeters } = outcome.result ?? {};
          if (!perimeters?.result && !firms?.result)
            return fail(
              'fires',
              'FIRES',
              'FIRMS · WFIGS',
              perimeters ?? firms ?? outcome,
              'get_fire_perimeters',
            );
          const rows = perimeters?.result?.data?.rows ?? [];
          const open = rows.filter(
            (row) => !(Number(row.contained_pct) >= 100),
          );
          const hotspots = firms?.result?.data?.total;
          const firmsKey =
            firms?.error && /key/i.test(firms.error.message || '');
          return section(
            'fires',
            'FIRES',
            firms?.result ? 'NASA FIRMS · NIFC WFIGS' : 'NIFC WFIGS',
            'ok',
            firms?.result
              ? say(
                  msg(
                    '{hotspots} satellite hotspots in 24 h; {open} uncontained of {total} mapped perimeters within 150 km',
                  ),
                  {
                    hotspots,
                    open: open.length,
                    total: rows.length,
                  },
                )
              : say(
                  msg(
                    '{open} uncontained of {total} mapped perimeters within 150 km',
                  ),
                  {
                    open: open.length,
                    total: rows.length,
                  },
                ),
            {
              tool: 'get_active_fires + get_fire_perimeters',
              observedAt:
                firms?.result?.data?.window_end ??
                perimeters?.result?.data?.retrieved_at ??
                null,
              ...(firmsKey
                ? {
                    missing: 'NASA FIRMS',
                    unknown: say(
                      msg(
                        'FIRES: satellite hotspots (NASA FIRMS) need a key on this server',
                      ),
                    ),
                  }
                : {}),
            },
          );
        },
      },
      {
        id: 'news',
        tool: 'news feed',
        label: msg('NEWS'),
        source: 'GDELT',
        local: () => eventsNear(streams.news, place, 120),
        read: (outcome) => {
          const near = outcome.result ?? [];
          if (!records.news?.ok)
            return fail(
              'news',
              'NEWS',
              'GDELT',
              { error: new Error('feed not answered') },
              'news feed',
            );
          const newest = near[0];
          return section(
            'news',
            'NEWS',
            'GDELT Project',
            'ok',
            newest
              ? say(
                  msg(
                    '{count} geolocated reports within 120 km; latest: {title}',
                  ),
                  { count: near.length, title: newest.title },
                )
              : say(
                  msg('No geolocated reports within 120 km in the feed window'),
                ),
            {
              tool: 'news feed',
              observedAt: newest?.at ? new Date(newest.at).toISOString() : null,
              pins: near.slice(0, 8).map((event) => ({
                lat: event.lat,
                lon: event.lon,
                kind: 'news',
                label: null,
              })),
            },
          );
        },
      },
      {
        id: 'cameras',
        tool: 'find_cctv_cameras',
        label: msg('CAMS'),
        source: 'GEV CCTV',
        args: {
          area: { lat: place.lat, lon: place.lon, radius_km: 40 },
          limit: 5,
        },
        read: (outcome, readAt) => {
          if (outcome.error)
            return fail(
              'cameras',
              'CAMS',
              'GEV CCTV',
              outcome,
              'find_cctv_cameras',
            );
          const data = outcome.result.data;
          return section(
            'cameras',
            'CAMS',
            'GEV CCTV catalog',
            'ok',
            say(msg('{count} public cameras within 40 km'), {
              count: data.total,
            }),
            {
              tool: 'find_cctv_cameras',
              observedAt: new Date(readAt).toISOString(),
            },
          );
        },
      },
      {
        id: 'sea',
        tool: 'vessels_in_area',
        label: msg('SEA'),
        source: 'AISStream',
        args: {
          area: { lat: place.lat, lon: place.lon, radius_km: 60 },
          limit: 20,
        },
        read: (outcome) => {
          if (outcome.error)
            return fail(
              'sea',
              msg('SEA'),
              'AISStream',
              outcome,
              'vessels_in_area',
            );
          const data = outcome.result.data;
          return section(
            'sea',
            'SEA',
            data.source || 'AIS',
            'ok',
            say(msg('{count} vessels reporting within 60 km'), {
              count: data.total,
            }),
            { tool: 'vessels_in_area', observedAt: data.observed_at },
          );
        },
      },
    ];
  }

  function pin(args = {}) {
    const id = deck.pin(args.id ?? null, args.pinned !== false);
    publishView();
    return id
      ? {
          ok: true,
          action: 'pin_card',
          say:
            args.pinned === false
              ? 'Card unpinned.'
              : 'Card pinned; it holds until dismissed.',
          card: { id },
        }
      : { ok: false, action: 'pin_card', error: 'No card on screen to pin.' };
  }

  function dismiss(args = {}) {
    const ids = deck.dismiss(args.id ?? null, { all: args.all === true });
    publishView();
    return ids.length
      ? {
          ok: true,
          action: 'dismiss_card',
          say: `Dismissed ${ids.length} card${ids.length === 1 ? '' : 's'}; receipts stay in the rail.`,
          cards: ids,
        }
      : {
          ok: false,
          action: 'dismiss_card',
          error: 'No card on screen to dismiss.',
        };
  }

  function expand(id, expanded = true) {
    const done = deck.expand(id, expanded);
    publishView();
    return done;
  }

  async function focusEvent(args = {}, { signal } = {}) {
    if (!enabled) setEnabled(true);
    let event = null;
    if (args.id)
      event = events.find((candidate) => candidate.id === args.id) ?? null;
    else {
      const rank = Number.isInteger(args.rank) ? args.rank : 1;
      const item = matters[rank - 1];
      event = item
        ? events.find((candidate) => candidate.id === item.id)
        : null;
    }
    if (!event)
      return {
        ok: false,
        action: 'focus_event',
        error: 'No such event in the live stream.',
      };
    focusedEventId = event.id;
    lastFocusPoint = { lat: event.lat, lon: event.lon };
    publishView();
    projectPins(true);
    let flew = null;
    if (run)
      flew = await settle(
        run(
          'fly_to_location',
          { latitude: event.lat, longitude: event.lon, rangeM: 900_000 },
          { signal },
        ),
      );
    const item = matters.find((candidate) => candidate.id === event.id);
    return {
      ok: !flew?.error,
      action: 'focus_event',
      say: `${event.title}${event.place ? `, ${event.place}` : ''} (${event.source}).`,
      event: {
        id: event.id,
        kind: event.kind,
        title: event.title,
        place: event.place,
        at: Number.isFinite(event.at) ? new Date(event.at).toISOString() : null,
        source: event.source,
        latitude: event.lat,
        longitude: event.lon,
      },
      ...(item
        ? {
            next_question: lineText(item.next.text),
            next_action: item.next.action,
          }
        : {}),
      ...(flew?.error ? { error: errorText(flew.error) } : {}),
    };
  }

  // ── Mode ───────────────────────────────────────────────────────────────
  function setEnabled(next) {
    next = next === true;
    if (next === enabled) return enabled;
    enabled = next;
    if (enabled) {
      lifetime = new AbortController();
      startPolling();
      if (onFrame && project) offFrame = onFrame(() => projectPins(false));
      publishView();
    } else {
      lifetime?.abort();
      lifetime = null;
      stopPolling();
      offFrame?.();
      offFrame = null;
      safe(() => publish({ enabled: false }));
      safe(() => publishPins([]));
    }
    return enabled;
  }

  /** What agents see: compact, plain, no feed bodies. */
  function context() {
    if (!enabled) return { enabled: false };
    const at = now();
    const snapshot = deck.snapshot();
    const statuses = sourceStatuses(records, at);
    return {
      enabled: true,
      cards: snapshot.cards
        .filter((card) => card.phase !== 'dissolving')
        .map((card) => ({
          id: card.id,
          kind: card.kind,
          title: card.title,
          status: card.status,
          value: card.answer?.value ?? null,
          pinned: card.pinned,
        })),
      receipts: snapshot.receipts.slice(0, 3).map((receipt) => ({
        kind: receipt.kind,
        title: receipt.title,
        value: receipt.value,
      })),
      matters: matters.map((item) => ({
        rank: item.rank,
        id: item.id,
        title: item.title,
        next: lineText(item.next.text),
      })),
      sources: Object.fromEntries(
        statuses.map((status) => [status.id, status.state]),
      ),
      missing: missingSources(statuses).map((source) => source.id),
    };
  }

  function stop() {
    setEnabled(false);
  }

  return {
    setEnabled,
    get enabled() {
      return enabled;
    },
    showCard,
    brief,
    pin,
    dismiss,
    expand,
    focusEvent,
    context,
    stop,
    // For tests and QA.
    _state: () => ({ records, events, matters, deck: deck.snapshot() }),
    _poll: (id) => poll(id, TASKS[id]),
    _projectPins: projectPins,
  };
}

function shortLabel(event) {
  if (event.kind === 'quake')
    return (
      event.title.split(' ')[0] +
      (event.place ? ` ${event.place.replace(/^.*\bof\s+/, '')}` : '')
    );
  if (event.kind === 'news')
    return event.place ? event.place.split(',')[0] : event.title.slice(0, 28);
  return event.title.slice(0, 28);
}

/** English text of a descriptor, for spoken results and agent context. */
export function lineText(line) {
  if (!line) return '';
  if (typeof line === 'string') return line;
  const values = line.values ?? {};
  return String(line.text || '').replace(/\{(\w+)\}/g, (_, key) =>
    values[key] === undefined ? `{${key}}` : String(values[key]),
  );
}
