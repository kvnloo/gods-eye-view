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

// Only intentionally coarsened public-view coordinates may cross a local-room boundary.
test('incoming views reject fine locations and discard unrecognized private fields', () => {
  const now = 100000;
  const base = {
    protocol: ROOM_PROTOCOL, room: 'earth-lab', peer: 'peer-alpha',
    sentAt: now, kind: 'view',
  };
  const coarse = { lat: 40.1, lon: -100.3, height: 50000 };
  const withExtras = {
    ...base,
    view: { ...coarse, preciseLatitude: 40.100001, address: 'not-for-sharing' },
  };
  assert.deepEqual(parseRoomMessage(withExtras, 'earth-lab', now), {
    ...base, view: coarse,
  });

  const rejected = [
    { ...coarse, lat: 40.100001 },
    { ...coarse, lon: -100.300001 },
    { ...coarse, height: 50123 },
    { ...coarse, lat: NaN },
    { ...coarse, height: 30001000 },
  ];
  for (const view of rejected) {
    assert.equal(
      parseRoomMessage({ ...base, view }, 'earth-lab', now),
      null,
      'unsupported precision or bounds must fail closed',
    );
  }
});
