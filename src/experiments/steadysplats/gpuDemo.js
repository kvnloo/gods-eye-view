import {createGpuSteadySplats} from './gpuRenderer.js';
import {parseGaussianPly,createProceduralGaussians3D,projectGaussians3D} from './gpuScene.js';

const W=256,H=192;
const CSS=`
  body{background:#090d18;color:#dae7f5;margin:0;font-family:Inter,system-ui,sans-serif;}
  .ss-gpu{max-width:1190px;margin:auto;padding:24px;}
  .ss-gpu a{color:#74cdeb}.ss-gpu h1{font-size:clamp(28px,4.2vw,50px);letter-spacing:-.04em;margin:30px 0 6px}
  .ss-gpu .ss-muted{color:#aab8cb;line-height:1.5;font-size:14px;max-width:860px}
  .ss-gpu .ss-controls{background:#142039;border:1px solid #344862;border-radius:12px;display:flex;flex-wrap:wrap;gap:20px;padding:16px;align-items:center;margin:20px 0}
  .ss-gpu label{display:flex;align-items:center;gap:8px;font-size:13px}.ss-gpu button{border:1px solid #537392;color:#fff;background:#243f57;border-radius:6px;padding:9px 16px;cursor:pointer}
  .ss-gpu input{accent-color:#6ee3bf}.ss-gpu canvas{display:block;width:100%;height:auto;border:1px solid #344862;border-radius:10px;image-rendering:auto;background:#141d2e;}
  .ss-gpu .ss-panels{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#b7c5d7;margin:15px 2px 8px;text-align:center;}
  .ss-gpu pre{white-space:pre-wrap;line-height:1.6;background:#142039;padding:15px;border-radius:10px;overflow-wrap:anywhere;font-size:12px}
  .ss-gpu .ss-warning{color:#efc88b;}
`;

/** A real WebGL2 lab; device provenance is always displayed and machine-readable. */
export function startSteadySplatsGpuDemo(parent=document.body) {
  const style=document.createElement('style');style.textContent=CSS;
  const root=document.createElement('main');root.className='ss-gpu';
  root.innerHTML=`<a href="/">← God's Eye View</a><h1>SteadySplats / GPU Lab</h1>
    <p class="ss-muted">Instanced WebGL2 stochastic 3D Gaussian splats, depth-buffered
    order-independent visibility, shader-based spatial resampling, motion-reprojected temporal reuse,
    and sorted-alpha reference. Isolated from Cesium and not the paper's Vulkan renderer.</p>
    <div class="ss-controls">
      <label>Gaussians <select id="ss-cloud"><option value="120">120</option><option value="350" selected>350</option><option value="900">900</option><option value="2000">2000</option></select></label>
      <label>History <select id="ss-history"><option value="1">1</option><option value="2">2</option><option value="4" selected>4</option></select></label>
      <label>Temporal <input id="ss-weight" type="range" min="0" max="95" value="65" step="5"><output id="ss-value">0.65</output></label>
      <label><input type="checkbox" id="ss-motion" checked> Camera pan</label>
      <label>Load 3DGS PLY <input type="file" id="ss-ply" accept=".ply"></label>
      <button id="ss-pause">Pause</button><button id="ss-reset">Reset</button>
    </div>
    <div class="ss-panels"><span>Sorted-alpha reference</span><span>Stochastic visibility (1 spp)</span></div>
    <canvas id="ss-gpu-canvas" width="${W*2}" height="${H*2}" aria-label="Four-way WebGL2 splat rendering comparison"></canvas>
    <div class="ss-panels"><span>GPU spatial reuse</span><span>GPU spatial + temporal</span></div>
    <pre id="ss-report" aria-live="off"></pre>
    <p class="ss-muted ss-warning">The synthetic or user-provided PLY scene runs on the actual WebGL2 backend reported above.
    SwiftShader / llvmpipe are software implementations, useful for correctness but NOT hardware GPU performance evidence.
    The prototype omits training-time regularization and Vulkan's exact importance-resampling algorithm.
    Paper: <a href="https://arxiv.org/abs/2610.05576">Windisch et al. (2026)</a>.</p>`;
  parent.replaceChildren(style,root);
  const byId=(id)=>root.querySelector('#'+id);
  let cloud=createProceduralGaussians3D(350),models=projectGaussians3D(cloud,W,H);
  let renderer;
  let frame=0,history=4,weight=0.65,playing=true,disposed=false,lastPaint=0,raf=0,lastMetrics=null;
  const report=byId('ss-report');
  function create() {
    renderer?.destroy(); renderer=createGpuSteadySplats(byId('ss-gpu-canvas'),{width:W,height:H,historySize:history,temporalWeight:weight});
    frame=0;
    const device=renderer.device;
    byId('ss-gpu-canvas').dataset.renderer=device.renderer;
    byId('ss-gpu-canvas').dataset.software=String(device.software);
  }
  function update() {
    const camX=byId('ss-motion').checked?3.6*Math.sin(frame*0.035):0;
    const stats=renderer.renderFrame({models,frame,cameraX:camX,weight});
    if(frame%4===0 || !lastMetrics)lastMetrics=renderer.captureMetrics();
    report.textContent=`WebGL2 renderer: ${renderer.device.renderer}\nVendor: ${renderer.device.vendor}\nExecution: ${renderer.device.software?'SOFTWARE (no hardware GPU evidence)':'HARDWARE CANDIDATE (check runner GPU counters)'}\nGaussians (projected): ${models.length} | Frame: ${frame}\nCPU submission: ${stats.cpuSubmissionMs.toFixed(2)} ms | GPU timer: ${stats.gpuMs==null?'pending/unavailable':stats.gpuMs.toFixed(2)+' ms'}\nPSNR (dB) vs GPU sorted-alpha: raw ${lastMetrics.psnr.raw.toFixed(2)} | spatial ${lastMetrics.psnr.spatial.toFixed(2)} | temporal ${lastMetrics.psnr.temporal.toFixed(2)}`;
    frame++;
  }
  function tick(now) {
    if(disposed)return;
    if(playing&&now-lastPaint>=125){update();lastPaint=now;}
    raf=requestAnimationFrame(tick);
  }
  create(); update();raf=requestAnimationFrame(tick);
  byId('ss-pause').addEventListener('click',()=>{playing=!playing;byId('ss-pause').textContent=playing?'Pause':'Resume';});
  byId('ss-motion').addEventListener('change',()=>renderer.reset());
  byId('ss-history').addEventListener('change',(event)=>{history=Number(event.target.value);create();update();});
  byId('ss-weight').addEventListener('input',(event)=>{weight=Number(event.target.value)/100;byId('ss-value').textContent=weight.toFixed(2);renderer.reset();});
  byId('ss-cloud').addEventListener('change',(event)=>{cloud=createProceduralGaussians3D(Number(event.target.value));models=projectGaussians3D(cloud,W,H);renderer.reset();});
  byId('ss-ply').addEventListener('change',async(event)=>{
    try{
      const file=event.target.files?.[0];if(!file)return;
      if(file.size>100_000_000)throw new RangeError('PLY file exceeds 100 MB experiment limit');
      cloud=parseGaussianPly(await file.arrayBuffer(),{maxGaussians:250000});
      // Recenter asset to camera coordinates without changing its colors/scales.
      const xs=cloud.map(x=>x.x),ys=cloud.map(x=>x.y),zs=cloud.map(x=>x.z);
      const bounds=[xs,ys,zs].map(a=>[Math.min(...a.slice(0,50000)),Math.max(...a.slice(0,50000))]);
      const center=bounds.map(([lo,hi])=>(lo+hi)/2);
      const span=Math.max(...bounds.map(([lo,hi])=>hi-lo),0.01);
      const factor=3.4/span;
      cloud=cloud.map(g=>({...g,x:(g.x-center[0])*factor,y:(g.y-center[1])*factor,z:4.0+(g.z-center[2])*factor,scale:g.scale.map(x=>x*factor)}));
      models=projectGaussians3D(cloud,W,H).slice(0,2000);
      if(!models.length)throw new Error('PLY projected no visible Gaussians');
      renderer.reset();update();
    }catch(e){report.textContent=`PLY load failed: ${e.message}`;}
  });
  byId('ss-reset').addEventListener('click',()=>{renderer.reset();frame=0;update();});
  const destroy=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(raf);renderer.destroy();window.removeEventListener('pagehide',destroy);};
  window.addEventListener('pagehide',destroy);
  // QA API is only reachable via the explicitly opted-in development route.
  return {destroy,render:()=>{update();return lastMetrics;},getMetrics:()=>renderer.captureMetrics(),getDevice:()=>renderer.device,getSceneCount:()=>models.length};
}
