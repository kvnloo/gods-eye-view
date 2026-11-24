/**
 * FORK-ONLY (exp/near-field-v0). Near-field mesh worker: generates cells off
 * the main thread (cellJob.js) and transfers the GLB bytes back.
 */
import { createCellGenerator } from './cellJob.js';

const generator = createCellGenerator();

self.onmessage = async (event) => {
  const { id, job } = event.data ?? {};
  try {
    const out = await generator.generate(job);
    const transfer = [out.main?.buffer, out.trees?.buffer].filter(Boolean);
    self.postMessage({ id, ok: true, out, data: { ...generator.stats } }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
};
