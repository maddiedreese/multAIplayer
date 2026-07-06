# Alpha Limitations

multAIplayer is an honest alpha. It is useful for local and trusted-team testing, but it is not production security software yet.

## Release And Installation

- macOS builds are unsigned and not notarized until Apple Developer ID signing is configured.
- Release checksums help verify artifact integrity, but they do not replace signing.
- Public releases should come from GitHub Actions, not ad hoc local builds.

## Accounts And Hosting

- GitHub sign-in requires a GitHub OAuth app configured on the relay.
- A hosted production relay requires real domain, TLS, secrets, persistent storage, and operator monitoring.
- The relay Dockerfile is available, but multi-instance production hosting still needs external/shared rate limiting and a database-backed store.

## Privacy And Encryption

- Room chat and local history are encrypted, and the relay should not store plaintext transcripts or attachments.
- The relay still sees routing metadata such as team names, room names, host labels, project path labels, invite ids, encrypted envelope sizes, and encrypted blob metadata.
- Direct invite links can include the room key in the URL fragment for convenience. Gated invite links avoid this by using host approval and device-wrapped room keys.
- Member removal is relay-enforced for future reads and live sockets, but not yet full cryptographic forward secrecy. A removed member may keep content and keys they already received.

## Codex Hosting

- Codex runs through the active host's local Codex app-server/session.
- multAIplayer does not provide a supported way for a browser website to draw from arbitrary users' ChatGPT or Codex subscription limits.
- Usage-limit handoff is an alpha continuity flow. The new host must have their own Codex access and a suitable local project folder or repo checkout.

## Local Machine Risk

- The active host controls local project files, terminals, browser profiles, Git, and GitHub actions.
- Terminal output, diffs, private repo paths, signed-in browser pages, and copied Markdown may expose secrets to the room.
- Sensitive file and terminal warnings are review aids, not complete secret scanners.
- The in-room browser blocks downloads, clipboard access, and file uploads where the native platform allows it, but signed-in page content can still be sensitive.

## Known Product Gaps

- Real multi-device, multi-account dogfooding is still required before a public alpha should be promoted broadly.
- Apple signing/notarization is not configured.
- Official relay hosting decisions, domains, secrets, and OAuth callback choices still need maintainer input.
- The visual design should continue to be reviewed in the native app on real screens, especially resizable columns and embedded browser behavior.
