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

The mutation gate requires a 100% score overall and in every source file, with zero surviving mutants; any new source file fails until it receives a whole-file policy rule. The measured ratchet covers 378 scored mutants. TypeScript-checker compile errors are retained in the report as detected invalid programs, and nine narrowly annotated ignores cover one equivalent surrogate-predicate replacement plus non-extractability flags that the public API cannot observe. A perfect mutation score is evidence about this test suite, not a security audit or a cryptographic guarantee.

Repository-owned gates live in [`mutation-policy.json`](mutation-policy.json). They enforce the per-file 100% ratchet and zero surviving mutants, reject uncovered or incomplete mutants and unexplained mutation-run errors, disallow broad mutator exclusions in governed files, and require every accepted timeout to match an exact source signature with a written rationale. Do not lower a floor or widen an ignore to make CI pass.

Large modules are hardened incrementally with paired `// mutation-policy:start <name>` and `// mutation-policy:end <name>` comments. Every mutant fully inside a configured region must satisfy that region's status limits. Markers must be unique and cannot nest; missing, reversed, or boundary-crossing markers fail the gate. Moving a marker to exclude code is a mutation-policy change and requires the same scrutiny as lowering a score floor.

The governed AAD regions are `device-context-aad`, `room-envelope-aad`, `local-aad`, and the attachment AAD inside `attachment-wrapper`. Their domains, canonical fields, and compatibility behavior are wire-protocol inputs documented in the [cryptography architecture](../../docs/cryptography.md); changing them requires the protocol-level process described there.

Every crypto source file has a whole-file 100%/zero-survivor gate. Named regions remain as semantic audit zones inside the larger `index.ts` boundary.
