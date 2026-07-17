// Code-execution grader for HumanEval. Extract the model's Python, assemble
//   <solution> + <hidden test> + check(<entry_point>)
// and run it in a subprocess killed on timeout. Exit 0 => the hidden tests passed.
// Model code is untrusted → always run under a wall-clock timeout in a temp dir.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function extractPython(text) {
  // Prefer a fenced ```python block; then any ``` block; else the raw text.
  const fenced = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  const anyFence = text.match(/```\s*\n([\s\S]*?)```/);
  if (anyFence) return anyFence[1];
  return text;
}

export function gradeCode(text, expect, { timeoutMs = 12_000 } = {}) {
  const solution = extractPython(text);
  const program = `${solution}\n\n${expect.test}\n\ncheck(${expect.entry_point})\n`;
  const dir = mkdtempSync(join(tmpdir(), 'brcode-'));
  const file = join(dir, 'prog.py');
  try {
    writeFileSync(file, program);
    const r = spawnSync('python3', [file], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    const passed = r.status === 0 && !r.error;
    let reason = null;
    if (!passed) {
      if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL') reason = 'timeout';
      else if (/AssertionError/.test(r.stderr || '')) reason = 'assert_fail';
      else if (/SyntaxError|IndentationError/.test(r.stderr || '')) reason = 'syntax_error';
      else if (r.stderr) reason = 'runtime_error';
      else reason = 'no_code';
    }
    return { pass: passed, reason };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
