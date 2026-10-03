#!/usr/bin/env node

import fs from 'node:fs';

const [baselinePath, treatmentPath] = process.argv.slice(2);
if (!baselinePath || !treatmentPath) {
  console.error(
    'usage: node scripts/compare-recent-imagery-motion.mjs <baseline.json> <treatment.json>',
  );
  process.exit(2);
}

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const baseline = read(baselinePath);
const treatment = read(treatmentPath);

for (const [name, report] of [
  ['baseline', baseline],
  ['treatment', treatment],
]) {
  if (report?.kind !== 'gev.recent-imagery-motion-profile') {
    throw new Error(`${name} is not a Recent Imagery motion profile`);
  }
  if (!report.identity?.headful) {
    throw new Error(`${name} was not collected headfully`);
  }
}

const identityFields = ['platform', 'arch', 'browserVersion'];
for (const field of identityFields) {
  if (baseline.identity[field] !== treatment.identity[field]) {
    throw new Error(
      `incomparable identity: ${field} differs (${baseline.identity[field]} vs ${treatment.identity[field]})`,
    );
  }
}
if (
  JSON.stringify(baseline.identity.viewport) !==
    JSON.stringify(treatment.identity.viewport) ||
  JSON.stringify(baseline.identity.camera) !==
    JSON.stringify(treatment.identity.camera)
) {
  throw new Error('incomparable identity: viewport or camera trace differs');
}

const b = baseline.frameIntervals.motion;
const t = treatment.frameIntervals.motion;
const delta = (field) =>
  b[field] == null || t[field] == null ? null : t[field] - b[field];
const ratio = (field) =>
  b[field] > 0 && t[field] != null ? t[field] / b[field] : null;

const summary = {
  schemaVersion: 1,
  kind: 'gev.recent-imagery-motion-ab',
  baselineCommit: baseline.identity.commit,
  treatmentCommit: treatment.identity.commit,
  frameIntervals: {
    baseline: {
      p50Ms: b.p50Ms,
      p95Ms: b.p95Ms,
      p99Ms: b.p99Ms,
      maxMs: b.maxMs,
      over50ms: b.over50ms,
      over100ms: b.over100ms,
    },
    treatment: {
      p50Ms: t.p50Ms,
      p95Ms: t.p95Ms,
      p99Ms: t.p99Ms,
      maxMs: t.maxMs,
      over50ms: t.over50ms,
      over100ms: t.over100ms,
    },
    deltaMs: {
      p50: delta('p50Ms'),
      p95: delta('p95Ms'),
      p99: delta('p99Ms'),
      max: delta('maxMs'),
    },
    ratio: {
      p95: ratio('p95Ms'),
      p99: ratio('p99Ms'),
      max: ratio('maxMs'),
    },
  },
  gibs: {
    baseline: baseline.gibs.requestCounts,
    treatment: treatment.gibs.requestCounts,
  },
  refinement: {
    baseline: baseline.refinement,
    treatment: treatment.refinement,
  },
  continuity: {
    baseline: baseline.continuity,
    treatment: treatment.continuity,
  },
  interpretation: {
    semanticGatesBlocking: true,
    timingComparisonAdvisory: true,
    note:
      'One baseline/treatment pair is not a timing gate. Repeat on the same host with interleaved ABBA/BAAB order before making a performance claim.',
  },
};

console.log(JSON.stringify(summary, null, 2));

if (treatment.gibs.requestCounts.motion !== 0) {
  console.error('FAIL: treatment issued GIBS requests during camera motion');
  process.exitCode = 1;
}
if (
  treatment.continuity.ownedDuring !== treatment.continuity.ownedBefore ||
  treatment.continuity.ownedAfter !== treatment.continuity.ownedBefore
) {
  console.error('FAIL: treatment did not preserve committed imagery ownership');
  process.exitCode = 1;
}
if (
  t.p95Ms > b.p95Ms ||
  t.p99Ms > b.p99Ms ||
  t.over100ms > b.over100ms
) {
  console.warn(
    'ADVISORY: this treatment sample has a worse interaction-tail metric; repeat interleaved runs before deciding whether it is a regression.',
  );
}
