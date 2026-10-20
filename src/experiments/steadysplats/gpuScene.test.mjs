import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGaussianPly, projectGaussians3D, createProceduralGaussians3D, prepareGaussianPreview} from './gpuScene.js';

function plyVertices(rows, properties, {ascii = false} = {}) {
  const format = ascii ? 'ascii 1.0' : 'binary_little_endian 1.0';
  const header = `ply\nformat ${format}\nelement vertex ${rows.length}\n${properties.map(([name,type])=>`property ${type} ${name}`).join('\n')}\nend_header\n`;
  const h = new TextEncoder().encode(header);
  const size = h.length + (ascii ? rows.map((r)=>r.join(' ')+'\n').join('').length : rows.length*properties.length*4);
  const buf = new ArrayBuffer(size);
  const bytes = new Uint8Array(buf);
  bytes.set(h);
  if (ascii) bytes.set(new TextEncoder().encode(rows.map((r)=>r.join(' ')+'\n').join('')), h.length);
  else {const view = new DataView(buf); rows.flat().forEach((v,i)=>view.setFloat32(h.length+i*4,v,true));}
  return buf;
}
const fields=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'].map(x=>[x,'float']);
test('binary PLY parses real 3DGS attribute conventions with bounded SH0 colors',()=>{
  const g=parseGaussianPly(plyVertices([[0,0,4,0,1,-1,1,-2,-2,-2,1,0,0,0]],fields));
  assert.equal(g.length,1); assert.equal(g[0].z,4);assert.ok(g[0].color[1]>g[0].color[0]);assert.ok(g[0].color[2]<g[0].color[0]);
  assert.ok(Math.abs(g[0].opacity-0.73105858)<1e-5);
});
test('ASCII PLY works and truncation and unreasonable counts fail closed',()=>{
  const buf=plyVertices([[1,2,3]],fields.slice(0,3),{ascii:true});
  assert.equal(parseGaussianPly(buf)[0].y,2);
  assert.throws(()=>parseGaussianPly(buf,{maxGaussians:0}),/bounds/);
  assert.throws(()=>parseGaussianPly(buf.slice(0,25)),/header/);
});
test('projection obeys depth, camera translations, finite eigenvalues and positive ellipse axes',()=>{
  const models=createProceduralGaussians3D(70);
  const a=projectGaussians3D(models,256,192), b=projectGaussians3D(models,256,192,{cameraX:0.25});
  assert.equal(a.length,70); assert.ok(a[0].x>b[0].x);
  assert.ok(a.every(g=>g.sx>0&&g.sy>0&&Number.isFinite(g.angle)&&g.depth>=0&&g.depth<=1));
  assert.equal(projectGaussians3D([{...models[0],z:-1}],256,192).length,0);
});

test('common CRLF PLY header is parsed correctly',()=>{
  const buf=plyVertices([[0,0,4]],fields.slice(0,3));
  const bytes=new Uint8Array(buf);const header=new TextDecoder().decode(bytes);
  const end=header.indexOf('end_header\n')+'end_header\n'.length;
  const crlf=new TextEncoder().encode(header.slice(0,end).replace(/\n/g,'\r\n'));
  const dst=new Uint8Array(crlf.length+buf.byteLength-end);
  dst.set(crlf);dst.set(bytes.subarray(end),crlf.length);
  assert.equal(parseGaussianPly(dst.buffer)[0].z,4);
});

test('PLY preview bounds include all vertices beyond the first 50,000', () => {
  const template={x:0,y:0,z:4,opacity:0.8,scale:[0.1,0.2,0.3],rotation:[1,0,0,0],color:[1,0,0]};
  const cloud=Array.from({length:60001},(_,i)=>({...template,x:i===60000?100:0}));
  const preview=prepareGaussianPreview(cloud);
  assert.equal(preview.length,2000);
  assert.ok(Math.abs(preview[0].x+1.7)<1e-9);
  assert.ok(Math.abs(preview.at(-1).x-1.7)<1e-9);
  assert.equal(preview[0].z,4);
  assert.equal(cloud[0].x,0);
  assert.equal(cloud.at(-1).x,100);
  assert.equal(cloud[0].scale[0],0.1);
  assert.ok(projectGaussians3D(preview,256,192).length>0);
});

test('PLY preview samples the full source range and preserves source appearance', () => {
  const source=Array.from({length:4001},(_,i)=>({
    x:i/1000,y:0,z:4,opacity:0.55,scale:[0.2,0.3,0.4],
    rotation:[1,0,0,0],color:[0.1,0.2,0.3],
  }));
  const preview=prepareGaussianPreview(source,{maxPreview:5});
  assert.equal(preview.length,5);
  assert.deepEqual(preview.map((g)=>Number(g.x.toFixed(3))),[-1.7,-0.85,0,0.85,1.7]);
  assert.equal(preview[4].color,source[4000].color);
  assert.ok(preview[0].scale[0]>0);
  assert.notEqual(preview[0].scale,source[0].scale);
  assert.equal(source[4000].x,4);
});

test('PLY preview fails closed on invalid bounds, scale and budget', () => {
  const valid={x:0,y:0,z:4,scale:[1,1,1]};
  assert.throws(()=>prepareGaussianPreview([]),RangeError);
  assert.throws(()=>prepareGaussianPreview([valid],{maxPreview:2001}),RangeError);
  assert.throws(()=>prepareGaussianPreview([{...valid,x:NaN}]),TypeError);
  assert.throws(()=>prepareGaussianPreview([{...valid,scale:[1,0,1]}]),TypeError);
});
