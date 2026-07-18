# br-model-eval

A **credible, reproducible** quality-×-cost benchmark of frontier LLMs, run entirely through
the [BharatRouter](https://bharatrouter.com) gateway — one endpoint, one key, one logging
layer, so the comparison is genuinely apples-to-apples.

Models under test:

| Model | Class | Route |
|---|---|---|
| `gpt-5.6-sol` | proprietary | OpenAI |
| `claude-fable-5` | proprietary | Anthropic |
| `kimi-k3` | open-weight | Moonshot |

## What makes it credible

- **Deterministic grading only** — execution (HumanEval), exact-match (AIME 2025 integers,
  Global-MMLU Hindi MCQ letters, synthetic needle codes), and programmatic constraint checks
  (IFEval). **No LLM judge** anywhere, so anyone re-running gets the same numbers.
- **One gateway, identical params** for every model — no per-vendor SDK confounds.
- **Wilson 95% CIs** on every score; gaps inside the CI are reported as ties, not winners.
- **₹ per correct answer**, not just accuracy — computed from realized-route token counts
  (BYOK bills ₹0 on BR, so we compute the true cost ourselves). This is the buying metric the
  leaderboards skip.
- **Realized provider recorded per request** (`x-br-provider`) — failover is allowed for
  resilience but never silently blended into the numbers.

### Honest bounds

This measures **auto-gradable capability** (correctness on coding / math / comprehension /
instruction-following), **not** open-ended style, creativity, or human preference. That's a
clean, defensible limit — "we measure what we can grade objectively."

## Axes

| Axis | Source | Grading |
|---|---|---|
| Coding | HumanEval | execute hidden tests |
| Reasoning / math | AIME 2025 (MathArena) | exact integer |
| Indic | Global-MMLU Hindi | exact MCQ letter |
| Long-context | synthetic needle-in-haystack | exact code match |
| Instruction-following | IFEval (verifiable subset) | programmatic checks |

## Run it yourself

```bash
cp .env.example .env         # add your BharatRouter br- key (that's the ONLY secret)
make datasets                # fetch + normalize all axes  (needs uv)
make preflight               # funding canary — one tiny call per model
make smoke                   # ~10/axis proving run (cheap)
make half                    # the full run
make metrics && make charts  # -> results/summary.json + charts/report.html
```

Requires Node ≥ 20 and [`uv`](https://docs.astral.sh/uv/). The upstream provider keys live in
BharatRouter's BYOK vault — **no OpenAI/Anthropic/Moonshot keys ever touch this repo.** Only
the `br-` gateway key is needed, and it stays in your git-ignored `.env`.

## Metrics reported

accuracy ± Wilson CI · ₹/correct · TTFT · throughput (tok/s) · tokens-to-answer (verbosity) ·
consistency (pass@1 vs pass@k) · failure-mode breakdown (refusal / malformed / truncation /
timeout) · realized provider per row.

## Layout

```
datasets/loaders/fetch_all.py   fetch + normalize every axis -> datasets/data/*.json
src/preflight.mjs               funding canary
src/run.mjs                     fan-out models × items × samples, stream rows to results/raw
src/br.mjs                      BR client (Bearer br- key, retry, realized-provider capture)
src/cost.mjs                    ₹ from tokens × realized-route rate
src/graders/                    exec (code) · exact (math/MCQ/needle) · ifcheck (IFEval)
src/metrics.mjs                 raw -> summary.json (Wilson CI, ₹/correct, latency, …)
src/charts.mjs                  summary.json -> self-contained charts/report.html
test/                           offline grader unit tests (make test)
```

## License

MIT.
