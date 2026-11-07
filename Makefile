.PHONY: test test-contract test-operator test-web build wasm
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
