.PHONY: setup test test-contract test-operator test-web build wasm e2e screens
# A fresh clone needs only `make test`: npm dependencies install on first use.
operator/node_modules: operator/package-lock.json
	cd operator && npm ci
web/node_modules: web/package-lock.json
	cd web && npm ci
setup: operator/node_modules web/node_modules
	cd web && npx playwright install chromium
test: test-contract test-operator test-web
test-contract:
	cd contract && cargo test && cargo clippy --all-targets -- -D warnings
test-operator: operator/node_modules
	cd operator && npm run typecheck && npm test
test-web: web/node_modules
	cd web && npx tsc --noEmit && npm test
wasm:
	cd contract && cargo near build non-reproducible-wasm
build: wasm operator/node_modules web/node_modules
	cd operator && npm run build
	cd web && npm run build
# Playwright against the static export + live testnet (start the testnet operator first:
#   cd operator && npx tsx --env-file-if-exists=../.env scripts/serve-testnet.ts)
e2e: setup
	cd web && npm run build && npx playwright test e2e/smoke.spec.ts
screens: setup
	cd web && npm run build && npx playwright test e2e/screens.spec.ts
