import { createSteadySplatsExperiment } from './renderer.js';

const SIZE = { width: 128, height: 96 };
const CHANNELS = [
  ['reference', 'Sorted alpha reference'],
  ['raw', 'Stochastic (1 spp)'],
  ['spatial', 'K-history spatial reuse'],
  ['output', 'Spatial + temporal reuse'],
];
const STYLES = `
  body { margin: 0; background: #080e19; color: #dce5f5; font-family: Inter, system-ui, sans-serif; }
  .ss-lab { max-width: 1240px; margin: 0 auto; padding: 28px 24px 72px; }
  .ss-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 13px; }
  .ss-top a { color: #92d5ff; text-decoration: none; }
  .ss-kicker { color: #b3ceea; font: 600 11px ui-monospace, monospace; letter-spacing: .16em; }
  .ss-lab h1 { margin: 42px 0 8px; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.035em; }
  .ss-intro { color: #acbbd1; line-height: 1.6; max-width: 720px; margin: 0 0 26px; }
  .ss-panel { border: 1px solid #314159; background: #111b2b; border-radius: 14px; padding: 18px; margin-bottom: 24px; }
  .ss-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 18px; }
  .ss-controls label { display: grid; gap: 8px; color: #bdcce2; font-size: 12px; }
  .ss-controls .ss-check { display: flex; align-items: center; gap: 8px; }
  .ss-controls button { cursor: pointer; background: #253c59; color: white; border: 1px solid #516782; border-radius: 7px; padding: 9px 14px; }
  .ss-controls input { accent-color: #78cde9; }
  .ss-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .ss-frame { border: 1px solid #314159; background: #111b2b; border-radius: 12px; overflow: hidden; }
  .ss-frame header { padding: 13px 15px; display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .ss-frame h2 { font-size: 13px; margin: 0; font-weight: 600; }
  .ss-score { color: #a8f0d1; font: 12px ui-monospace, monospace; }
  .ss-frame canvas { width: 100%; aspect-ratio: 4/3; height: auto; display: block; image-rendering: pixelated; background: #090e19; }
  .ss-stats { color: #adbdd5; font: 12px ui-monospace, monospace; margin-top: 18px; line-height: 1.6; }
  .ss-note { color: #7f92ad; font-size: 12px; line-height: 1.6; margin-top: 24px; }
  @media (max-width: 640px) { .ss-grid { grid-template-columns: 1fr; } .ss-lab { padding: 20px 14px 60px; } }
`;

/** Opt-in diagnostics only: never mutates Cesium or its render pipeline. */
export function startSteadySplatsExperiment(parent = document.body) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('main');
  root.className = 'ss-lab';
  root.innerHTML = `
    <nav class="ss-top"><a href="/">← God's Eye View</a><span class="ss-kicker">DOWNSTREAM RENDERING LAB / CPU REFERENCE</span></nav>
    <h1>SteadySplats</h1>
    <p class="ss-intro">A controlled experiment with stochastic Gaussian visibility,
      history-based spatial importance weights, and motion-aware temporal reuse.
      These are synthetic projected Gaussians, not Cesium tiles or pretrained splats.</p>
    <section class="ss-panel ss-controls" aria-label="Experiment controls">
      <label>History K <output id="ss-k-out">4</output>
        <input id="ss-k" type="range" min="1" max="8" step="1" value="4" /></label>
      <label>Temporal weight <output id="ss-weight-out">0.70</output>
        <input id="ss-weight" type="range" min="0" max="95" step="5" value="70" /></label>
      <label class="ss-check"><input id="ss-motion" type="checkbox" /> Pan camera (reprojection)</label>
      <button type="button" id="ss-pause">Pause</button>
      <button type="button" id="ss-reset">Reset history</button>
    </section>
    <div class="ss-grid" aria-label="Four-way stochastic rendering comparison">
      ${CHANNELS.map(([id, label]) => `<section class="ss-frame"><header><h2>${label}</h2><span class="ss-score" id="ss-score-${id}"></span></header><canvas id="ss-${id}" width="${SIZE.width}" height="${SIZE.height}" aria-label="${label}"></canvas></section>`).join('')}
    </div>
    <p class="ss-stats" id="ss-stats" aria-live="off"></p>
    <p class="ss-note">PSNR compares each method with the exact sorted-alpha reference
      for this synthetic scene; these numbers are not the paper's benchmarks.
      The K-buffer is estimated from recently visible Gaussian IDs. Training-time
      variance regularization, GPU rendering and real 3DGS/Cesium integration remain future steps.
      <a href="https://arxiv.org/abs/2610.05576" rel="noopener noreferrer" target="_blank">Windisch et al. (2026)</a>.</p>`;
  parent.replaceChildren(style, root);

  const byId = (id) => root.querySelector('#' + id);
  const contexts = Object.fromEntries(CHANNELS.map(([id]) => [
    id,
    byId('ss-' + id).getContext('2d', { alpha: false }),
  ]));
  let historySize = 4;
  let historyWeight = 0.7;
  let experiment = createSteadySplatsExperiment({ ...SIZE, historySize, historyWeight });
  let frame = 0;
  let running = true;
  let disposed = false;
  let animationId;
  let lastPaint = -Infinity;
  let previousReference;
  let previousChannels;

  function redraw(canvas, image) {
    const data = canvas.createImageData(SIZE.width, SIZE.height);
    for (let p = 0; p < image.length; p++) {
      data.data[(Math.floor(p / 3) * 4) + (p % 3)] =
        Math.round(255 * Math.pow(Math.max(0, Math.min(1, image[p])), 1 / 2.2));
    }
    for (let p = 0; p < SIZE.width * SIZE.height; p++) data.data[p * 4 + 3] = 255;
    canvas.putImageData(data, 0, 0);
  }

  function temporalPsnr(current, previous, reference, priorReference) {
    if (!previous || !priorReference) return '–';
    let mse = 0;
    for (let i = 0; i < current.length; i++) {
      const delta = (current[i] - previous[i]) - (reference[i] - priorReference[i]);
      mse += delta * delta;
    }
    mse /= current.length;
    return mse ? (-10 * Math.log10(mse)).toFixed(1) : '∞';
  }

  function reset() {
    experiment = createSteadySplatsExperiment({ ...SIZE, historySize, historyWeight });
    frame = 0;
    previousReference = null;
    previousChannels = null;
    paint();
  }

  function paint() {
    const begin = performance.now();
    const cameraX = byId('ss-motion').checked ? 7 * Math.sin(frame * 0.035) : 0;
    const result = experiment.render({ frame, cameraX, temporalWeight: historyWeight });
    for (const [id] of CHANNELS) {
      redraw(contexts[id], result[id]);
      const score = byId('ss-score-' + id);
      score.textContent = id === 'reference' ? 'GROUND TRUTH' :
        result.scores[id === 'output' ? 'temporal' : id].toFixed(1) + ' dB';
    }
    const tRaw = temporalPsnr(result.raw, previousChannels?.raw, result.reference, previousReference);
    const tSpatial = temporalPsnr(result.spatial, previousChannels?.spatial, result.reference, previousReference);
    const tTemporal = temporalPsnr(result.output, previousChannels?.output, result.reference, previousReference);
    const elapsed = performance.now() - begin;
    byId('ss-stats').textContent =
      'Frame ' + frame + ' · compute ' + elapsed.toFixed(1) + ' ms · K=' + historySize +
      ' · tPSNR raw/spatial/temporal: ' + tRaw + ' / ' + tSpatial + ' / ' + tTemporal + ' dB';
    previousReference = result.reference;
    previousChannels = { raw: result.raw, spatial: result.spatial, output: result.output };
    frame++;
  }

  function tick(now) {
    if (disposed) return;
    if (running && now - lastPaint >= 100) {
      paint();
      lastPaint = now;
    }
    animationId = requestAnimationFrame(tick);
  }

  const historyControl = byId('ss-k');
  historyControl.addEventListener('input', () => {
    historySize = Number(historyControl.value);
    byId('ss-k-out').textContent = String(historySize);
    reset();
  });
  const temporalControl = byId('ss-weight');
  temporalControl.addEventListener('input', () => {
    historyWeight = Number(temporalControl.value) / 100;
    byId('ss-weight-out').textContent = historyWeight.toFixed(2);
    reset();
  });
  byId('ss-motion').addEventListener('change', reset);
  byId('ss-reset').addEventListener('click', reset);
  byId('ss-pause').addEventListener('click', () => {
    running = !running;
    byId('ss-pause').textContent = running ? 'Pause' : 'Resume';
  });
  paint();
  animationId = requestAnimationFrame(tick);
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationId);
    window.removeEventListener('pagehide', destroy);
  };
  window.addEventListener('pagehide', destroy);
  return { destroy, reset };
}
