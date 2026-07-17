// Programmatic IFEval grading (strict, prompt-level): an item passes only if EVERY
// instruction in its list is satisfied. We implement the 13 verifiable instruction types
// the loader filters for. Word/sentence counts are whitespace/punctuation approximations
// (deterministic and applied identically to every model, so the comparison stays fair).

const words = (t) => (t.trim().match(/\b[\w'-]+\b/g) || []);
const sentences = (t) => (t.replace(/\n/g, ' ').match(/[^.!?]+[.!?]+/g) || (t.trim() ? [t] : []));

function rel(count, relation, n) {
  if (relation === 'at least') return count >= n;
  if (relation === 'less than') return count < n;
  return count === n;
}

const CHECKERS = {
  'keywords:existence': (t, k) => (k.keywords || []).every(w => new RegExp(`\\b${escape(w)}\\b`, 'i').test(t)),
  'keywords:frequency': (t, k) => {
    const c = (t.match(new RegExp(`\\b${escape(k.keyword)}\\b`, 'gi')) || []).length;
    return rel(c, k.relation, k.frequency);
  },
  'keywords:forbidden_words': (t, k) => (k.forbidden_words || []).every(w => !new RegExp(`\\b${escape(w)}\\b`, 'i').test(t)),
  'length_constraints:number_words': (t, k) => rel(words(t).length, k.relation, k.num_words),
  'length_constraints:number_sentences': (t, k) => rel(sentences(t).length, k.relation, k.num_sentences),
  'detectable_format:number_bullet_lists': (t, k) => {
    const bullets = (t.match(/^[ \t]*[\*\-]\s+/gm) || []).length;
    return bullets === k.num_bullets;
  },
  'detectable_format:json_format': (t) => {
    let s = t.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { JSON.parse(s); return true; } catch { return false; }
  },
  'detectable_format:number_highlighted_sections': (t, k) => {
    const hi = (t.match(/\*[^*\n]+\*/g) || []).length;
    return hi >= k.num_highlights;
  },
  'detectable_format:title': (t) => /<<[^>]+>>/.test(t),
  'change_case:english_lowercase': (t) => t === t.toLowerCase(),
  'change_case:english_uppercase': (t) => t === t.toUpperCase(),
  'startend:end_checker': (t, k) => t.trim().toLowerCase().endsWith(String(k.end_phrase || '').trim().toLowerCase()),
  'punctuation:no_comma': (t) => !t.includes(','),
};

function escape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function gradeIF(text, expect) {
  const ids = expect.instruction_ids || [];
  const kwargs = expect.kwargs || [];
  const per = {};
  let ok = true;
  ids.forEach((id, i) => {
    const fn = CHECKERS[id];
    const pass = fn ? safe(() => fn(text, kwargs[i] || {})) : false;
    per[id] = pass;
    if (!pass) ok = false;
  });
  return { pass: ok, per };
}

function safe(fn) { try { return !!fn(); } catch { return false; } }
