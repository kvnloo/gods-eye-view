#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  compareTrafficScenarioRuns,
} from '../../src/data/trafficScenarioComparison.js';

if (process.argv.length !== 4) {
  console.error(
    'Usage: node compare-sumo-receipts.mjs baseline.json candidate.json',
  );
  process.exit(2);
}
try {
  const [baseline, candidate] = process.argv.slice(2).map((path) =>
    JSON.parse(readFileSync(path, 'utf8')),
  );
  const comparison = compareTrafficScenarioRuns(baseline, candidate);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (comparison.status !== 'comparable') process.exitCode = 2;
} catch (error) {
  console.error(`Cannot compare simulation receipts: ${error.message}`);
  process.exitCode = 2;
}
