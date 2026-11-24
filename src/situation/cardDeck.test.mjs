import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardDeck } from './cardDeck.js';

const card = (title, extra = {}) => ({
  kind: 'aircraft',
  status: 'ok',
  title,
  createdAt: 0,
  answer: { value: 3, unit: 'AIRCRAFT' },
  source: 'adsb.lol',
  observedAt: '2026-11-24T04:00:00.000Z',
  pins: [],
  trail: [],
  ...extra,
});

function clock(start = 1000) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

test('a card plays, holds, dissolves, then leaves a receipt', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, playMs: 1000, holdMs: 5000, dissolveMs: 500 });
  const id = deck.add(card('Hormuz'));
  assert.equal(deck.find(id).phase, 'playing');
  time.advance(1000);
  assert.equal(deck.tick(), true);
  assert.equal(deck.find(id).phase, 'holding');
  time.advance(4999);
  deck.tick();
  assert.equal(deck.find(id).phase, 'holding');
  time.advance(1);
  deck.tick();
  assert.equal(deck.find(id).phase, 'dissolving');
  time.advance(500);
  deck.tick();
  assert.equal(deck.find(id), null);
  const { receipts } = deck.snapshot();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].title, 'Hormuz');
  assert.equal(receipts[0].value, 3);
  assert.equal(receipts[0].source, 'adsb.lol');
});

test('a pinned card holds until unpinned or dismissed', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, playMs: 100, holdMs: 1000, dissolveMs: 100 });
  const id = deck.add(card('A'));
  assert.equal(deck.pin(), id, 'pin without an id pins the newest card');
  time.advance(60_000);
  deck.tick();
  assert.equal(deck.find(id).phase, 'holding');
  deck.pin(id, false);
  time.advance(999);
  deck.tick();
  assert.equal(deck.find(id).phase, 'holding', 'unpinning gives a fresh hold');
  time.advance(2);
  deck.tick();
  assert.equal(deck.find(id).phase, 'dissolving');
});

test('expanding the decision trail extends the hold and rescues a dissolving card', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, playMs: 0, holdMs: 1000, expandedHoldMs: 5000, dissolveMs: 400 });
  const id = deck.add(card('A'));
  time.advance(1000);
  deck.tick();
  deck.tick();
  assert.equal(deck.find(id).phase, 'dissolving');
  deck.expand(id, true);
  assert.equal(deck.find(id).phase, 'holding');
  assert.equal(deck.find(id).expanded, true);
  time.advance(4999);
  deck.tick();
  assert.equal(deck.find(id).phase, 'holding');
});

test('dismiss sends a card (or all) to the receipt rail', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, dissolveMs: 300 });
  const a = deck.add(card('A'));
  const b = deck.add(card('B'));
  assert.deepEqual(deck.dismiss(), [b], 'dismiss without an id dismisses the newest');
  assert.deepEqual(deck.dismiss(null, { all: true }).sort(), [a, b].sort());
  time.advance(300);
  deck.tick();
  assert.equal(deck.snapshot().cards.length, 0);
  assert.deepEqual(deck.snapshot().receipts.map((r) => r.title).sort(), ['A', 'B']);
  assert.deepEqual(deck.dismiss(), [], 'nothing left to dismiss');
});

test('more cards than room dissolve the oldest unpinned one', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, maxCards: 2 });
  const a = deck.add(card('A'));
  deck.pin(a);
  const b = deck.add(card('B'));
  const c = deck.add(card('C'));
  const phases = Object.fromEntries(deck.snapshot().cards.map((x) => [x.id, x.phase]));
  assert.equal(phases[a], 'playing', 'the pinned card stays');
  assert.equal(phases[b], 'dissolving');
  assert.equal(phases[c], 'playing');
});

test('receipts are capped, newest first', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now, maxReceipts: 3, dissolveMs: 0 });
  for (const title of ['1', '2', '3', '4']) {
    deck.add(card(title));
    deck.dismiss();
    time.advance(1);
    deck.tick();
  }
  assert.deepEqual(deck.snapshot().receipts.map((r) => r.title), ['4', '3', '2']);
});

test('update changes content but never the lifecycle', () => {
  const time = clock();
  const deck = createCardDeck({ now: time.now });
  const id = deck.add(card('Brief'));
  deck.pin(id);
  const before = deck.find(id);
  assert.equal(
    deck.update(id, (entry) => Object.assign(entry, { title: 'Brief 2', phase: 'dissolving', pinned: false, id: null })),
    true,
  );
  const after = deck.find(id);
  assert.equal(after.title, 'Brief 2');
  assert.equal(after.phase, before.phase);
  assert.equal(after.pinned, true);
  assert.equal(after.id, id);
  assert.equal(deck.update('missing', () => {}), false);
});
