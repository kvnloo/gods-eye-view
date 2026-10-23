// Linux/MBP only. Start the exact-head GEV server, then:
// QA_GEV_URL=http://127.0.0.1:PORT node scripts/qa-watch-resources.mjs
// Measures raw owned-process CPU and proportional memory, not a hardware minimum claim.
import puppeteer from 'puppeteer';
import { spawn, execFileSync } from 'node:child_process';
import { readdir, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const url = process.env.QA_GEV_URL;
if (
  process.platform !== 'linux' ||
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
)
  throw new Error('Use a worker-local GEV server on Linux');
const ticksPerSecond = Number(
  execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }),
);
async function processes(roots) {
  const table = new Map();
  for (const id of await readdir('/proc')) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const raw = await readFile(`/proc/${id}/stat`, 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      table.set(Number(id), {
        parent: Number(fields[1]),
        ticks: Number(fields[11]) + Number(fields[12]),
      });
    } catch {
      /* A child can exit during sampling. */
    }
  }
  const owned = new Set(roots);
  let changed;
  do {
    changed = false;
    for (const [id, info] of table)
      if (!owned.has(id) && owned.has(info.parent)) {
        owned.add(id);
        changed = true;
      }
  } while (changed);
  let ticks = 0,
    pssKiB = 0,
    rssKiB = 0;
  for (const id of owned) {
    ticks += table.get(id)?.ticks || 0;
    try {
      const rows = (await readFile(`/proc/${id}/smaps_rollup`, 'utf8')).split(
        '\n',
      );
      pssKiB += Number(
        rows
          .find((r) => r.startsWith('Pss:'))
          ?.trim()
          .split(/\s+/)[1] || 0,
      );
      rssKiB += Number(
        rows
          .find((r) => r.startsWith('Rss:'))
          ?.trim()
          .split(/\s+/)[1] || 0,
      );
    } catch {
      /* Exited processes are absent from the memory snapshot. */
    }
  }
  return { ticks, pssKiB, rssKiB, processCount: owned.size };
}
async function sample(roots) {
  const before = await processes(roots);
  const start = performance.now();
  await new Promise((r) => setTimeout(r, 10000));
  const after = await processes(roots);
  const elapsedMs = performance.now() - start;
  return {
    elapsedMs,
    oneCoreCpuPercent:
      (Math.max(0, after.ticks - before.ticks) /
        ticksPerSecond /
        (elapsedMs / 1000)) *
      100,
    pssBytes: after.pssKiB * 1024,
    summedRssBytes: after.rssKiB * 1024,
    processCount: after.processCount,
  };
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-resource-'));
let child, browser;
try {
  const config = {
    stateDirectory: 'state',
    notifier: {
      type: 'ntfy',
      server: 'http://127.0.0.1:1',
      topic: 'never-deliver',
    },
    rules: [
      {
        id: 'resource-control',
        source: 'usgs',
        enabled: true,
        lat: 0,
        lon: 0,
        radiusKm: 1,
        minMagnitude: 10,
        maxAgeMs: 3600000,
        cooldownMs: 60000,
      },
    ],
  };
  const filename = path.join(dir, 'config.json');
  await writeFile(filename, JSON.stringify(config), { mode: 0o600 });
  child = spawn(
    process.execPath,
    ['server/watch/cli.mjs', '--config', filename],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let state;
  for (let i = 0; i < 40; i++) {
    try {
      state = JSON.parse(
        await readFile(path.join(dir, 'state/state.json'), 'utf8'),
      );
      if (['current', 'unavailable'].includes(state.sources.usgs?.status))
        break;
    } catch {
      /* Startup owns the state file. */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(
    state?.sources.usgs.status,
    'current',
    'A failed provider cannot establish the matched live-source comparison',
  );
  const watch = await sample([child.pid]);
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Watch failed to stop')),
      25000,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  child = null;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const manager = window.__godsEyeView.dataManager;
    for (const [id, layer] of manager.layers)
      if (layer.enabled && id !== 'earthquakes')
        await manager.setEnabled(id, false);
    await manager.setEnabled('earthquakes', true);
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('earthquakes')
        ?.module.getStats()?.count > 0,
    { timeout: 30000 },
  );
  const full = await sample([
    browser.process().pid,
    ...(Number.isInteger(Number(process.env.QA_SERVER_PID)) &&
    Number(process.env.QA_SERVER_PID) > 1
      ? [Number(process.env.QA_SERVER_PID)]
      : []),
  ]);
  assert.ok(
    watch.pssBytes > 0 && full.pssBytes > 0,
    'Owned process PSS must be observable',
  );
  await page.screenshot({
    path:
      process.env.QA_RESOURCE_SCREENSHOT || '/tmp/gev-watch-full-control.png',
  });
  console.log(
    JSON.stringify({
      gate: 'watch-resources',
      status: 'PASS',
      source: 'existing USGS all-day feed, only enabled source/layer',
      watch,
      full,
      fullIncludesServer: !!process.env.QA_SERVER_PID,
      pssReductionPercent: (1 - watch.pssBytes / full.pssBytes) * 100,
      note: 'Ten-second quiet windows, one run, no hardware minimum or generalized savings claim; summed RSS double-counts shared pages; PSS is the memory comparison',
    }),
  );
} finally {
  child?.kill('SIGTERM');
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
}
