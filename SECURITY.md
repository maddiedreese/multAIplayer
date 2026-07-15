# Security Policy

multAIplayer is an honest alpha. Please treat it as security-sensitive software because it coordinates local project files, terminals, GitHub access, browser state, and a local Codex host.

## Supported Scope

Security reports are welcome for the current `main` branch and latest published alpha release. Older alphas and unreleased branches are unsupported; upgrade or reproduce on `main` when possible.

The intended security properties are:

- the relay does not persist plaintext chat transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, file diffs, host-local project paths, Codex model configuration, or GitHub access tokens. It observes a GitHub token transiently during sign-in identity verification, then discards it; native pull-request and Actions calls go directly to GitHub;
- room events are RFC 9420 MLS PrivateMessages, while attachments are encrypted with per-blob keys derived by the native MLS core;
- active project paths and Codex model/tuning configuration are member-only `room.config` payloads; the relay receives MLS ciphertext and routing metadata, not those plaintext values;
- MLS authenticated data binds canonical room, sender, event-kind, timestamp, message-id, and epoch routing fields;
- invite approval binds an independent random single-use bearer capability to an authenticated requester, exact KeyPackage hash, and pinned host HPKE key before an MLS Add and Welcome are created;
- membership changes use MLS Add and Remove commits, and both native clients and the relay enforce that only the active host can commit;
- MLS signature and HPKE private keys, group state, exporter output, history secrets, and per-blob keys remain behind the Rust IPC boundary. Versioned identity and SQLCipher-wrapping keys use the operating-system credential store; SQLCipher also holds the durable copy of the latest validated room configuration used for retry;
- retained exporter-derived history secrets intentionally preserve local history readability across epochs, so forward secrecy applies to live traffic rather than retained device-local history;
- browser builds contain no preview workspace and do not initialize identity, relay, project, or MLS state;
- GitHub access tokens remain behind the native Rust IPC boundary in the operating-system credential store and are excluded from webview state, room events, relay sessions, and diagnostics;
- relay session cookies are high-entropy bearer tokens; persistence stores only their SHA-256 digests, identity metadata, and expiry, while legacy plaintext session-id rows are migrated and rewritten on startup;
- production account deletion fails closed around an authenticated HMAC-pseudonymous external ledger: the tombstone commits before primary deletion, protected identities lose authenticated access immediately, and every startup reconciles the complete active ledger before listening;
- production relays require authentication by default; unauthenticated relay mode is an explicit self-host opt-out.

Remaining alpha limitations are documented in [docs/threat-model.md](docs/threat-model.md), especially retroactive erasure, recovery, and local-machine risk.

Release-specific checks, journey evidence, and artifact trust notes are tracked in the [external review and engineering guide](docs/external-review-packet.md).

## Reporting

Please use [GitHub private vulnerability reporting](https://github.com/maddiedreese/multAIplayer/security/advisories/new). If private reporting is unavailable, email [maddie@maddiedreese.com](mailto:maddie@maddiedreese.com). Do not open a public issue or include vulnerability details or sensitive data in a public channel.

Good reports include:

- affected app or package;
- commit or version tested;
- local reproduction steps using dummy secrets;
- expected vs actual behavior;
- whether the issue affects the relay, native desktop app, browser install notice, or documentation.

Expect an initial acknowledgement within 3 business days and a status update at least every 7 days while a report remains open. We coordinate fixes and release timing privately, aim to publish a patched release before technical disclosure, and credit reporters who want attribution. Please allow 90 days for coordinated disclosure unless active exploitation or another urgent risk requires a shorter timeline.

## Local Verification

Before reporting a suspected regression, run the relevant checks when possible:

```sh
npm run check
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
```

For native encryption issues, reproduce with `npm run tauri:dev`; the browser build is only an install notice and contains no workspace behavior.

## Secret Handling

Use dummy values in reports. The project test suite uses examples such as `debug-token`, synthetic GitHub ids, and local temporary directories; follow that pattern.

Never paste:

- real GitHub, OpenAI, Codex, cloud, npm, PyPI, SSH, or database credentials;
- private room invite secrets;
- decrypted room payloads from real teams;
- real terminal output containing credentials;
- private repository files.

Support and maintainers will never ask for a complete invitation link or any invite fragment. If one is accidentally received, redact or delete it from the support system immediately, do not copy it into another tool, and tell the sender to invalidate the invite and create a replacement. These handling rules reduce exposure; they do not promise that a third-party support platform can mathematically prevent every transient receipt or backup copy.

### Host command authorization

Native room commands and interactive terminals require an operating-system approval dialog bound to the exact room, canonical working directory, command or input, and execution kind. On macOS they then run under an OS sandbox profile that permits process creation and network access, permits reads from the selected workspace plus named system/toolchain locations, and permits filesystem writes only beneath the canonical selected workspace. This is meaningful filesystem confinement, not complete isolation: commands inherit a host-controlled environment, can make network requests, can run workspace scripts and hooks, and can read the documented system/toolchain paths. Native authorization and confinement are enforcement boundaries, but users must still review the exact command and treat admitted members as able to influence the selected project and network-visible services after approval.

Before command or PTY output can be returned to the webview and encrypted into a room event, the native host redacts known GitHub/OpenAI token forms, secret-bearing environment assignments, and PEM private keys. Pattern redaction reduces accidental disclosure; it cannot recognize every possible secret encoding.

Commands that appear to read `.env`, SSH/package-manager credentials, credential stores, or secret files use a separate high-risk native confirmation. They cannot use the ten-minute exact-command grant and must be approved once with an explicit credential-access warning.
