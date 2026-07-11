# Security Policy

multAIplayer is an honest alpha. Please treat it as security-sensitive software because it coordinates local project files, terminals, GitHub access, browser state, and a local Codex host.

## Supported Scope

Security reports are welcome for the current `main` branch and the latest published alpha artifacts.

The intended security properties are:

- the relay does not store plaintext chat transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, file diffs, or plaintext GitHub access tokens;
- room messages, attachments, terminal requests, browser requests, Codex events, Git events, and invite approval workflows are routed as encrypted envelopes;
- AES-GCM authenticates canonical envelope metadata, including room, sender, event kind, timestamp, and key epoch;
- invite approval binds a single-use capability to the authenticated requester and host device keys before any room key is delivered;
- membership changes advance the room key epoch and deliver the new key only to eligible registered devices;
- native desktop room secrets and device identities are stored in the macOS Keychain;
- the browser/web preview is a development fallback and keeps room secrets in localStorage;
- GitHub session persistence is memory-only unless a strong `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured, in which case access tokens are encrypted at rest.
- production relays require authentication by default; unauthenticated relay mode is an explicit self-host opt-out.

Remaining alpha limitations are documented in [docs/threat-model.md](docs/threat-model.md), especially retroactive erasure, recovery, and local-machine risk.

Release-specific checks and unsigned macOS artifact notes are tracked in [docs/release-hardening.md](docs/release-hardening.md).

## Reporting

Please report suspected vulnerabilities through GitHub's private vulnerability reporting feature by selecting **Report a vulnerability** on the repository's Security page. Do not open a public issue for a suspected vulnerability. If private reporting is unavailable, open a minimal issue asking the maintainers for a preferred private contact; do not include vulnerability details, live secrets, access tokens, private repo contents, real chat transcripts, or exploit payloads that would expose another user's data.

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
