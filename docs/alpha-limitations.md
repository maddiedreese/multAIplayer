# Alpha Limitations

multAIplayer is an honest alpha. It is useful for local and trusted-team testing, but it is not production security software yet.

## Release And Installation

- Public macOS alpha artifacts are expected to be Developer ID signed and notarized. Local development builds are not release artifacts and may be unsigned.
- Release checksums help verify artifact integrity, but they do not replace signing.
- Public releases should come from GitHub Actions, not ad hoc local builds.

## Accounts And Hosting

- GitHub sign-in requires a GitHub OAuth app configured on the relay.
- A hosted production relay requires real domain, TLS, secrets, persistent storage, and operator monitoring.
- The relay Dockerfile and SQLite storage are available, but multi-instance production hosting still needs external/shared rate limiting, backup/restore drills, and operational monitoring.
- SQLite encrypted room envelopes use an incremental append/delete path, but the normalized non-envelope relay state still rewrites all teams, rooms, invites, devices, members, and sessions on each debounced flush. That is acceptable for alpha-scale trusted teams, but larger hosted relays should plan an incremental or shared-store rewrite before rooms and membership counts grow enough for whole-store rewrites to become a scaling ceiling.

## Privacy And Encryption

- Room chat and local history are encrypted, and the relay should not store plaintext transcripts or attachments.
- The relay still sees routing metadata such as team names, room names, host labels, project path labels, invite ids, encrypted envelope sizes, and encrypted blob metadata.
- Direct invite links can include the room key in the URL fragment for convenience. Gated invite links avoid this by using host approval and device-wrapped room keys.
- Member removal is relay-enforced for future reads and live sockets, but not yet full cryptographic forward secrecy. A removed member may keep content and keys they already received.
- Post-alpha security roadmap items include MLS-style group keying, history epochs/backfill, stronger member-removal key epochs, identity verification, and multi-device recovery.

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
- Official relay hosting decisions, domains, secrets, and OAuth callback choices still need maintainer input.
- The visual design should continue to be reviewed in the native app on real screens, especially resizable columns and embedded browser behavior.
