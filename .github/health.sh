#!/usr/bin/env bash
# Uptime guard for the hosted demo (through 2026-11-25). Run by .github/workflows/health.yml.
# Checks: the Pages site, the age of the latest season tick, one vault's last NAV over
# testnet RPC, NEAR AI availability and low-balance warnings from the season tick.
# A stale tick reruns the season workflow once; anything still wrong opens or updates
# one GitHub issue labelled "uptime", which is closed when everything recovers.
# DRY=1 prints what it would do instead of dispatching or touching issues.
set -uo pipefail
: "${GH_REPO:?set GH_REPO=owner/repo}"
SITE=${SITE:-https://amityadav0.github.io/silent-partner/}
RPC=${RPC:-https://rpc.testnet.fastnear.com}
VAULT=${VAULT:-sp-momo-92991.testnet}
MAINNET_RPC=${MAINNET_RPC:-https://rpc.mainnet.fastnear.com}
MAINNET_VAULT=${MAINNET_VAULT:-1f80f62c945eec98005dac38ab9db5f95c44ef1258cf5ca9606fb8c7dd4da36e}
MAINNET_STALE_MIN=${MAINNET_STALE_MIN:-360}
STALE_MIN=${STALE_MIN:-45}
NAV_STALE_MIN=${NAV_STALE_MIN:-60}
WAIT_MIN=${WAIT_MIN:-20}
DRY=${DRY:-0}
problems=()
now() { date -u +%s; }

run_json() { gh api "repos/$GH_REPO/contents/last-run.json?ref=season-state" -q .content | base64 -d; }
tick_age_min() {
  local at; at=$(run_json | jq -r .ranAt) || return 1
  echo $(( ($(now) - $(date -u -d "$at" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%S" "${at%.*}" +%s)) / 60 ))
}
nav_age_min() { # [rpc] [vault]
  local rpc=${1:-$RPC} vault=${2:-$VAULT}
  local args; args=$(printf '{}' | base64)
  local ms; ms=$(curl -s -m 30 "$rpc" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$vault\",\"method_name\":\"get_vault\",\"args_base64\":\"$args\"}}" \
    | jq -r '.result.result | implode | fromjson | .last_nav_ms') || return 1
  echo $(( ($(now) - ms / 1000) / 60 ))
}

# 1. Pages
code=$(curl -s -o /tmp/sp-site.html -w '%{http_code}' -m 30 "$SITE")
grep -q 'Not the crowd' /tmp/sp-site.html || problems+=("Pages site: HTTP $code, landing text missing ($SITE)")

# 2. Season tick, with one rerun if stale
age=$(tick_age_min) || age=9999
echo "season tick age: ${age} min"
if (( age > STALE_MIN )); then
  if [[ $DRY == 1 ]]; then echo "DRY: would run: gh workflow run season.yml"; else
    gh workflow run season.yml
    for ((i = 0; i < WAIT_MIN; i++)); do sleep 60; age=$(tick_age_min) || age=9999; (( age <= STALE_MIN )) && break; done
  fi
  (( age > STALE_MIN )) && problems+=("Season tick is ${age} min old after a rerun of season.yml")
fi

# 3. One vault's NAV, straight from testnet RPC
nav=$(nav_age_min) || nav=9999
echo "$VAULT last NAV: ${nav} min ago"
(( nav > NAV_STALE_MIN )) && problems+=("$VAULT: last NAV ${nav} min ago (RPC $RPC)")

# 3b. Mainnet vault: the keeper (keeper.yml, every 3 h + every season tick) must keep the
# last accepted post well inside the 24 h emergency. Over 6 h: dispatch the keeper, alert.
mnav=$(nav_age_min "$MAINNET_RPC" "$MAINNET_VAULT") || mnav=9999
echo "mainnet vault last accepted post: ${mnav} min ago"
if (( mnav > MAINNET_STALE_MIN )); then
  if [[ $DRY == 1 ]]; then echo "DRY: would run: gh workflow run keeper.yml"; else gh workflow run keeper.yml || true; fi
  problems+=("MAINNET vault: last accepted price post ${mnav} min ago (emergency at 1440). keeper.yml was dispatched; if it fails, post by hand: cd operator && echo yes | npx tsx --env-file=../.env.mainnet scripts/op.ts epoch")
fi

# 4. NEAR AI and balances, from the tick's public summary
summary=$(run_json)
down=$(echo "$summary" | jq '[.results[] | select(.ai_model) | select(.ai_status == "unavailable" or (.ai_status == null and .ai_tokens == null))] | length')
total=$(echo "$summary" | jq '[.results[] | select(.ai_model)] | length')
echo "AI leaders unavailable: $down of $total"
(( total > 0 && down == total )) && problems+=("NEAR AI unavailable for all $total AI leaders at the last tick: $(echo "$summary" | jq -r '[.results[] | select(.ai_error) | .ai_error][0] // "no error text"'). They hold until it answers.")
while IFS= read -r w; do [[ -n $w ]] && problems+=("Low balance: $w (see docs/keep-online.md)"); done < <(echo "$summary" | jq -r '(.warnings // [])[] | "\(.account): \(.free_near) NEAR, \(.days_left) days"')

# 5. Report
open=$(gh issue list --label uptime --state open --json number -q '.[0].number' 2>/dev/null || true)
if (( ${#problems[@]} )); then
  body=$(printf -- '- %s\n' "${problems[@]}"; printf '\nChecked %s by the health workflow.\n' "$(date -u +%FT%TZ)")
  printf '%s\n' "$body"
  if [[ $DRY == 1 ]]; then echo "DRY: would ${open:+comment on #$open}${open:-open an uptime issue}"; exit 1; fi
  if [[ -n $open ]]; then gh issue comment "$open" --body "$body"; else
    gh label create uptime --color B9401F --description "Hosted demo health" 2>/dev/null || true
    gh issue create --title "Demo health: needs attention" --label uptime --body "$body"
  fi
  exit 1
fi
echo "all healthy"
if [[ -n $open ]]; then
  if [[ $DRY == 1 ]]; then echo "DRY: would close #$open"; else gh issue close "$open" --comment "Recovered at $(date -u +%FT%TZ)."; fi
fi
