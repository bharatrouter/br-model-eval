// Aggregate results-*.jsonl → per (arm × model): solve-rate, realized ₹/task (cache-aware),
// cache-cold ₹/task (ceiling), cache-hit %, median secs.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => a.length ? sum(a) / a.length : null;

const groups = {};
for (const r of rows) (groups[`${r.arm} · ${r.label}`] ??= []).push(r);

console.log('\n=== Agentic benchmark — realized (cache-aware) ₹/task ===');
console.log(`${'arm · model'.padEnd(26)} ${'solve'.padStart(6)} ${'₹/task'.padStart(8)} ${'₹cold'.padStart(8)} ${'cache%'.padStart(7)} ${'med s'.padStart(6)}`);
for (const [g, rs] of Object.entries(groups)) {
  const solved = rs.filter(r => r.status === 'pass').length;
  const rate = solved / rs.length;
  const costed = rs.filter(r => r.inr != null);
  const inrTask = avg(costed.map(r => r.inr));
  const coldTask = avg(costed.map(r => r.inrColdList));
  const cacheHit = avg(costed.map(r => r.cacheHitPct));
  const f = (v, p = '₹') => v == null ? '—' : p + v.toFixed(2);
  console.log(`${g.padEnd(26)} ${(rate * 100).toFixed(0).padStart(5)}% ${f(inrTask).padStart(8)} ${f(coldTask).padStart(8)} ${(cacheHit == null ? '—' : cacheHit.toFixed(0) + '%').padStart(7)} ${String(med(rs.map(r => r.secs))).padStart(6)}`);
}

console.log('\n=== per task (pass/fail) ===');
const tasks = [...new Set(rows.map(r => r.task))];
for (const g of Object.keys(groups)) {
  const line = tasks.map(t => {
    const rs = groups[g].filter(r => r.task === t);
    if (!rs.length) return `${t}:—`;
    return `${t}:${rs.filter(r => r.status === 'pass').length}/${rs.length}`;
  }).join('  ');
  console.log(`  ${g.padEnd(26)} ${line}`);
}

console.log('\n=== token mix (avg per task) ===');
console.log(`${'arm · model'.padEnd(26)} ${'uncached'.padStart(9)} ${'cache-rd'.padStart(9)} ${'cache-wr'.padStart(9)} ${'output'.padStart(8)}`);
for (const [g, rs] of Object.entries(groups)) {
  const costed = rs.filter(r => r.inr != null);
  const n = x => (avg(costed.map(r => r[x])) ?? 0).toFixed(0);
  console.log(`${g.padEnd(26)} ${n('inTok').padStart(9)} ${n('cacheRead').padStart(9)} ${n('cacheCreate').padStart(9)} ${n('outTok').padStart(8)}`);
}

const approx = rows.some(r => r.tokApprox);
if (approx) console.log('\nNote: codex ₹ is cache-cold approximate (total tokens split 72/28 in/out, no cache breakdown). Claude Code arms are cache-aware exact.');
