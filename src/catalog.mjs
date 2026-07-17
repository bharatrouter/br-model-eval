// The three models under test + their BR route pricing (₹ per Mtok), confirmed live
// from GET /v1/models on 2026-07-18. Cost is computed from token counts × the REALIZED
// route's rate (x-br-provider), so we keep a per-provider price map, not one number.
//
// BYOK requests bill ₹0 on BR (x-br-cost-inr = 0), so we compute the "would-be" ₹ here.

export const MODELS = [
  { id: 'gpt-5.6-sol',    label: 'GPT-5.6 Sol', klass: 'proprietary' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', klass: 'proprietary' },
  { id: 'kimi-k3',        label: 'Kimi K3', klass: 'open-weight' },
];

// provider -> {input, output} ₹/Mtok, per model. Keyed by "model@provider".
export const PRICING = {
  'gpt-5.6-sol@openai':      { in: 480, out: 2880 },
  'claude-fable-5@anthropic':{ in: 960, out: 4800 },
  'claude-fable-5@openrouter':{ in: 960, out: 4800 },
  'kimi-k3@moonshot':        { in: 288, out: 1440 },
};

// Fallback per-model rate if the realized provider isn't in the map (use the primary route).
export const PRIMARY_RATE = {
  'gpt-5.6-sol':    { in: 480, out: 2880 },
  'claude-fable-5': { in: 960, out: 4800 },
  'kimi-k3':        { in: 288, out: 1440 },
};

export function rateFor(model, provider) {
  return PRICING[`${model}@${provider}`] || PRIMARY_RATE[model] || { in: 0, out: 0 };
}
