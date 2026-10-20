// Opt-in WebGL2 rendering experiment, independent of Cesium's WebGL context.
// Stochastic OIT is GPU rasterized (discard/depth); spatial and temporal reuse
// are fragment shaders. This is a simplified paper-inspired research backend,
// NOT Windisch et al.'s Vulkan implementation or learned color regularizer.
import { BACKGROUND } from './renderer.js';

const VERTEX_GAUSSIAN = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 aEllipse;
layout(location=2) in vec4 aColor;
layout(location=3) in vec2 aDepthId;
layout(location=4) in vec2 aRotation;
uniform vec2 uSize;
uniform vec2 uCamera;
out vec2 vLocal;
out vec4 vColor;
flat out float vId;
flat out float vDepth;
void main() {
  vLocal = aQuad * 4.0;
  vec2 ellipse = aQuad * 4.0 * aEllipse.zw;
  vec2 pos = aEllipse.xy + vec2(
    aRotation.x*ellipse.x-aRotation.y*ellipse.y,
    aRotation.y*ellipse.x+aRotation.x*ellipse.y);
  gl_Position = vec4((pos-uCamera) / uSize * 2.0 - 1.0, aDepthId.x * 2.0 - 1.0, 1.0);
  vColor = aColor;
  vId = aDepthId.y;
  vDepth = aDepthId.x;
}`;
const FRAGMENT_REFERENCE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
out vec4 outColor;
void main() {
  float alpha = vColor.a * exp(-0.5 * dot(vLocal, vLocal));
  if (alpha < 0.0005) discard;
  outColor = vec4(vColor.rgb, alpha);
}`;
const FRAGMENT_STOCHASTIC = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
flat in float vId;
flat in float vDepth;
uniform float uFrame;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outMeta;
// Integer avalanche hash: independent per Gaussian / pixel / frame.
float random01(ivec2 p, uint seed) {
  uint h = uint(p.x) * 0x9e3779b9u ^ uint(p.y) * 0x85ebca6bu ^ seed;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) * (1.0 / 4294967296.0);
}
void main() {
  float alpha = vColor.a * exp(-0.5 * dot(vLocal, vLocal));
  if (alpha < 0.0005 || random01(ivec2(gl_FragCoord.xy), uint(vId)*747796405u ^ uint(uFrame)*2891336453u) > alpha) discard;
  outColor = vec4(vColor.rgb, 1.0);
  // Identifier encodes 1..254. Zero is background. Keep exact id in RGBA8.
  outMeta = vec4(mod(vId+1.0,256.0)/255.0, vDepth, floor((vId+1.0)/256.0)/255.0, 1.0);
}`;
const VERTEX_SCREEN = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2(-1.0, -1.0);
  // Triangle vertices: (-1,-1), (3,-1), (-1,3).
  if (gl_VertexID == 1) p = vec2(3.0, -1.0);
  if (gl_VertexID == 2) p = vec2(-1.0, 3.0);
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p,0.0,1.0);
}`;
const SAMPLE_COMMON = `
precision highp float;
precision highp sampler2D;
in vec2 vUV;
uniform ivec2 uSize;
ivec2 pixel() { return clamp(ivec2(vUV * vec2(uSize)), ivec2(0),uSize-1); }
bool contains(ivec2 p) { return all(greaterThanEqual(p,ivec2(0))) && all(lessThan(p,uSize)); }
`;
const FRAGMENT_SPATIAL = `#version 300 es
${SAMPLE_COMMON}
uniform sampler2D uRaw0, uRaw1, uRaw2, uRaw3;
uniform sampler2D uMeta0, uMeta1, uMeta2, uMeta3;
uniform sampler2D uModels;
uniform vec2 uCameras[4];
uniform int uCount;
out vec4 outColor;
vec4 fetchRaw(int i, ivec2 p) {
  if (i == 0) return texelFetch(uRaw0,p,0);
  if (i == 1) return texelFetch(uRaw1,p,0);
  if (i == 2) return texelFetch(uRaw2,p,0);
  return texelFetch(uRaw3,p,0);
}
vec4 fetchMeta(int i, ivec2 p) {
  if (i == 0) return texelFetch(uMeta0,p,0);
  if (i == 1) return texelFetch(uMeta1,p,0);
  if (i == 2) return texelFetch(uMeta2,p,0);
  return texelFetch(uMeta3,p,0);
}
float alphaAt(int id, vec2 screenWorld) {
  if (id < 0) return 0.25;
  vec4 ellipse = texelFetch(uModels,ivec2(id,0),0);
  vec4 values = texelFetch(uModels,ivec2(id,1),0);
  vec2 direction = texelFetch(uModels,ivec2(id,2),0).xy;
  vec2 diff = screenWorld - ellipse.xy;
  vec2 r = vec2(dot(diff,vec2(direction.x,direction.y)),dot(diff,vec2(-direction.y,direction.x))) / ellipse.zw;
  return max(0.0001, values.y * exp(-0.5*dot(r,r)));
}
void main() {
  ivec2 target = pixel();
  vec3 weighted = vec3(0.0);
  float total = 0.0;
  for(int history=0;history<4;history++) {
    if(history>=uCount) break;
    ivec2 shift = ivec2(round(uCameras[0]-uCameras[history]));
    for(int n=0;n<5;n++) {
      ivec2 offset = n==0?ivec2(0):n==1?ivec2(-1,0):n==2?ivec2(1,0):n==3?ivec2(0,-1):ivec2(0,1);
      ivec2 source = target + offset + shift;
      if(!contains(source))continue;
      vec4 meta = fetchMeta(history,source);
      int id = int(round(meta.r*255.0)) + 256*int(round(meta.b*255.0)) - 1;
      vec2 worldTarget = vec2(target)+vec2(0.5)+uCameras[0];
      vec2 worldSource = vec2(source)+vec2(0.5)+uCameras[history];
      float probability = alphaAt(id,worldTarget) / max(0.0001,alphaAt(id,worldSource));
      float spatialWeight = n==0?1.0:0.6;
      float temporalWeight = history==0?1.0:0.65;
      float weight = min(4.0,probability)*spatialWeight*temporalWeight;
      weighted += fetchRaw(history,source).rgb*weight;
      total += weight;
    }
  }
  outColor = vec4(total>0.0?weighted/total:fetchRaw(0,target).rgb,1.0);
}`;
const FRAGMENT_TEMPORAL = `#version 300 es
${SAMPLE_COMMON}
uniform sampler2D uSpatial;
uniform sampler2D uPrevious;
uniform vec2 uMotion;
uniform float uWeight;
uniform bool uHasPrevious;
out vec4 outColor;
void main() {
  ivec2 target = pixel();
  vec3 current = texelFetch(uSpatial,target,0).rgb;
  if (!uHasPrevious || uWeight <= 0.0) {outColor=vec4(current,1.0);return;}
  ivec2 source = target + ivec2(round(uMotion));
  if (!contains(source)) {outColor=vec4(current,1.0);return;}
  vec3 lo = vec3(1.0),hi=vec3(0.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
    ivec2 p=clamp(target+ivec2(x,y),ivec2(0),uSize-1);
    vec3 candidate=texelFetch(uSpatial,p,0).rgb;
    lo=min(lo,candidate);hi=max(hi,candidate);
  }
  vec3 previous=texelFetch(uPrevious,source,0).rgb;
  float disagreement=length(previous-clamp(previous,lo,hi));
  float weight=uWeight*exp(-12.0*disagreement);
  outColor=vec4(mix(current,previous,weight),1.0);
}`;
const FRAGMENT_DISPLAY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uImage;
out vec4 outColor;
void main() {outColor=vec4(pow(texture(uImage,vUV).rgb,vec3(1.0/2.2)),1.0);}
`;

function shader(gl, type, source) {
  const s=gl.createShader(type); gl.shaderSource(s,source);gl.compileShader(s);
  if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) {const detail=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error('SteadySplats GLSL compile: '+detail);}
  return s;
}
function program(gl, vs, fs) {
  const v=shader(gl,gl.VERTEX_SHADER,vs),f=shader(gl,gl.FRAGMENT_SHADER,fs);
  const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
  gl.deleteShader(v);gl.deleteShader(f);
  if (!gl.getProgramParameter(p,gl.LINK_STATUS)) {const detail=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error('SteadySplats GLSL link: '+detail);}
  return p;
}
function texture(gl,w,h) {
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  return t;
}
function target(gl,w,h,withMeta=false) {
  const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  const color=texture(gl,w,h);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
  let meta=null, depth=null;
  if (withMeta) {
    meta=texture(gl,w,h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,meta,0);
    depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
  } else gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('SteadySplats framebuffer incomplete');
  return {fbo,color,meta,depth};
}
function bindUnit(gl,texture,unit) {
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
}
function uniform(gl,prog,name){return gl.getUniformLocation(prog,name);}
function msToPsnr(mse) {return mse<=1e-15?Infinity:-10*Math.log10(mse);}
function distortion(pixels,reference) {
  let total=0;
  for(let i=0;i<pixels.length;i+=4) for(let c=0;c<3;c++) total+=(pixels[i+c]-reference[i+c])**2;
  return total/(pixels.length/4*3*255*255);
}
export function isSoftwareWebGLRenderer(renderer='') {
  return /swiftshader|llvmpipe|softpipe|software|lavapipe|microsoft basic render|warp device|mesa offscreen/i.test(renderer);
}

/** Browser-reported GPU names are only candidates, never hardware proof. */
export function classifyWebGLRenderer(renderer='',vendor='') {
  const identity=String(renderer||'')+' '+String(vendor||'');
  if(isSoftwareWebGLRenderer(identity))return 'software';
  if(/nvidia|geforce|amd|radeon|apple|intel|mali|adreno|qualcomm/i.test(identity))
    return 'hardware-candidate';
  return 'unknown';
}

/** Create a separate WebGL2 context and manage all GPU resources by ownership. */
export function createGpuSteadySplats(canvas,{width=256,height=192,historySize=4,temporalWeight=0.65}={}) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>4096||height>4096)
    throw new RangeError('Invalid GPU dimensions');
  if (!Number.isInteger(historySize)||historySize<1||historySize>4)throw new RangeError('GPU history supports 1..4 frames');
  canvas.width=width*2;canvas.height=height*2;
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,depth:true});
  if(!gl)throw new Error('WebGL2 unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const vendor=debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
  const backend=classifyWebGLRenderer(renderer,vendor);
  const device={renderer,vendor,backend,software:backend==='software',webglVersion:gl.getParameter(gl.VERSION),maxTextures:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
  if(device.maxTextures<10)throw new Error('SteadySplats experiment requires >=10 fragment texture units');
  const programs={reference:program(gl,VERTEX_GAUSSIAN,FRAGMENT_REFERENCE),raw:program(gl,VERTEX_GAUSSIAN,FRAGMENT_STOCHASTIC),spatial:program(gl,VERTEX_SCREEN,FRAGMENT_SPATIAL),temporal:program(gl,VERTEX_SCREEN,FRAGMENT_TEMPORAL),display:program(gl,VERTEX_SCREEN,FRAGMENT_DISPLAY)};
  const vao=gl.createVertexArray(),quad=gl.createBuffer(),instances=gl.createBuffer(),screen=gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,quad);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,instances);
  const attrs=[[1,4,0],[2,4,4],[3,2,8],[4,2,10]];
  for(const [slot,components,offset] of attrs){gl.enableVertexAttribArray(slot);gl.vertexAttribPointer(slot,components,gl.FLOAT,false,12*4,offset*4);gl.vertexAttribDivisor(slot,1);}
  gl.bindVertexArray(null);
  const reference=target(gl,width,height),spatial=target(gl,width,height),temporals=[target(gl,width,height),target(gl,width,height)];
  const samples=Array.from({length:4},()=>({...target(gl,width,height,true),cameraX:0,cameraY:0}));
  const modelTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,modelTex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const queryExtension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let timerPending=null, gpuMs=null, frameIndex=0,activeTemporal=0,hasPriorTemporal=false,priorCamX=0,priorCamY=0,destroyed=false;
  let lastTargetIndices=null, lastGpuResult=null;
  const allTargets=[reference,spatial,...temporals,...samples];
  function ensure() {if(destroyed)throw new Error('SteadySplats GPU renderer destroyed');}
  function upload(models, sorted=false) {
    const list=sorted?[...models].sort((a,b)=>b.depth-a.depth):models;
    const data=new Float32Array(list.length*12);
    for(let i=0;i<list.length;i++){
      const g=list[i],offset=i*12,angle=g.angle||0;
      data.set([g.x,g.y,g.sx,g.sy,...g.color,g.opacity,g.depth,g.id,Math.cos(angle),Math.sin(angle)],offset);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,instances);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    return list.length;
  }
  function drawGaussians(prog,models,cameraX,cameraY) {
    gl.useProgram(prog);gl.uniform2f(uniform(gl,prog,'uSize'),width,height);gl.uniform2f(uniform(gl,prog,'uCamera'),cameraX,cameraY);
    gl.bindVertexArray(vao);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,models.length);gl.bindVertexArray(null);
  }
  function drawScreen(prog,destination) {
    gl.bindFramebuffer(gl.FRAMEBUFFER,destination?.fbo||null);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0,0,width,height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    gl.useProgram(prog);gl.bindVertexArray(screen);gl.drawArrays(gl.TRIANGLES,0,3);gl.bindVertexArray(null);
  }
  function renderFrame({models,frame=frameIndex,cameraX=0,cameraY=0,weight=temporalWeight}={}) {
    ensure();
    if(!Array.isArray(models)||models.length<1||models.length>Math.min(16384,gl.getParameter(gl.MAX_TEXTURE_SIZE)))throw new RangeError('WebGL2 experiment exceeds Gaussian GPU budget');
    if(![frame,cameraX,cameraY,weight].every(Number.isFinite)||weight<0||weight>0.99)throw new RangeError('Invalid GPU frame parameters');
    if(queryExtension && timerPending){
      if(gl.getQueryParameter(timerPending,gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(queryExtension.GPU_DISJOINT_EXT)){
        gpuMs=gl.getQueryParameter(timerPending,gl.QUERY_RESULT)/1e6;gl.deleteQuery(timerPending);timerPending=null;
      }
    }
    const begin=performance.now();
    const modelsWithIds=models.map((g,id)=>({...g,id}));
    const modelData=new Float32Array(modelsWithIds.length*4*3);
    for(let i=0;i<modelsWithIds.length;i++){
      const g=modelsWithIds[i],j=i*4,cos=Math.cos(g.angle||0),sin=Math.sin(g.angle||0);
      modelData.set([g.x,g.y,g.sx,g.sy],j);
      modelData.set([g.depth,g.opacity,g.color[0],g.color[1]],4*modelsWithIds.length+j);
      modelData.set([cos,sin,g.color[2],0],8*modelsWithIds.length+j);
    }
    bindUnit(gl,modelTex,8);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,models.length,3,0,gl.RGBA,gl.FLOAT,modelData);
    const currentSlot=frameIndex%4,sample=samples[currentSlot];
    const sampleRefs=[sample];
    for(let age=1;age<Math.min(frameIndex+1,historySize);age++)sampleRefs.push(samples[(frameIndex-age)%4]);
    sample.cameraX=cameraX;sample.cameraY=cameraY;
    // GPU elapsed time (not CPU wall time) is asynchronous to avoid readback stalls.
    const thisQuery=queryExtension&&!timerPending?gl.createQuery():null;
    if(thisQuery)gl.beginQuery(queryExtension.TIME_ELAPSED_EXT,thisQuery);
    gl.bindFramebuffer(gl.FRAMEBUFFER,reference.fbo);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0,0,width,height);gl.clearColor(...BACKGROUND,1);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    upload(modelsWithIds,true);drawGaussians(programs.reference,modelsWithIds,cameraX,cameraY);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER,sample.fbo);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR,0,new Float32Array([...BACKGROUND,1]));
    gl.clearBufferfv(gl.COLOR,1,new Float32Array([0,1,0,1]));
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);
    upload(modelsWithIds,false);
    gl.useProgram(programs.raw);
    gl.uniform1f(uniform(gl,programs.raw,'uFrame'),frame);
    drawGaussians(programs.raw,modelsWithIds,cameraX,cameraY);
    gl.disable(gl.DEPTH_TEST);

    const spatialProg=programs.spatial;
    gl.useProgram(spatialProg);
    for(let i=0;i<4;i++){
      bindUnit(gl,sampleRefs[i]?.color||sample.color,i);
      bindUnit(gl,sampleRefs[i]?.meta||sample.meta,4+i);
      gl.uniform1i(uniform(gl,spatialProg,'uRaw'+i),i);
      gl.uniform1i(uniform(gl,spatialProg,'uMeta'+i),4+i);
    }
    bindUnit(gl,modelTex,8);gl.uniform1i(uniform(gl,spatialProg,'uModels'),8);
    gl.uniform2i(uniform(gl,spatialProg,'uSize'),width,height);
    const cams=new Float32Array(8);
    for(let i=0;i<4;i++) {cams[2*i]=sampleRefs[i]?.cameraX||0;cams[2*i+1]=sampleRefs[i]?.cameraY||0;}
    gl.uniform2fv(uniform(gl,spatialProg,'uCameras[0]'),cams);
    gl.uniform1i(uniform(gl,spatialProg,'uCount'),sampleRefs.length);
    drawScreen(spatialProg,spatial);

    const prev=temporals[activeTemporal],next=temporals[1-activeTemporal];
    const temporalProg=programs.temporal;
    gl.useProgram(temporalProg);
    bindUnit(gl,spatial.color,0);bindUnit(gl,prev.color,1);
    gl.uniform1i(uniform(gl,temporalProg,'uSpatial'),0);
    gl.uniform1i(uniform(gl,temporalProg,'uPrevious'),1);
    gl.uniform2i(uniform(gl,temporalProg,'uSize'),width,height);
    gl.uniform2f(uniform(gl,temporalProg,'uMotion'),cameraX-priorCamX,cameraY-priorCamY);
    gl.uniform1f(uniform(gl,temporalProg,'uWeight'),weight);
    gl.uniform1i(uniform(gl,temporalProg,'uHasPrevious'),hasPriorTemporal?1:0);
    drawScreen(temporalProg,next);
    if(thisQuery){gl.endQuery(queryExtension.TIME_ELAPSED_EXT);timerPending=thisQuery;}
    activeTemporal=1-activeTemporal;hasPriorTemporal=true;priorCamX=cameraX;priorCamY=cameraY;
    // Visible A/B is intentionally a separate pass: does not enter GPU timer.
    const views=[reference.color,sample.color,spatial.color,next.color];
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.drawBuffers([gl.BACK]);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    gl.useProgram(programs.display);gl.uniform1i(uniform(gl,programs.display,'uImage'),0);
    gl.bindVertexArray(screen);
    for(let i=0;i<4;i++){
      gl.viewport((i%2)*width,(1-Math.floor(i/2))*height,width,height);
      bindUnit(gl,views[i],0);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.bindVertexArray(null);
    frameIndex++;
    const cpuSubmissionMs=performance.now()-begin;
    lastTargetIndices={reference,sample,spatial,temporal:next};
    lastGpuResult={frame,gaussians:models.length,cameraX,cameraY,cpuSubmissionMs,gpuMs};
    return {...lastGpuResult};
  }
  function read(targetObj) {
    const out=new Uint8Array(width*height*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,targetObj.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,out);
    return out;
  }
  function captureMetrics() {
    ensure();if(!lastTargetIndices)throw new Error('No GPU frame rendered');
    const ref=read(lastTargetIndices.reference);
    const images={raw:read(lastTargetIndices.sample),spatial:read(lastTargetIndices.spatial),temporal:read(lastTargetIndices.temporal)};
    const mse=Object.fromEntries(Object.entries(images).map(([name,pixels])=>[name,distortion(pixels,ref)]));
    const psnr=Object.fromEntries(Object.entries(mse).map(([name,value])=>[name,msToPsnr(value)]));
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {mse,psnr,images,reference:ref,device,...lastGpuResult};
  }
  function reset() {ensure();frameIndex=0;hasPriorTemporal=false;priorCamX=0;priorCamY=0;}
  function destroy() {
    if(destroyed)return;destroyed=true;
    for(const t of allTargets){gl.deleteFramebuffer(t.fbo);gl.deleteTexture(t.color);if(t.meta)gl.deleteTexture(t.meta);if(t.depth)gl.deleteRenderbuffer(t.depth);}
    gl.deleteTexture(modelTex);gl.deleteVertexArray(vao);gl.deleteVertexArray(screen);gl.deleteBuffer(quad);gl.deleteBuffer(instances);
    for(const p of Object.values(programs))gl.deleteProgram(p);
    if(timerPending)gl.deleteQuery(timerPending);
  }
  return {renderFrame,captureMetrics,reset,destroy,device,width,height};
}
