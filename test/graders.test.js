// Offline grader tests: a passing + a failing case per grader, so a green grader can't
// silently pass everything. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeMath, gradeMCQ, gradeNeedle } from '../src/graders/exact.mjs';
import { gradeIF } from '../src/graders/ifcheck.mjs';
import { gradeCode, extractPython } from '../src/graders/exec.mjs';

test('math: marker + fallback', () => {
  assert.equal(gradeMath('work...\nANSWER: 204', '204'), true);
  assert.equal(gradeMath('the answer is 0204', '204'), true);      // leading zeros
  assert.equal(gradeMath('ANSWER: 17', '204'), false);
});

test('mcq: letter marker + fallback', () => {
  assert.equal(gradeMCQ('reasoning\nANSWER: C', 'C'), true);
  assert.equal(gradeMCQ('so the answer is B', 'B'), true);
  assert.equal(gradeMCQ('ANSWER: A', 'D'), false);
});

test('needle: substring of code', () => {
  assert.equal(gradeNeedle('ANSWER: INDIGO-4521', 'INDIGO-4521'), true);
  assert.equal(gradeNeedle('the code is monsoon-1234 somewhere', 'MONSOON-1234'), true);
  assert.equal(gradeNeedle('ANSWER: SAFFRON-0000', 'BANYAN-9999'), false);
});

test('ifeval: uppercase + end phrase', () => {
  const ok = gradeIF('HELLO WORLD THAT IS ALL', {
    instruction_ids: ['change_case:english_uppercase', 'startend:end_checker'],
    kwargs: [{}, { end_phrase: 'that is all' }],
  });
  assert.equal(ok.pass, true);
  const bad = gradeIF('Hello world done', {
    instruction_ids: ['change_case:english_uppercase'], kwargs: [{}],
  });
  assert.equal(bad.pass, false);
});

test('ifeval: word count relation', () => {
  const ok = gradeIF('one two three four five', {
    instruction_ids: ['length_constraints:number_words'],
    kwargs: [{ num_words: 3, relation: 'at least' }],
  });
  assert.equal(ok.pass, true);
  const bad = gradeIF('one two', {
    instruction_ids: ['length_constraints:number_words'],
    kwargs: [{ num_words: 3, relation: 'at least' }],
  });
  assert.equal(bad.pass, false);
});

test('code: extract from fence', () => {
  assert.match(extractPython('sure:\n```python\ndef f():\n    return 1\n```\ndone'), /def f/);
});

test('code: passing + failing solutions', () => {
  const expect = { entry_point: 'add', test: 'def check(candidate):\n    assert candidate(2,3)==5\n    assert candidate(0,0)==0\n' };
  const good = gradeCode('```python\ndef add(a,b):\n    return a+b\n```', expect);
  assert.equal(good.pass, true);
  const bad = gradeCode('```python\ndef add(a,b):\n    return a-b\n```', expect);
  assert.equal(bad.pass, false);
  assert.equal(bad.reason, 'assert_fail');
});
