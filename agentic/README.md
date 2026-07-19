# Agentic cost benchmark (Part 2)

The harness behind **[How Kimi K3 became the cheapest coding agent](https://bharatrouter.com/blog/kimi-k3-cheapest-coding-agent)** —
the same three flagships (Kimi K3, GPT-5.6 Sol, Claude Fable 5) run *inside a real coding agent*
(Claude Code / Codex) through one neutral gateway, priced per task with **cache-accurate,
four-component cost**.

## Why four components

An agent re-sends its whole context every turn, so ~99% of input tokens are **cache reads**. Pricing
them at list rate overstates cost ~10×. The honest bill has four parts, each at its own rate:

| component | billed at |
|---|---|
| uncached input | 1.0× input |
| cache read | 0.1× input |
| cache write | 1.25× input (Anthropic, GPT-5.6+) / 0× (Moonshot, pre-5.6) |
| output | 1.0× output |

BharatRouter surfaces all four on every route (`cache_read_input_tokens`,
`cache_creation_input_tokens`) — including BYOK — so the numbers are measurable. BYOK bills ₹0, so
the harness computes the would-be cost itself from realized token counts × catalog rates.

## Results (2026-07-19, Claude Code, 16/16 solved)

| model | realized ₹/task | cache-cold | cache-read % |
|---|---|---|---|
| **Kimi K3** | **₹10.87** | ₹29.40 | 69% |
| GPT-5.6 Sol | ₹19.37 | ₹44.27 | 69% |
| Claude Fable 5 | ₹43.11 | ₹158.39 | 83% |

Full numbers in [`results/summary.json`](results/summary.json). Headline: the cheapest *token* (Kimi)
becomes the cheapest *agent* — the reverse of the single-turn result in
[Part 1](https://bharatrouter.com/blog/cheapest-token-cheapest-answer), because agentic cost is
input/cache-dominated and output verbosity barely registers.

## Run it

Requires: Node ≥ 20, `python3`, [Claude Code](https://claude.com/claude-code) and/or
[Codex CLI](https://github.com/openai/codex) on `PATH`, and a BharatRouter `br-` key.

```bash
# your br- key is the ONLY secret; provider keys stay in BR's BYOK vault
echo "BR_API_KEY=br-..." > ../.env          # repo-root .env (git-ignored)

# — multi-file tasks (rich, multi-turn) —
#   point TASKS_DIR in run.sh at a set of task dirs, each: PROMPT + seed files + grade.sh
BR_KEY=br-... bash run.sh --repeats 1

# — HumanEval at scale (164 standard single-function tasks, run agentically) —
python3 materialize_humaneval.py            # writes humaneval-tasks/HumanEval_*/
BR_KEY=br-... bash run_humaneval.sh 164      # or a smaller N for a pilot
```

Each run seeds a scratch workdir, drives the real agent headless via BharatRouter, grades
deterministically (exit code + tamper-guarded tests), and records solve / four-component tokens / ₹ /
seconds per task. `summarize.mjs` prints realized ₹/task, the cache-cold ceiling, and cache-hit %.

## Layout

| file | what |
|---|---|
| `run.sh` | multi-file task runner — arms: Codex + Claude Code (reduced toolset) |
| `run_humaneval.sh` | HumanEval-at-scale runner (Claude Code, 3 flagships) |
| `materialize_humaneval.py` | fetches HumanEval → agentic task dirs (stub + hidden-test grade.sh) |
| `proxy.mjs` | logging proxy — tallies BR's four-component token usage per task |
| `row.mjs` | one result row; realized (cache-aware) + cache-cold cost from token counts |
| `summarize.mjs` | aggregate → solve-rate, ₹/task, cache-cold, cache-hit %, median s |

## Caveats (stated plainly)

- **Cache timing.** Cache-hit rate depends on prefix stability and TTL (Anthropic 5 min; a long idle
  gap re-writes the cache and spikes cost). We report a measured run against the stable cache-cold
  ceiling.
- **Harness matters.** The same model in a different agent prices and behaves differently — quote a
  model's agentic cost *with its harness*. Codex's `/v1/responses` path doesn't expose a cache split,
  so its figures are cache-cold.
- **Task profile.** The multi-file tasks are richly multi-turn; HumanEval tasks are lighter
  (single-function) — a complementary profile, reported separately, not blended.
- **Local paths.** `run.sh` references a `TASKS_DIR` and a repo-root `.env` via `$HOME` — adjust to
  your checkout.
