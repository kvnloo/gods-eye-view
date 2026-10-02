#!/usr/bin/env node
/**
 * Browser gate for the explicit low-end viewer profile.
 *
 * This verifies configuration wiring only. Headless/SwiftShader frame times are
 * not a hardware performance benchmark; absolute potato budgets belong to #110.
 *
 * Usage: node scripts/qa-potato-profile.mjs [--url http://localhost:4173]
 * Requires a running dev server.
 */
import puppeteer from 'puppeteer';

const argv = process.argv;
const baseUrl = argv.includes('--url')
  ? argv[argv.indexOf('--url') + 1]
  : 'http://localhost:4173';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(
    `  [${pass ? 'PASS' : 'FAIL'}] ${name}${
      detail ? ` — ${JSON.stringify(detail)}` : ''
    }`,
  );
}

function withPerformance(value) {
  const url = new URL(baseUrl);
  if (value != null) url.searchParams.set('performance', value);
  return url.toString();
}

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function readProfile(url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    return await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      return {
        profile: viewer.gevPerformanceProfile,
        targetFrameRate: viewer.targetFrameRate,
        resolutionScale: viewer.resolutionScale,
        msaaSamples: viewer.scene.msaaSamples,
        preserveDrawingBuffer:
          viewer.scene.context._gl.getContextAttributes()
            ?.preserveDrawingBuffer ?? null,
      };
    });
  } finally {
    await page.close();
  }
}

try {
  const standard = await readProfile(withPerformance(null));
  check(
    'default viewer keeps the standard profile',
    standard.profile === 'standard' &&
      standard.targetFrameRate === 60 &&
      standard.resolutionScale === 1 &&
      standard.msaaSamples === 4 &&
      standard.preserveDrawingBuffer === true,
    standard,
  );

  const potato = await readProfile(withPerformance('potato'));
  check(
    'potato query applies the low-end viewer profile',
    potato.profile === 'potato' &&
      potato.targetFrameRate === 30 &&
      potato.resolutionScale === 0.75 &&
      potato.msaaSamples === 1 &&
      potato.preserveDrawingBuffer === false,
    potato,
  );

  const unknown = await readProfile(withPerformance('unknown'));
  check(
    'unknown profile falls back to standard',
    unknown.profile === 'standard' &&
      unknown.targetFrameRate === 60 &&
      unknown.resolutionScale === 1 &&
      unknown.msaaSamples === 4 &&
      unknown.preserveDrawingBuffer === true,
    unknown,
  );
} finally {
  await browser.close();
}

const passed = results.filter(({ pass }) => pass).length;
console.log(`\nqa-potato-profile: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
