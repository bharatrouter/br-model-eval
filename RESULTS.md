# Results — run `merged-v2` (2026-07-18)

570 graded calls · 5 axes · 3 models · ~₹3.1k total BYOK spend · deterministic grading.

## Overall

| Model | Accuracy (95% CI) | ₹ / correct | Median TTFT | Throughput |
|---|---|---|---|---|
| **GPT-5.6 Sol** | **95.3%** [91–97] | **₹1.43** | 40.5 s | 120 tok/s |
| Kimi K3 (open-weight) | 92.1% [87–95] | ₹2.01 | 30.9 s | 46 tok/s |
| Claude Fable 5 | 86.3% [81–90] | ₹4.68 | 35.9 s | 85 tok/s |

**Sol wins both axes** — most accurate and cheapest per correct answer (terse output beats
cheap-but-verbose). **Kimi K3 (open-weight) beats Claude Fable 5** on both quality and cost.

## By axis

| Axis | GPT-5.6 Sol | Kimi K3 | Claude Fable 5 |
|---|---|---|---|
| Coding (HumanEval, n=80) | 95.0% | 92.5% | 90.0% |
| Math (AIME 2025, n=15) | 86.7% | 86.7% | 86.7% (tie) |
| Indic / Hindi (Global-MMLU, n=60) | 95.0% | 90.0% | 76.7%* |
| Long-context (needle, n=15) | 100% | 100% | 93.3% |
| Instruction-following (IFEval, n=20) | 100% | 95.0% | 95.0% |

\* Most of Fable's Hindi misses were **Anthropic content-filter refusals** (anatomy/medical
topics), not wrong answers — a deliverability gap. Counted as failures (a user gets nothing).

## Method notes / integrity

Three measurement artifacts were found in the first run and fixed before these numbers — each
would have produced a wrong, plausible-looking result:

1. **Code grader dropped stub imports** → correct terse code failed `NameError` (Sol coding
   71%→95%). Fixed to keep HumanEval stub imports.
2. **Needle prompt tripped Anthropic's content filter** ("secret access code" framing) →
   Fable 0%→93% on long-context after reframing to benign fact-retrieval.
3. **300s timeout counted as wrong answers** → reasoning models were killed mid-thought on
   hard AIME; raised to 600s, remaining math failures are genuine timeouts (reported as their
   own failure mode, not wrong answers).

Grading is deterministic (execution + exact-match + programmatic checks); ₹ is computed from
realized-route token counts; every row records its realized `x-br-provider`. See
`results/summary.json` for all numbers and `charts/report.html` for the frontier chart.
