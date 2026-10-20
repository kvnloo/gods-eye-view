// Browser GPU vs software provenance harness. CI fails rather than inventing GPU performance.
import { spawn, execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const requireHardware = process.argv.includes('--require-hardware');
const port = Number(process.env.GEV_GPU_QA_PORT || 4269);
const output = path.resolve(process.env.GEV_GPU_QA_OUTPUT || 'artifacts/steadysplats-webgl');
const base = `http://127.0.0.1:${port}`;
const executablePath = process.env.CHROME_BIN || process.env.PUPPETEER_EXECUTABLE_PATH || (()=>{
  for(const name of ['google-chrome','chromium','chromium-browser']){
    try{return execFileSync('which',[name],{encoding:'utf8'}).trim();}catch{}
  }
  try {const cached=puppeteer.executablePath();if(existsSync(cached))return cached;}catch{}
  return undefined;
})();
if(!executablePath)throw new Error('Chrome/Chromium not installed; cannot claim a browser test');
await mkdir(output,{recursive:true});
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
let serverLog='';
for(const stream of [dev.stdout,dev.stderr])stream.on('data',(part)=>serverLog+=String(part));
let browser;
try {
  let ready=false;
  for(let i=0;i<80;i++){
    if(dev.exitCode!==null)throw new Error('Vite exited: '+serverLog.slice(-2000));
    try{const resp=await fetch(base);if(resp.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error('Vite failed to listen: '+serverLog.slice(-2000));
  const args=['--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-webgl','--ignore-gpu-blocklist'];
  if(process.platform==='linux')args.push('--no-sandbox');
  if(!requireHardware && process.platform==='linux')args.push('--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  browser=await puppeteer.launch({headless:true,executablePath,args});
  const page=await browser.newPage();
  await page.setViewport({width:1180,height:1100,deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',(e)=>errors.push(String(e)));
  page.on('console',(msg)=>{if(msg.type()==='error')errors.push(msg.text());});
  await page.goto(base+'/?experiment=steadysplats-gpu',{waitUntil:'domcontentloaded',timeout:40000});
  await page.waitForFunction('window.__gevSteadySplatsGpuQa != null',{timeout:50000});
  await page.waitForSelector('#ss-report');
  const checks=[];
  for(const [name,moving] of [['static',false],['pan',true]]) {
    await page.$eval('#ss-motion',(input,moving)=>{input.checked=moving;input.dispatchEvent(new Event('change',{bubbles:true}));},moving);
    let result;
    const cpu=[];
    for(let i=0;i<25;i++){
      result=await page.evaluate(()=>{
        const qa=window.__gevSteadySplatsGpuQa;
        const m=qa.render();
        return {psnr:m.psnr,device:m.device,gaussians:m.gaussians,cpuSubmissionMs:m.cpuSubmissionMs,gpuMs:m.gpuMs};
      });
      cpu.push(result.cpuSubmissionMs);
    }
    await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
    const sorted=cpu.sort((a,b)=>a-b);
    checks.push({name,psnr:result.psnr,gaussians:result.gaussians,cpuSubmitMsP50:sorted[12],cpuSubmitMsP95:sorted[23],gpuTimerMs:result.gpuMs});
    if(!Number.isFinite(result.psnr.raw)||!Number.isFinite(result.psnr.spatial)||!Number.isFinite(result.psnr.temporal))throw new Error('Nonfinite image quality metrics');
    if(result.gaussians<50)throw new Error('Too few projected splats');
  }
  const device=await page.evaluate(()=>window.__gevSteadySplatsGpuQa.getDevice());
  const report={date:new Date().toISOString(),device,backend:device.software?'software':'hardware-candidate',confirmedHardware:!device.software,checks,errors};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(errors.length)throw new Error('Browser console errors: '+errors.join(' | ').slice(0,1500));
  if(requireHardware && device.software)throw new Error('GPU required but the browser used software rasterization');
  if(requireHardware && !/NVIDIA|AMD|Radeon|Apple|Intel|Mali|Adreno/i.test(device.renderer+' '+device.vendor))
    throw new Error('GPU identity not verifiable from WebGL driver');
} finally {
  if(browser)await browser.close();
  dev.kill('SIGTERM');
}
