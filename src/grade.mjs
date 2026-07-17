// Dispatch grading by axis. Returns { pass, reason? }. Pure/deterministic.
import { gradeExact } from './graders/exact.mjs';
import { gradeIF } from './graders/ifcheck.mjs';
import { gradeCode } from './graders/exec.mjs';

export function grade(axis, content, expect) {
  if (!content || !content.trim()) return { pass: false, reason: 'empty' };
  if (axis === 'coding') return gradeCode(content, expect);
  if (axis === 'ifeval') { const r = gradeIF(content, expect); return { pass: r.pass, reason: r.pass ? null : 'constraint_fail' }; }
  return { pass: gradeExact(axis, content, expect), reason: null };
}
