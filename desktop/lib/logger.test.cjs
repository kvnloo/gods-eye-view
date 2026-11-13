'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { createLogger } = require('./logger.cjs');

test('the desktop log rotates after crossing 2 MiB during a session', (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'gev-desktop-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const logger = createLogger(directory, 'desktop');
  logger.info('x'.repeat(2 * 1024 * 1024));
  logger.error('after rotation');

  const rotated = path.join(directory, 'desktop.old.log');
  assert.equal(fs.existsSync(rotated), true);
  assert.match(fs.readFileSync(rotated, 'utf8'), /INFO x/);
  const current = fs.readFileSync(logger.file, 'utf8');
  assert.match(current, /ERROR after rotation/);
  assert.doesNotMatch(current, /INFO x/);
});
