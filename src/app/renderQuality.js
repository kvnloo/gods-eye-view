// Render-quality presets measured and proposed by @GGPOShadows in upstream #680.
// This module owns only preset resolution/application; Display UI owns user changes.

export const RENDER_QUALITY_STORAGE_KEY = 'gev:render-quality:v1';
export const RENDER_QUALITY_DEFAULT = 'balanced';

export const RENDER_QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({
    msaaSamples: 4,
    resolutionScale: 1,
    description: 'Full resolution, 4x MSAA',
  }),
  balanced: Object.freeze({
    msaaSamples: 2,
    resolutionScale: 0.85,
    description: 'Balanced fidelity and GPU cost',
  }),
  performance: Object.freeze({
    msaaSamples: 1,
    resolutionScale: 0.6,
    description: 'Reduced resolution for constrained GPUs',
  }),
});

export const RENDER_QUALITY_NAMES = Object.freeze([
  'performance',
  'balanced',
  'high',
]);

export function normalizeRenderQualityName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(RENDER_QUALITY_PRESETS, name) ? name : null;
}

export function renderQualityQueryOverride(search) {
  try {
    return normalizeRenderQualityName(
      new URLSearchParams(String(search ?? '')).get('quality'),
    );
  } catch {
    return null;
  }
}

export function resolveRenderQualityName({ search, stored } = {}) {
  return (
    renderQualityQueryOverride(search) ||
    normalizeRenderQualityName(stored) ||
    RENDER_QUALITY_DEFAULT
  );
}

export function readStoredRenderQuality(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    return normalizeRenderQualityName(
      target?.getItem?.(RENDER_QUALITY_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function writeStoredRenderQuality(name, storage) {
  const normalized = normalizeRenderQualityName(name);
  if (!normalized) return false;
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target?.setItem) return false;
    target.setItem(RENDER_QUALITY_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function renderQualityPreset(name) {
  const normalized = normalizeRenderQualityName(name);
  return RENDER_QUALITY_PRESETS[normalized || RENDER_QUALITY_DEFAULT];
}

export function applyRenderQuality(viewer, name) {
  const normalized = normalizeRenderQualityName(name) || RENDER_QUALITY_DEFAULT;
  const preset = RENDER_QUALITY_PRESETS[normalized];
  if (!viewer?.scene) return null;
  try {
    viewer.scene.msaaSamples = preset.msaaSamples;
    viewer.resolutionScale = preset.resolutionScale;
    return preset;
  } catch {
    return null;
  }
}
