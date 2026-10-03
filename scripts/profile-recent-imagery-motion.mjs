#!/usr/bin/env node

/**
 * Headful browser profiler for the Recent Imagery motion-safe refinement gate.
 *
 * Run the same script on baseline and treatment:
 *
 *   QA_BROWSER_PATH=/path/to/chrome \
 *   QA_MOTION_REPORT=/tmp/baseline.json \
 *   node scripts/profile-recent-imagery-motion.mjs
 *
 * The app must already be serving at QA_BASE_URL (default http://127.0.0.1:4173).
 * This script requires the live NASA CMR/GIBS path and intentionally exits
 * non-zero when those dependencies are unavailable.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const REPORT_PATH =
  process.env.QA_MOTION_REPORT || 'qa-shots/recent-imagery-motion.json';
const BROWSER_PATH = process.env.QA_BROWSER_PATH;
const AUSTIN = { lon: -97.74, lat: 30.27, height: 12_000 };
const PAN_OFFSET_DEG = 0.02;
const FLIGHT_SECONDS = 1.2;
const SETTLE_TIMEOUT_MS = 8_000;

if (!BROWSER_PATH) {
  console.error(
    'QA_BROWSER_PATH is required: this gate must run a real headful browser, not Puppeteer\'s software/headless default.',
  );
  process.exit(2);
}

async function requireNetwork() {
  const response = await fetch(
    'https://cmr.earthdata.nasa.gov/search/collections.json?page_size=1',
    { signal: AbortSignal.timeout(8_000) },
  ).catch(() => null);
  if (!response?.ok) {
    throw new Error(
      'NASA CMR is unavailable; a skipped live dependency is not performance evidence.',
    );
  }
}

function percentile(sorted, quantile) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(sorted.length * quantile));
  return sorted[rank - 1];
}

function summarizeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1) ?? null,
    over33ms: sorted.filter((value) => value > 33.3).length,
    over50ms: sorted.filter((value) => value > 50).length,
    over100ms: sorted.filter((value) => value > 100).length,
    rawMs: intervals,
  };
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

await requireNetwork();

const browser = await puppeteer.launch({
  headless: false,
  executablePath: BROWSER_PATH,
  args: [
    '--window-size=1280,860',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

let phase = 'setup';
const requests = [];
const responses = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });

  const isGibs = (url) =>
    url.includes('earthdata.nasa.gov') || url.includes('gibs.earthdata');

  page.on('request', (request) => {
    const url = request.url();
    if (isGibs(url)) {
      requests.push({
        phase,
        url,
        at: performance.now(),
      });
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    if (!isGibs(url)) return;
    const rawLength = response.headers()['content-length'];
    const contentLength = rawLength ? Number(rawLength) : null;
    responses.push({
      phase,
      url,
      status: response.status(),
      contentLength:
        Number.isFinite(contentLength) && contentLength >= 0
          ? contentLength
          : null,
      at: performance.now(),
    });
  });

  await page.goto(`${BASE_URL}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForFunction(
    () =>
      window.__gevRecentImagery &&
      window.__godsEyeView &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );

  await page.evaluate((view) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.scene.tweens?.removeAll?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (view.lon * Math.PI) / 180,
        latitude: (view.lat * Math.PI) / 180,
        height: view.height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender();
  }, AUSTIN);

  const layerToggle = '[data-layer-id="recent-imagery"] .data-toggle-btn';
  await page.waitForSelector(layerToggle, { timeout: 20_000 });
  await page.click(layerToggle);

  await page.waitForFunction(
    () => window.__godsEyeView.dataManager.isEnabled('recent-imagery'),
    { timeout: 10_000 },
  );

  await page.click(
    '#recent-imagery-panel [data-action-id="use-view"]',
  );

  await page.waitForFunction(
    () => {
      const snap = window.__gevRecentImagery.layer.getSnapshot();
      return (
        !snap.searching &&
        snap.candidates.length > 0 &&
        Boolean(snap.preview.key) &&
        window.__gevRecentImagery.layer.diagnostics().ownedCount === 1
      );
    },
    { timeout: 45_000 },
  );

  // Allow the initial preview to become the last-correct committed visual
  // before the measured camera interaction starts.
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const before = await page.evaluate(() => ({
    snapshot: window.__gevRecentImagery.layer.getSnapshot(),
    diagnostics: window.__gevRecentImagery.layer.diagnostics(),
    owned: window.__gevRecentImagery.layer.diagnostics().ownedCount,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
  }));

  await page.evaluate(() => {
    window.__riMotionIntervals = [];
    window.__riMotionRaf = null;
    window.__riMotionEndIndex = null;
    window.__riCameraMoveEnded = false;
    const viewer = window.__godsEyeView.viewer;
    const offMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
      window.__riCameraMoveEnded = true;
      window.__riMotionEndIndex = window.__riMotionIntervals.length;
      if (typeof offMoveEnd === 'function') offMoveEnd();
    });
    let previous = performance.now();
    const sample = (now) => {
      window.__riMotionIntervals.push(now - previous);
      previous = now;
      window.__riMotionRaf = requestAnimationFrame(sample);
    };
    window.__riMotionRaf = requestAnimationFrame(sample);
  });

  requests.splice(0);
  responses.splice(0);
  phase = 'motion';

  await page.evaluate(
    ({ view, offset, duration }) => {
      const viewer = window.__godsEyeView.viewer;
      const destination =
        viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: ((view.lon + offset) * Math.PI) / 180,
          latitude: (view.lat * Math.PI) / 180,
          height: view.height,
        });
      viewer.camera.flyTo({
        destination,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration,
      });
    },
    { view: AUSTIN, offset: PAN_OFFSET_DEG, duration: FLIGHT_SECONDS },
  );

  await page.waitForFunction(
    () =>
      window.__gevRecentImagery.layer.diagnostics().refinement?.motion.moving ===
      true,
    { timeout: 3_000 },
  );

  await new Promise((resolve) =>
    setTimeout(resolve, Math.floor((FLIGHT_SECONDS * 1000) / 2)),
  );

  const during = await page.evaluate(() => ({
    diagnostics: window.__gevRecentImagery.layer.diagnostics(),
    owned: window.__gevRecentImagery.layer.diagnostics().ownedCount,
    shown: window.__gevRecentImagery.layer.getSnapshot().shown,
  }));

  await page.waitForFunction(
    () => window.__riCameraMoveEnded === true,
    { timeout: SETTLE_TIMEOUT_MS },
  );
  phase = 'settle';

  await page.waitForFunction(
    () => {
      const motion =
        window.__gevRecentImagery.layer.diagnostics().refinement?.motion;
      return motion?.moving === false && motion?.settled === true;
    },
    { timeout: SETTLE_TIMEOUT_MS },
  );

  await new Promise((resolve) => setTimeout(resolve, 700));
  phase = 'done';

  const intervalSample = await page.evaluate(() => {
    if (window.__riMotionRaf !== null) {
      cancelAnimationFrame(window.__riMotionRaf);
    }
    const intervals = window.__riMotionIntervals || [];
    const motionEndIndex =
      window.__riMotionEndIndex == null
        ? intervals.length
        : window.__riMotionEndIndex;
    return {
      motion: intervals.slice(0, motionEndIndex),
      full: intervals,
    };
  });

  const after = await page.evaluate(() => ({
    diagnostics: window.__gevRecentImagery.layer.diagnostics(),
    owned: window.__gevRecentImagery.layer.diagnostics().ownedCount,
    shown: window.__gevRecentImagery.layer.getSnapshot().shown,
  }));

  const requestCounts = Object.fromEntries(
    ['motion', 'settle', 'done'].map((name) => [
      name,
      requests.filter((request) => request.phase === name).length,
    ]),
  );
  const knownBytes = Object.fromEntries(
    ['motion', 'settle', 'done'].map((name) => [
      name,
      responses
        .filter(
          (response) =>
            response.phase === name && response.contentLength !== null,
        )
        .reduce((sum, response) => sum + response.contentLength, 0),
    ]),
  );

  const report = {
    schemaVersion: 1,
    kind: 'gev.recent-imagery-motion-profile',
    identity: {
      commit: currentCommit(),
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      node: process.version,
      browserVersion: await browser.version(),
      headful: true,
      baseUrl: BASE_URL,
      camera: {
        start: AUSTIN,
        longitudeOffsetDegrees: PAN_OFFSET_DEG,
        durationSeconds: FLIGHT_SECONDS,
      },
      viewport: before.viewport,
    },
    frameIntervals: {
      motion: summarizeIntervals(intervalSample.motion.slice(1)),
      interactionAndSettle: summarizeIntervals(intervalSample.full.slice(1)),
    },
    gibs: {
      requestCounts,
      knownContentLengthBytes: knownBytes,
      totalRequests: requests.length,
      responsesWithKnownBytes: responses.filter(
        (response) => response.contentLength !== null,
      ).length,
    },
    refinement: {
      before: before.diagnostics.refinement,
      during: during.diagnostics.refinement,
      after: after.diagnostics.refinement,
      motionDeferredDelta:
        after.diagnostics.refinement.motionDeferred -
        before.diagnostics.refinement.motionDeferred,
      generationDelta:
        after.diagnostics.refinement.motion.generation -
        before.diagnostics.refinement.motion.generation,
    },
    continuity: {
      ownedBefore: before.owned,
      ownedDuring: during.owned,
      ownedAfter: after.owned,
      shownBefore: before.snapshot.shown,
      shownDuring: during.shown,
      shownAfter: after.shown,
    },
  };

  fs.mkdirSync(path.dirname(path.resolve(REPORT_PATH)), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  console.log(JSON.stringify(report, null, 2));

  if (requestCounts.motion !== 0) {
    throw new Error(
      `expected zero GIBS requests during camera motion, observed ${requestCounts.motion}`,
    );
  }
  if (during.owned !== before.owned || after.owned !== before.owned) {
    throw new Error('committed imagery ownership changed during the motion trace');
  }
  if (report.refinement.motionDeferredDelta <= 0) {
    throw new Error('the trace did not exercise deferred Recent Imagery refinement');
  }
  if (
    after.diagnostics.refinement.motion.moving ||
    !after.diagnostics.refinement.motion.settled ||
    after.diagnostics.refinement.motionRetryPending
  ) {
    throw new Error('Recent Imagery did not settle cleanly after the trace');
  }
} finally {
  await browser.close();
}
