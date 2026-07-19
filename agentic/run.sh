#!/bin/bash
# Part 2 — agentic coding benchmark. Runs each (arm × model) over the deterministic
# eval tasks: sets up a scratch workdir, drives the real coding agent headless via
# BharatRouter, grades with the task's grade.sh (exit-code + shasum test-guard), and
# records solve/fail + tokens + ₹ + seconds per task.
#
#   BR_KEY=br-... bash run.sh [--repeats N] [--tasks "bugfix feature ..."]
#
# Arms: codex (codex exec), claude (claude -p, reduced toolset). Cost is computed locally
# from the agent's reported token usage × the model's catalog rate (BYOK bills ₹0 on BR).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TASKS_DIR="$HOME/projects/bharatrouter-code-gui/evals/tasks"
KEY="${BR_KEY:-$(grep BR_API_KEY "$HOME/projects/br-model-eval/.env" | cut -d= -f2)}"
API="https://api.bharatrouter.com"
DEADLINE="${BR_EVAL_TIMEOUT:-300}"
REPEATS=1
TASKS="bugfix feature refactor no-false-refusal"
while [ $# -gt 0 ]; do case "$1" in --repeats) REPEATS="$2"; shift 2;; --tasks) TASKS="$2"; shift 2;; *) shift;; esac; done

STAMP="$(node -e 'console.log(new Date().toISOString().replace(/[:.]/g,"-"))')"
OUT="$ROOT/results-$STAMP.jsonl"; : > "$OUT"
CODEX_HOME_DIR="/tmp/codex-eval-home"; mkdir -p "$CODEX_HOME_DIR"
cp "$HOME/projects/cookbook/recipes/13-kimi-k3-coding-agents/codex-config.toml" "$CODEX_HOME_DIR/config.toml"

# Claude Code can't self-report tokens for a custom endpoint, so route it through the
# logging proxy which tallies BR's real usage into /tmp/proxy-tokens.txt.
PROXY_URL="http://localhost:8791"
pkill -f "proxy.mjs" 2>/dev/null; sleep 1
node "$ROOT/proxy.mjs" >/tmp/proxy.out 2>&1 &
PROXY_PID=$!; sleep 1
trap 'kill $PROXY_PID 2>/dev/null' EXIT

# arm|model|label — three flagships inside Claude Code (Kimi / Fable / Sol, all via the
# BR /v1/messages translate path) + Codex cross-checking Kimi on the native /v1/responses path.
# Sol via BR works through Claude Code (/v1/messages threads tool-calls correctly after BR
# #371/#374). codex|gpt-5.6-sol stays OFF: BR's /v1/responses shim drops tool-result threading
# across turns ("tool_call_ids did not have response messages") — needs the full Responses
# translator (roadmap), not a config flag.
COMBOS=(
  "codex|kimi-k3|Kimi K3"
  "claude|kimi-k3|Kimi K3"
  "claude|claude-fable-5|Claude Fable 5"
  "claude|gpt-5.6-sol|GPT-5.6 Sol"
)

run_agent() { # arm model workdir promptfile  -> prints "<exit> <tokens_in> <tokens_out>" ; writes agent.log
  local arm="$1" model="$2" wd="$3" pf="$4"; local prompt; prompt="$(cat "$pf")"
  cd "$wd"
  if [ "$arm" = "codex" ]; then
    CODEX_HOME="$CODEX_HOME_DIR" BHARATROUTER_API_KEY="$KEY" \
      perl -e 'alarm shift; exec @ARGV' "$DEADLINE" \
      codex exec -c "model=$model" --dangerously-bypass-approvals-and-sandbox "$prompt" >agent.log 2>&1
    local ec=$?
    # codex prints "tokens used\n<N>" (total). It doesn't expose a cache breakdown, so
    # cache-read/creation are 0 here → codex cost is the cache-cold ceiling (flagged approx).
    local tot; tot="$(grep -A1 -i 'tokens used' agent.log | tail -1 | tr -d ', ' | grep -oE '[0-9]+' | head -1)"
    echo "$ec ${tot:-0} 0 0 0"
  else
    # route through the proxy so BR's real token usage is tallied (Claude Code reports 0 for
    # a custom endpoint). Diff /tmp/proxy-tokens.txt across the run to get this task's tokens.
    # Four counters: uncached-input, output, cache-read, cache-creation.
    read pin0 pout0 pcr0 pcc0 < /tmp/proxy-tokens.txt
    export ANTHROPIC_BASE_URL="$PROXY_URL" ANTHROPIC_API_KEY="$KEY" ANTHROPIC_CUSTOM_HEADERS="x-br-api-key: $KEY" \
           ANTHROPIC_DEFAULT_OPUS_MODEL="$model" ANTHROPIC_DEFAULT_SONNET_MODEL="$model" ANTHROPIC_DEFAULT_HAIKU_MODEL="$model"
    perl -e 'alarm shift; exec @ARGV' "$DEADLINE" \
      claude -p "$prompt" --dangerously-skip-permissions --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
        --allowedTools "Bash,Edit,Read,Write,Glob,Grep" --output-format json >agent.log 2>&1
    local ec=$?
    sleep 1  # let the proxy flush the final response's usage
    read pin1 pout1 pcr1 pcc1 < /tmp/proxy-tokens.txt
    echo "$ec $(( pin1 - pin0 )) $(( pout1 - pout0 )) $(( pcr1 - pcr0 )) $(( pcc1 - pcc0 ))"
  fi
}

echo "RUN $STAMP | tasks: $TASKS | repeats: $REPEATS | ${#COMBOS[@]} arm×model combos"
for combo in "${COMBOS[@]}"; do
  IFS='|' read -r arm model label <<< "$combo"
  for task in $TASKS; do
    td="$TASKS_DIR/$task"; [ -d "$td" ] || { echo "  skip $task (missing)"; continue; }
    for r in $(seq 1 "$REPEATS"); do
      wd="$(mktemp -d /tmp/agx.XXXXXX)"
      # seed the workdir with everything except PROMPT/grade.sh (keep them pristine outside)
      for f in "$td"/*; do b="$(basename "$f")"; [ "$b" = PROMPT ] || [ "$b" = grade.sh ] || cp -R "$f" "$wd/"; done
      [ -f "$wd/package.json" ] || echo '{"type":"commonjs"}' > "$wd/package.json"
      t0=$(date +%s)
      read ec ti to cr cc < <(run_agent "$arm" "$model" "$wd" "$td/PROMPT")
      secs=$(( $(date +%s) - t0 ))
      # grade deterministically in the workdir
      if ( cd "$wd" && bash "$td/grade.sh" >grade.log 2>&1 ); then status=pass; else status=fail; fi
      row="$(BR_ARM="$arm" BR_MODEL="$model" BR_LABEL="$label" BR_TASK="$task" BR_REP="$r" \
        BR_STATUS="$status" BR_EC="$ec" BR_TI="$ti" BR_TO="$to" BR_CR="$cr" BR_CC="$cc" BR_SECS="$secs" \
        node "$ROOT/row.mjs")"
      echo "$row" >> "$OUT"
      echo "  [$arm/$model] $task#$r → $status  ${secs}s  in=$ti out=$to  $(echo "$row" | node -e 'let d=JSON.parse(require("fs").readFileSync(0));console.log("₹"+d.inr)')"
      rm -rf "$wd"
    done
  done
done
echo "DONE → $OUT"
node "$ROOT/summarize.mjs" "$OUT"
