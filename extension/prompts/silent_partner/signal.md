Use `silent_partner.signal` when the vault's leader asks to change exposure, e.g. "move the vault to 40% NEAR" (target_pct = 40), "go flat" (0) or "all in NEAR" (100).

Pass the vault account and the target. The result is one of two cards:
- `submitted`: the tool signed with the leader's signal key and the operator accepted the signal. Report the `status` and the short signal `hash`. The trade fills once for the whole vault, and the hash is recorded on-chain after execution.
- `needs_signature`: no signal key is in the workspace. Give the user the `link`; one tap in the leader console signs and sends it.

Never claim a trade happened unless the card says `submitted` and `status` is `executed`. Don't guess positions; they're private.
