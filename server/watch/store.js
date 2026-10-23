import { constants } from 'node:fs';
import { open, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Private atomic JSON state with an OS-released, exclusive SQLite file lock. */
export function createWatchStore(filename) {
  const lockPath = `${filename}.lock.sqlite`;
  let lock;
  let lockIdentity;
  async function acquire() {
    if (lock) return;
    const dir = path.dirname(filename);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await stat(dir);
    if (!info.isDirectory() || info.mode & 0o077) throw new Error('Watch directory must be private (0700)');
    const file = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      lockIdentity = await file.stat();
      if (lockIdentity.mode & 0o077) throw new Error('Watch lock must be private');
    } finally { await file.close(); }
    const db = new DatabaseSync(lockPath);
    try {
      // EXCLUSIVE mode retains the real database file lock after COMMIT, until close/crash.
      // No stale PID, timeout takeover, lock-file deletion, or helper process is involved.
      db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY); COMMIT;');
      lock = db;
      await checkOwnership();
    } catch (error) { db.close(); lock = null; throw error; }
  }
  async function checkOwnership() {
    if (!lock) throw new Error('Watch store not acquired');
    const current = await stat(lockPath);
    if (current.ino !== lockIdentity.ino || current.dev !== lockIdentity.dev) throw new Error('Watch state lock replaced');
  }
  return {
    async load() {
      await acquire();
      try {
        const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (info.mode & 0o077 || info.size > 4 * 1024 * 1024) throw new Error('Watch state must be private and bounded');
          return JSON.parse(await handle.readFile('utf8'));
        } finally { await handle.close(); }
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save(state) {
      await checkOwnership();
      const temporary = `${filename}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
        await handle.close();
        await checkOwnership();
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
      held.close();
      // Never unlink a lock database: a waiter may already hold its inode.
    },
  };
}
