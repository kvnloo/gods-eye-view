#!/usr/bin/env node
/**
 * Real startup-share proof: no-layer baseline, unknown token, mixed valid/unknown
 * tokens, and a valid earthquake selection. Uses fresh browser contexts and only
 * reads application state; it never calls restoration or status methods.
 * USGS is an empty public-feed fixture; optional Google/AI requests are blocked.
 * Run against a keyless dev server:
 * QA_BASE_URL=http://127.0.0.1:4175 PUPPETEER_EXECUTABLE_PATH=/path/to/chrome \
 *   node scripts/qa-share-invalid-layer-notice.mjs
 * Saves screenshots and DOM/startup evidence in qa-shots/share-notice/.
 * Reports: daikaginza, KnottyDyes. Review: asturksever, quanticsoul4772.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { encodeLayerStateParams } from '../src/data/layerState.js';
import { redact, watchPage } from './qa-browserEvidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'qa-shots', 'share-notice');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4175';
const notice = 'Shared layer selection could not be restored';
const deadline = 60_000;
const acceptInsecureCerts = process.env.QA_ACCEPT_INSECURE_CERTS === '1';
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (process.env.QA_EXPECTED_HEAD)
  assert.equal(head, process.env.QA_EXPECTED_HEAD);
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  acceptInsecureCerts,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const evidence = {
  head,
  browser: await browser.version(),
  acceptInsecureCerts,
  fixture: 'Empty USGS FeatureCollection',
  cases: [],
};
let baseline;

try {
  for (const name of ['baseline', 'unknown', 'mixed', 'valid']) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    const monitor = watchPage(page, { name, errors });
    const entry = { name, errors, fixtureRequests: 0 };
    evidence.cases.push(entry);
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.hostname === 'earthquake.usgs.gov') {
          entry.fixtureRequests++;
          void request.respond({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: '{"type":"FeatureCollection","features":[]}',
          });
        } else if (
          url.origin === new URL(base).origin &&
          url.pathname === '/api/google/tiles-token'
        ) {
          void request.respond({
            status: 200,
            contentType: 'application/json',
            body: '{}',
          });
        } else if (
          ['maps.googleapis.com', 'tile.googleapis.com'].includes(
            url.hostname,
          ) ||
          url.pathname.startsWith('/api/openai/')
        ) {
          void request.abort('blockedbyclient');
        } else void request.continue();
      });
      await page.evaluateOnNewDocument((expected) => {
        const trace = (window.__qaShareNotice = { settled: null, notices: [] });
        window.addEventListener(
          'gev:initial-share-restore-settled',
          (event) => {
            trace.settled = { at: performance.now(), result: event.detail };
          },
        );
        const install = () => {
          const status = document.getElementById('global-loading-status');
          if (!status) return false;
          const observe = () => {
            const label = document.getElementById(
              'global-loading-label',
            )?.textContent;
            if (label !== expected) return;
            const box = status.getBoundingClientRect();
            const cover = document.getElementById('loading-screen');
            trace.notices.push({
              at: performance.now(),
              label,
              settled: Boolean(trace.settled),
              visible:
                !status.hidden &&
                box.width > 0 &&
                box.height > 0 &&
                getComputedStyle(status).visibility === 'visible' &&
                (!cover || getComputedStyle(cover).visibility === 'hidden'),
            });
          };
          new MutationObserver(observe).observe(status, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          observe();
          return true;
        };
        const observer = new MutationObserver(() => {
          if (install()) observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      }, notice);
      const url = new URL(base);
      url.searchParams.set('welcome', '0');
      url.searchParams.set('lang', 'en');
      const hash = new URLSearchParams({
        v: '2',
        lat: '30.2672',
        lon: '-97.7431',
        alt: '120000',
        heading: '0',
        pitch: '-90',
        map: 'esri-imagery',
      });
      if (name === 'valid')
        encodeLayerStateParams(hash, { enabledLayerIds: ['earthquakes'] });
      else if (name !== 'baseline')
        hash.set('l', name === 'mixed' ? 'e.unknown' : 'unknown');
      url.hash = hash.toString();
      entry.url = url.href;
      await page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: deadline,
      });
      await page.waitForFunction(
        () =>
          window.__godsEyeView?.dataManager && window.__qaShareNotice.settled,
        { timeout: deadline },
      );
      await page.waitForFunction(
        () => {
          const cover = document.getElementById('loading-screen');
          return !cover || getComputedStyle(cover).visibility === 'hidden';
        },
        { timeout: deadline },
      );
      const invalid = name === 'unknown' || name === 'mixed';
      if (invalid) {
        await page.waitForFunction(
          (expected) => {
            const box = document.getElementById('global-loading-status');
            return (
              box &&
              !box.hidden &&
              document.getElementById('global-loading-label')?.textContent ===
                expected
            );
          },
          { timeout: deadline },
          notice,
        );
        // The real split-flap animation owns a bounded 620ms transition.
        await new Promise((resolve) => setTimeout(resolve, 700));
      } else {
        // The deferred scheduler's 1s fallback has now had time to fire.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        // Reveal the existing OFF/ON control using the recipient's ordinary
        // disclosure and scrolling actions, without changing layer selection.
        await page.click('#data-panel [data-collapse-target="data-panel"]');
        await page.waitForFunction(
          () => document.getElementById('data-toggles')?.clientHeight > 100,
          { timeout: deadline },
        );
        const row = await page.$('[data-layer-id="earthquakes"]');
        assert.ok(row, 'Earthquakes row is present');
        await row.scrollIntoView();
        await page.waitForFunction(
          () => {
            const toggle = document.querySelector(
              '[data-layer-id="earthquakes"] .data-toggle-btn',
            );
            const box = toggle?.getBoundingClientRect();
            if (!box || box.width <= 0 || box.height <= 0) return false;
            const hit = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return hit === toggle || toggle.contains(hit);
          },
          { timeout: deadline },
        );
      }
      entry.state = await page.evaluate(() => {
        const app = window.__godsEyeView;
        const status = document.getElementById('global-loading-status');
        const rect = status.getBoundingClientRect();
        const toggle = document.querySelector(
          '[data-layer-id="earthquakes"] .data-toggle-btn',
        );
        const toggleBox = toggle?.getBoundingClientRect();
        const hit =
          toggleBox &&
          document.elementFromPoint(
            toggleBox.x + toggleBox.width / 2,
            toggleBox.y + toggleBox.height / 2,
          );
        return {
          enabled: app.dataManager
            .getAll()
            .filter((layer) => layer.enabled)
            .map((layer) => layer.id)
            .sort(),
          initialLayerStateInvalid:
            app.styleManager._initialShareState?.layerStateInvalid,
          noticeText: document.getElementById('global-loading-label')
            ?.textContent,
          noticeVisible:
            !status.hidden &&
            getComputedStyle(status).visibility === 'visible' &&
            rect.width > 0 &&
            rect.height > 0,
          noticeRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          noticeRole: status.getAttribute('role'),
          noticeLive: status.getAttribute('aria-live'),
          coverVisibility: getComputedStyle(
            document.getElementById('loading-screen'),
          ).visibility,
          earthquakeToggle: toggle
            ? {
                text: toggle.textContent,
                pressed: toggle.getAttribute('aria-pressed'),
                active: toggle.classList.contains('active'),
                visible:
                  toggleBox.width > 0 &&
                  toggleBox.height > 0 &&
                  (hit === toggle || toggle.contains(hit)),
              }
            : null,
          trace: window.__qaShareNotice,
        };
      });
      if (invalid) {
        const element = await page.$('#global-loading-status');
        await element.screenshot({
          path: path.join(output, `${name}-notice.png`),
        });
      }
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      assert.equal(entry.state.trace.settled.result.status, 'settled');
      assert.equal(entry.state.coverVisibility, 'hidden');
      assert.deepEqual(errors, []);
      if (name === 'baseline') baseline = entry.state.enabled;
      if (invalid) {
        assert.equal(entry.state.initialLayerStateInvalid, true);
        assert.equal(entry.state.noticeText, notice);
        assert.equal(entry.state.noticeVisible, true);
        assert.equal(entry.state.noticeRole, 'status');
        assert.equal(entry.state.noticeLive, 'polite');
        assert.deepEqual(
          entry.state.enabled,
          baseline,
          'invalid payload restores the baseline, without partial salvage',
        );
        assert.equal(
          entry.state.trace.notices.some(
            (seen) => seen.visible && !seen.settled,
          ),
          false,
        );
      } else {
        assert.equal(entry.state.initialLayerStateInvalid, false);
        assert.equal(entry.state.earthquakeToggle?.visible, true);
        assert.equal(
          entry.state.trace.notices.length,
          0,
          'valid/default links never announce invalid layer state',
        );
        if (name === 'valid') {
          assert.deepEqual(entry.state.enabled, ['earthquakes']);
          assert.equal(entry.state.earthquakeToggle?.active, true);
          assert.ok(entry.fixtureRequests > 0);
        }
      }
      entry.pass = true;
      console.log(`PASS ${name}: ${JSON.stringify(entry.state.enabled)}`);
    } catch (error) {
      entry.failure = redact(error?.stack || error);
      await page
        .screenshot({ path: path.join(output, `${name}-failure.png`) })
        .catch(() => {});
      throw error;
    } finally {
      entry.console = monitor.console;
      entry.failedRequests = monitor.failed;
      await context.close();
      await fs.writeFile(
        path.join(output, 'evidence.json'),
        redact(JSON.stringify(evidence, null, 2)),
      );
    }
  }
} finally {
  await browser.close();
}
console.log(`Share notice browser evidence: ${output}`);
