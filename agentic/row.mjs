// Build one result row with REALIZED (cache-aware) ₹ from token usage × BR catalog rates.
// BYOK bills ₹0 on BR, so we compute the "would-be" cost ourselves. Agentic loops re-send
// the same context every turn, so ~99% of input is prompt-cache hits — billed at 0.1× input
// on all three providers. We therefore price four components separately:
//   uncached input × in · cache-read × (0.1×in) · cache-creation × write · output × out
// Cache-WRITE premium: Anthropic & OpenAI gpt-5.6 bill explicit cache writes at 1.25× input
// (Claude Code uses explicit cache_control → Fable pays this on turn 1). Moonshot/OpenAI
// AUTOMATIC caching (the translated Kimi/Sol path) reports no separate creation tokens and
// no write premium — turn 1 is just uncached input — so their cacheCreate is 0 in practice.
// Rates: INR per Mtok (₹96/$). in/out from the BR catalog; read = 0.1×in; write = 1.25×in.
const RATES = {
  'kimi-k3':        { in: 288, read: 28.8, write: 288,  out: 1440 },
  'gpt-5.6-sol':    { in: 480, read: 48,   write: 600,  out: 2880 },
  'claude-fable-5': { in: 960, read: 96,   write: 1200, out: 4800 },
};
const e = process.env;
const model = e.BR_MODEL;
const r = RATES[model] || { in: 0, read: 0, write: 0, out: 0 };
let inTok = +e.BR_TI || 0, outTok = +e.BR_TO || 0;
let cacheRead = +e.BR_CR || 0, cacheCreate = +e.BR_CC || 0;
let tokApprox = false, tokMissing = false;

if (e.BR_ARM === 'codex' && outTok === 0 && cacheRead === 0 && inTok > 0) {
  // codex reports only a TOTAL token count and no cache breakdown → split by an assumed
  // agentic ratio and treat it as cache-cold (ceiling). Flagged approximate.
  const total = inTok;
  inTok = Math.round(total * 0.72);
  outTok = total - inTok;
  tokApprox = true;
}

// Realized cost = each component at its own rate.
let inr = null;
if (inTok > 0 || outTok > 0 || cacheRead > 0 || cacheCreate > 0) {
  inr = +((inTok * r.in + cacheRead * r.read + cacheCreate * r.write + outTok * r.out) / 1e6).toFixed(4);
} else if (e.BR_ARM === 'claude') {
  tokMissing = true;
}
// Cache-cold comparison (what it would cost with NO caching): all input at full rate.
const totalInput = inTok + cacheRead + cacheCreate;
const inrColdList = +((totalInput * r.in + outTok * r.out) / 1e6).toFixed(4);
const cacheHitPct = totalInput > 0 ? +((cacheRead / totalInput) * 100).toFixed(1) : 0;

console.log(JSON.stringify({
  arm: e.BR_ARM, model, label: e.BR_LABEL, task: e.BR_TASK, rep: +e.BR_REP,
  status: e.BR_STATUS, ec: +e.BR_EC,
  inTok, outTok, cacheRead, cacheCreate, totalInput, cacheHitPct,
  tokApprox, tokMissing, secs: +e.BR_SECS,
  inr,             // realized (cache-aware) — the headline
  inrColdList,     // cache-cold list price — the ceiling
}));
