# Security Policy

multAIplayer is an honest alpha. Please treat it as security-sensitive software because it coordinates local project files, terminals, GitHub access, browser state, and a local Codex host.

## Supported Scope

Security reports are welcome for the current `main` branch and latest published alpha release. Older alphas and unreleased branches are unsupported; upgrade or reproduce on `main` when possible.

The intended security properties are:

- the relay does not store plaintext chat transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, file diffs, or plaintext GitHub access tokens;
- room messages, attachments, terminal requests, browser requests, Codex events, Git events, and invite approval workflows are routed as encrypted envelopes;
- AES-GCM authenticates versioned, domain-separated deterministic envelope metadata, including room, sender, event kind, timestamp, and key epoch;
- invite approval binds an independent random single-use bearer capability to the authenticated requester and host device keys before any room key is delivered; raw capabilities remain outside relay-visible metadata, cross relay transport only inside host-key-sealed requests, and are persisted by issuers only as verifiers;
- membership changes advance the room key epoch and deliver the new key only to eligible registered devices;
- native desktop room secrets and device identities are stored in the macOS Keychain;
- the browser/web preview is a development fallback that keeps room secrets in process memory and loses room access on reload;
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

For native app issues, also include whether the behavior appears in `npm run tauri:dev` or only in the browser preview.

## Secret Handling

Use dummy values in reports. The project test suite uses examples such as `debug-token`, synthetic GitHub ids, and local temporary directories; follow that pattern.

Never paste:

- real GitHub, OpenAI, Codex, cloud, npm, PyPI, SSH, or database credentials;
- private room invite secrets;
- decrypted room payloads from real teams;
- real terminal output containing credentials;
- private repository files.

### Host command containment

Native room commands and interactive terminals are launched through the operating system sandbox with the selected project as their only writable filesystem subtree. The native host fails closed on platforms where that confinement backend is unavailable. This is an enforcement boundary in addition to room and native approval policy, not a replacement for approvals.

Before command or PTY output can be returned to the webview and encrypted into a room event, the native host redacts known GitHub/OpenAI token forms, secret-bearing environment assignments, and PEM private keys. Pattern redaction reduces accidental disclosure; it cannot recognize every possible secret encoding.

Commands that appear to read `.env`, SSH/package-manager credentials, credential stores, or secret files use a separate high-risk native confirmation. They cannot use the ten-minute exact-command grant and must be approved once with an explicit credential-access warning.
