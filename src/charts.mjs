// Render results/summary.json -> charts/report.html: a self-contained, theme-aware report.
// Hero = quality x cost frontier; then per-axis accuracy bars with Wilson CI whiskers,
// latency/throughput, verbosity, and failure modes. Pure inline SVG, no external assets.
//
//   node src/charts.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = JSON.parse(readFileSync(join(ROOT, 'results', 'summary.json'), 'utf8'));
mkdirSync(join(ROOT, 'charts'), { recursive: true });

const MODELS = S.models;
const AXES = S.axes;
// brand-neutral, colourblind-safe categorical palette
const PAL = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed'];
const color = m => PAL[MODELS.indexOf(m) % PAL.length];
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = x => (x * 100).toFixed(1) + '%';
const cell = (m, a) => S.cells[`${m}|${a}`];

// ---- frontier: accuracy (y) vs ₹/correct (x, log) -------------------------------------
function frontier() {
  const W = 720, H = 440, pad = { l: 64, r: 24, t: 24, b: 56 };
  const pts = MODELS.map(m => ({ m, x: S.overall[m].inrPerCorrect, y: S.overall[m].accuracy }))
    .filter(p => p.x != null && p.x > 0);
  if (!pts.length) return '<p>no cost data</p>';
  const xs = pts.map(p => Math.log10(p.x));
  const xmin = Math.min(...xs) - 0.15, xmax = Math.max(...xs) + 0.15;
  const ymax = Math.min(1, Math.max(...pts.map(p => p.y)) + 0.1), ymin = Math.max(0, Math.min(...pts.map(p => p.y)) - 0.1);
  const X = lx => pad.l + (lx - xmin) / (xmax - xmin) * (W - pad.l - pad.r);
  const Y = y => H - pad.b - (y - ymin) / (ymax - ymin) * (H - pad.t - pad.b);
  let g = '';
  // gridlines / axes
  for (let i = 0; i <= 4; i++) {
    const y = ymin + (ymax - ymin) * i / 4;
    g += `<line x1="${pad.l}" y1="${Y(y)}" x2="${W - pad.r}" y2="${Y(y)}" class="grid"/>`;
    g += `<text x="${pad.l - 8}" y="${Y(y) + 4}" text-anchor="end" class="tick">${pct(y)}</text>`;
  }
  for (let e = Math.floor(xmin); e <= Math.ceil(xmax); e++) {
    if (X(e) < pad.l || X(e) > W - pad.r) continue;
    g += `<line x1="${X(e)}" y1="${pad.t}" x2="${X(e)}" y2="${H - pad.b}" class="grid"/>`;
    g += `<text x="${X(e)}" y="${H - pad.b + 18}" text-anchor="middle" class="tick">₹${Math.pow(10, e).toFixed(e < 0 ? 2 : 0)}</text>`;
  }
  for (const p of pts) {
    g += `<circle cx="${X(Math.log10(p.x))}" cy="${Y(p.y)}" r="8" fill="${color(p.m)}" stroke="var(--bg)" stroke-width="2"/>`;
    g += `<text x="${X(Math.log10(p.x))}" y="${Y(p.y) - 14}" text-anchor="middle" class="lbl">${esc(p.m)}</text>`;
  }
  g += `<text x="${(W) / 2}" y="${H - 8}" text-anchor="middle" class="axl">₹ per correct answer (log) → cheaper is left</text>`;
  g += `<text transform="translate(16 ${H / 2}) rotate(-90)" text-anchor="middle" class="axl">accuracy → better is up</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
}

// ---- grouped accuracy bars per axis, with CI whiskers ---------------------------------
function axisBars() {
  const W = 720, rowH = 34, pad = { l: 150, r: 60, t: 30, b: 10 };
  let out = '';
  for (const a of AXES) {
    const H = pad.t + AXES.length * 0 + MODELS.length * rowH + pad.b;
    const bw = W - pad.l - pad.r;
    let g = `<text x="8" y="18" class="axl">${esc(a)}</text>`;
    MODELS.forEach((m, i) => {
      const c = cell(m, a); if (!c) return;
      const y = pad.t + i * rowH;
      g += `<text x="${pad.l - 8}" y="${y + 20}" text-anchor="end" class="tick">${esc(m)}</text>`;
      g += `<rect x="${pad.l}" y="${y + 8}" width="${bw}" height="16" class="track"/>`;
      g += `<rect x="${pad.l}" y="${y + 8}" width="${bw * c.accuracy}" height="16" fill="${color(m)}"/>`;
      // CI whisker
      g += `<line x1="${pad.l + bw * c.ci_lo}" y1="${y + 16}" x2="${pad.l + bw * c.ci_hi}" y2="${y + 16}" class="ci"/>`;
      g += `<text x="${pad.l + bw + 6}" y="${y + 20}" class="tick">${pct(c.accuracy)}</text>`;
    });
    out += `<svg viewBox="0 0 ${W} ${pad.t + MODELS.length * rowH + pad.b}" class="chart">${g}</svg>`;
  }
  return out;
}

// ---- overall table --------------------------------------------------------------------
function table() {
  let rows = MODELS.map(m => {
    const o = S.overall[m];
    return `<tr><td><span class="dot" style="background:${color(m)}"></span>${esc(m)}</td>
      <td>${pct(o.accuracy)} <span class="ci-t">[${pct(o.ci_lo)}–${pct(o.ci_hi)}]</span></td>
      <td>${o.inrPerCorrect ?? '—'}</td><td>₹${o.costINR}</td>
      <td>${o.medTtftMs}ms</td><td>${o.medDecodeTokPerSec}</td><td>${o.errors}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>model</th><th>accuracy (95% CI)</th><th>₹/correct</th>
    <th>total ₹</th><th>median TTFT</th><th>tok/s</th><th>errors</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- per-axis detail table ------------------------------------------------------------
function axisTable() {
  let out = '<table><thead><tr><th>axis</th>' + MODELS.map(m => `<th>${esc(m)}</th>`).join('') + '</tr></thead><tbody>';
  for (const a of AXES) {
    out += `<tr><td>${esc(a)}</td>` + MODELS.map(m => {
      const c = cell(m, a); if (!c) return '<td>—</td>';
      return `<td>${pct(c.accuracy)}<br><span class="ci-t">₹/ok ${c.inrPerCorrect ?? '—'} · ${c.n}n</span></td>`;
    }).join('') + '</tr>';
  }
  return out + '</tbody></table>';
}

const html = `<div class="wrap">
<h1>Frontier models, one gateway: quality × cost</h1>
<p class="sub">${esc(MODELS.join(' · '))} — benchmarked through BharatRouter. Run <code>${esc(S.tag)}</code> · ${esc(S.at)}. Grading is deterministic (execution + exact-match); ₹/correct is computed from realized-route token counts.</p>

<h2>The frontier — accuracy vs ₹ per correct answer</h2>
<div class="card">${frontier()}</div>

<h2>Overall</h2>
<div class="card">${table()}</div>

<h2>Accuracy by axis <span class="ci-t">(bar = accuracy, whisker = 95% Wilson CI)</span></h2>
<div class="card">${axisBars()}</div>

<h2>Per-axis detail</h2>
<div class="card">${axisTable()}</div>
</div>`;

const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BR model benchmark — ${esc(S.tag)}</title><style>
:root{--bg:#fff;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--card:#f8fafc}
@media(prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--mut:#94a3b8;--line:#1e293b;--card:#111827}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 10px}
.sub{color:var(--mut);margin:0 0 8px}code{background:var(--card);padding:1px 5px;border-radius:4px;font-size:.9em}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
.chart{width:100%;height:auto;display:block}.chart+.chart{margin-top:6px}
.grid{stroke:var(--line);stroke-width:1}.tick{fill:var(--mut);font-size:11px}.lbl{fill:var(--fg);font-size:12px;font-weight:600}
.axl{fill:var(--mut);font-size:12px}.track{fill:var(--line)}.ci{stroke:var(--fg);stroke-width:2;opacity:.5}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;vertical-align:middle}
.ci-t{color:var(--mut);font-size:11px}
</style></head><body>${html}</body></html>`;

writeFileSync(join(ROOT, 'charts', 'report.html'), doc);
console.log('wrote charts/report.html');
