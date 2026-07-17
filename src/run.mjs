// Orchestrator: load axis datasets, fan out over models × items × samples through BR,
// grade deterministically, stream rows to results/raw/<tag>.jsonl. Never blends providers
// (realized x-br-provider is on every row). Hard budget ceiling so an unattended run can't
// overspend. Reasoning axes (coding, math) run 2 samples at temp>0 for pass@k + consistency.
//
//   BR_API_KEY=... node src/run.mjs --mode smoke|half [--cap 35000] [--tag mytag]

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MODELS } from './catalog.mjs';
import { call } from './br.mjs';
import { costINR } from './cost.mjs';
import { grade } from './grade.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'datasets', 'data');
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const MODE = argOf('--mode', 'smoke');
const CAP = Number(argOf('--cap', MODE === 'smoke' ? 800 : 35000));
const TAG = argOf('--tag', `${MODE}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const POOL = Number(argOf('--pool', 5));

// axis -> { n items, samples, maxTokens }. Reasoning models (Kimi, Sol) can emit tens of
// thousands of hidden reasoning tokens on hard math — the cap must be generous or they get
// truncated mid-thought and fail (a measurement artifact, not a capability gap). Full run is
// right-sized so it finishes overnight; the ₹ cap in run() is the hard backstop.
const PLAN = MODE === 'smoke'
  ? {
      coding: { n: 3, samples: 1, max: 6000 },
      math:   { n: 3, samples: 1, max: 20000 },
      indic:  { n: 3, samples: 1, max: 4000 },
      ifeval: { n: 3, samples: 1, max: 3000 },
      needle: { n: 3, samples: 1, max: 2000 },
    }
  : {
      coding: { n: 80, samples: 1, max: 6000 },
      math:   { n: 15, samples: 1, max: 20000 },   // AIME 2025 paper I (15 problems)
      indic:  { n: 60, samples: 1, max: 4000 },
      ifeval: { n: 20, samples: 1, max: 3000 },
      needle: { n: 15, samples: 1, max: 2000 },
    };

function loadAxis(axis, n) {
  const items = JSON.parse(readFileSync(join(DATA, `${axis}.json`), 'utf8'));
  return items.slice(0, n); // deterministic slice (datasets pre-shuffled where relevant)
}

// optional axis filter (re-run a subset, e.g. --axes coding,needle)
const ONLY_AXES = argOf('--axes', null)?.split(',');
// optional model filter (--models gpt-5.6-sol,kimi-k3)
const ONLY_MODELS = argOf('--models', null)?.split(',');
const RUN_MODELS = ONLY_MODELS ? MODELS.filter(m => ONLY_MODELS.includes(m.id)) : MODELS;

// build the full task list
const tasks = [];
for (const [axis, cfg] of Object.entries(PLAN)) {
  if (ONLY_AXES && !ONLY_AXES.includes(axis)) continue;
  const items = loadAxis(axis, cfg.n);
  for (const item of items)
    for (let s = 0; s < cfg.samples; s++)
      tasks.push({ axis, item, sample: s, cfg });
}
// interleave so no model/provider/axis owns a burst
tasks.sort((a, b) => (a.sample - b.sample) || a.item.id.localeCompare(b.item.id));

const RAW = join(ROOT, 'results', 'raw');
mkdirSync(RAW, { recursive: true });
const outFile = join(RAW, `${TAG}.jsonl`);
writeFileSync(outFile, '');

let spent = 0, done = 0, aborted = false;
const total = tasks.length * RUN_MODELS.length;
const t0 = Date.now();

async function runOne(task, model) {
  const { axis, item, sample, cfg } = task;
  // temperature omitted — reasoning models fix/forbid it; default sampling drives pass@k
  const rec = await call(model.id, item.prompt, { maxTokens: cfg.max });
  const inr = costINR(rec);
  const g = rec.err ? { pass: false, reason: rec.failure } : grade(axis, rec.content, item.expect);
  const row = {
    tag: TAG, axis, itemId: item.id, model: model.id, sample,
    provider: rec.provider, servedModel: rec.servedModel,
    pass: g.pass, reason: g.reason,
    inTok: rec.inTok, outTok: rec.outTok, reasoningTok: rec.reasoningTok, reasoned: rec.reasoned,
    ttftMs: rec.ttftMs, totalMs: rec.totalMs, brLatencyMs: rec.brLatencyMs,
    decodeTokPerSec: rec.decodeTokPerSec,
    costINR: +inr.toFixed(5), failure: rec.failure, err: rec.err,
    finishReason: rec.finishReason,
    contentLen: rec.content.length,
    content: rec.content.slice(0, 4000),  // stored so grading can be re-run offline, no re-call
    ts: Date.now(),
  };
  appendFileSync(outFile, JSON.stringify(row) + '\n');
  spent += inr; done++;
  const pct = ((done / total) * 100).toFixed(1);
  const flag = rec.err ? `ERR(${rec.failure})` : (g.pass ? 'ok' : `x(${g.reason ?? ''})`);
  console.error(`[${pct}%] ${axis}/${item.id} ${model.id.padEnd(14)} ${flag.padEnd(16)} ${rec.outTok}tok ₹${inr.toFixed(3)} tot₹${spent.toFixed(1)} ${rec.totalMs}ms${rec.provider ? ' @' + rec.provider : ''}`);
  return row;
}

// flatten to (task × model) units and run with a small pool
const units = [];
for (const task of tasks) for (const model of RUN_MODELS) units.push({ task, model });

let idx = 0;
async function worker() {
  while (idx < units.length && !aborted) {
    const u = units[idx++];
    try { await runOne(u.task, u.model); } catch (e) { console.error('worker err', String(e).slice(0, 120)); }
    if (spent > CAP) { aborted = true; console.error(`\n!! BUDGET CAP ₹${CAP} exceeded (spent ₹${spent.toFixed(1)}) — stopping.`); }
  }
}

console.error(`RUN ${TAG} | mode=${MODE} | ${units.length} calls (${tasks.length} items×samples × ${RUN_MODELS.length} models) | cap ₹${CAP}`);
await Promise.all(Array.from({ length: POOL }, worker));

const manifest = {
  tag: TAG, mode: MODE, at: new Date().toISOString(),
  models: RUN_MODELS.map(m => m.id), plan: PLAN,
  calls: done, spentINR: +spent.toFixed(2), aborted,
  durationSec: Math.round((Date.now() - t0) / 1000), rawFile: `results/raw/${TAG}.jsonl`,
};
writeFileSync(join(ROOT, 'results', `${TAG}.manifest.json`), JSON.stringify(manifest, null, 2));
console.error(`\nDONE ${TAG}: ${done} calls, ₹${spent.toFixed(2)}, ${manifest.durationSec}s${aborted ? ' [ABORTED on cap]' : ''}`);
console.log(JSON.stringify(manifest));
