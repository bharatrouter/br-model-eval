# We benchmarked GPT-5.6 Sol, Claude Fable 5 and Kimi K3 through one gateway. Here's what a correct answer actually costs.

> **Draft** for `site/src/pages/blog/` — not yet published. `{{...}}` placeholders are filled
> from `results/summary.json` after the full run. Hero image = the quality-×-cost frontier
> chart (`charts/report.html`).

Every week there's a new leaderboard telling you which model is *smartest*. Almost none of
them tell you what being smart **costs** — and for anyone actually shipping, that's the whole
question. A model three points ahead on some benchmark but five times pricier per correct
answer is not the better buy for most workloads.

So we ran a different kind of comparison. Three frontier models —

- **GPT-5.6 Sol**, OpenAI's new flagship (proprietary),
- **Claude Fable 5**, Anthropic's flagship (proprietary),
- **Kimi K3**, the open-weight challenger from Moonshot —

put through the exact same pipeline, graded the exact same way, and scored on two axes at
once: **how often they're right**, and **how many rupees each correct answer costs.**

## One gateway, so it's actually fair

The quiet problem with most model comparisons is that each model is called through its own
SDK, its own defaults, its own quirks — and small differences leak into the results. We
sidestepped that entirely by routing **every** call through [BharatRouter](https://bharatrouter.com),
which presents one OpenAI-compatible API over all three providers. Same endpoint, same auth,
same parameters. The only thing that changes between runs is the model name.

That neutrality is the point. BharatRouter is the referee, not a contestant.

A useful side effect: BR logs tokens, latency and cost for every request, so the
₹-per-correct-answer numbers fall out of the same run that measures quality — no separate
accounting pass.

## What we measured, and how we graded it

Five axes, each on a **standard, public** benchmark, each graded **deterministically** — no
LLM-as-judge anywhere, so the whole thing reproduces bit-for-bit:

| Axis | Benchmark | How it's graded |
|---|---|---|
| Coding | HumanEval | run the model's code against hidden tests |
| Reasoning / math | AIME 2025 | exact integer match |
| Indic | Global-MMLU (Hindi) | exact multiple-choice letter |
| Long-context | synthetic needle-in-haystack | exact code buried in a long document |
| Instruction-following | IFEval | programmatic constraint checks |

We report accuracy with **95% Wilson confidence intervals**, and when two models land inside
each other's interval we call it a **tie** — no fake precision.

**The honest caveat:** this measures things we can grade objectively. It says nothing about
writing quality, taste, or which model you'd rather talk to. That's a real limit — but a clean
one.

## The headline

{{HEADLINE PARAGRAPH — the open-weight-vs-proprietary story: does Kimi K3 close the quality
gap, and at what fraction of the ₹-per-correct? Fill from summary.json.}}

![quality vs cost frontier]({{hero chart}})

*Up and to the left is better: more accurate, cheaper per correct answer.*

## By the numbers

{{OVERALL TABLE — accuracy ± CI, ₹/correct, median TTFT, tok/s, per model. From summary.json.}}

### Where each model wins

- **Coding** — {{...}}
- **Math** — {{...}}
- **Indic** — {{... the India-first angle: how do the flagships handle Hindi vs the open-weight model?}}
- **Long-context & instruction-following** — {{...}}

## Cost is the story the leaderboards bury

{{₹/correct discussion — the multiple between cheapest and priciest per correct answer, and
what that means for real workloads. From summary.json overall.inrPerCorrect.}}

## Run it yourself

Everything here is one command away. The harness is open source; your provider keys stay in
BharatRouter's vault, never in the repo.

```bash
git clone <repo> && cd br-model-eval
cp .env.example .env    # your br- key
make datasets && make preflight && make half && make metrics && make charts
```

Full recipe in the [cookbook]({{cookbook link}}). Change one model name, re-run, and you have
your own numbers — on your own tasks, if you swap the datasets.

---

*Methodology, raw per-request data and the grading code are all in the
[br-model-eval repo]({{repo link}}). Grading is deterministic; the ₹ figures are computed from
realized-route token counts (BYOK bills ₹0 on BR, so we compute the true cost). Runs are
compute-heavy because two of the three models emit hidden reasoning tokens — we report those
too.*
