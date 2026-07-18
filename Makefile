# br-model-eval — quality x cost benchmark of frontier models through BharatRouter.
# One key (BR_API_KEY in .env); provider keys live in BR's BYOK vault, not here.

.PHONY: help datasets preflight smoke half metrics charts test clean

help:
	@echo "make datasets   fetch + normalize all benchmark axes"
	@echo "make preflight  funding canary — one tiny call per model"
	@echo "make smoke      ~10/axis proving run (cheap)"
	@echo "make half       the full smart-half run (~Rs 23.5k of BYOK spend)"
	@echo "make metrics    aggregate newest raw run -> results/summary.json"
	@echo "make charts     render charts + HTML report from summary.json"
	@echo "make test       offline grader unit tests"

datasets:
	uv run datasets/loaders/fetch_all.py

preflight:
	node --env-file=.env src/preflight.mjs

smoke:
	node --env-file=.env src/run.mjs --mode smoke

half:
	node --env-file=.env src/run.mjs --mode half

metrics:
	node src/metrics.mjs

charts:
	node src/charts.mjs

test:
	node --test test/*.test.js

clean:
	rm -rf results/raw/* results/*.manifest.json
