import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWatchStore } from './store.js';

test('native exclusive ownership rejects a second process and recovers after SIGKILL', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-store-lock-'));
  const filename = path.join(dir, 'state.json');
  const moduleUrl = new URL('./store.js', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {createWatchStore}=await import(process.argv[1]); const s=createWatchStore(process.argv[2]); await s.load(); process.stdout.write('LOCKED'); setInterval(()=>{},1000);`,
      moduleUrl,
      filename,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await exited;
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Child lock startup timeout')),
      10000,
    );
    child.stdout.once('data', (data) => {
      clearTimeout(timer);
      data.toString() === 'LOCKED'
        ? resolve()
        : reject(new Error('Unexpected child status'));
    });
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Child exited before acquiring lock'));
    });
  });
  const waiting = createWatchStore(filename);
  await assert.rejects(waiting.load());
  child.kill('SIGKILL');
  await exited;
  assert.equal(await waiting.load(), null);
  await waiting.save({ version: 1, test: 'durable' });
  assert.equal((await stat(filename)).mode & 0o077, 0);
  await waiting.close();
  const recovered = createWatchStore(filename);
  assert.deepEqual(await recovered.load(), { version: 1, test: 'durable' });
  await recovered.close();
});

test('two same-process owners cannot both acquire the state', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-store-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = createWatchStore(path.join(dir, 'state.json'));
  const second = createWatchStore(path.join(dir, 'state.json'));
  await first.load();
  await assert.rejects(second.load());
  await first.close();
  await second.load();
  await second.close();
});
