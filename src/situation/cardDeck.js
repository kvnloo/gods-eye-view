/**
 * The ephemeral card lifecycle: a card appears when asked, plays (its pins
 * land and its number settles), holds while it is relevant, then dissolves
 * into a one-line receipt. Pinning holds a card until it is unpinned or
 * dismissed; expanding it (the decision trail) holds it too. Pure: time is
 * passed in, so the lifecycle is tested without timers.
 */

import { receiptOf } from './cardModels.js';

export const CARD_PHASES = Object.freeze(['playing', 'holding', 'dissolving']);

export const DECK_DEFAULTS = Object.freeze({
  playMs: 1600,
  holdMs: 45_000,
  // A card the person or agent is looking into holds this long after the
  // last interaction, even unpinned.
  expandedHoldMs: 90_000,
  dissolveMs: 700,
  maxCards: 3,
  maxReceipts: 8,
});

/** Create a deck. `now()` is read on every change. */
export function createCardDeck(options = {}) {
  const config = { ...DECK_DEFAULTS, ...options };
  const now = options.now ?? (() => Date.now());
  let serial = 0;
  let cards = [];
  let receipts = [];
  let version = 0;

  const touch = () => {
    version += 1;
  };

  function retire(card, at) {
    receipts = [
      { ...receiptOf(card), retiredAt: at },
      ...receipts.filter((receipt) => receipt.id !== card.id),
    ].slice(0, config.maxReceipts);
  }

  /** Show a card; returns its id. The oldest unpinned card makes room. */
  function add(card, { holdMs } = {}) {
    const at = now();
    serial += 1;
    const id = card.id || `card-${serial}`;
    const entry = {
      ...card,
      id,
      phase: 'playing',
      shownAt: at,
      phaseAt: at,
      holdUntil: at + config.playMs + (holdMs ?? config.holdMs),
      pinned: false,
      expanded: false,
    };
    cards = [entry, ...cards.filter((existing) => existing.id !== id)];
    // Room for the new card: dissolve the oldest unpinned ones beyond the cap.
    const live = cards.filter((existing) => existing.phase !== 'dissolving');
    if (live.length > config.maxCards) {
      const extra = live
        .filter((existing) => !existing.pinned && existing.id !== id)
        .slice(config.maxCards - live.length);
      for (const old of extra) startDissolve(old, at);
    }
    touch();
    return id;
  }

  function startDissolve(card, at) {
    if (card.phase === 'dissolving') return;
    card.phase = 'dissolving';
    card.phaseAt = at;
  }

  function find(id) {
    if (id == null) return cards.find((card) => card.phase !== 'dissolving');
    return cards.find((card) => card.id === id) ?? null;
  }

  /** Pin (or unpin) a card; the newest when `id` is omitted. */
  function pin(id, pinned = true) {
    const card = find(id);
    if (!card) return null;
    const at = now();
    card.pinned = pinned;
    if (card.phase === 'dissolving') {
      card.phase = 'holding';
      card.phaseAt = at;
    }
    if (!pinned) card.holdUntil = Math.max(card.holdUntil, at + config.holdMs);
    touch();
    return card.id;
  }

  /** Open or close a card's decision trail; open extends its hold. */
  function expand(id, expanded = true) {
    const card = find(id);
    if (!card) return null;
    const at = now();
    card.expanded = expanded;
    if (expanded) {
      card.holdUntil = Math.max(card.holdUntil, at + config.expandedHoldMs);
      if (card.phase === 'dissolving') {
        card.phase = 'holding';
        card.phaseAt = at;
      }
    }
    touch();
    return card.id;
  }

  /** Dismiss one card (the newest when `id` is omitted) or all of them. */
  function dismiss(id, { all = false } = {}) {
    const at = now();
    const targets = all ? cards : [find(id)].filter(Boolean);
    for (const card of targets) {
      card.pinned = false;
      startDissolve(card, at);
    }
    if (targets.length) touch();
    return targets.map((card) => card.id);
  }

  /** Change a card in place (a brief filling in); returns whether it exists. */
  function update(id, change) {
    const card = cards.find((entry) => entry.id === id);
    if (!card) return false;
    const { phase, phaseAt, shownAt, holdUntil, pinned, expanded } = card;
    change(card);
    Object.assign(card, {
      id,
      phase,
      phaseAt,
      shownAt,
      holdUntil,
      pinned,
      expanded,
    });
    touch();
    return true;
  }

  /** Advance phases to `now()`. Returns true when anything changed. */
  function tick() {
    const at = now();
    let changed = false;
    const kept = [];
    for (const card of cards) {
      if (card.phase === 'playing' && at - card.phaseAt >= config.playMs) {
        card.phase = 'holding';
        card.phaseAt = at;
        changed = true;
      }
      if (card.phase === 'holding' && !card.pinned && at >= card.holdUntil) {
        startDissolve(card, at);
        changed = true;
      }
      if (
        card.phase === 'dissolving' &&
        at - card.phaseAt >= config.dissolveMs
      ) {
        retire(card, at);
        changed = true;
        continue;
      }
      kept.push(card);
    }
    cards = kept;
    if (changed) touch();
    return changed;
  }

  function snapshot() {
    return {
      version,
      cards: cards.map((card) => ({ ...card })),
      receipts: receipts.map((receipt) => ({ ...receipt })),
    };
  }

  return {
    add,
    update,
    pin,
    expand,
    dismiss,
    tick,
    find: (id) => {
      const card = find(id);
      return card ? { ...card } : null;
    },
    snapshot,
    get version() {
      return version;
    },
  };
}
