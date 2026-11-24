// Run Cesium's own glTF pre-processing (removeUnusedElements) on a near-field tree GLB and report node counts.
import { createCellGenerator } from '../../src/data/nearField/cellJob.js';
import { readGlbJson } from '../../src/data/nearField/glb.js';
import { tileOf } from '../../src/data/nearField/tiling.js';
import removeUnusedElements from '../../node_modules/@cesium/engine/Source/Scene/GltfPipeline/removeUnusedElements.js';
import addDefaults from '../../node_modules/@cesium/engine/Source/Scene/GltfPipeline/addDefaults.js';
const gen = createCellGenerator();
const out = await gen.generate({ cell: tileOf(37.8555, -122.489, 16), ground: { n: 9, spacing: 80, half: 320, heights: new Array(81).fill(0), centre: 0, offset: 0 }, kit: 'norse' });
const j = readGlbJson(out.trees);
console.log('before', j.nodes.length, j.meshes.length, j.accessors.length);
addDefaults(j);
removeUnusedElements(j, ['mesh', 'node', 'material', 'accessor', 'bufferView', 'buffer']);
console.log('after', j.nodes.length, j.meshes.length, j.accessors.length, JSON.stringify(j.nodes[1] ?? null));
