# Threat-model changelog

This public changelog records material changes to multAIplayer's security assumptions, trust boundaries, guarantees, and known limitations. It complements the current [threat model](threat-model.md), which remains the normative description of the present design. Implementation-only fixes that do not change a boundary may stay in ordinary release notes.

## 2026-07-11

- Defined host handoff as a future-authority transition, not erasure: an outgoing host can retain all previously observed content and key material, while an incoming host must re-verify identities, device keys, membership, local execution context, credentials, pending actions, and approval policy before creating a fresh epoch. See the [host-handoff ADR](decisions/host-handoff.md).
- Made the unaudited status explicit. The custom cryptographic protocol has not received an independent professional audit; end-to-end encryption is design intent supported by tests, not a verified security guarantee.
- Documented third-party release reproduction and comparison. Signed/notarized macOS containers are not currently bit-for-bit reproducible because Apple signing, notarization, stapling, and packaging add environment-dependent data.
- Added public canonical-encoder and key-wrapping vectors as a stable review surface, with a repository check that regenerates or verifies the committed data.
- Treat room-originated text, attachments, fetched pages, rendered content, model output, and peer-proposed actions as untrusted inputs to Codex and native approvals. Network-touching and credential-file-touching commands are denied even when broader approval defaults would otherwise permit execution, and approval displays identify proposal and context provenance.
- Hardened the crypto receive boundary without changing valid emitted wire bytes or domain strings: noncanonical Base64 spellings, invalid payload discriminants, malformed device/local/attachment contexts, unpinned sender keys, and invalid invite/rotation transitions now fail closed. Ordinary room/local/attachment version 2 ciphertext, unversioned legacy device seals, and version 1 standalone room-secret wraps remain decrypt-only compatibility paths with the same validation as canonical routes; authenticated room-secret delivery remains version 3 only.
- Split the crypto migration boundary into focused key-material, authenticated-data, payload, and device-wrapping modules without changing its package-root API, emitted bytes, algorithms, domains, or compatibility paths. The same 595-mutant policy baseline remains at 100%, and repository hygiene prevents implementation modules from growing beyond 250 lines.

## Maintenance rule

Add a dated entry in the same pull request whenever a change adds or removes a trust boundary, changes cryptographic formats or key lifecycle, weakens or strengthens a security claim, introduces a new privileged surface, or closes a published limitation. Link the ADR, protocol section, test vector, or release note that lets readers inspect the change.
