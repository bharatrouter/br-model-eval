# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow", "requests"]
# ///
"""Fetch + normalize every benchmark axis to datasets/data/<axis>.json.

Each item: {id, axis, prompt, expect, meta}. Grading is deterministic downstream:
  coding  -> expect = {test, entry_point}      (execute hidden tests)
  math    -> expect = {answer}                 (exact numeric match)
  indic   -> expect = {answer}                 (exact MCQ letter)
  ifeval  -> expect = {checks:[...]}           (programmatic constraint checks)
  needle  -> expect = {answer}                 (exact string match; synthetic)

Standard benchmarks (HumanEval, AIME-2025, MILU, IFEval) are fetched from public
sources; long-context needle is generated locally (zero contamination/licence risk).
Resilient: a failed axis is reported, not fatal.
"""
import gzip, io, json, os, sys, re, hashlib, random
from pathlib import Path
import requests

DATA = Path(__file__).resolve().parents[1] / "data"
DATA.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "br-model-eval/1.0"}

def save(axis, items):
    p = DATA / f"{axis}.json"
    p.write_text(json.dumps(items, ensure_ascii=False, indent=1))
    print(f"  [{axis}] {len(items)} items -> {p.name}")

def get(url, **kw):
    import time
    last = None
    for attempt in range(5):
        r = requests.get(url, headers=UA, timeout=120, **kw)
        if r.status_code in (429, 500, 502, 503):
            last = r; time.sleep(3 * (attempt + 1)); continue
        r.raise_for_status()
        return r
    last.raise_for_status()
    return last

# ---------------------------------------------------------------- coding: HumanEval
def coding():
    url = "https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz"
    raw = gzip.decompress(get(url).content).decode()
    items = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        items.append({
            "id": r["task_id"].replace("/", "_"),
            "axis": "coding",
            # The model must complete the function. We ask for a full solution.
            "prompt": ("Complete the following Python function. Return ONLY the full "
                       "function definition in a single ```python code block, no prose.\n\n"
                       + r["prompt"]),
            "expect": {"test": r["test"], "entry_point": r["entry_point"], "stub": r["prompt"]},
            "meta": {"source": "HumanEval"},
        })
    save("coding", items)

# ------------------------------------------------------------------ math: AIME 2025
def math_aime():
    import pyarrow.parquet as pq
    # MathArena/aime_2025 — verified integer answers 0..999
    url = "https://huggingface.co/datasets/MathArena/aime_2025/resolve/main/data/train-00000-of-00001.parquet"
    tbl = pq.read_table(io.BytesIO(get(url).content)).to_pylist()
    items = []
    for i, r in enumerate(tbl):
        q = r.get("problem") or r.get("question") or r.get("Problem")
        a = r.get("answer") or r.get("Answer") or r.get("solution")
        if q is None or a is None:
            continue
        items.append({
            "id": f"aime2025_{i:03d}",
            "axis": "math",
            "prompt": ("Solve the problem. Reason step by step, then give the final answer "
                       "as an integer on its own last line in the form: ANSWER: <n>\n\n" + str(q)),
            "expect": {"answer": str(a).strip()},
            "meta": {"source": "AIME-2025"},
        })
    save("math", items)

# ----------------------------------------------------------------- indic: MILU Hindi
def indic_milu():
    # CohereLabs/Global-MMLU, Hindi config — ungated MCQ via the datasets-server rows API.
    base = "https://datasets-server.huggingface.co/rows?dataset=CohereLabs/Global-MMLU&config=hi&split=test"
    items = []
    for offset in range(0, 400, 100):
        rows = get(f"{base}&offset={offset}&length=100").json().get("rows", [])
        if not rows:
            break
        for r in rows:
            r = r["row"]
            q = r.get("question")
            opts = [r.get("option_a"), r.get("option_b"), r.get("option_c"), r.get("option_d")]
            ans = r.get("answer")  # letter A/B/C/D
            if not q or any(o is None for o in opts) or ans not in ("A", "B", "C", "D"):
                continue
            block = "\n".join(f"{l}. {o}" for l, o in zip("ABCD", opts))
            items.append({
                "id": f"gmmlu_hi_{r.get('sample_id', len(items))}",
                "axis": "indic",
                "prompt": (f"निम्नलिखित बहुविकल्पीय प्रश्न का उत्तर दें। केवल सही विकल्प का अक्षर "
                           f"(A/B/C/D) अंतिम पंक्ति में इस रूप में दें: ANSWER: <letter>\n\n{q}\n{block}"),
                "expect": {"answer": ans},
                "meta": {"source": "Global-MMLU-Hindi", "subject": r.get("subject")},
            })
    random.Random(7).shuffle(items)
    save("indic", items[:300])

# -------------------------------------------------------------------- ifeval (subset)
# We implement a focused set of verifiable instruction checkers and keep only IFEval
# items whose instructions are all covered. Kept small + fully deterministic.
SUPPORTED = {
    "keywords:existence", "keywords:frequency", "keywords:forbidden_words",
    "length_constraints:number_words", "length_constraints:number_sentences",
    "detectable_format:number_bullet_lists", "detectable_format:json_format",
    "detectable_format:number_highlighted_sections", "detectable_format:title",
    "change_case:english_lowercase", "change_case:english_uppercase",
    "startend:end_checker", "punctuation:no_comma",
}
def ifeval():
    url = "https://raw.githubusercontent.com/google-research/google-research/master/instruction_following_eval/data/input_data.jsonl"
    items = []
    for line in get(url).text.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        ids = r.get("instruction_id_list", [])
        if not ids or not all(x in SUPPORTED for x in ids):
            continue
        items.append({
            "id": f"ifeval_{r['key']}",
            "axis": "ifeval",
            "prompt": r["prompt"],
            "expect": {"instruction_ids": ids, "kwargs": r.get("kwargs", [])},
            "meta": {"source": "IFEval"},
        })
    save("ifeval", items)

# ------------------------------------------------------------ long-context: needle (synthetic)
def needle():
    # Benign fact-retrieval framing. Earlier "secret access code for the data centre"
    # phrasing tripped Anthropic's content filter (finish_reason=content_filter, empty
    # output) — an artifact of prompt design, not a long-context gap. This is a neutral
    # trivia fact no safety filter objects to. Context sizes are bounded (~1 word ≈ 1.3
    # tokens here) to keep large-input cost sane while still testing deep retrieval.
    rng = random.Random(42)
    FILLER = ("The quarterly logistics review noted steady throughput across regional hubs. "
              "Inventory turns held within target and no material variance was recorded. ")
    items = []
    sizes = [1500, 3000, 5000, 5000, 8000, 8000, 12000, 12000, 16000, 16000,
             20000, 20000, 24000, 24000, 8000, 12000, 16000, 20000, 3000, 24000]
    for i, approx_words in enumerate(sizes):
        fruit = rng.choice(['Alphonso mango', 'Nagpur orange', 'Coorg coffee',
                            'Darjeeling tea', 'Bhut jolokia chilli'])
        num = rng.randint(1000, 9999)
        fact = f"The winning entry number at the {fruit} festival was {num}."
        n_para = max(4, approx_words // 25)
        depth = rng.randint(1, n_para - 2)
        paras = [fact if j == depth else FILLER * rng.randint(1, 2) for j in range(n_para)]
        haystack = "\n\n".join(paras)
        items.append({
            "id": f"needle_{i:02d}_{approx_words}w",
            "axis": "needle",
            "prompt": ("Read the document below and answer the question at the end.\n\n"
                       f"=== DOCUMENT ===\n{haystack}\n=== END ===\n\n"
                       f"Question: What was the winning entry number at the {fruit} festival? "
                       "Answer with ONLY the number in the form: ANSWER: <number>"),
            "expect": {"answer": str(num)},
            "meta": {"source": "synthetic-needle", "approx_words": approx_words, "depth_para": depth},
        })
    save("needle", items)

if __name__ == "__main__":
    only = sys.argv[1:] or ["coding", "math", "indic", "ifeval", "needle"]
    fns = {"coding": coding, "math": math_aime, "indic": indic_milu,
           "ifeval": ifeval, "needle": needle}
    print("Fetching datasets...")
    ok, fail = [], []
    for name in only:
        try:
            fns[name](); ok.append(name)
        except Exception as e:
            fail.append((name, repr(e)[:200])); print(f"  [{name}] FAILED: {repr(e)[:200]}")
    print(f"Done. ok={ok} fail={[f[0] for f in fail]}")
    if fail:
        sys.exit(0 if ok else 1)
