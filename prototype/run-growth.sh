#!/usr/bin/env bash
# Token growth over N headless turns with the lumberroom-memory plugin loaded (spec 2.1 method).
# The probe logs each model request's input tokens; the plugin does recall.
# usage: run-growth.sh <label> [plugin|none] [turns]
set -euo pipefail
label=$1; with=${2:-plugin}; turns=${3:-10}
here=$(cd "$(dirname "$0")" && pwd); repo=$(dirname "$here")
out=/tmp/lr-probe/$label; mkdir -p "$out"; rm -f /tmp/lr-probe/*.json
prompts=(
  "What did the owner decide about Cloudflare D1 for lumberroom?"
  "Which ports does the hermes plugin gate script use?"
  "Where does the lumberroom CLI live on the Linux host?"
  "What is the rule about running cargo builds in parallel?"
  "How should waits on CI be done?"
  "What model routing does the owner prefer for fixers?"
  "What happened with the refresh token replay in the CLI?"
  "Which repo holds the openclaw plugin?"
  "What is the rule about touching vyaah-prod?"
  "Summarise in one line what you know about the teams build."
)
dirs=(--plugin-dir "$here/probe"); [ "$with" = plugin ] && dirs+=(--plugin-dir "$repo")
cd "${ENGINE_DIR:-$repo/../lumberroom}"
sid=""
for i in $(seq 1 "$turns"); do
  args=(-p --model haiku "${dirs[@]}" --output-format json)
  [ -n "$sid" ] && args+=(--resume "$sid")
  res=$(claude "${args[@]}" "Do not call any tool. Answer in one sentence from what this session already shows you. turn $i: ${prompts[$((i-1))]}" </dev/null)
  sid=$(jq -r .session_id <<<"$res")
  jq -r '.result' <<<"$res" | head -c 300 > "$out/answer-t$i.txt"
done
echo "$sid" > "$out/session_id"
mv /tmp/lr-probe/*.json "$out/" 2>/dev/null || true
jq -r '.[] | select(.index==0) | "\(.turn) \(.input)"' "$out/steps.json"
