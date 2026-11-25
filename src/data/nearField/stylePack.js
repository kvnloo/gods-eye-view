// Schema defaults also keep generation available if a pack cannot be fetched.
const groundColours = {
  meadow: '#798b59', wood: '#5c714b', park: '#779258', farmland: '#9c9067',
  residential: '#909677', commercial: '#a59e92', sand: '#ceb991', rock: '#928d86',
  ice: '#e5e9eb', water: '#377987', shallow: '#59a6ac', road: '#797978',
  kerb: '#bfb6a6', rail: '#615c57', paving: '#b5aca0', path: '#a89578',
};

const defaults = {
  ground: Object.fromEntries(Object.entries(groundColours).map(([k, colour]) => [k, [colour, 0.07]])),
  kit: {
    walls: ['#e5dbc8', '#d9c7ae'], roofs: ['#ab634a', '#727b84'],
    towerWalls: ['#d2ccc0', '#bbc1c2'], towerRoofs: ['#7e7872'],
    window: '#505c62', door: '#6d5040', gableMaxArea: 300, sat: 1,
  },
  trees: { density: { wood: 1, park: 0.5, grass: 0.2, residential: 0.08, street: 0.28 }, species: [
    { shape: 'round', radius: [2, 4], squash: 1, lobes: 10, colours: ['#81ae68'], shade: '#547958', share: 1 },
  ] },
  light: {
    minEl: 18, maxEl: 30, color: '#ffe4bc', key: 0.83, ambient: 0.48,
    shadeTint: [0.89, 0.95, 1.18], darkness: 0.7, softShadows: true, size: 2048, maxDistance: 2000, depthBias: 0.0002,
  },
  post: {
    ao: { aoStrength: 0.45 },
    dof: { tiltAmount: 0.22, tiltBand: 0.35 },
    grade: { temperature: 0.45, saturation: 0.99, contrast: 1.05 },
    lut: { lutStrength: 0.30 },
  },
  look: { meadow: 1, patina: 0.85, darkLift: 0.028, shadeCool: 0.85 },
};

const colour = (v) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
const number = (lo, hi) => (v) => Number.isFinite(v) && v >= lo && v <= hi;
const palette = (v) => Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(colour);
const tuple = (v, n, check) => Array.isArray(v) && v.length === n && v.every(check);
const range = (v) => tuple(v, 2, number(0.5, 15)) && v[0] <= v[1];
const fraction = number(0, 1);
const speciesFields = {
  shape: (v) => ['round', 'egg', 'spreading', 'conifer'].includes(v),
  radius: range, squash: number(0.4, 4), lobes: (v) => Number.isInteger(v) && v >= 3 && v <= 18,
  colours: palette, shade: colour, share: number(0.001, 1),
};
const checks = {
  'kit.gableMaxArea': number(0, 2000), 'kit.sat': number(0, 2),
  'light.minEl': number(0, 90), 'light.maxEl': number(0, 90),
  'light.key': number(0, 3), 'light.ambient': number(0, 2),
  'light.shadeTint': (v) => tuple(v, 3, number(0, 2)),
  'light.size': (v) => [512, 1024, 2048, 4096].includes(v),
  'light.depthBias': number(0, 0.05),
  'light.maxDistance': number(100, 10000), 'post.grade.temperature': number(-1, 1),
  'post.grade.saturation': number(0, 2), 'post.grade.contrast': number(0, 2),
};

export function validateStylePack(input, fallback = defaults) {
  const problems = [];
  function value(v, base, path) {
    if (v === undefined) return base;
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v)) if (!Object.hasOwn(base, k)) problems.push(`unknown ${path}${k}`);
        return Object.fromEntries(Object.entries(base).map(([k, b]) => [k, value(Object.hasOwn(v, k) ? v[k] : undefined, b, `${path}${k}.`)]));
      }
    } else if (path === 'trees.species.') {
      if (Array.isArray(v) && v.length > 0 && v.length <= 8) {
        return v.map((s, i) => {
          const fields = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
          for (const k of Object.keys(fields)) if (!Object.hasOwn(speciesFields, k)) problems.push(`unknown trees.species.${i}.${k}`);
          return Object.fromEntries(Object.entries(speciesFields).map(([k, check]) => {
            if (check(fields[k])) return [k, fields[k]];
            problems.push(`bad trees.species.${i}.${k}`);
            return [k, base[i % base.length][k]];
          }));
        });
      }
    } else {
      const check = checks[path.slice(0, -1)] ?? (
        path.startsWith('ground.') ? (a) => Array.isArray(a) && a.length === 2 && colour(a[0]) && fraction(a[1])
          : Array.isArray(base) ? palette
            : typeof base === 'string' ? colour
              : typeof base === 'boolean' ? (a) => typeof a === 'boolean'
                : fraction
      );
      if (check(v)) return v;
    }
    problems.push(`bad ${path.slice(0, -1) || 'style pack'}`);
    return base;
  }
  const pack = value(input, fallback, '');
  if (pack.light.minEl > pack.light.maxEl) {
    problems.push('bad light elevation range');
    pack.light = { ...pack.light, minEl: fallback.light.minEl, maxEl: fallback.light.maxEl };
  }
  return { pack, problems };
}

export function stylePackHash(pack) {
  let hash = 2166136261;
  for (const c of JSON.stringify(pack)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const packs = new Map();
export function loadStylePack(name = 'wintercats') {
  if (!packs.has(name)) packs.set(name, (async () => {
    if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('invalid style pack name');
    const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}themes/stylepacks/${name}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const fallback = name === 'wintercats' ? defaults : (await loadStylePack()).pack;
    const { pack, problems } = validateStylePack(await response.json(), fallback);
    return { pack, problems, name, hash: stylePackHash(pack) };
  })().catch(async (error) => {
    const fallback = name === 'wintercats'
      ? { pack: defaults, name: 'defaults', hash: stylePackHash(defaults), problems: [] }
      : await loadStylePack();
    return { ...fallback, problems: [`${name}: ${error.message}`, ...fallback.problems] };
  }));
  return packs.get(name);
}

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
