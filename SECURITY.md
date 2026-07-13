# Security Policy

multAIplayer is an honest alpha. Please treat it as security-sensitive software because it coordinates local project files, terminals, GitHub access, browser state, and a local Codex host.

## Supported Scope

Security reports are welcome for the current `main` branch and latest published alpha release. Older alphas and unreleased branches are unsupported; upgrade or reproduce on `main` when possible.

The intended security properties are:

- the relay does not store plaintext chat transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, file diffs, or plaintext GitHub access tokens;
- room events are RFC 9420 MLS PrivateMessages, while attachments are encrypted with per-blob keys derived by the native MLS core;
- MLS authenticated data binds canonical room, sender, event-kind, timestamp, message-id, and epoch routing fields;
- invite approval binds an independent random single-use bearer capability to an authenticated requester, exact KeyPackage hash, and pinned host HPKE key before an MLS Add and Welcome are created;
- membership changes use MLS Add and Remove commits, and both native clients and the relay enforce that only the active host can commit;
- MLS signature and HPKE private keys, group state, exporter output, history secrets, and per-blob keys remain behind the Rust IPC boundary and are stored with the operating-system credential store plus SQLCipher;
- retained exporter-derived history secrets intentionally preserve local history readability across epochs, so forward secrecy applies to live traffic rather than retained device-local history;
- the browser/web preview contains seeded local demo rooms only and cannot create or join E2EE rooms;
- GitHub session persistence is memory-only unless a strong `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured, in which case access tokens are encrypted at rest.
- production relays require authentication by default; unauthenticated relay mode is an explicit self-host opt-out.

Remaining alpha limitations are documented in [docs/threat-model.md](docs/threat-model.md), especially retroactive erasure, recovery, and local-machine risk.

Release-specific checks and artifact trust notes are tracked in [docs/release-operations.md](docs/release-operations.md).

## Reporting

Please use [GitHub private vulnerability reporting](https://github.com/maddiedreese/multAIplayer/security/advisories/new). If private reporting is unavailable, email [maddie@maddiedreese.com](mailto:maddie@maddiedreese.com). Do not open a public issue or include vulnerability details or sensitive data in a public channel.

Good reports include:

- affected app or package;
- commit or version tested;
- local reproduction steps using dummy secrets;
- expected vs actual behavior;
- whether the issue affects the relay, native desktop app, web preview, or documentation.

Expect an initial acknowledgement within 3 business days and a status update at least every 7 days while a report remains open. We coordinate fixes and release timing privately, aim to publish a patched release before technical disclosure, and credit reporters who want attribution. Please allow 90 days for coordinated disclosure unless active exploitation or another urgent risk requires a shorter timeline.

## Local Verification

Before reporting a suspected regression, run the relevant checks when possible:

```sh
npm run check
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
```

For native encryption issues, reproduce with `npm run tauri:dev`; the browser preview intentionally has no MLS or E2EE room support.

## Secret Handling

Use dummy values in reports. The project test suite uses examples such as `debug-token`, synthetic GitHub ids, and local temporary directories; follow that pattern.

Never paste:

- real GitHub, OpenAI, Codex, cloud, npm, PyPI, SSH, or database credentials;
- private room invite secrets;
- decrypted room payloads from real teams;
- real terminal output containing credentials;
- private repository files.

### Host command authorization

Native room commands and interactive terminals require an operating-system approval dialog bound to the exact room, canonical working directory, command or input, and execution kind. The selected project is the process working directory, not a filesystem sandbox; an approved command runs with the host account's ambient access. Native authorization is an enforcement boundary, but users must review commands as granting host-account shell authority.

Before command or PTY output can be returned to the webview and encrypted into a room event, the native host redacts known GitHub/OpenAI token forms, secret-bearing environment assignments, and PEM private keys. Pattern redaction reduces accidental disclosure; it cannot recognize every possible secret encoding.

Commands that appear to read `.env`, SSH/package-manager credentials, credential stores, or secret files use a separate high-risk native confirmation. They cannot use the ten-minute exact-command grant and must be approved once with an explicit credential-access warning.
