// Gate between smoke and the full run. Asserts the pipeline actually works on real output
// before we spend on the full run. Exit 0 => proceed; exit 1 => stop (something's broken).
//   node src/check_smoke.mjs <tag>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MODELS } from './catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2];
const rows = readFileSync(join(ROOT, 'results', 'raw', `${tag}.jsonl`), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); else console.error(`  ✓ ${msg}`); };

ok(rows.length > 0, `rows written (${rows.length})`);
for (const m of MODELS) {
  const mr = rows.filter(r => r.model === m.id);
  ok(mr.some(r => !r.err), `${m.id}: at least one non-error response`);
  ok(mr.some(r => r.provider), `${m.id}: realized provider recorded`);
}
// graders actually discriminate: at least one pass AND the exec grader ran on code
ok(rows.some(r => r.axis === 'coding' && !r.err), 'coding: calls returned to grade');
ok(rows.some(r => r.pass), 'at least one item graded as pass (graders not all-fail)');
ok(rows.some(r => r.axis === 'coding' && r.pass) || rows.some(r => r.axis === 'coding' && r.reason),
   'coding exec grader produced a verdict');
ok(rows.every(r => typeof r.costINR === 'number'), 'cost computed on every row');
ok(rows.reduce((s, r) => s + r.costINR, 0) > 0, 'total computed cost > 0');
ok(rows.some(r => r.axis === 'ifeval'), 'ifeval axis present');

if (fail.length) {
  console.error(`\nSMOKE ASSERTIONS FAILED (${fail.length}):`);
  for (const f of fail) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.error(`\nSmoke assertions PASSED (${rows.length} rows). Proceeding to full run.`);
