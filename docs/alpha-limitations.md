# Alpha Limitations

multAIplayer is a Public Alpha. It is useful for local and trusted-team testing, but it is not production security software yet.

## Release And Installation

- The supported public alpha must be Developer ID signed and notarized. The existing scaffold download and local development builds are not supported release artifacts and may be unsigned.
- Public packages support Apple silicon Macs running macOS 11 or later. Intel Macs, Windows, and Linux are not supported release targets.
- Release checksums help verify artifact integrity, but they do not replace signing.
- Public releases should come from GitHub Actions, not ad hoc local builds.
- Official invitations use signed macOS universal links on `open.multaiplayer.com` and `multaiplayer.com`; there is no custom-scheme fallback. Automated parser, AASA-shape, and entitlement checks do not prove operating-system dispatch, so every release still requires cold-start and warm-app testing with a signed installed build.
- The missing-app landing keeps the complete invitation only in page memory after removing it from the address bar. Refreshing, closing, or navigating away deliberately loses that retry state; the recipient must return to the original private message and click the link again.

## Accounts And Hosting

- GitHub sign-in requires a GitHub OAuth app configured on the relay.
- GitHub Device Flow identifies workspace members and authorizes relay/repository workflows. ChatGPT login separately authorizes the local Codex process. Joining requires relay and GitHub readiness but does not require Codex, a ChatGPT login, or a project folder until that device hosts Codex work.
- A hosted production relay requires real domain, TLS, secrets, persistent storage, and operator monitoring.
- The official free-alpha relay is planned for Railway and will use GitHub identity for hosted access. It is not live until DNS, persistent storage, secrets, TLS/WSS routing, monitoring, and backup/restore checks pass, and it carries no uptime or support guarantee.
- The relay Dockerfile and SQLite storage are available. Multi-instance production hosting needs external/shared rate limiting, backup/restore drills, and operational monitoring.
- SQLite opaque MLS messages use an incremental append/delete path, but the normalized non-message relay state rewrites teams, rooms, invites, devices, members, and sessions on each debounced flush. That is acceptable for alpha-scale trusted teams, but larger hosted relays should plan an incremental or shared-store rewrite before rooms and membership counts grow enough for whole-store rewrites to become a scaling ceiling.

## Privacy And Encryption

- Protocol v2 uses RFC 9420 MLS through `mls-rs`; the application integration, host-authority policy, HPKE invite flow, and storage boundary remain unaudited. End-to-end encryption is design intent backed by tests, not an independently verified guarantee.
- Room chat and local history are encrypted, and the relay should not store plaintext transcripts or attachments.
- The relay sees routing metadata such as team names, room names, host labels, device ids, invite ids, epoch hints, opaque MLS-message sizes, and attachment filename/MIME/declared-size/epoch/expiry metadata. Attachment contents are encrypted; those metadata fields are not.
- Invite links contain a private single-use bearer capability and public host HPKE binding, never an MLS group secret. Anyone who obtains a complete link can submit a device-bound KeyPackage request, so links must be shared privately; the active host validates the requester before creating an Add and Welcome.
- Member removal revokes relay access and advances the group through an MLS Remove commit. A removed member may still keep content, exports, screenshots, and retained history secrets already received.
- Exporter-derived history secrets are deliberately retained in encrypted native storage. Forward secrecy applies to live traffic, not retained local history.
- Multi-device recovery and history backfill remain limited; each device enrolls with its own MLS credential and KeyPackages. State loss requires a clean rejoin and loses pre-rejoin history access.
- Pre-v2 rooms and pre-v3 invite authenticators are intentionally incompatible and are not migrated.
- The product is native-only. Browser builds show a static install notice and initialize no workspace, identity, relay connection, or MLS state.

## Codex Hosting

- Codex runs through the active host's local Codex app-server/session.
- Codex app-server 0.133.0–0.144.0 is the supported compatibility range, with generated-schema fixtures at 0.133.0, 0.143.0, and 0.144.0. Older versions cannot host; newer versions are marked unverified and new security-sensitive capabilities remain fail closed until tested.
- Fork-through-turn requires Codex 0.143.0 or newer. Version 0.133.0 supports full-thread forks only.
- Codex account/app/MCP controls and the `auto`/`prompt`/`writes` app approval default are host-local; the approval default is global to that Codex installation, not isolated to one room.
- Codex Browser Use and Codex Computer Use are not offered in multAIplayer because the Codex app-server API surface this app uses does not support them.
- Usage-limit handoff is an alpha continuity flow. The replacement host must have their own Codex access and a suitable local project folder or repo checkout.

## Local Machine Risk

- The active host controls local project files, terminals, browser profiles, Git, and GitHub actions.
- Terminal output, diffs, private repo paths, signed-in browser pages, and copied Markdown may expose secrets to the room.
- Sensitive file and terminal warnings are review aids, not complete secret scanners.
- The in-room browser blocks downloads, clipboard access, and file uploads where the native platform allows it, but signed-in page content can be sensitive.
- Local preview sharing uses `cloudflared` to create a temporary public `trycloudflare.com` URL for a host-local development server. Anyone with the link may be able to view the preview while the tunnel is running.

## Known Product Gaps

- Real multi-device, multi-account dogfooding is required before a public alpha is promoted broadly.
- Official relay hosting decisions, domains, secrets, and GitHub device-code OAuth configuration require maintainer input.
- Independently branded or self-hosted builds cannot inherit the official universal-link association. They need their own HTTPS domains, AASA files, Apple Team ID, bundle id, associated-domain entitlement, signing, and matching native allowlists; otherwise recipients can paste the complete private invitation into the app.
- The visual design should continue to be reviewed in the native app on real screens, especially resizable columns and embedded browser behavior.
- A room intentionally has one primary repository binding. Multi-repository rooms are deferred until app-server exposes a stable multi-root execution and sandbox contract; use separate rooms meanwhile. See [the accepted ADR](decisions/multi-repository-rooms.md).
