// ₹ for one call, computed from token counts × the REALIZED route's catalog rate.
// BR bills BYOK at ₹0, so we compute the "would-be" cost ourselves — this is the number
// the ₹/correct frontier is built on. Rupees (not micro-rupees).

import { rateFor } from './catalog.mjs';

export function costINR(rec) {
  const r = rateFor(rec.model, rec.provider);
  return ((rec.inTok * r.in) + (rec.outTok * r.out)) / 1e6;
}
