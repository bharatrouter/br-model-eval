// Deterministic exact-match grading for math (AIME integer), indic (MCQ letter),
// and needle (synthetic code). All three instruct the model to end with "ANSWER: <x>".
// We prefer that marker, then fall back to a sensible last-token heuristic.

function afterAnswerMarker(text) {
  // last "ANSWER: ..." wins (models sometimes restate). Require the ':' or '-' separator
  // so the plain word "answer" inside prose ("the answer is ...") doesn't false-match.
  const m = [...text.matchAll(/ANSWER\s*[:\-]\s*(.+)/gi)];
  return m.length ? m[m.length - 1][1].trim() : null;
}

export function gradeMath(text, expected) {
  const wantN = parseInt(String(expected).match(/-?\d+/)?.[0] ?? 'NaN', 10);
  let got = afterAnswerMarker(text);
  if (got == null) {
    // fall back to the last integer in the response
    const nums = [...text.matchAll(/-?\d[\d,]*/g)].map(x => x[0]);
    got = nums.length ? nums[nums.length - 1] : '';
  }
  const norm = got.replace(/[,\s$\\]/g, '');
  const g = norm.match(/-?\d+/);
  // AIME answers are integers 0..999 → compare numerically (handles leading zeros).
  return !!g && Number.isFinite(wantN) && parseInt(g[0], 10) === wantN;
}

export function gradeMCQ(text, expected) {
  const want = String(expected).trim().toUpperCase();
  let got = afterAnswerMarker(text);
  if (got != null) {
    const m = got.match(/[A-D]/i);
    if (m) return m[0].toUpperCase() === want;
  }
  // fall back: last standalone A-D letter in the text
  const all = [...text.matchAll(/\b([A-D])\b/gi)].map(x => x[1].toUpperCase());
  return all.length ? all[all.length - 1] === want : false;
}

export function gradeNeedle(text, expected) {
  const want = String(expected).trim().toUpperCase();
  const got = afterAnswerMarker(text);
  if (got != null && got.toUpperCase().includes(want)) return true;
  return text.toUpperCase().includes(want);
}

export function gradeExact(axis, text, expect) {
  if (axis === 'math') return gradeMath(text, expect.answer);
  if (axis === 'indic') return gradeMCQ(text, expect.answer);
  if (axis === 'needle') return gradeNeedle(text, expect.answer);
  throw new Error(`gradeExact: unknown axis ${axis}`);
}
