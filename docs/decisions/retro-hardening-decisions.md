# Retrospective hardening decision records

These compact ADRs recover durable decisions from the most significant hardening changes whose rationale previously lived primarily in pull-request and commit history. They are accepted unless a later ADR supersedes them.

Protocol v2 superseded the protocol-v1 cryptography decisions in ADR-007 through ADR-010, ADR-016, ADR-019, and ADR-020. Those entries remain below as historical rationale only; current cryptographic architecture and policy follow [MLS protocol v2](mls-protocol-v2.md). Their general review lessons still apply, but their custom encodings, epoch-key delivery, preview-key handling, TypeScript crypto-module boundary, and crypto mutation policy are not current runtime behavior.

## ADR-007: Canonical authenticated records

- **Context:** JSON serialization order and permissive decoding allow multiple byte representations of the same apparent data.
- **Decision:** Authenticate domain-separated, versioned, deterministic records and reject ambiguous scalar, Unicode, and Base64 encodings.
- **Consequences:** Wire changes require vectors and migration review; interoperability becomes byte-testable.

## ADR-008: Capability-authenticated device enrollment

- **Context:** Invite links and outer relay identity alone cannot safely bind a requesting device key.
- **Decision:** Use an independent invite capability MAC that binds host, requester, device keys, fingerprints, room, epoch, request id, and nonce before approval.
- **Consequences:** Legacy invites are invalidated at encoding transitions; hosts issue fresh links.

## ADR-009: Epoch keys are random and recipient wrapped

- **Context:** Deriving new keys from old epochs or identities would couple compromise domains.
- **Decision:** Generate each epoch key independently and wrap it separately to every eligible pinned device using authenticated static-host ECDH.
- **Consequences:** Rotation state must be persisted for retry and discarded when recipients change.

## ADR-010: Removed devices fail cryptographically

- **Context:** UI removal is insufficient if a device can still obtain future secrets.
- **Decision:** Omit removed devices from rotation recipients and require the exact next-epoch authenticated transition.
- **Consequences:** Lifecycle journeys must prove removed devices cannot decrypt, not only that they disappear from membership state.

## ADR-011: Native shell authorization is exact and one-use

- **Context:** A compromised webview can substitute commands, workspaces, rooms, sessions, or input after a broad approval.
- **Decision:** Rust binds native approval to exact bytes and canonical context, expires it quickly, and atomically consumes it once.
- **Consequences:** Every execution and PTY write needs native authorization; executable allowlists are not trusted boundaries.

## ADR-012: Repeat grants are narrow and memory-only

- **Context:** Identical command prompts cause fatigue, but durable or pattern grants enlarge authority.
- **Decision:** Permit only exact command/room/workspace repeats for ten minutes, in Rust memory, with explicit revocation.
- **Consequences:** Restart clears grants; PTY creation/input never inherits them.

## ADR-013: The workspace is a binding, not a sandbox

- **Context:** A working directory does not prevent scripts, hooks, symlinks, or tools from accessing host authority.
- **Decision:** Describe and enforce canonical workspace binding without claiming filesystem isolation.
- **Consequences:** Dialogs warn about mutable repository behavior and threat documentation avoids sandbox claims.

## ADR-014: Codex activity is bounded and structured

- **Context:** Raw model/tool streams may contain secrets, commands, environment data, or prompt injection.
- **Decision:** Share an allowlisted, bounded typed projection. Reasoning summaries remain the default; host-controlled raw-reasoning sharing is per-room, off by default, and dependent on provider availability.
- **Consequences:** Projection schemas fail closed on unknown fields. Accepted details are encrypted but visible to and retainable by room members, and enabling or disabling raw-reasoning sharing does not provide retroactive revocation.

## ADR-015: Codex transport is injectable

- **Context:** Tests coupled to a real Codex binary are slow, nondeterministic, and cannot safely exercise hostile output.
- **Decision:** Put app-server I/O behind an injectable transport while keeping production framing in one adapter.
- **Consequences:** CI can run deterministic lifecycle and red-team scenarios; adapter contract fixtures remain mandatory.

## ADR-016: Room keys stay out of preview URLs and storage

- **Context:** URLs, logs, history, and browser persistence leak fragments and credentials.
- **Decision:** Keep preview room keys in memory and scrub sensitive join material after bootstrap.
- **Consequences:** Refresh may require rejoining; leak scans cover URLs, logs, and persisted state.

## ADR-017: Relay decision mutation evidence is scheduled

- **Context:** Coverage can execute authorization branches without proving assertions distinguish permissive mutations.
- **Decision:** Run weekly advisory mutation testing across authorization, sessions, WebSocket admission, and room mutation routes. Keep `authz.ts` at zero survivors; use score floors and reviewable reports for the broader decision surface.
- **Consequences:** The full run is intentionally too slow for pull requests. Its first expanded report establishes calibration evidence, while monthly drift review remains advisory and does not require per-refactor allowlists.

## ADR-018: Protocol guards are mutation-gated

- **Context:** TypeScript types do not validate hostile network payloads at runtime.
- **Decision:** Mutation-test runtime discriminants and structural guards at the protocol boundary.
- **Consequences:** New guard behavior needs focused hostile inputs and cannot silently rely on compile-time types.

## ADR-019: Crypto modules stay small and one-way

- **Context:** A monolithic crypto file obscures review boundaries and encourages shared mutable helpers.
- **Decision:** Split types, key material, canonical/AAD encoding, payload AEAD, and wrapping into a one-way dependency graph with file-size limits.
- **Consequences:** Public exports remain narrow and cross-module cycles fail hygiene checks.

## ADR-020: Crypto mutation policy is a ratchet

- **Context:** Mutation scores are easy to improve cosmetically by lowering thresholds or widening ignores.
- **Decision:** Require per-file policy, zero survivors, exact annotated exceptions, deterministic summaries, and reviewable semantic regions.
- **Consequences:** Policy changes receive the same scrutiny as security code changes.

## ADR-021: Property tests target normalization and codecs

- **Context:** Hand-picked strings miss Unicode, view offsets, ordering, and alternate-encoding classes.
- **Decision:** Use seeded replayable properties for canonical encodings, stores, and security normalization, while retaining focused examples.
- **Consequences:** CI failures provide seeds and minimized counterexamples; properties do not replace mutation testing.

## ADR-022: Diagnostic exports are explicitly redacted

- **Context:** Support bundles can accidentally consolidate secrets, paths, message content, and model output.
- **Decision:** Export only schema-allowlisted diagnostics with bounded values and secret-pattern redaction.
- **Consequences:** Diagnostics sacrifice completeness for safe shareability and need hostile-fixture tests.

## ADR-023: Relay inputs fail closed at runtime

- **Context:** Authenticated peers can still send malformed or oversized payloads.
- **Decision:** Validate envelope structure, identity binding, limits, and state transition authorization before mutation or broadcast.
- **Consequences:** Compatibility requires explicit protocol versions rather than permissive parsing.

## ADR-024: Dependencies are pinned conservatively

- **Context:** Floating ranges and unreviewed major batches undermine reproducibility and can break locked installation.
- **Decision:** Pin direct dependencies, use locked installs, group only compatible updates, and reject major updates outside peer ranges.
- **Consequences:** Renovation is deliberate; security patches remain prioritized and verified across all targets.

## ADR-025: Release artifacts are reproducible inputs

- **Context:** A release built inside a write-capable publish job cannot cleanly separate compilation from repository mutation.
- **Decision:** Build with read-only permissions, record hashes/SBOM/provenance, then publish only trusted downloaded artifacts in a minimal write job.
- **Consequences:** Release workflows are longer but review and compromise boundaries are clearer.

## ADR-026: Security evidence must be independent and layered

- **Context:** Checks authored by the same agent as the code can share blind spots.
- **Decision:** Combine unit/property/mutation/journey tests with an independent crypto consumer, CodeQL/Semgrep, dependency/container/secret scanners, and signed provenance.
- **Consequences:** A green build is stronger evidence, but remains explicitly short of an audit.
