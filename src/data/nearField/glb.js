/**
 * @module data/nearField/glb
 * @description FORK-ONLY (exp/near-field-v0). A minimal binary glTF writer
 * for near-field cells: one flat-shaded triangle soup (POSITION + COLOR_0,
 * no normals: the renderer's shader derives flat normals from screen-space
 * derivatives) plus instanced prototypes (EXT_mesh_gpu_instancing).
 * Coordinates are Z-up east/north/up metres; the renderer loads the model
 * with upAxis Z. Pure: runs in node and in the worker.
 */

const FLOAT = 5126;
const USHORT = 5123;
const pad4 = (n) => (n + 3) & ~3;

/** Linear colour floats (r,g,b,a per vertex) to normalized uint16. */
function packColours(c) {
  const out = new Uint16Array(c.length);
  for (let i = 0; i < c.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round(c[i] * 65535)));
  return out;
}

/**
 * @param {{soup?: {p:number[], c:number[]}, protos?: Iterable<{soup:{p:number[],c:number[]}, instances:number[][]}>, generator?: string}} parts
 * @returns {Uint8Array} GLB bytes
 */
export function writeGlb({ soup, protos = [], generator = 'gev near-field (fork-only)' }) {
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const len = pad4(bytes.byteLength);
    const buf = new Uint8Array(len);
    buf.set(bytes);
    chunks.push(buf);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target && { target }) });
    offset += len;
    return views.length - 1;
  };
  const acc = (typed, type, componentType, count, extra = {}) => {
    accessors.push({ bufferView: push(typed, extra.instance ? undefined : 34962), componentType, count, type, ...extra.acc });
    return accessors.length - 1;
  };
  const minmax = (p) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    return { min, max };
  };
  const meshes = [];
  const nodes = [];
  const prim = (s) => {
    const p = new Float32Array(s.p);
    return {
      attributes: {
        POSITION: acc(p, 'VEC3', FLOAT, p.length / 3, { acc: minmax(p) }),
        COLOR_0: acc(packColours(s.c), 'VEC4', USHORT, s.c.length / 4, { acc: { normalized: true } }),
      },
      material: 0,
    };
  };
  if (soup?.p?.length) {
    meshes.push({ primitives: [prim(soup)] });
    nodes.push({ mesh: meshes.length - 1 });
  }
  let instanced = false;
  for (const p of protos) {
    if (!p.instances?.length || !p.soup?.p?.length) continue;
    meshes.push({ primitives: [prim(p.soup)] });
    const n = p.instances.length;
    const tr = new Float32Array(n * 3);
    const ro = new Float32Array(n * 4);
    const sc = new Float32Array(n * 3);
    p.instances.forEach(([x, y, z, k, a], i) => {
      tr.set([x, y, z], i * 3);
      ro.set([0, 0, Math.sin(a / 2), Math.cos(a / 2)], i * 4);
      sc.set([k, k, k], i * 3);
    });
    nodes.push({
      mesh: meshes.length - 1,
      extensions: {
        EXT_mesh_gpu_instancing: {
          attributes: {
            // min/max matter: Cesium bounds (and culls) an instanced node by them
            TRANSLATION: acc(tr, 'VEC3', FLOAT, n, { instance: true, acc: minmax(tr) }),
            ROTATION: acc(ro, 'VEC4', FLOAT, n, { instance: true }),
            SCALE: acc(sc, 'VEC3', FLOAT, n, { instance: true }),
          },
        },
      },
    });
    instanced = true;
  }
  if (!nodes.length) return null;
  const json = {
    asset: { version: '2.0', generator },
    ...(instanced && { extensionsUsed: ['EXT_mesh_gpu_instancing'], extensionsRequired: ['EXT_mesh_gpu_instancing'] }),
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jlen = pad4(enc.byteLength);
  const total = 12 + 8 + jlen + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jlen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jlen);
  out.set(enc, 20);
  let at = 20 + jlen;
  dv.setUint32(at, offset, true);
  dv.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Parse a GLB's JSON chunk (tests and QA). */
export function readGlbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jlen = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jlen)));
}
