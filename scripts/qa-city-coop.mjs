#!/usr/bin/env node
// Two residents, two tabs, one local City builder room (same browser profile;
// rooms use BroadcastChannel). A third, separate profile opens the exported
// room as a read-only archive. The parent starts the app on an isolated port.
//   QA_BASE_URL=http://127.0.0.1:4371 node scripts/qa-city-coop.mjs
// QA_SHOTS_DIR defaults to qa-shots/city-coop. Screenshots are numbered
// side-by-side PNGs; the run also writes city-coop-journey.mp4 (ffmpeg hstack).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4371';
const output = path.resolve(process.env.QA_SHOTS_DIR || 'qa-shots/city-coop');
const frames = path.join(output, 'frames');
const KEY = 'godsEyeView.cityBuilder.v1';
const ROOM = 'elm-street';
const W = 960;
const H = 1000;
const SITE = { lat: 37.8007, lon: -122.4103, alt: 1600 };
const S = {
  open: '#top-center-actions [data-city-builder-open]',
  dialog: '[data-community-planning-preview]',
  editor: '[data-city-builder-editor]',
  room: '[data-city-room]',
};
const report = {
  startedAt: new Date().toISOString(),
  base,
  output,
  assertions: [],
  screenshots: [],
  console: [],
  pageErrors: [],
  digests: {},
};
let browser;
let phase = 'launch';
let shot = 0;
const pages = {};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);

async function check(name, run) {
  phase = name;
  try {
    await run();
    report.assertions.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.assertions.push({ name, status: 'fail', error: error.stack });
    throw error;
  }
}
function label(text) {
  return Buffer.from(
    `<svg width="${W}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0b2630"/><text x="12" y="23" font-family="sans-serif" font-size="17" fill="#e3faff">${text}</text></svg>`,
  );
}
const LABELS = {
  a: 'Tab A · Ana (owner)',
  b: 'Tab B · Ben (joins by room code)',
};
async function framed(bytes, key) {
  return sharp({
    create: { width: W, height: H + 34, channels: 3, background: '#000' },
  })
    .composite([
      { input: label(LABELS[key]), top: 0, left: 0 },
      {
        input: await sharp(bytes).resize(W, H, { fit: 'contain' }).toBuffer(),
        top: 34,
        left: 0,
      },
    ])
    .jpeg({ quality: 80 })
    .toBuffer();
}
/** Numbered side-by-side screenshot of both residents' tabs. */
async function pair(name, focus = {}) {
  for (const [key, selector] of Object.entries(focus)) {
    if (!selector) continue;
    await pages[key]
      .locator(selector)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const [a, b] = await Promise.all(
    ['a', 'b'].map(async (key) =>
      framed(await pages[key].screenshot({ animations: 'disabled' }), key),
    ),
  );
  const filename = `${String(++shot).padStart(2, '0')}-${name}.png`;
  await sharp({
    create: { width: W * 2, height: H + 34, channels: 3, background: '#000' },
  })
    .composite([
      { input: a, top: 0, left: 0 },
      { input: b, top: 0, left: W },
    ])
    .png()
    .toFile(path.join(output, filename));
  report.screenshots.push(filename);
}
async function single(page, name) {
  const filename = `${String(++shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(output, filename) });
  report.screenshots.push(filename);
}

/**
 * CDP screencast frames per tab, sampled on one clock. Sampling only writes
 * the latest JPEG bytes; labels, scaling and hstack happen once in ffmpeg.
 */
async function recorder() {
  await rm(frames, { recursive: true, force: true });
  await mkdir(path.join(frames, 'a'), { recursive: true });
  await mkdir(path.join(frames, 'b'), { recursive: true });
  for (const key of ['a', 'b'])
    await sharp(label(LABELS[key]))
      .png()
      .toFile(path.join(frames, `${key}.png`));
  const latest = {};
  const sessions = [];
  for (const key of ['a', 'b']) {
    const cdp = await pages[key].context().newCDPSession(pages[key]);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      latest[key] = Buffer.from(data, 'base64');
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: W,
      maxHeight: H,
    });
    sessions.push(cdp);
  }
  let index = 0;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (!latest.a || !latest.b) return;
    // Keep the clock honest under load: one sample per elapsed 250 ms slot.
    const due = Math.floor((Date.now() - startedAt) / 250);
    const a = latest.a;
    const b = latest.b;
    while (index < due) {
      const n = String(++index).padStart(6, '0');
      writeFile(path.join(frames, 'a', `${n}.jpg`), a).catch(() => {});
      writeFile(path.join(frames, 'b', `${n}.jpg`), b).catch(() => {});
    }
  }, 250);
  return async function stop() {
    clearInterval(timer);
    for (const cdp of sessions)
      await cdp.send('Page.stopScreencast').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    const video = path.join(output, 'city-coop-journey.mp4');
    const tile = (input, labelInput, name) =>
      `[${input}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:0:black[${name}v];[${labelInput}:v][${name}v]vstack=inputs=2:shortest=1[${name}]`;
    const result = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        '4',
        '-i',
        path.join(frames, 'a', '%06d.jpg'),
        '-framerate',
        '4',
        '-i',
        path.join(frames, 'b', '%06d.jpg'),
        '-loop',
        '1',
        '-framerate',
        '4',
        '-i',
        path.join(frames, 'a.png'),
        '-loop',
        '1',
        '-framerate',
        '4',
        '-i',
        path.join(frames, 'b.png'),
        '-filter_complex',
        `${tile(0, 2, 'a')};${tile(1, 3, 'b')};[a][b]hstack=inputs=2,format=yuv420p`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '27',
        video,
      ],
      { encoding: 'utf8' },
    );
    report.video = {
      file: path.basename(video),
      frames: index,
      seconds: index / 4,
      ffmpegStatus: result.status,
      ffmpegError: result.stderr?.slice(0, 2000) || null,
    };
    assert.equal(result.status, 0, `ffmpeg hstack failed: ${result.stderr}`);
    await rm(frames, { recursive: true, force: true });
  };
}

function watch(page, key) {
  page.on('console', (message) =>
    report.console.push({
      key,
      phase,
      type: message.type(),
      text: message.text(),
      location: message.location(),
    }),
  );
  page.on('pageerror', (error) =>
    report.pageErrors.push({ key, phase, message: error.message }),
  );
}
async function startup(page, atSite) {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  if (atSite)
    url.hash = new URLSearchParams({
      v: '2',
      lat: String(SITE.lat),
      lon: String(SITE.lon),
      alt: String(SITE.alt),
      heading: '0',
      pitch: '-90',
      roll: '0',
      style: 'normal',
    }).toString();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    null,
    { timeout: 180000 },
  );
}
async function settled(page) {
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute('aria-busy') === 'false',
    S.editor,
    { timeout: 60000 },
  );
}
const digest = (page) =>
  page.evaluate(
    (selector) => document.querySelector(selector)?.dataset.cityRoomDigest,
    S.room,
  );
async function converged() {
  const deadline = Date.now() + 15000;
  for (;;) {
    const [a, b] = await Promise.all([digest(pages.a), digest(pages.b)]);
    if (a && a === b) return a;
    if (Date.now() > deadline)
      throw new Error(`Room replicas did not converge: ${a} vs ${b}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const text = (page, selector) => page.locator(selector).first().innerText();
async function fillRoomEditor(page, values) {
  if (values.title !== undefined)
    await page.locator('#city-room-title').fill(values.title);
  if (values.description !== undefined)
    await page.locator('#city-room-description').fill(values.description);
  if (values.kind)
    await page.locator('#city-room-kind').selectOption(values.kind);
  if (values.trees !== undefined)
    await page.locator('#city-room-trees').fill(String(values.trees));
  await page.locator('[data-city-room-save]').click();
}
const card = (page, title) =>
  page
    .locator('[data-city-room-alternative]')
    .filter({ hasText: title })
    .first();
const headOf = (page, title) =>
  page.locator('[data-city-room-version]').filter({ hasText: title }).first();

await mkdir(output, { recursive: true });
let stopRecording = null;
try {
  const env = { ...process.env };
  for (const key of [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'WAYLAND_SOCKET',
    'XAUTHORITY',
  ])
    delete env[key];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    headless: true,
    env,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ozone-platform=headless',
    ],
  });
  const options = {
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    acceptDownloads: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  };
  // Two residents' tabs share one profile: BroadcastChannel reaches only that.
  const shared = await browser.newContext(options);
  await shared.route('**/api/city-concept*', (route) => route.abort());
  pages.a = await shared.newPage();
  watch(pages.a, 'a');
  pages.a.setDefaultTimeout(30000);

  await check('Ana’s tab starts the real app at a public site', async () => {
    await startup(pages.a, true);
  });

  let localBefore;
  await check(
    'Ana captures a reference and authors a park locally',
    async () => {
      const a = pages.a;
      // Same readiness gate as qa-city-builder.mjs: settled camera, loaded tiles.
      await a.waitForFunction(
        ({ lat, lon }) => {
          const app = window.__godsEyeView;
          const p = app?.viewer?.camera?.positionCartographic;
          if (!p || app.viewer.camera._currentFlight) return false;
          if (
            Math.abs((p.latitude * 180) / Math.PI - lat) > 0.025 ||
            Math.abs((p.longitude * 180) / Math.PI - lon) > 0.025
          )
            return false;
          const primitives = app.viewer.scene.primitives;
          const tileset = Array.from({ length: primitives.length }, (_, i) =>
            primitives.get(i),
          ).some((item) => item.show && item.tilesLoaded === true);
          const surface = app.viewer.scene.globe?.show
            ? app.viewer.scene.globe.tilesLoaded
            : tileset;
          return (
            surface && app.mapStackController?.getState?.().status === 'ready'
          );
        },
        SITE,
        { timeout: 240000 },
      );
      await a.bringToFront();
      report.visibility = await a.evaluate(() => document.visibilityState);
      await a.locator(S.open).click();
      await a.locator(S.dialog).waitFor({ state: 'visible' });
      await a.locator('#city-builder-project-title').fill('Elm street commons');
      // Capture waits at most 400 ms for a fresh frame; a CPU-starved
      // software renderer can miss it, so retry the visible button.
      for (let attempt = 1; ; attempt++) {
        await a.locator('[data-city-builder-start]').click();
        await settled(a);
        if (await a.locator('[data-city-builder-reference] img').count()) break;
        report.captureRetries = attempt;
        assert.ok(attempt < 4, 'reference capture failed four times');
        await a.waitForTimeout(5000);
      }
      await a
        .locator('[data-city-builder-reference] img')
        .waitFor({ state: 'visible' });
      await a.locator('#city-builder-title').fill('Pocket park');
      await a
        .locator('#city-builder-description')
        .fill('Replace surplus paving with shade trees and seating.');
      await a.locator('#city-builder-kind').selectOption('park');
      await a.locator('#city-builder-trees').fill('24');
      await a.locator('[data-city-builder-save]').click();
      await settled(a);
      localBefore = await a.evaluate((key) => localStorage.getItem(key), KEY);
      assert.ok(
        localBefore && JSON.parse(localBefore).alternatives.length === 1,
      );
      await a.locator('[data-city-room]').scrollIntoViewIfNeeded();
      await single(a, 'ana-local-project-before-room');
    },
  );

  await check('Ben opens the app in a second tab of the same browser', async () => {
    // A second resident arrives after Ana's capture, as in real use.
    pages.b = await shared.newPage();
    watch(pages.b, 'b');
    pages.b.setDefaultTimeout(30000);
    await startup(pages.b, false);
    await pages.b.locator(S.open).click();
    await pages.b.locator(S.dialog).waitFor({ state: 'visible' });
    stopRecording = await recorder();
  });

  await check(
    'Ana shares the project in a room; Ben joins by code as a viewer',
    async () => {
      const { a, b } = pages;
      await a.locator('#city-room-name').fill('Ana');
      await a.locator('#city-room-code').fill(ROOM);
      await a.locator('[data-city-room-share]').click();
      await a
        .locator('[data-city-room-summary]')
        .filter({ hasText: 'Connected' })
        .waitFor();
      assert.match(
        await text(a, '[data-city-room-self]'),
        /You are Ana · Owner/,
      );
      await b.locator('#city-room-name').fill('Ben');
      await b.locator('#city-room-code').fill(ROOM);
      await b.locator('[data-city-room-join]').click();
      await b
        .locator('[data-city-room-reference] img')
        .waitFor({ state: 'visible' });
      await converged();
      assert.equal(
        await b.locator('[data-city-room-reference] img').getAttribute('src'),
        JSON.parse(localBefore).reference.image,
        'Ben sees the exact captured reference',
      );
      assert.match(
        await text(b, '[data-city-room-alternative]'),
        /Proposed by Ana · /,
      );
      assert.match(
        await text(b, '[data-city-room-readonly]'),
        /You are a viewer/,
      );
      assert.equal(
        await b.locator('[data-city-room-edit]').first().isDisabled(),
        true,
      );
      assert.equal(await b.locator('[data-city-room-editor]').count(), 0);
      const benRow = a
        .locator('[data-city-room-member]')
        .filter({ hasText: 'Ben' });
      await benRow.filter({ hasText: 'online' }).waitFor();
      assert.match(await benRow.innerText(), /Viewer/);
      await pair('joined-ben-is-viewer', {
        a: '[data-city-room-members]',
        b: '[data-city-room-readonly]',
      });
    },
  );

  await check(
    'Owner grants contributor; Ben proposes and comments with credit',
    async () => {
      const { a, b } = pages;
      await a
        .locator('[data-city-room-member]')
        .filter({ hasText: 'Ben' })
        .locator('[data-city-room-set-role="contributor"]')
        .click();
      await b.locator('[data-city-room-editor]').waitFor();
      assert.match(await text(b, '[data-city-room-self]'), /Ben · Contributor/);
      await fillRoomEditor(b, {
        title: 'Protected bike lane',
        description:
          'Raised separators, accessible crossings and street trees.',
        kind: 'bike-lane',
        trees: 10,
      });
      await card(a, 'Protected bike lane').waitFor();
      assert.match(
        await card(a, 'Protected bike lane').innerText(),
        /Proposed by Ben · /,
      );
      const park = headOf(b, 'Pocket park');
      await park
        .locator('[data-city-room-comment-input]')
        .fill('Add a drinking fountain near the seating.');
      await park.locator('[data-city-room-comment-send]').click();
      await headOf(a, 'Pocket park')
        .locator('[data-city-room-comments]')
        .waitFor();
      assert.match(
        await headOf(a, 'Pocket park')
          .locator('[data-city-room-comments]')
          .innerText(),
        /Ben · \w{4}\s+Add a drinking fountain/,
      );
      await park.locator('[data-city-room-inspect]').click();
      await a
        .locator('[data-city-room-member]')
        .filter({ hasText: 'viewing Pocket park' })
        .waitFor();
      await converged();
      await pair('peer-proposal-and-comment', {
        a: '[data-city-room-comments]',
        b: '[data-city-room-editor]',
      });
    },
  );

  await check(
    'Ben branches from Ana’s park; Ana sees the source credited',
    async () => {
      const { a, b } = pages;
      await headOf(b, 'Pocket park').locator('[data-city-room-branch]').click();
      assert.equal(
        await b.locator('#city-room-title').inputValue(),
        'Pocket park',
      );
      await fillRoomEditor(b, { title: 'Park and plaza', kind: 'plaza' });
      await card(a, 'Park and plaza').waitFor();
      assert.match(
        await card(a, 'Park and plaza')
          .locator('[data-city-room-branched]')
          .innerText(),
        /Branched from Ana · \w{4}’s “Pocket park” revision 1/,
      );
      await converged();
      await pair('branch-from-peer', {
        a: '[data-city-room-branched]',
        b: '[data-city-room-branched]',
      });
    },
  );

  await check(
    'Concurrent edits become a visible conflict, then an explicit Keep',
    async () => {
      const { a, b } = pages;
      await b.locator('[data-city-room-leave]').click();
      await b.locator('[data-city-room-reconnect]').waitFor();
      await headOf(a, 'Pocket park').locator('[data-city-room-edit]').click();
      await fillRoomEditor(a, { title: 'Park with fountain' });
      await headOf(b, 'Pocket park').locator('[data-city-room-edit]').click();
      await fillRoomEditor(b, { title: 'Park with play area', trees: 30 });
      await b.locator('[data-city-room-reconnect]').click();
      await b.locator('[data-city-room-leave]').waitFor();
      await converged();
      for (const page of [a, b]) {
        const conflicted = page.locator('[data-city-room-conflict="true"]');
        await conflicted.waitFor();
        const body = await conflicted.innerText();
        assert.match(body, /Nothing was merged/);
        assert.match(body, /Park with fountain/);
        assert.match(body, /Park with play area/);
        assert.equal(
          await conflicted.locator('[data-city-room-keep]').count(),
          2,
        );
      }
      await pair('conflict-visible-not-merged', {
        a: '[data-city-room-conflict="true"]',
        b: '[data-city-room-conflict="true"]',
      });
      await headOf(a, 'Park with play area')
        .locator('[data-city-room-keep]')
        .click();
      await b
        .locator('[data-city-room-credit]')
        .filter({ hasText: /Written by Ben · \w{4}, kept by Ana/ })
        .waitFor();
      assert.equal(
        await a.locator('[data-city-room-conflict="true"]').count(),
        0,
      );
      await converged();
      await pair('conflict-resolved-explicitly', {
        a: '[data-city-room-credit]',
        b: '[data-city-room-credit]',
      });
    },
  );

  await check(
    'Ben is revoked while offline; his later write is rejected everywhere',
    async () => {
      const { a, b } = pages;
      await b.locator('[data-city-room-leave]').click();
      await b.locator('[data-city-room-reconnect]').waitFor();
      const benRow = a
        .locator('[data-city-room-member]')
        .filter({ hasText: 'Ben' });
      await benRow.filter({ hasText: 'offline' }).waitFor();
      await benRow.locator('[data-city-room-set-role="revoked"]').click();
      await benRow.filter({ hasText: 'Access revoked' }).waitFor();
      await b.locator('[data-city-room-new]').click();
      await fillRoomEditor(b, {
        title: 'Late proposal',
        description: 'Written offline after access was revoked.',
      });
      await b.locator('[data-city-room-reconnect]').click();
      await converged();
      for (const page of [a, b]) {
        await page
          .locator('[data-city-room-rejected]')
          .filter({
            hasText:
              /Ben · \w{4}’s “Late proposal” — contributor access was revoked/,
          })
          .waitFor();
        assert.equal(await card(page, 'Late proposal').count(), 0);
      }
      assert.match(
        await text(b, '[data-city-room-readonly]'),
        /access was revoked/,
      );
      assert.equal(await b.locator('[data-city-room-editor]').count(), 0);
      await pair('revoked-write-rejected', {
        a: '[data-city-room-rejected-list]',
        b: '[data-city-room-rejected-list]',
      });
    },
  );

  await check(
    'Reload and reconnect replay the identical room; observed facts untouched',
    async () => {
      const { a, b } = pages;
      const before = await converged();
      report.digests.beforeReload = before;
      const referenceBefore = hash(
        await b.locator('[data-city-room-reference] img').getAttribute('src'),
      );
      await b.reload({ waitUntil: 'domcontentloaded' });
      await b.waitForFunction(
        () =>
          document
            .querySelector('#loading-screen')
            ?.classList.contains('hidden'),
        null,
        { timeout: 180000 },
      );
      await b.locator(S.open).click();
      await b.locator('[data-city-room-reconnect]').waitFor();
      assert.equal(
        await digest(b),
        before,
        'replayed replica before reconnect',
      );
      await b.locator('[data-city-room-reconnect]').click();
      await b
        .locator('[data-city-room-summary]')
        .filter({ hasText: 'Connected' })
        .waitFor();
      assert.equal(await converged(), before);
      report.digests.afterReconnect = before;
      assert.equal(
        hash(
          await b.locator('[data-city-room-reference] img').getAttribute('src'),
        ),
        referenceBefore,
      );
      assert.equal(
        await a.evaluate((key) => localStorage.getItem(key), KEY),
        localBefore,
        'room activity never rewrote the local project or its reference',
      );
      await pair('reconnected-identical', {
        a: '[data-city-room-summary]',
        b: '[data-city-room-summary]',
      });
    },
  );

  await check(
    'Export, then a separate profile opens the room archive with credits',
    async () => {
      const download = pages.a.waitForEvent('download');
      await pages.a.locator('[data-city-room-export]').click();
      const file = await download;
      const exported = path.join(output, 'city-room-export.json');
      await file.saveAs(exported);
      const doc = JSON.parse(await readFile(exported, 'utf8'));
      assert.equal(doc.kind, 'city-room');
      assert.equal(doc.room, ROOM);
      const other = await browser.newContext(options);
      const c = await other.newPage();
      watch(c, 'c');
      await startup(c, false);
      await c.locator(S.open).click();
      await c.locator('#city-room-import').setInputFiles(exported);
      await c
        .locator('[data-city-room-summary]')
        .filter({ hasText: 'Read-only archive' })
        .waitFor();
      assert.equal(await digest(c), report.digests.afterReconnect);
      const body = await text(c, S.room);
      assert.match(body, /Proposed by Ben · /);
      assert.match(
        body,
        /Branched from Ana · \w{4}’s “Pocket park” revision 1/,
      );
      assert.match(body, /Written by Ben · \w{4}, kept by Ana/);
      assert.match(
        body,
        /Ben · \w{4}’s “Late proposal” — contributor access was revoked/,
      );
      assert.equal(await c.locator('[data-city-room-editor]').count(), 0);
      await c
        .locator('[data-city-room-alternative]')
        .first()
        .scrollIntoViewIfNeeded();
      await single(c, 'imported-archive-separate-profile');
      await other.close();
    },
  );

  await check('No page errors, console errors or Vue warnings', async () => {
    assert.deepEqual(report.pageErrors, []);
    const errors = report.console.filter(
      (entry) =>
        /\[Vue warn\]|Unhandled error during execution/i.test(entry.text) ||
        (entry.type === 'error' &&
          !/Failed to load resource|net::ERR_|Failed to fetch|NetworkError/i.test(
            entry.text,
          ) &&
          !/^\[Data:(?:Flights|Satellites|Ships|CCTV)\].*(?:fetch|network|HTTP|status|unavailable|timeout|401|403|429|503)/i.test(
            entry.text,
          )),
    );
    assert.deepEqual(errors, []);
  });
  await stopRecording();
  stopRecording = null;
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${error.stack || error}`);
  for (const [key, page] of Object.entries(pages)) {
    try {
      await page.screenshot({ path: path.join(output, `failure-${key}.png`) });
    } catch {
      // The failure itself is already recorded.
    }
  }
} finally {
  if (stopRecording) await stopRecording().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  await json('console.json', report.console);
  await json('summary.json', report);
  console.log(
    `${String(report.status).toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} checks; ${path.join(output, 'summary.json')}`,
  );
}
