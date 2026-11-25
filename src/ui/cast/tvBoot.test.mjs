// A TV view says it loaded before the globe starts; other pages say nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportTvBoot } from './tvBoot.js';

const windowAt = (search) => ({
  location: { search },
  navigator: { userAgent: 'CrKey/1.56' },
  innerWidth: 1024,
  innerHeight: 600,
  addEventListener() {},
});

test('a TV view reports its boot stage to its room', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, JSON.parse(options.body)]);
    return { ok: true };
  };
  assert.equal(
    reportTvBoot('html', {}, { windowRef: windowAt('?tv=cast&room=hub234&name=Kitchen'), fetchImpl }),
    true,
  );
  assert.equal(calls.length, 1);
  const [url, body] = calls[0];
  assert.equal(url, '/api/cast/tv');
  assert.equal(body.room, 'hub234');
  assert.equal(body.kind, 'cast');
  assert.equal(body.status.boot, 'html');
  assert.equal(body.status.name, 'Kitchen');
  assert.equal(body.status.w, 1024);
});

test('a page that is not a TV view, or has no room, reports nothing', () => {
  const fetchImpl = async () => assert.fail('no report');
  assert.equal(reportTvBoot('html', {}, { windowRef: windowAt(''), fetchImpl }), false);
  assert.equal(reportTvBoot('html', {}, { windowRef: windowAt('?tv=1'), fetchImpl }), false);
});
