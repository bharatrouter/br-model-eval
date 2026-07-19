import gzip, io, json, os, urllib.request, stat
UA={'User-Agent':'Mozilla/5.0'}
url="https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz"
req=urllib.request.Request(url, headers=UA)
raw=gzip.decompress(urllib.request.urlopen(req, timeout=120).read()).decode()
probs=[json.loads(l) for l in raw.splitlines() if l.strip()]
root=os.path.expanduser("~/projects/br-agentic-eval/humaneval-tasks")
os.makedirs(root, exist_ok=True)
n=0
for p in probs:
    tid=p["task_id"].replace("/","_")   # HumanEval/0 -> HumanEval_0
    d=os.path.join(root, tid); os.makedirs(d, exist_ok=True)
    # stub: the prompt IS the signature+docstring (no body) — seed as solution.py
    with open(os.path.join(d,"solution.py"),"w") as f: f.write(p["prompt"])
    # PROMPT for the agent
    with open(os.path.join(d,"PROMPT"),"w") as f:
        f.write(f"Implement the function in solution.py so all tests pass. "
                f"The file already has the signature and docstring — complete the body. "
                f"Do not rename the function. When done, the hidden test suite must pass.\n")
    # grade.sh embeds the hidden test (kept out of the agent's workdir); run at grade time
    ep=p["entry_point"]; test=p["test"]
    gs=os.path.join(d,"grade.sh")
    with open(gs,"w") as f:
        f.write("#!/bin/bash\ncat > _grade_test.py <<'HUMANEVAL_EOF'\n")
        f.write("from solution import "+ep+"\n")
        f.write(test+"\n")
        f.write("check("+ep+")\nprint('OK')\n")
        f.write("HUMANEVAL_EOF\n")
        f.write("python3 _grade_test.py; rc=$?; rm -f _grade_test.py; exit $rc\n")
    os.chmod(gs, os.stat(gs).st_mode | stat.S_IEXEC)
    n+=1
print(f"materialized {n} HumanEval agentic tasks -> {root}")
