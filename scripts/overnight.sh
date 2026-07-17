#!/bin/bash
# Unattended orchestrator: preflight -> smoke -> assert -> full -> metrics -> charts.
# Stops immediately if preflight or smoke assertions fail. Hard ₹ cap on the full run.
set -uo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M%S)
LOG=results/overnight-$STAMP.log
exec > >(tee -a "$LOG") 2>&1
echo "=== OVERNIGHT $STAMP ==="

echo "--- preflight ---"
node --env-file=.env src/preflight.mjs || { echo "ABORT: preflight failed"; exit 1; }

echo "--- smoke ---"
node --env-file=.env src/run.mjs --mode smoke --tag smoke-$STAMP || { echo "ABORT: smoke run errored"; exit 1; }
node src/check_smoke.mjs smoke-$STAMP || { echo "ABORT: smoke assertions failed"; exit 1; }

echo "--- full run (cap Rs 35000) ---"
node --env-file=.env src/run.mjs --mode half --tag full-$STAMP --cap 35000 --pool 6 || { echo "WARN: full run exited non-zero"; }

echo "--- metrics + charts ---"
node src/metrics.mjs full-$STAMP
node src/charts.mjs

echo "=== OVERNIGHT COMPLETE $STAMP (tag full-$STAMP) ==="
