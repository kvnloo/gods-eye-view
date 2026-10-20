// Browser-portable Gaussian scene parsing and perspective projection.
// A research fixture, not a Cesium terrain renderer. The DC coefficients are
// converted using the public 3DGS SH0 basis; higher SH bands are not evaluated.
const SH0 = 0.28209479177387814;
const TYPES = Object.freeze({
  char: ['getInt8', 1], uchar: ['getUint8', 1], int8: ['getInt8', 1], uint8: ['getUint8', 1],
  short: ['getInt16', 2], ushort: ['getUint16', 2], int16: ['getInt16', 2], uint16: ['getUint16', 2],
  int: ['getInt32', 4], uint: ['getUint32', 4], int32: ['getInt32', 4], uint32: ['getUint32', 4],
  float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8],
});
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const logistic = (x) => 1 / (1 + Math.exp(-x));

export function parseGaussianPly(data, { maxGaussians = 250000 } = {}) {
  if (!(data instanceof ArrayBuffer)) throw new TypeError('Expected an ArrayBuffer');
  const bytes = new Uint8Array(data);
  let headerEnd = -1;
  const magic = new TextEncoder().encode('end_header');
  const maxHeader = Math.min(bytes.length, 1024 * 1024);
  for (let i = 0; i <= maxHeader - magic.length; i++) {
    if (bytes[i] !== 101) continue;
    let match = true;
    for (let j = 0; j < magic.length; j++) if (bytes[i + j] !== magic[j]) { match = false; break; }
    if (match) {
      const e = i + magic.length;
      if (bytes[e] === 10) { headerEnd = e+1; break; }
      if (bytes[e] === 13 && bytes[e+1] === 10) { headerEnd = e+2; break; }
    }
  }
  if (headerEnd < 0) throw new Error('Missing PLY header');
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd)).replace(/\r/g, '');
  const lines = header.trim().split('\n');
  if (lines[0] !== 'ply') throw new Error('Invalid PLY signature');
  const format = lines.find((line) => line.startsWith('format '))?.split(' ')[1];
  if (format !== 'binary_little_endian' && format !== 'ascii') throw new Error('Unsupported PLY format');
  let element = '';
  let vertexCount = 0;
  const props = [];
  let stride = 0;
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === 'element') {
      element = tokens[1];
      if (element === 'vertex') vertexCount = Number(tokens[2]);
    }
    if (tokens[0] === 'property' && element === 'vertex') {
      if (tokens[1] === 'list') throw new Error('List-valued vertex attributes are not supported');
      const type = TYPES[tokens[1]];
      if (!type) throw new Error(`Unknown PLY type: ${tokens[1]}`);
      props.push({ name: tokens[2], type, offset: stride });
      stride += type[1];
    }
  }
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 1 || vertexCount > maxGaussians)
    throw new RangeError('PLY vertex count outside configured bounds');
  for (const name of ['x', 'y', 'z']) if (!props.some((p) => p.name === name)) throw new Error(`Missing vertex ${name}`);
  const valid = new Map(props.map((p, index) => [p.name, index]));
  const get = (values, name, fallback) => valid.has(name) ? values[valid.get(name)] : fallback;
  const view = new DataView(data);
  let start = headerEnd;
  const output = [];
  let rows;
  if (format === 'ascii') {
    rows = new TextDecoder().decode(bytes.subarray(headerEnd)).trim().split(/\r?\n/);
    if (rows.length < vertexCount) throw new Error('Truncated ASCII vertex data');
  } else if (start + vertexCount * stride > data.byteLength) {
    throw new Error('Truncated binary vertex data');
  }
  for (let i = 0; i < vertexCount; i++) {
    const values = format === 'ascii'
      ? rows[i].trim().split(/\s+/).slice(0, props.length).map(Number)
      : props.map((p) => view[p.type[0]](start + i * stride + p.offset, true));
    if (values.length !== props.length || values.some((v) => !Number.isFinite(v)))
      throw new Error(`Invalid PLY vertex ${i}`);
    const hasSH = valid.has('f_dc_0');
    const color = hasSH
      ? [0, 1, 2].map((c) => clamp(0.5 + SH0 * get(values, `f_dc_${c}`, 0), 0, 1))
      : ['red', 'green', 'blue'].map((name) => clamp(get(values, name, 200) / 255, 0, 1));
    const scale = [0, 1, 2].map((k) => Math.exp(clamp(get(values, `scale_${k}`, -2.8), -12, 5)));
    const opacity = valid.has('opacity') ? logistic(get(values, 'opacity', 0)) : 0.72;
    const q = [0, 1, 2, 3].map((k) => get(values, `rot_${k}`, k === 0 ? 1 : 0));
    const x = get(values, 'x', 0), y = get(values, 'y', 0), z = get(values, 'z', 0);
    output.push({ x, y, z, opacity, scale, rotation: q, color });
  }
  return output;
}

/** Project the full covariance J R Sigma R^T J^T into a rotated screen ellipse. */
export function projectGaussians3D(gaussians, width, height, { cameraX = 0, cameraY = 0, cameraZ = 0, focal = 0.9 * height, near = 0.2, far = 200 } = {}) {
  const out = [];
  for (const g of gaussians) {
    const x = g.x - cameraX, y = g.y - cameraY, z = g.z - cameraZ;
    if (!Number.isFinite(z) || z <= near || z > far) continue;
    const pointX = width * 0.5 + focal * x / z, pointY = height * 0.5 + focal * y / z;
    const q = g.rotation || [1, 0, 0, 0];
    const norm = Math.hypot(...q) || 1;
    const [w, a, b, c] = q.map((v) => v / norm);
    const R = [
      [1 - 2*(b*b+c*c), 2*(a*b-w*c), 2*(a*c+w*b)],
      [2*(a*b+w*c), 1 - 2*(a*a+c*c), 2*(b*c-w*a)],
      [2*(a*c-w*b), 2*(b*c+w*a), 1 - 2*(a*a+b*b)],
    ];
    const J = [[focal / z, 0, -focal * x / (z*z)], [0, focal / z, -focal * y / (z*z)]];
    const A = [0, 1].map((i) => [0, 1, 2].map((j) =>
      (J[i][0]*R[0][j] + J[i][1]*R[1][j] + J[i][2]*R[2][j]) * g.scale[j]));
    const covXX = A[0].reduce((v, k) => v + k*k, 0) + 0.15;
    const covXY = A[0].reduce((v, k, j) => v + k*A[1][j], 0);
    const covYY = A[1].reduce((v, k) => v + k*k, 0) + 0.15;
    const delta = Math.sqrt(Math.max(0, (covXX-covYY)**2 + 4*covXY*covXY));
    const eig0 = Math.max(0.25, 0.5*(covXX+covYY+delta));
    const eig1 = Math.max(0.25, 0.5*(covXX+covYY-delta));
    const angle = 0.5*Math.atan2(2*covXY, covXX-covYY);
    const sx = Math.sqrt(eig0), sy = Math.sqrt(eig1);
    if (Math.abs(pointX-width/2) > width/2 + 4*sx || Math.abs(pointY-height/2) > height/2 + 4*sy) continue;
    out.push({ x: pointX, y: pointY, sx, sy, angle, depth: clamp((z-near)/(far-near), 0, 1), color: g.color, opacity: g.opacity });
  }
  return out;
}

/** Procedural 3D point cloud with depth, anisotropic covariance and overdraw. */
export function createProceduralGaussians3D(count = 350, seed = 23) {
  const rand = () => { seed = Math.imul(seed ^ (seed >>> 15), 0x85ebca6b) >>> 0; return seed / 0x100000000; };
  const palette = [[0.08,0.67,0.95],[0.98,0.39,0.24],[0.89,0.72,0.15],[0.29,0.86,0.60],[0.59,0.43,0.96]];
  return Array.from({length: count}, (_, i) => {
    const cluster = i % 5, hue = palette[cluster];
    const t = rand()*6.28318530718, r = Math.sqrt(rand());
    const x = (cluster-2)*0.9 + Math.cos(t)*1.35*r;
    const y = Math.sin(t)*1.55*r + (rand()-0.5)*0.7;
    const z = 3.4 + (rand()*1.5) + cluster*0.35;
    const base = 0.11 + 0.12*rand();
    return {x,y,z,color:hue.map(v=>clamp(v+(rand()-0.5)*0.19,0,1)),opacity:0.24+rand()*0.50,
      scale:[base,base*(0.5+1.2*rand()),base*(0.5+rand())], rotation:[1,0,0,0]};
  });
}
