/**
 * @module render/cesium/themes/customEffects
 * @description FORK-ONLY (exp/theme-engine-v0). User effects loaded at
 * runtime (docs/CUSTOM-EFFECTS.md). An effect file is a JSON header in a
 * `/*! gev-effect ... *\/` comment followed by a GLSL `main()`:
 *
 *   /*! gev-effect
 *   { "id": "ink", "label": "Ink lines", "depth": true,
 *     "uniforms": { "inkStrength": { "type": "float", "default": 0.5,
 *                   "min": 0, "max": 1, "step": 0.01, "label": "Ink" } } }
 *   *\/
 *   void main() { ... out_FragColor = ...; }
 *
 * The engine prepends the standard header (colorTexture,
 * colorTextureDimensions, v_textureCoordinates, fx_luma, fx_hash; with
 * "depth": fx_eye/fx_sky/fx_dist; with "launchpad": fx_normal) and one
 * uniform per declared uniform. Parsing never throws; problems come back as
 * a list. Compile errors are caught by the engine at first draw: the effect
 * is switched off and the error shown, the globe keeps drawing.
 */
import { SHADER_PARTS, EFFECT_IDS } from './effectLibrary.js';

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const UNIFORM = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const RESERVED = new Set([
  'colorTexture',
  'depthTexture',
  'colorTextureDimensions',
  'launchpadTexture',
  'sourceTexture',
  'main',
]);
const TYPES = new Set(['float', 'bool', 'color', 'vec3']);
const MAX_GLSL = 20000;

/** GLSL declaration of a declared uniform. */
function declare(name, spec) {
  return `uniform ${spec.type === 'color' || spec.type === 'vec3' ? 'vec3' : 'float'} ${name};`;
}

/**
 * Parse an effect file (string) or effect object ({id, uniforms, glsl}).
 * @returns {{effect: object|null, problems: string[]}}
 */
export function parseCustomEffect(input) {
  const problems = [];
  let header;
  let glsl;
  if (typeof input === 'string') {
    const m = input.match(/\/\*!\s*gev-effect\s*([\s\S]*?)\*\//);
    if (!m)
      return {
        effect: null,
        problems: ['missing /*! gev-effect {json} */ header'],
      };
    try {
      header = JSON.parse(m[1]);
    } catch (e) {
      return { effect: null, problems: [`header is not JSON: ${e.message}`] };
    }
    glsl = input.slice(m.index + m[0].length);
  } else if (input && typeof input === 'object') {
    header = input;
    glsl = String(input.glsl ?? '');
  } else
    return {
      effect: null,
      problems: ['effect must be a file string or an object'],
    };

  const id = String(header.id ?? '');
  if (!ID.test(id)) problems.push(`bad id "${id}" (a-z, 0-9, -; 2-41 chars)`);
  if (EFFECT_IDS.includes(id)) problems.push(`id "${id}" is a built-in effect`);
  if (!/\bvoid\s+main\s*\(/.test(glsl))
    problems.push('GLSL has no void main()');
  if (/#\s*(version|extension)/.test(glsl))
    problems.push('#version/#extension are not allowed');
  if (glsl.length > MAX_GLSL)
    problems.push(`GLSL longer than ${MAX_GLSL} chars`);
  const uniforms = {};
  for (const [name, spec] of Object.entries(header.uniforms ?? {})) {
    if (!UNIFORM.test(name) || RESERVED.has(name) || name.startsWith('czm_')) {
      problems.push(`bad uniform name ${name}`);
      continue;
    }
    if (!spec || !TYPES.has(spec.type)) {
      problems.push(`uniform ${name}: type must be float, bool, color or vec3`);
      continue;
    }
    const vec = spec.type === 'color' || spec.type === 'vec3';
    const def = spec.default ?? (vec ? [0, 0, 0] : 0);
    if (
      vec
        ? !(
            Array.isArray(def) &&
            def.length === 3 &&
            def.every(Number.isFinite)
          )
        : !Number.isFinite(Number(def))
    ) {
      problems.push(`uniform ${name}: bad default`);
      continue;
    }
    uniforms[name] = {
      type: spec.type,
      default: vec ? [...def] : Number(def),
      min: Number.isFinite(spec.min) ? spec.min : 0,
      max: Number.isFinite(spec.max) ? spec.max : 1,
      step: Number.isFinite(spec.step) ? spec.step : 0.01,
      label: String(spec.label ?? name),
    };
  }
  if (problems.length) return { effect: null, problems };
  const { HEAD, DEPTH, LAUNCHPAD_READ } = SHADER_PARTS;
  const depth = !!header.depth || !!header.launchpad;
  const fragmentShader = [
    HEAD,
    depth ? DEPTH : '',
    header.launchpad ? LAUNCHPAD_READ : '',
    ...Object.entries(uniforms).map(([n, s]) => declare(n, s)),
    glsl,
  ].join('\n');
  return {
    effect: {
      id,
      label: String(header.label ?? id),
      custom: true,
      cost: Math.min(10, Math.max(0.1, Number(header.cost) || 1)),
      launchpad: !!header.launchpad,
      fragmentShader,
      uniforms,
    },
    problems,
  };
}
