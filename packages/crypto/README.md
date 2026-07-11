# `@multaiplayer/crypto`

This package contains multAIplayer's small Web Crypto-based cryptographic boundary. Keep runtime dependencies and exported primitives deliberately limited so the code remains feasible for focused third-party review.

## Interoperability vectors

[`test-vectors/v1.json`](test-vectors/v1.json) publishes stable UTF-8/hex canonical-encoding vectors and a deterministic authenticated room-secret wrapping vector. Private keys and the fixed nonce in that file exist only as public test fixtures and must never be used outside interoperability tests.

Run `npm test -w @multaiplayer/crypto` to verify the published vectors, hostile-input properties, and cryptographic round trips. Implementations checking the wrapping vector must reproduce these steps:

1. Encode the listed context with `canonicalAuthenticatedRecord`, using domain `multaiplayer:authenticated-room-secret-wrap:v2` and version `1`.
2. Perform P-256 ECDH with the sender private key and recipient public key.
3. Use HKDF-SHA-256 with `SHA-256(AAD)` as salt and the UTF-8 domain above as `info` to derive a 256-bit AES-GCM key.
4. Encrypt the exact listed plaintext with the fixed 96-bit nonce and canonical bytes as AAD. The published ciphertext includes the 128-bit GCM tag.

The cryptography is unaudited. End-to-end encryption properties described by this package and the wider project are design intent, not independently verified guarantees.

## Encoding contract

`base64ToBytes` accepts only canonical RFC 4648 base64: standard alphabet, required padding for partial final groups, and no whitespace or alternate encodings of the same bytes. Crypto payload parsing deliberately rejects permissive decoder aliases so authenticated values have one wire representation.

## Mutation reports

Run `npm run test:mutation -w @multaiplayer/crypto` to generate HTML, mutation-testing-elements JSON, and a deterministic summary under `packages/crypto/reports/mutation/`. The generated reports are ignored locally and retained as CI artifacts for 14 days. The summary keeps every mutant status and source location while removing volatile run metadata so survivor classification and score changes can be compared reliably.

The current mutation threshold is a baseline ratchet, not a security claim. Surviving authentication, validation, key-binding, version, algorithm, or context mutants must be eliminated or narrowly proven equivalent before the ratchet is raised; broad mutation-class exclusions are temporary migration debt.

Repository-owned gates live in [`mutation-policy.json`](mutation-policy.json). They enforce per-file score floors and zero surviving mutants for hardened modules, reject uncovered or incomplete mutants and unexplained mutation-run errors, disallow broad mutator exclusions in governed files, and require every accepted timeout to match an exact source signature with a written rationale. Raise a floor after improving it; do not lower a floor to make CI pass.
