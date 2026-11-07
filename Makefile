.PHONY: test test-contract test-operator test-web build wasm e2e screens
test: test-contract test-operator test-web
test-contract:
	cd contract && cargo test && cargo clippy --all-targets -- -D warnings
test-operator:
	cd operator && npm run typecheck && npm test
test-web:
	cd web && npx tsc --noEmit && npm test
wasm:
	cd contract && cargo near build non-reproducible-wasm
build: wasm
	cd operator && npm run build
	cd web && npm run build
# Playwright against the static export + live testnet (start the testnet operator first:
#   cd operator && npx tsx --env-file-if-exists=../.env scripts/serve-testnet.ts)
e2e:
	cd web && npm run build && npx playwright test e2e/smoke.spec.ts
screens:
	cd web && npm run build && npx playwright test e2e/screens.spec.ts
