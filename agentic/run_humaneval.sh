#!/bin/bash
# Scaled agentic eval over HumanEval (164 single-function tasks, run through Claude Code).
# 3 flagship arms, cache-accurate 4-component cost via the proxy. Complements the 4 multi-file tasks.
#   BR_KEY=br-... bash run_humaneval.sh <N-tasks>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TASKS_DIR="$ROOT/humaneval-tasks"
KEY="${BR_KEY:-$(grep BR_API_KEY "$HOME/projects/br-model-eval/.env" | cut -d= -f2)}"
N="${1:-164}"
DEADLINE="${BR_EVAL_TIMEOUT:-180}"
STAMP="$(node -e 'console.log(new Date().toISOString().replace(/[:.]/g,"-"))')"
OUT="$ROOT/humaneval-results-$STAMP.jsonl"; : > "$OUT"
MODELS=("kimi-k3|Kimi K3" "gpt-5.6-sol|GPT-5.6 Sol" "claude-fable-5|Claude Fable 5")
# pick first N task dirs (sorted numerically) — bash 3.2-safe (no mapfile on macOS)
TASKS=()
while IFS= read -r t; do TASKS+=("$t"); done < <(ls "$TASKS_DIR" | sed 's/HumanEval_//' | sort -n | head -"$N" | sed 's/^/HumanEval_/')

pkill -f "proxy.mjs" 2>/dev/null; sleep 1
node "$ROOT/proxy.mjs" >/tmp/he-proxy.out 2>&1 & PROXY_PID=$!; sleep 1
trap 'kill $PROXY_PID 2>/dev/null' EXIT

echo "RUN $STAMP | ${#TASKS[@]} HumanEval tasks × ${#MODELS[@]} models = $(( ${#TASKS[@]} * ${#MODELS[@]} )) runs"
pass=0; tot=0
for combo in "${MODELS[@]}"; do
  IFS='|' read -r model label <<< "$combo"
  for task in "${TASKS[@]}"; do
    td="$TASKS_DIR/$task"; [ -d "$td" ] || continue
    wd="$(mktemp -d /tmp/he.XXXXXX)"
    cp "$td/solution.py" "$wd/"
    read i0 o0 cr0 cc0 < /tmp/proxy-tokens.txt
    t0=$(date +%s)
    ( cd "$wd"
      ANTHROPIC_BASE_URL="http://localhost:8791" ANTHROPIC_API_KEY="$KEY" ANTHROPIC_CUSTOM_HEADERS="x-br-api-key: $KEY" \
      ANTHROPIC_DEFAULT_OPUS_MODEL="$model" ANTHROPIC_DEFAULT_SONNET_MODEL="$model" ANTHROPIC_DEFAULT_HAIKU_MODEL="$model" \
      perl -e 'alarm shift; exec @ARGV' "$DEADLINE" \
      claude -p "$(cat "$td/PROMPT")" --dangerously-skip-permissions --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
        --allowedTools "Bash,Edit,Read,Write,Glob,Grep" --output-format json >agent.log 2>&1 )
    ec=$?; secs=$(( $(date +%s) - t0 )); sleep 1
    read i1 o1 cr1 cc1 < /tmp/proxy-tokens.txt
    if ( cd "$wd" && bash "$td/grade.sh" >/dev/null 2>&1 ); then status=pass; pass=$((pass+1)); else status=fail; fi
    tot=$((tot+1))
    row="$(BR_ARM=claude BR_MODEL="$model" BR_LABEL="$label" BR_TASK="$task" BR_REP=1 BR_STATUS="$status" BR_EC="$ec" \
      BR_TI=$((i1-i0)) BR_TO=$((o1-o0)) BR_CR=$((cr1-cr0)) BR_CC=$((cc1-cc0)) BR_SECS="$secs" node "$ROOT/row.mjs")"
    echo "$row" >> "$OUT"
    rm -rf "$wd"
  done
  echo "  [$label] done"
done
echo "DONE $pass/$tot passed → $OUT"
node "$ROOT/summarize.mjs" "$OUT"
