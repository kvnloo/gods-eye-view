// Experimental, CPU-only reference path. This does NOT patch Cesium's renderer.
// SteadySplats: Windisch et al., arXiv:2610.05576 (2026).
// Approximated K-history visibility weights; no learned color regularizer.

export const BACKGROUND = Object.freeze([0.035, 0.055, 0.09]);
const NEIGHBORS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
const MAX_WEIGHT = 8;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hash01(x, y, gaussianId, frame, seed) {
  let h = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^
    Math.imul(y + 1, 0x85ebca77) ^ Math.imul(gaussianId + 1, 0xc2b2ae3d) ^
    Math.imul(frame + 1, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Elliptical 2D projection of a 3D Gaussian, in synthetic screen/world pixels. */
export function gaussianAlpha(gaussian, x, y) {
  const dx = (x - gaussian.x) / gaussian.sx;
  const dy = (y - gaussian.y) / gaussian.sy;
  const radiusSq = dx * dx + dy * dy;
  return radiusSq > 18 ? 0 : gaussian.opacity * Math.exp(-0.5 * radiusSq);
}

/** A small overlap-heavy scene; no external assets or network required. */
export function createDemoGaussians(width = 128, height = 96) {
  const specs = [
    [0.22, 0.44, 0.20, 0.30, 0.72, 3, [0.10, 0.67, 0.82]],
    [0.38, 0.42, 0.16, 0.27, 0.78, 1, [1.00, 0.38, 0.21]],
    [0.49, 0.50, 0.23, 0.28, 0.64, 4, [0.32, 0.81, 0.49]],
    [0.67, 0.43, 0.18, 0.33, 0.80, 2, [0.94, 0.75, 0.23]],
    [0.79, 0.56, 0.14, 0.24, 0.82, 5, [0.54, 0.40, 0.93]],
    [0.51, 0.25, 0.12, 0.13, 0.85, 0, [0.90, 0.26, 0.54]],
    [0.29, 0.72, 0.19, 0.10, 0.74, 6, [0.11, 0.39, 0.78]],
    [0.68, 0.77, 0.21, 0.12, 0.76, 7, [0.30, 0.82, 0.88]],
  ];
  return specs.map(([x, y, sx, sy, opacity, depth, color]) => ({
    x: x * width,
    y: y * height,
    sx: sx * width,
    sy: sy * height,
    opacity,
    depth,
    color,
  }));
}

/** Sorted alpha blending supplies an exact reference for the synthetic scene. */
function generateSamples(gaussians, width, height, cameraX, cameraY, frame, seed) {
  const pixels = width * height;
  const n = gaussians.length;
  const ids = new Int16Array(pixels).fill(-1);
  const reference = new Float32Array(pixels * 3);
  const dominant = new Int16Array(pixels).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const wx = x + 0.5 + cameraX;
      const wy = y + 0.5 + cameraY;
      let transmittance = 1;
      let winningProbability = 0;
      for (let i = 0; i < n; i++) {
        const gaussian = gaussians[i];
        const alpha = gaussianAlpha(gaussian, wx, wy);
        const probability = transmittance * alpha;
        if (probability > winningProbability) {
          winningProbability = probability;
          dominant[pixel] = i;
        }
        for (let c = 0; c < 3; c++) {
          reference[pixel * 3 + c] += probability * gaussian.color[c];
        }
        transmittance *= 1 - alpha;
        // Independent Bernoulli alpha masks + nearest accepted depth reproduce
        // stochastic OIT. The CPU loop is depth-ordered only for early exit.
        if (ids[pixel] < 0 && hash01(x, y, i, frame, seed) < alpha) {
          ids[pixel] = i;
        }
      }
      if (transmittance > winningProbability) dominant[pixel] = -1;
      for (let c = 0; c < 3; c++) {
        reference[pixel * 3 + c] += transmittance * BACKGROUND[c];
      }
    }
  }
  return { ids, reference, dominant, cameraX, cameraY };
}

function sampleColors(ids, gaussians) {
  const colors = new Float32Array(ids.length * 3);
  for (let p = 0; p < ids.length; p++) {
    const color = ids[p] < 0 ? BACKGROUND : gaussians[ids[p]].color;
    for (let c = 0; c < 3; c++) colors[p * 3 + c] = color[c];
  }
  return colors;
}

/** Deduplicate up to K observed Gaussians at a reprojected pixel. */
function buildCandidateBuffers(samples, width, height, cameraX, cameraY, k) {
  const candidates = Array.from({ length: width * height }, () => []);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const found = candidates[y * width + x];
      for (const sample of samples) {
        const sx = Math.round(x + cameraX - sample.cameraX);
        const sy = Math.round(y + cameraY - sample.cameraY);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const id = sample.ids[sy * width + sx];
        if (id >= 0 && !found.includes(id)) found.push(id);
        if (found.length >= k) break;
      }
    }
  }
  return candidates;
}

/** Approximate visibility using only the K historically observed occluders. */
function estimatedProbabilities(gaussians, candidates, width, height, cameraX, cameraY) {
  const n = gaussians.length;
  const probabilities = new Float32Array(width * height * (n + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const observed = candidates[pixel];
      const alphas = gaussians.map((g) => gaussianAlpha(g, x + 0.5 + cameraX, y + 0.5 + cameraY));
      let background = 1;
      for (const id of observed) background *= 1 - alphas[id];
      probabilities[pixel * (n + 1) + n] = background;
      for (let id = 0; id < n; id++) {
        let probability = alphas[id];
        for (const nearer of observed) {
          if (nearer < id) probability *= 1 - alphas[nearer];
        }
        probabilities[pixel * (n + 1) + id] = probability;
      }
    }
  }
  return probabilities;
}

/** Spatial importance reuse with a five-pixel cross and K-frame history. */
function resample(current, previous, gaussians, width, height, k) {
  const n = gaussians.length;
  const all = [current, ...previous.slice(0, k - 1)];
  const candidates = buildCandidateBuffers(all, width, height, current.cameraX, current.cameraY, k);
  const probabilities = estimatedProbabilities(
    gaussians, candidates, width, height, current.cameraX, current.cameraY,
  );
  const output = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = y * width + x;
      let totalWeight = 0;
      const color = [0, 0, 0];
      for (const source of all) {
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const sx = Math.round(nx + current.cameraX - source.cameraX);
          const sy = Math.round(ny + current.cameraY - source.cameraY);
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          const id = source.ids[sy * width + sx];
          const offset = id < 0 ? n : id;
          const numerator = probabilities[target * (n + 1) + offset];
          const denominator = probabilities[(ny * width + nx) * (n + 1) + offset];
          if (numerator <= 0 || denominator <= 0) continue;
          const weight = clamp(numerator / denominator, 0, MAX_WEIGHT);
          const rgb = id < 0 ? BACKGROUND : gaussians[id].color;
          for (let c = 0; c < 3; c++) color[c] += weight * rgb[c];
          totalWeight += weight;
        }
      }
      const fallback = current.ids[target] < 0
        ? BACKGROUND : gaussians[current.ids[target]].color;
      for (let c = 0; c < 3; c++) {
        output[target * 3 + c] = totalWeight > 0
          ? color[c] / totalWeight : fallback[c];
      }
    }
  }
  return output;
}

/** Reproject prior color; soft-reject disocclusions instead of clipping colors. */
function temporalReuse(spatial, current, previous, width, height, strength) {
  if (!previous || strength <= 0) return spatial;
  const output = new Float32Array(spatial);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const prevX = Math.round(x + current.cameraX - previous.cameraX);
      const prevY = Math.round(y + current.cameraY - previous.cameraY);
      if (prevX < 0 || prevX >= width || prevY < 0 || prevY >= height) continue;
      const p = y * width + x;
      const old = prevY * width + prevX;
      if (current.dominant[p] !== previous.dominant[old]) continue;
      let errorSq = 0;
      for (let c = 0; c < 3; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const value = spatial[(ny * width + nx) * 3 + c];
            lo = Math.min(lo, value);
            hi = Math.max(hi, value);
          }
        }
        const value = previous.colors[old * 3 + c];
        const residual = value < lo ? lo - value : value > hi ? value - hi : 0;
        errorSq += residual * residual;
      }
      const weight = strength * Math.exp(-12 * Math.sqrt(errorSq));
      for (let c = 0; c < 3; c++) {
        output[p * 3 + c] = spatial[p * 3 + c] * (1 - weight) +
          previous.colors[old * 3 + c] * weight;
      }
    }
  }
  return output;
}

/** Train-time surrogate only; training a 3DGS model is intentionally out of scope. */
export function rayColorVariance(gaussians, x, y) {
  const sum = [0, 0, 0];
  let mass = 0;
  for (const gaussian of gaussians) {
    const alpha = gaussianAlpha(gaussian, x, y);
    mass += alpha;
    for (let c = 0; c < 3; c++) sum[c] += alpha * gaussian.color[c];
  }
  if (mass === 0) return 0;
  for (let c = 0; c < 3; c++) sum[c] /= mass;
  let variance = 0;
  for (const gaussian of gaussians) {
    const alpha = gaussianAlpha(gaussian, x, y);
    for (let c = 0; c < 3; c++) {
      variance += alpha * (gaussian.color[c] - sum[c]) ** 2;
    }
  }
  return variance / mass;
}

export function psnr(actual, reference) {
  if (actual.length !== reference.length) throw new RangeError('Image shape mismatch');
  let mse = 0;
  for (let i = 0; i < actual.length; i++) {
    mse += (actual[i] - reference[i]) ** 2;
  }
  mse /= actual.length || 1;
  return mse === 0 ? Infinity : -10 * Math.log10(mse);
}

/** Stateful, deterministic synthetic experiment. No browser or Cesium globals. */
export function createSteadySplatsExperiment({
  width = 128,
  height = 96,
  gaussians = createDemoGaussians(width, height),
  historySize = 4,
  historyWeight = 0.7,
  seed = 2026,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width * height > 262144) {
    throw new RangeError('Invalid experiment dimensions');
  }
  if (!Number.isInteger(historySize) || historySize < 1 || historySize > 32) {
    throw new RangeError('historySize must be between 1 and 32');
  }
  const models = gaussians.map((gaussian) => ({ ...gaussian })).sort((a, b) => a.depth - b.depth);
  if (models.length > 32767 || models.some((g) =>
    !Number.isFinite(g.x) || !Number.isFinite(g.y) ||
    !(g.sx > 0) || !(g.sy > 0) ||
    !Number.isFinite(g.depth) || !(g.opacity >= 0 && g.opacity <= 1) ||
    !Array.isArray(g.color) || g.color.length !== 3 ||
    g.color.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1))) {
    throw new TypeError('Invalid Gaussian scene');
  }
  const previous = [];
  let temporal = null;
  return {
    render({ frame = 0, cameraX = 0, cameraY = 0, temporalWeight = historyWeight } = {}) {
      if (![frame, cameraX, cameraY, temporalWeight].every(Number.isFinite) ||
        temporalWeight < 0 || temporalWeight > 1) throw new RangeError('Invalid render parameters');
      const current = generateSamples(models, width, height, cameraX, cameraY, frame, seed);
      const raw = sampleColors(current.ids, models);
      const spatial = resample(current, previous, models, width, height, historySize);
      const output = temporalReuse(spatial, current, temporal, width, height, temporalWeight);
      previous.unshift(current);
      previous.length = Math.min(previous.length, historySize - 1);
      temporal = { colors: output, cameraX, cameraY, dominant: current.dominant };
      return {
        raw,
        spatial,
        output,
        reference: current.reference,
        scores: {
          raw: psnr(raw, current.reference),
          spatial: psnr(spatial, current.reference),
          temporal: psnr(output, current.reference),
        },
      };
    },
    reset() {
      previous.length = 0;
      temporal = null;
    },
    getHistoryLength: () => previous.length,
    width,
    height,
  };
}
