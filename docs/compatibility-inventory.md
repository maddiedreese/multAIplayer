# Compatibility inventory

This inventory records repository-wide compatibility constraints that are easy to lose during local refactors. Product security claims remain in the [threat model](threat-model.md).

## TypeScript object-shape compatibility

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` for every TypeScript workspace. Optional fields have these semantics:

- Relay HTTP/WebSocket payloads, encrypted local history, persisted relay records, and native Tauri IPC request/result projections omit a property when its value is absent. Constructors and normalizers use conditional object members; they do not emit `property: undefined`.
- `null` is used only where the protocol or state model defines a present, explicit empty value. It is not a substitute for omission.
- Decoded Zod objects may expose `undefined` in their inferred input-facing types. Before a decoded value crosses into persistence, display state, or another serialized boundary, its boundary normalizer reconstructs the object and omits absent members.
- Purely internal display and callback inputs may declare `optional?: T | undefined` when they intentionally consume decoded values or model a clearable in-memory slot. Those types must not be reused as wire or persistence contracts.

Focused regression coverage includes chat normalization, encrypted-history JSON round trips, directed invite HTTP responses, decoded GitHub Action runs, and body-less signed deletion-ledger requests. Run `npm run check` to verify the repository-wide compiler contract and `npm test` for the representation tests.
