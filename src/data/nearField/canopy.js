import { linear, prism, prng, ring, Soup } from '../cityDioramaMesh.js';

const TAU = 2 * Math.PI;
const clamp = (v) => Math.max(0, Math.min(1, v));

// Adapts Tinytown's lobedSurface (MIT, Pete Koomen). Angular clumps
// displace one continuous crown, with a tighter, flatter underside.
function lobedSurface(species, random) {
  const clumps = Array.from({ length: species.lobes }, () => {
    const z = random() * 1.5 - 0.5;
    const angle = random() * TAU;
    const r = Math.sqrt(1 - z * z);
    return { x: r * Math.cos(angle), y: r * Math.sin(angle), z, sharpness: 8 + 5 * random() };
  });
  return ([x, y, z]) => {
    let strongest = 0, sum = 0;
    for (const c of clumps) {
      const falloff = Math.exp(-c.sharpness * (1 - x * c.x - y * c.y - z * c.z));
      strongest = Math.max(strongest, falloff);
      sum += falloff;
    }
    const swell = clamp(strongest * 0.86 + sum * 0.14);
    const r = 0.78 + 0.27 * swell;
    const w = species.shape === 'spreading' ? 1.12 : 1;
    return { p: [x * r * w, y * r, species.squash * (0.77 + z * r * (z < 0 ? 0.68 : 1)) + 0.65], lit: clamp((z + 0.8) / 1.55) * (0.88 + 0.12 * swell) };
  };
}

// Adapts the continuous tiered conifer from Tinytown (MIT, Pete Koomen).
function coniferPoint(species, height, angle, phase) {
  const t = height;
  const hem = t * species.lobes + Math.sin(angle * 3 + phase) * Math.sin(t * Math.PI) * 0.15;
  const tip = (1 - (hem - Math.floor(hem))) ** 2;
  const r = (1 - t) * (0.63 + tip * 0.4) * (1 + 0.06 * Math.sin(angle * 5 + phase));
  return { p: [r * Math.cos(angle), r * Math.sin(angle), 0.57 + t * species.squash], lit: 0.4 + t * 0.4 + tip * 0.2 };
}

// Adapts Tinytown's canopyCore (MIT, Pete Koomen). A welded crown with
// smoothed radial normals and interpolated sunny-top / shaded-base colour.
export function canopyPrototype(species, variant = 0) {
  const random = prng(257 + variant * 431 + species.lobes * 37);
  const top = linear(species.colours[variant % species.colours.length]);
  const shade = linear(species.shade);
  const project = lobedSurface(species, random);
  const phase = random() * TAU;
  const p = [], n = [], c = [], indices = [];
  const isFir = species.shape === 'conifer';
  const rings = isFir ? 12 : 9;
  const sides = isFir ? 10 : 14;
  const add = (position, normal, lit) => {
    p.push(...position);
    const length = Math.hypot(...normal);
    n.push(...normal.map((v) => v / length));
    c.push(...top.map((v, i) => shade[i] + (v - shade[i]) * lit), 1);
  };
  add(isFir ? [0, 0, 0.57] : project([0, 0, -1]).p, [0, 0, -1], 0);
  for (let j = 0; j < rings; j++) {
    const t = (j + 1) / (rings + 1);
    const latitude = Math.PI * (t - 0.5);
    const z = Math.sin(latitude), xy = Math.cos(latitude);
    for (let i = 0; i < sides; i++) {
      const angle = i / sides * TAU;
      const x = Math.cos(angle), y = Math.sin(angle);
      const point = isFir ? coniferPoint(species, j / rings, angle, phase) : project([x * xy, y * xy, z]);
      add(point.p, isFir ? [x, y, 1 / species.squash] : [x * xy, y * xy, z / species.squash], point.lit);
    }
  }
  const tip = p.length / 3;
  add(isFir ? [0, 0, 0.57 + species.squash] : project([0, 0, 1]).p, [0, 0, 1], 1);
  const at = (j, i) => 1 + j * sides + (i % sides);
  for (let i = 0; i < sides; i++) {
    indices.push(0, at(0, i + 1), at(0, i));
    for (let j = 1; j < rings; j++) {
      const a = at(j - 1, i), b = at(j - 1, i + 1), c = at(j, i), d = at(j, i + 1);
      indices.push(a, b, c, b, d, c);
    }
    indices.push(at(rings - 1, i), at(rings - 1, i + 1), tip);
  }
  return { p, n, c, indices, triangles: indices.length / 3 };
}

export function treePrototype(species, variant) {
  const crown = canopyPrototype(species, variant);
  const trunk = new Soup();
  prism(trunk, ring(0, 0, 0.065, 5), 0, species.shape === 'conifer' ? 0.65 : 0.9, linear('#7a5f48'));
  const start = crown.p.length / 3;
  crown.p.push(...trunk.p);
  crown.n.push(...trunk.n);
  crown.c.push(...trunk.c);
  for (let i = 0; i < trunk.p.length / 3; i++) crown.indices.push(start + i);
  crown.triangles = crown.indices.length / 3;
  return crown;
}
