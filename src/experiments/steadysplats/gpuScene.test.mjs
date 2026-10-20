import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGaussianPly, projectGaussians3D, createProceduralGaussians3D} from './gpuScene.js';

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
