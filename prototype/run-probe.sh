#!/usr/bin/env bash
# Drives N headless turns of one session through the lr-probe mod.
# usage: run-probe.sh <ctx|noctx> [turns]
set -euo pipefail
mode=$1; turns=${2:-10}
here=$(cd "$(dirname "$0")" && pwd)
out=/tmp/lr-probe/$mode; mkdir -p "$out" /tmp/lr-probe-cwd; rm -f /tmp/lr-probe/*.json
tag=""; [ "$mode" = ctx ] && tag="[CTX]"
cd /tmp/lr-probe-cwd
sid=""
for i in $(seq 1 "$turns"); do
  args=(-p --model haiku --plugin-dir "$here/probe" --allowedTools 'mcp__lumberroom__*' --output-format json)
  [ -n "$sid" ] && args+=(--resume "$sid")
  res=$(claude "${args[@]}" "Reply with the single word OK. $tag turn $i")
  sid=$(jq -r .session_id <<<"$res")
done
mv /tmp/lr-probe/*.json "$out/"
jq -r '.[] | "\(.turn) \(.index) \(.input)"' "$out/steps.json"
