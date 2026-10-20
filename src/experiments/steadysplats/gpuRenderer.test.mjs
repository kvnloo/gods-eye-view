import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuSteadySplats,isSoftwareWebGLRenderer} from './gpuRenderer.js';

test('driver attribution rejects software backends and keeps hardware candidates',()=>{
  for(const name of ['ANGLE (Google, Vulkan 1.3 SwiftShader Device)','llvmpipe (LLVM 19.1.7)','softpipe Mesa'])
    assert.equal(isSoftwareWebGLRenderer(name),true,name);
  for(const name of ['ANGLE (NVIDIA GeForce RTX 3080 Ti Direct3D11)','Apple M1','AMD Radeon RX 7900'])
    assert.equal(isSoftwareWebGLRenderer(name),false,name);
});
test('GPU lab rejects unsupported surfaces or dimensions before rendering',()=>{
  const canvas={width:0,height:0,getContext:()=>null};
  assert.throws(()=>createGpuSteadySplats(canvas,{width:0,height:128}),/dimensions/);
  assert.throws(()=>createGpuSteadySplats(canvas,{width:128,height:128,historySize:5}),/history/);
  assert.throws(()=>createGpuSteadySplats(canvas,{width:128,height:128}),/WebGL2 unavailable/);
  assert.equal(canvas.width,256);
  assert.equal(canvas.height,256);
});
