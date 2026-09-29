import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERFORMANCE_PROFILES,
  performanceProfileFromSearch,
  resolvePerformanceProfile,
} from './performanceProfile.js';

test('standard performance profile preserves the shipped viewer defaults', () => {
  assert.deepEqual(resolvePerformanceProfile(), {
    id: 'standard',
    targetFrameRate: 60,
    msaaSamples: 4,
    resolutionScale: 1,
    preserveDrawingBuffer: true,
  });
  assert.equal(
    resolvePerformanceProfile('unknown'),
    PERFORMANCE_PROFILES.standard,
  );
});

test('potato performance profile lowers render cost explicitly', () => {
  assert.deepEqual(resolvePerformanceProfile('potato'), {
    id: 'potato',
    targetFrameRate: 30,
    msaaSamples: 1,
    resolutionScale: 0.75,
    preserveDrawingBuffer: false,
  });
  assert.equal(
    resolvePerformanceProfile(' POTATO '),
    PERFORMANCE_PROFILES.potato,
  );
});

test('standalone query parsing opts in only to known profiles', () => {
  assert.equal(performanceProfileFromSearch('?performance=potato'), 'potato');
  assert.equal(
    performanceProfileFromSearch('?performance=unknown&other=1'),
    'standard',
  );
  assert.equal(performanceProfileFromSearch(''), 'standard');
});
