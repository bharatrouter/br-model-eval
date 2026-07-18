# Cookbook: Benchmark 3 models on BharatRouter

> **Draft** for `site/src/pages/cookbook/` — not yet published. Numbers are injected from
> `results/summary.json` after the full run.

Everyone ranks models. Almost nobody tells you what a *correct answer* actually costs. This
recipe does both — quality **and** ₹-per-correct — for three frontier models, and because
every call goes through one BharatRouter endpoint, the comparison is genuinely
apples-to-apples. Clone it and re-run it against your own key in minutes.

## What you get

- Accuracy (with 95% confidence intervals) across coding, math, Indic, long-context and
  instruction-following.
- **₹ per correct answer** for each model — the number that actually decides what you deploy.
- Latency, throughput, verbosity and failure-rate, all from BR's own request logs.

## The whole idea in five lines of config

Because BharatRouter normalizes every provider to one OpenAI-compatible API, switching models
is a one-word change — same client, same auth, same params:

```js
const BASE = "https://api.bharatrouter.com/v1";
const KEY  = process.env.BR_API_KEY;          // your br- key — the ONLY secret you need
const MODELS = ["gpt-5.6-sol", "claude-fable-5", "kimi-k3"];
```

Your upstream OpenAI / Anthropic / Moonshot keys stay in BR's **BYOK vault** — they never
touch the benchmark repo. One `br-` key drives all three.

## Steps

```bash
git clone <repo> && cd br-model-eval
cp .env.example .env          # paste your br- key
make datasets                 # fetch HumanEval, AIME-2025, Global-MMLU-Hindi, IFEval + build needles
make preflight                # funding canary: one tiny call per model, aborts if any is dry
make smoke                    # ~10 items/axis — proves the wiring cheaply
make half                     # the full run
make metrics && make charts   # summary.json + a self-contained report.html
```

## Why it's trustworthy

- **Deterministic grading** — code is executed against hidden tests; math/MCQ/needle are
  exact-match; instruction-following is checked programmatically. No LLM-as-judge, so the
  numbers are reproducible bit-for-bit.
- **Realized provider on every row** — BR may fail over between hosts; the harness records
  which one actually served each call (`x-br-provider`) and never blends them silently.
- **Honest cost** — BYOK requests bill ₹0 on BR, so the harness computes the true ₹ from
  token counts × the realized route's published rate.

## Read the result

`results/summary.json` has every number; `charts/report.html` renders the quality-×-cost
frontier and per-axis bars. In our run:

> **GPT-5.6 Sol led on both accuracy (95.3%) and ₹-per-correct (₹1.43) — cheapest despite
> premium per-token pricing, because it's terse. The open-weight Kimi K3 (92.1%, ₹2.01) beat
> Claude Fable 5 (86.3%, ₹4.68) on both quality and cost.** Math was a three-way tie; the
> India-first Hindi axis separated them most.

## Extend it

Add a model: drop its id into `MODELS` (it must be routable on your BR org). Add an axis: add
a loader in `datasets/loaders/` that emits `{id, prompt, expect, meta}` and a grader in
`src/graders/`. That's it.
