// Cast's pure part: the menu's targets, the TV view's address and its query.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_PATTERN,
  castTargets,
  newRoomCode,
  parseTvMode,
  tvViewUrl,
} from './castTargets.js';

test('the menu lists Samsung, Google Cast and AirPlay, in that order', () => {
  const targets = castTargets({ samsungConfigured: true, secure: true, castSdk: 'ready' });
  assert.deepEqual(
    targets.map(({ id, available }) => `${id}:${available}`),
    ['samsung:true', 'chromecast:true', 'airplay:true'],
  );
  assert.equal(targets[2].help, true, 'AirPlay explains mirroring; it starts nothing');
});

test('each unavailable route says why', () => {
  const plain = castTargets({ samsungConfigured: false, secure: false, castSdk: 'ready' });
  assert.equal(plain[0].available, false);
  assert.match(plain[0].detail, /No Samsung TV/);
  assert.equal(plain[1].available, false);
  assert.match(plain[1].detail, /https/, 'Chrome casts only from secure pages');
  const noChrome = castTargets({ samsungConfigured: true, secure: true, castSdk: 'none' });
  assert.match(noChrome[1].detail, /Chrome/);
  const loading = castTargets({ samsungConfigured: true, secure: true, castSdk: 'loading' });
  assert.equal(loading[1].available, false);
});

test('a room code is six letters and digits without look-alikes', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = newRoomCode();
    assert.match(code, ROOM_PATTERN);
    assert.doesNotMatch(code, /[lo01]/);
  }
});

test('the TV view carries kind, room and name in the query and the view in the hash', () => {
  const href = tvViewUrl({
    origin: 'http://192.168.1.8:8803',
    kind: 'cast',
    room: 'abc234',
    name: 'Living room',
    hash: '#v=2&lat=29.7&lon=-95.4',
  });
  const url = new URL(href);
  assert.equal(url.origin, 'http://192.168.1.8:8803');
  assert.equal(url.searchParams.get('tv'), 'cast');
  assert.equal(url.searchParams.get('room'), 'abc234');
  assert.equal(url.searchParams.get('name'), 'Living room');
  assert.equal(url.hash, '#v=2&lat=29.7&lon=-95.4');
  assert.deepEqual(parseTvMode(url.search), { kind: 'cast', room: 'abc234', name: 'Living room' });
});

test('a page without ?tv is not a TV view; a bad room is dropped', () => {
  assert.equal(parseTvMode(''), null);
  assert.equal(parseTvMode('?v=2'), null);
  assert.deepEqual(parseTvMode('?tv=samsung&room=NOPE'), { kind: 'samsung', room: null, name: 'TV' });
});
