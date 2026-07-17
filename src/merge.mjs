// Merge raw rows from two runs into one tagged result: take the "keep" axes from the base
// run and the rest from the override run. Used after re-running fixed axes (coding, needle)
// without paying to re-run the axes that were already valid (math, indic, ifeval).
//   node src/merge.mjs <baseTag> <overrideTag> <mergedTag> <overrideAxis1,overrideAxis2,...>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = t => readFileSync(join(ROOT, 'results', 'raw', `${t}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

const [baseTag, overrideTag, mergedTag, axesCsv] = process.argv.slice(2);
const overrideAxes = new Set(axesCsv.split(','));

const base = raw(baseTag).filter(r => !overrideAxes.has(r.axis));  // keep non-overridden axes
const over = raw(overrideTag).filter(r => overrideAxes.has(r.axis)); // take overridden axes
const merged = [...base, ...over].map(r => ({ ...r, tag: mergedTag }));

const out = join(ROOT, 'results', 'raw', `${mergedTag}.jsonl`);
writeFileSync(out, merged.map(r => JSON.stringify(r)).join('\n') + '\n');

const byAxis = {};
for (const r of merged) byAxis[r.axis] = (byAxis[r.axis] || 0) + 1;
console.error(`merged ${merged.length} rows -> ${mergedTag}  (base non-[${axesCsv}] + override [${axesCsv}])`);
console.error('by axis:', JSON.stringify(byAxis));
