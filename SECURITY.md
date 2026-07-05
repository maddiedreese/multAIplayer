# Security Policy

multAIplayer is an honest alpha. Please treat it as security-sensitive software because it coordinates local project files, terminals, GitHub access, browser state, and a local Codex host.

## Supported Scope

Security reports are welcome for the current `main` branch and the latest published alpha artifacts.

The intended security properties are:

- the relay does not store plaintext chat transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, file diffs, or plaintext GitHub access tokens;
- room messages, attachments, terminal requests, browser requests, Codex events, Git events, and invite approval workflows are routed as encrypted envelopes;
- native desktop room secrets and device identities are stored in the macOS Keychain;
- the browser/web preview is a development fallback and keeps room secrets in localStorage;
- GitHub session persistence is memory-only unless a strong `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured, in which case access tokens are encrypted at rest.
- production relays require authentication by default; unauthenticated relay mode is an explicit self-host opt-out.

Known alpha limitations are documented in [docs/threat-model.md](docs/threat-model.md), especially member removal, key rotation, identity verification, and multi-device recovery.

Release-specific checks and unsigned macOS artifact notes are tracked in [docs/release-hardening.md](docs/release-hardening.md).

## Reporting

Until a private security contact is published, please open a GitHub issue with a minimal description and mark it clearly as security-sensitive. Do not include live secrets, access tokens, private repo contents, real chat transcripts, or exploit payloads that would expose another user's data.

Good reports include:

- affected app or package;
- commit or version tested;
- local reproduction steps using dummy secrets;
- expected vs actual behavior;
- whether the issue affects the relay, native desktop app, web preview, or documentation.

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
