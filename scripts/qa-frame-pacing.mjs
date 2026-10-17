#!/usr/bin/env node
/**
 * Opt-in Cesium frame pacing QA. postRender is NOT a photon timestamp.
 * See docs/FRAME-PACING-QA.md.
 *
 * node scripts/qa-frame-pacing.mjs --url http://localhost:4173
 *   --styles normal,noir,snow --mode motion --runs 3 --ms 5000
 *   [--layers flights,traffic] [--headful] [--require-hardware]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { summarizeFrameTrace, isSoftwareRenderer } from './frame-pacing-metrics.mjs';
import { redact } from './qa-browserEvidence.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
};
const flag = (name) => argv.includes(name);
const styles = option('--styles', 'normal,noir,snow').split(',');
const allowed = new Set(['normal', 'retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow']);
if (styles.some((style) => !allowed.has(style))) throw new Error('unknown visual style');
const requestedLayers = option('--layers', '').split(',').map((id) => id.trim()).filter(Boolean);
const mode = option('--mode', 'motion');
if (!['motion', 'drag', 'idle'].includes(mode)) throw new Error('unknown mode');
const ms = Number(option('--ms', '5000'));
const runs = Number(option('--runs', '3'));
if (!Number.isInteger(ms) || ms < 1000 || ms > 60000 || !Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new RangeError('--ms must be 1000..60000 and --runs 1..20');
const url = new URL(option('--url', 'http://localhost:4173'));
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) URL required');
url.searchParams.set('welcome', '0');
const outDir = path.resolve(option('--out', 'qa-shots/frame-pacing'));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

const browser = await puppeteer.launch({
  headless: !flag('--headful'),
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  protocolTimeout: 180000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  ],
});

const samples = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(redact(String(e.message)).slice(0, 300)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__godsEyeView?.viewer?.scene, { timeout: 120000 });
  await page.waitForFunction(
    () => document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 120000 },
  );
  await sleep(3000); // Warm capture, not a cold-start claim.
  await page.evaluate(async (layers) => {
    const gev = window.__godsEyeView;
    gev.viewer.camera.cancelFlight?.();
    for (const [id, entry] of gev.dataManager.layers)
      if (entry.enabled) await gev.dataManager.setEnabled(id, false, { origin: 'user' });
    for (const id of layers) {
      if (!gev.dataManager.layers.has(id)) throw new Error('unknown layer: ' + id);
      await gev.dataManager.setEnabled(id, true, { origin: 'user' });
    }
  }, requestedLayers);
  await sleep(1500);

  const setPose = () => page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    const radians = Math.PI / 180;
    v.camera.cancelFlight?.();
    v.camera.setView({
      destination: v.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: -97.7431 * radians, latitude: 30.2672 * radians, height: 2500,
      }),
      orientation: { heading: 0, pitch: -70 * radians, roll: 0 },
    });
    v.scene.requestRender();
  });

  const getEnvironment = () => page.evaluate((mode) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const gl = scene.context?._gl;
    // A masked 'WebKit WebGL' string is not proof of a hardware GPU.
    let renderer = null;
    let rendererVerified = false;
    try {
      const info = gl?.getExtension?.('WEBGL_debug_renderer_info');
      const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
      if (typeof unmasked === 'string' && unmasked.trim()) {
        renderer = unmasked;
        rendererVerified = true;
      }
    } catch { /* unknown GPU identity cannot be claimed as hardware */ }
    const counts = {};
    for (const [id, entry] of gev.dataManager.layers) {
      if (!entry.enabled) continue;
      const stats = entry.module?.getStats?.();
      const count = stats?.renderedCount ?? stats?.count ?? stats?.total ?? null;
      counts[id] = Number.isFinite(count) ? count : null;
    }
    return {
      mode, style: gev.styleManager.activeStyle,
      viewport: innerWidth + 'x' + innerHeight, dpr: devicePixelRatio,
      canvas: scene.canvas.width + 'x' + scene.canvas.height, renderer, rendererVerified,
      softwareRenderer: /swiftshader|llvmpipe|softpipe|software|basic render driver|d3d11 warp/i.test(renderer ?? ''),
      sourceCounts: counts,
      profile: new URL(location.href).searchParams.get('performance') || 'standard',
      userAgent: navigator.userAgent,
      visible: document.visibilityState === 'visible', focused: document.hasFocus(),
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, mode);

  const startTrace = () => page.evaluate((mode) => {
    const scene = window.__godsEyeView.viewer.scene;
    const timestamps = [];
    const rafs = [];
    const inputSamples = [];
    const longTasks = [];
    const longFrames = [];
    const scriptCosts = new Map();
    let unclassifiedScripts = 0;
    let cameraChangedFrames = 0;
    let running = true;
    let tasks = null;
    let frames = null;
    let rafId = 0;
    const renderErrors = [];
    const removeRenderError = scene.renderError?.addEventListener?.(
      (_scene, error) => renderErrors.push(String(error?.message || error)),
    ) || (() => {});
    const observers = { longtask: false, longAnimationFrame: false };
    const start = performance.now();
    const signature = () => {
      const c = scene.camera;
      return [c.positionWC.x, c.positionWC.y, c.positionWC.z,
        c.directionWC.x, c.directionWC.y, c.directionWC.z];
    };
    let lastCamera = signature();
    const remove = scene.postRender.addEventListener(() => {
      const now = performance.now() - start;
      timestamps.push(now);
      const next = signature();
      const changed = next.some((value, index) => value !== lastCamera[index]);
      lastCamera = next;
      if (changed) {
        cameraChangedFrames++;
        for (const input of inputSamples)
          if (input.firstChangedSceneAtMs === null) input.firstChangedSceneAtMs = now;
      }
    });
    const canvas = scene.canvas;
    const onPointer = (event) => {
      if (mode === 'drag' && (event.buttons & 1) && event.target === canvas)
        inputSamples.push({ atMs: performance.now() - start, firstChangedSceneAtMs: null });
    };
    canvas.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    const ingestTasks = (records) => {
      for (const entry of records) longTasks.push(entry.duration);
    };
    const ingestLongFrames = (records) => {
      for (const entry of records) {
        longFrames.push(entry.duration);
        for (const script of entry.scripts ?? []) {
          // No full paths, hosts, search strings or unbounded per-script rows.
          let name = '(anonymous)';
          try {
            name = script.sourceURL
              ? new URL(script.sourceURL, location.href).pathname.split('/').at(-1) || name
              : name;
          } catch { /* keep anonymized source */ }
          name = name.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 64);
          if (!scriptCosts.has(name) && scriptCosts.size >= 64) {
            unclassifiedScripts++;
            continue;
          }
          const previous = scriptCosts.get(name) ?? { calls: 0, totalMs: 0, forcedLayoutMs: 0 };
          previous.calls++;
          previous.totalMs += Number(script.duration) || 0;
          previous.forcedLayoutMs += Number(script.forcedStyleAndLayoutDuration) || 0;
          scriptCosts.set(name, previous);
        }
      }
    };
    try {
      tasks = new PerformanceObserver((list) => ingestTasks(list.getEntries()));
      tasks.observe({ type: 'longtask', buffered: false });
      observers.longtask = true;
    } catch { tasks = null; }
    try {
      frames = new PerformanceObserver((list) => ingestLongFrames(list.getEntries()));
      frames.observe({ type: 'long-animation-frame', buffered: false });
      observers.longAnimationFrame = true;
    } catch { frames = null; }
    const tick = (now) => {
      if (!running) return;
      rafs.push(now - start);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    window.__gevFrameTrace = {
      stop() {
        running = false;
        cancelAnimationFrame(rafId);
        remove();
        removeRenderError();
        canvas.removeEventListener('pointermove', onPointer, true);
        // Flush records queued immediately before stop; disconnect alone
        // can discard the hitch that ended this capture.
        if (tasks) ingestTasks(tasks.takeRecords());
        if (frames) ingestLongFrames(frames.takeRecords());
        tasks?.disconnect();
        frames?.disconnect();
        return {
          mode, durationMs: performance.now() - start,
          sceneTimestampsMs: timestamps, rafTimestampsMs: rafs, inputSamples,
          longTaskDurationsMs: longTasks, longAnimationFrameDurationsMs: longFrames,
          observerSupport: observers, cameraChangedFrames, renderErrors,
          slowScripts: [...scriptCosts].map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.totalMs - a.totalMs).slice(0, 8),
          unclassifiedScripts,
        };
      },
    };
  }, mode);

  const driveMotion = () => page.evaluate((durationMs) => new Promise((resolve) => {
    const camera = window.__godsEyeView.viewer.camera;
    const started = performance.now();
    let previous = started;
    const step = (now) => {
      const delta = Math.min(50, Math.max(0, now - previous));
      previous = now;
      camera.lookRight(0.2 * delta / 1000); // Clock-based route, not FPS based.
      if (now - started < durationMs) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  }), ms);

  const driveDrag = async () => {
    const rect = await page.evaluate(() => {
      const r = window.__godsEyeView.viewer.scene.canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(rect.x, rect.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(rect.x + i * 6, rect.y + 20 * Math.sin(i * Math.PI / 40));
      await sleep(ms / 40);
    }
    await page.mouse.up();
  };

  for (const style of styles) {
    await page.evaluate((name) => window.__godsEyeView.styleManager.setStyle(name), style);
    await page.waitForFunction(
      () => window.__godsEyeView.styleManager.transitions.size === 0,
      { timeout: 10000 },
    );
    await sleep(500);
    for (let run = 1; run <= runs; run++) {
      await setPose();
      await sleep(1000);
      const before = await getEnvironment();
      if (flag('--require-hardware') && (!before.rendererVerified || isSoftwareRenderer(before.renderer)))
        throw new Error('hardware renderer required; unmasked GPU identity unavailable or software: ' + (before.renderer ?? 'unknown'));
      const errorCursor = errors.length;
      await startTrace();
      if (mode === 'motion') await driveMotion();
      else if (mode === 'drag') await driveDrag();
      else await sleep(ms);
      const trace = await page.evaluate(() => window.__gevFrameTrace.stop());
      trace.renderErrors = trace.renderErrors.map((error) => redact(error).slice(0, 350));
      const runErrors = errors.slice(errorCursor);
      const after = await getEnvironment();
      const summary = summarizeFrameTrace(trace);
      const knownPopulations = Object.values(before.sourceCounts).every(
        (count) => Number.isFinite(count) && count >= 0,
      );
      const stable = before.canvas === after.canvas && before.renderer === after.renderer
        && before.rendererVerified && after.rendererVerified
        && before.visible && after.visible && before.focused && after.focused
        && before.canvas !== '0x0' && knownPopulations
        && JSON.stringify(before.sourceCounts) === JSON.stringify(after.sourceCounts)
        && trace.renderErrors.length === 0 && runErrors.length === 0;
      samples.push({
        style, run, trace, summary, environment: before,
        comparableEnvironment: stable, errors: runErrors,
      });
      console.log('[' + (summary.valid && stable ? 'CAPTURE' : 'INVALID') + '] '
        + style + ' #' + run + ': scene p95='
        + (summary.sceneFrameIntervalMs?.p95 ?? 'n/a') + 'ms; rendered='
        + summary.sceneFrames + '; rAF=' + summary.rafTicks
        + '; drag input p95=' + (summary.inputToChangedSceneRenderMs.p95 ?? 'n/a') + 'ms');
    }
  }
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify({
    schemaVersion: 1, url: url.origin + url.pathname, mode, requestedLayers,
    sourceRevision: null, // Browser JS cannot attest the exact deployed commit.
    samples,
  }, null, 2));
  if (samples.some((s) => !s.summary.valid || !s.comparableEnvironment)) process.exitCode = 1;
  console.log('Results: ' + path.join(outDir, 'results.json'));
} finally {
  await browser.close();
}
