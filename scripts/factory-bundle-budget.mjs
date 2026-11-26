// Production asset budget. Raising a limit is a reviewed change to this file.
//   node scripts/factory-bundle-budget.mjs [dist] [result.json]
import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

// Measured at nightly 53f0caa6 (Node 24.22.2, Linux x64): total 80,939,371;
// JS gzip 7,456,194; largest JS gzip 2,796,702; entry JS gzip 4,498,737.
// Two builds of the same tree gave identical bytes. Limits are about 5% over.
export const LIMITS = Object.freeze({
  totalBytes: 85_000_000,
  jsGzipBytes: 7_850_000,
  largestJsGzipBytes: 3_000_000,
  entryJsGzipBytes: 4_750_000,
});

const out = process.argv[2] ?? 'dist';
const result = { totalBytes: 0, files: 0, jsFiles: 0, jsGzipBytes: 0, largestJsGzipBytes: 0, largestJs: null, entryJsGzipBytes: 0 };
assert.ok((await stat(join(out, 'index.html'))).isFile(), 'Missing production HTML');
const html = await readFile(join(out, 'index.html'), 'utf8');
const entries = new Set([...html.matchAll(/<script[^>]*\bsrc="\/?([^"]+\.m?js)"/g)].map((m) => m[1]));
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile()) {
      result.totalBytes += (await stat(file)).size;
      result.files++;
      if (!/\.m?js$/.test(item.name)) continue;
      const bytes = gzipSync(await readFile(file)).length;
      result.jsFiles++;
      result.jsGzipBytes += bytes;
      if (entries.has(relative(out, file).split('\\').join('/'))) result.entryJsGzipBytes += bytes;
      if (bytes > result.largestJsGzipBytes) {
        result.largestJsGzipBytes = bytes;
        result.largestJs = relative(out, file);
      }
    } else throw new Error(`Unexpected non-file artifact: ${file}`);
  }
}
await walk(out);
const report = { ...result, entries: [...entries], limits: LIMITS };
console.log(JSON.stringify(report, null, 2));
if (process.argv[3]) await writeFile(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
assert.ok(result.largestJs, 'No JavaScript found in production output');
assert.ok(entries.size > 0, 'No entry script in dist/index.html');
for (const [name, limit] of Object.entries(LIMITS)) {
  assert.ok(limit > 0, `${name} has no budget`);
  assert.ok(result[name] <= limit, `${name}: ${result[name]} > ${limit}`);
}
