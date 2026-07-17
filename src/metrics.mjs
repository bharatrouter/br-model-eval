// Aggregate results/raw/<tag>.jsonl -> results/summary.json: the numbers behind every
// chart. Per model × axis: accuracy + Wilson 95% CI, ₹/correct, TTFT, throughput,
// tokens-to-answer, consistency (pass@1 vs pass@k), failure-mode breakdown, realized
// provider split. Everything deterministic from the raw rows.
//
//   node src/metrics.mjs <tag>     (defaults to the newest raw file)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'results', 'raw');

let tag = process.argv[2];
if (!tag) {
  const files = readdirSync(RAW).filter(f => f.endsWith('.jsonl'));
  files.sort();
  tag = files.at(-1)?.replace(/\.jsonl$/, '');
}
if (!tag) { console.error('no raw files'); process.exit(1); }
const rows = readFileSync(join(RAW, `${tag}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

// Wilson score interval for a binomial proportion (95%).
function wilson(k, n) {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = a => a.reduce((x, y) => x + y, 0);

const models = [...new Set(rows.map(r => r.model))];
const axes = [...new Set(rows.map(r => r.axis))];

const summary = { tag, at: new Date().toISOString(), models, axes, cells: {}, overall: {} };

for (const model of models) {
  for (const axis of axes) {
    const rs = rows.filter(r => r.model === model && r.axis === axis);
    if (!rs.length) continue;
    const ok = rs.filter(r => !r.err); // calls that returned something to grade
    const passes = rs.filter(r => r.pass).length;
    // per-item consistency: group by item, pass@1 = mean pass, pass@k = any pass
    const byItem = {};
    for (const r of rs) (byItem[r.itemId] ??= []).push(r);
    const items = Object.values(byItem);
    const passAt1 = items.length ? sum(items.map(g => sum(g.map(r => r.pass ? 1 : 0)) / g.length)) / items.length : 0;
    const passAtK = items.length ? items.filter(g => g.some(r => r.pass)).length / items.length : 0;
    const flaky = items.filter(g => g.length > 1 && g.some(r => r.pass) && g.some(r => !r.pass)).length;

    const w = wilson(passes, rs.length);
    const failures = {};
    for (const r of rs) if (r.failure) failures[r.failure] = (failures[r.failure] || 0) + 1;
    const provSplit = {};
    for (const r of rs) if (r.provider) provSplit[r.provider] = (provSplit[r.provider] || 0) + 1;

    const totalCost = sum(rs.map(r => r.costINR));
    summary.cells[`${model}|${axis}`] = {
      model, axis, n: rs.length, items: items.length,
      accuracy: +w.p.toFixed(4), ci_lo: +w.lo.toFixed(4), ci_hi: +w.hi.toFixed(4),
      passAt1: +passAt1.toFixed(4), passAtK: +passAtK.toFixed(4), flakyItems: flaky,
      costINR: +totalCost.toFixed(3),
      inrPerCorrect: passes ? +(totalCost / passes).toFixed(3) : null,
      medTtftMs: median(ok.map(r => r.ttftMs || 0)),
      medTotalMs: median(ok.map(r => r.totalMs || 0)),
      medDecodeTokPerSec: median(ok.map(r => r.decodeTokPerSec || 0)),
      medOutTok: median(ok.map(r => r.outTok || 0)),
      medReasoningTok: median(ok.map(r => r.reasoningTok || 0)),
      failures, providerSplit: provSplit,
      errors: rs.filter(r => r.err).length,
    };
  }
  // overall per model (micro-average across all rows)
  const rs = rows.filter(r => r.model === model);
  const passes = rs.filter(r => r.pass).length;
  const w = wilson(passes, rs.length);
  const totalCost = sum(rs.map(r => r.costINR));
  summary.overall[model] = {
    n: rs.length, accuracy: +w.p.toFixed(4), ci_lo: +w.lo.toFixed(4), ci_hi: +w.hi.toFixed(4),
    costINR: +totalCost.toFixed(2), inrPerCorrect: passes ? +(totalCost / passes).toFixed(3) : null,
    medTtftMs: median(rs.filter(r => !r.err).map(r => r.ttftMs || 0)),
    medDecodeTokPerSec: median(rs.filter(r => !r.err).map(r => r.decodeTokPerSec || 0)),
    errors: rs.filter(r => r.err).length,
  };
}

const outPath = join(ROOT, 'results', 'summary.json');
writeFileSync(outPath, JSON.stringify(summary, null, 2));

// console table
console.error(`\n=== ${tag} ===`);
for (const model of models) {
  const o = summary.overall[model];
  console.error(`${model.padEnd(16)} acc ${(o.accuracy * 100).toFixed(1)}% [${(o.ci_lo * 100).toFixed(0)}-${(o.ci_hi * 100).toFixed(0)}]  ₹/correct ${o.inrPerCorrect ?? '—'}  ttft ${o.medTtftMs}ms  ${o.medDecodeTokPerSec}tok/s  err ${o.errors}`);
}
for (const axis of axes) {
  console.error(`  -- ${axis} --`);
  for (const model of models) {
    const c = summary.cells[`${model}|${axis}`]; if (!c) continue;
    console.error(`    ${model.padEnd(16)} ${(c.accuracy * 100).toFixed(1)}% (${c.n}n) ₹/ok ${c.inrPerCorrect ?? '—'} p@1 ${(c.passAt1*100).toFixed(0)} p@k ${(c.passAtK*100).toFixed(0)}`);
  }
}
console.log(`wrote ${outPath}`);
