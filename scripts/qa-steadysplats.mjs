import { performance } from 'node:perf_hooks';
import { createSteadySplatsExperiment } from '../src/experiments/steadysplats/renderer.js';

const trials = [
  { name: 'static', cameraX: () => 0 },
  { name: 'moving', cameraX: (frame) => 7 * Math.sin(frame * 0.035) },
];
for (const { name, cameraX } of trials) {
  const experiment = createSteadySplatsExperiment({ width: 128, height: 96 });
  const scores = { raw: 0, spatial: 0, temporal: 0 };
  const frames = 16;
  const start = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    const result = experiment.render({ frame, cameraX: cameraX(frame) });
    for (const key of Object.keys(scores)) scores[key] += result.scores[key] / frames;
  }
  const ms = (performance.now() - start) / frames;
  console.log(name, {
    averagePsnrDb: Object.fromEntries(Object.entries(scores).map(([key, val]) => [key, +val.toFixed(2)])),
    cpuMsPerFrame: +ms.toFixed(2),
  });
  if (scores.spatial <= scores.raw + 3) throw new Error(name + ': spatial reuse failed quality gate');
  if (scores.temporal <= scores.spatial) throw new Error(name + ': temporal reuse failed quality gate');
}
