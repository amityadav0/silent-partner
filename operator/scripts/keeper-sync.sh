#!/bin/sh
# After any manual mainnet step that changes the fill log (shield, trade, payout, op.ts epoch),
# refresh the keeper's copy so its posts sign over the latest head. Prints nothing secret.
#   operator/scripts/keeper-sync.sh
set -eu
cd "$(dirname "$0")/.."
V=$(grep '^VAULT_CONTRACT_ID=' ../.env.mainnet | cut -d= -f2-)
base64 < "data-mainnet/fills-$V.jsonl" | tr -d '\n' | gh secret set KEEPER_FILL_LOG --repo amityadav0/silent-partner
echo "KEEPER_FILL_LOG updated: $(wc -l < "data-mainnet/fills-$V.jsonl" | tr -d ' ') entries"
