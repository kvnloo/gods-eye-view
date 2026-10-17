#!/usr/bin/env node
/** Offline A/B of two frame-pacing reports. No automatic GPU speedup claim. */
import { readFileSync } from 'node:fs';
import { compareFrameTraces } from './frame-pacing-metrics.mjs';

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-frame-pacing.mjs baseline/results.json candidate/results.json');
  process.exit(2);
}
const load = (filename) => {
  const report = JSON.parse(readFileSync(filename, 'utf8'));
  if (report.schemaVersion !== 1 || !Array.isArray(report.samples))
    throw new Error('not a frame-pacing report: ' + filename);
  return report;
};
const [before, after] = process.argv.slice(2).map(load);
const identify = (sample) => sample.style + ':' + sample.run;
const candidates = new Map(after.samples.map((sample) => [identify(sample), sample]));
let invalid = before.samples.length !== after.samples.length;
for (const sample of before.samples) {
  const candidate = candidates.get(identify(sample));
  if (!candidate) {
    console.log('[NOT COMPARABLE] ' + identify(sample) + ': missing candidate');
    invalid = true;
    continue;
  }
  const result = compareFrameTraces(
    { ...sample.trace, environment: sample.environment },
    { ...candidate.trace, environment: candidate.environment },
  );
  if (!sample.comparableEnvironment || !candidate.comparableEnvironment || !result.comparable) {
    console.log('[NOT COMPARABLE] ' + identify(sample) + ': '
      + (result.mismatches?.join(', ') || 'environment drift'));
    invalid = true;
    continue;
  }
  console.log(identify(sample) + ': scene p95 delta '
    + (result.p95SceneIntervalDeltaMs ?? 'n/a') + ' ms; input-to-scene p95 delta '
    + (result.p95InputToRenderDeltaMs ?? 'n/a') + ' ms');
}
if (!before.sourceRevision || !after.sourceRevision)
  console.log('SOURCE NOT ATTESTED: record exact served source SHA separately; do not claim code-caused gains.');
if (invalid) process.exitCode = 2;
