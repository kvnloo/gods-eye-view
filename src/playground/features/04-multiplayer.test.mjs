import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoom, parseRoomMessage, makeRoomInvite, ROOM_PROTOCOL } from './04-multiplayer.js';

test('local room codes cannot contain path or script characters', () => {
  assert.equal(normalizeRoom(' Team-Earth '), 'team-earth');
  assert.equal(normalizeRoom('../other'), null);
  assert.equal(normalizeRoom('<script>'), null);
  assert.equal(normalizeRoom('ab'), null);
});
test('presence packets are scoped, fresh and view coordinates bounded', () => {
  const now = 100000;
  const base = { protocol: ROOM_PROTOCOL, room: 'earth', peer: 'peer-alpha', sentAt: now, kind: 'view' };
  assert.ok(parseRoomMessage({ ...base, view: { lat: 40, lon: -100, height: 50000 } }, 'earth', now));
  assert.equal(parseRoomMessage({ ...base, room: 'other', view: { lat: 40, lon: 2, height: 10000 } }, 'earth', now), null);
  assert.equal(parseRoomMessage({ ...base, view: { lat: 91, lon: 2, height: 10000 } }, 'earth', now), null);
  assert.equal(parseRoomMessage({ ...base, sentAt: 100 }, 'earth', now), null);
});
test('invite preserves existing scene share hash', () => {
  const next = new URL(makeRoomInvite('https://example.org/view?embed=0#map=foo', 'earth-lab'));
  assert.equal(next.searchParams.get('gevRoom'), 'earth-lab');
  assert.equal(next.hash, '#map=foo');
});
