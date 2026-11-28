#!/usr/bin/env bash
# Top up every testnet season account to TARGET_DAYS of spend, from the funder
# accounts given as arguments (keys must be in ~/.near-credentials/testnet/).
# Testnet only. Reads live balances, so it's safe to rerun.
#
#   bash operator/scripts/topup-season.sh sp-gas-1128a sp-gas-1128b ...
#   DRY=1 bash operator/scripts/topup-season.sh x      # print each account's need and the total, send nothing
set -euo pipefail
cd "$(dirname "$0")/../.."
TARGET_DAYS=${TARGET_DAYS:-15}
RPC=${RPC:-https://rpc.testnet.near.org}
[ $# -ge 1 ] || { echo "usage: $0 <funder> [funder...]  (testnet account names, .testnet optional)"; exit 1; }

# Accounts and daily spend, as season.ts budgets them, except the operator: it
# also pays fills and the auto top-ups, so it gets a flat 7 NEAR target.
TARGETS=$(python3 - "$TARGET_DAYS" <<'EOF'
import json, sys
d = json.load(open("operator/season/vaults.json")); days = float(sys.argv[1])
for v in d["vaults"]:
    if v["strategy"] != "drill": print(v["id"], round(0.29 * days, 2))
for a in d.get("auto_topup", []):
    if not any(v["id"] == a for v in d["vaults"]): print(a, round(0.29 * days, 2))
print(d["operator"], 7)
EOF
)

free() { # free NEAR above storage
  curl -s --max-time 20 "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(round(int(r['amount'])/1e24 - r['storage_usage']*1e-5, 3))"
}

FUNDERS=(); for f in "$@"; do FUNDERS+=("${f%.testnet}.testnet"); done
fi=0
while read -r acct target; do
  have=$(free "$acct")
  need=$(python3 -c "print(max(0, round($target - $have, 2)))")
  echo "$acct: $have free, target $target, needs $need"
  total=$(python3 -c "print(round(${total:-0} + $need, 2))")
  [ "${DRY:-}" = 1 ] && continue
  while python3 -c "import sys; sys.exit(0 if $need > 0.01 else 1)"; do
    [ $fi -lt ${#FUNDERS[@]} ] || { echo "funders exhausted; add more and rerun"; exit 2; }
    src=${FUNDERS[$fi]}
    avail=$(python3 -c "print(max(0, round($(free "$src") - 0.2, 2)))")   # keep 0.2 for gas
    amt=$(python3 -c "print(min($need, $avail))")
    if python3 -c "import sys; sys.exit(0 if $amt < 0.05 else 1)"; then fi=$((fi + 1)); continue; fi
    near tokens "$src" send-near "$acct" "$amt NEAR" network-config testnet sign-with-keychain send 2>&1 |
        grep -oE "Transaction ID: [A-Za-z0-9]+" | sed "s/^/  $src -> $acct $amt NEAR  /"
    need=$(python3 -c "print(round($need - $amt, 2))")
  done
done <<< "$TARGETS"
echo "total needed: $total NEAR"
