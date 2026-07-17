// Funding gate. One tiny canary per model through BR (works with only the br- key): a dry
// account returns an unmistakable billing error. Exit non-zero if any model can't serve, so
// an unattended run never starts against a dead account. Prints realized provider per model.

import { MODELS } from './catalog.mjs';
import { call } from './br.mjs';

let bad = 0;
console.error('Preflight canary (1 tiny call per model)...');
for (const m of MODELS) {
  const r = await call(m.id, 'Reply with the single word: ok', { maxTokens: 16 });
  if (r.err) {
    bad++;
    const dry = r.failure === 'billing';
    console.error(`  ✗ ${m.id.padEnd(16)} ${dry ? 'NOT FUNDED / billing' : 'ERROR'}: ${r.err}`);
  } else {
    console.error(`  ✓ ${m.id.padEnd(16)} 200 @${r.provider ?? '?'} (${r.outTok}tok${r.reasoned ? ', reasons' : ''})`);
  }
}
if (bad) { console.error(`\nPreflight FAILED: ${bad}/${MODELS.length} model(s) not serving. Aborting.`); process.exit(1); }
console.error(`\nPreflight OK: all ${MODELS.length} models funded + serving.`);
