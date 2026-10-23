import { constants } from 'node:fs';
import { open, mkdir, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/** Private atomic state with one process owner. Never steal a live/foreign lock. */
export function createWatchStore(filename) {
  const lockPath = `${filename}.lock`;
  let lock;
  async function acquire() {
    if (lock) return;
    const dir = path.dirname(filename);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await stat(dir);
    if (info.mode & 0o077) throw new Error('Watch directory must be private (0700)');
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(await readFile(lockPath, 'utf8'));
      if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0)
        throw new Error('Watch state is locked');
      try { process.kill(owner.pid, 0); }
      catch (e) {
        if (e.code !== 'ESRCH') throw new Error('Watch state is locked');
        await unlink(lockPath);
        lock = await open(lockPath, 'wx', 0o600);
      }
      if (!lock) throw new Error('Watch state is in use');
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
    await lock.sync();
  }
  return {
    async load() {
      await acquire();
      try {
        const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (info.mode & 0o077 || info.size > 4 * 1024 * 1024)
            throw new Error('Watch state must be private and bounded');
          return JSON.parse(await handle.readFile('utf8'));
        } finally { await handle.close(); }
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save(state) {
      if (!lock) throw new Error('Watch store not acquired');
      const temporary = `${filename}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
        await handle.close();
        await rename(temporary, filename);
        const dir = await open(path.dirname(filename), 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw error;
      }
    },
    async close() {
      if (!lock) return;
      const held = lock;
      lock = null;
      await held.close();
      await unlink(lockPath);
    },
  };
}
