const PERFORMANCE_PROFILES = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    targetFrameRate: 60,
    msaaSamples: 4,
    resolutionScale: 1,
    preserveDrawingBuffer: true,
    scene3DOnly: false,
  }),
  potato: Object.freeze({
    id: 'potato',
    targetFrameRate: 30,
    msaaSamples: 1,
    resolutionScale: 0.75,
    preserveDrawingBuffer: false,
    scene3DOnly: true,
  }),
});

/** Resolve an explicit viewer performance profile without guessing device capability. */
export function resolvePerformanceProfile(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return PERFORMANCE_PROFILES[key] || PERFORMANCE_PROFILES.standard;
}

/** Resolve the standalone `?performance=` opt-in. Unknown values stay standard. */
export function performanceProfileFromSearch(search = '') {
  const params = new URLSearchParams(String(search || ''));
  return resolvePerformanceProfile(params.get('performance')).id;
}

export { PERFORMANCE_PROFILES };
