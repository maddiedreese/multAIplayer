# Changelog

All notable user-visible and security-relevant changes are curated here. Release automation versions the reviewed `Unreleased` section without synthesizing notes from internal commits.

## [Unreleased]

### Added

- Native RFC 9420 MLS rooms with pinned `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`, active-host commits, KeyPackage invite approval, retained exporter-derived history secrets, and encrypted chat and attachments.
- Room-scoped Codex hosting with explicit turn approval, bounded queues, goal controls, project/file/diff tools, terminals, an in-room browser, GitHub workflows, and host handoff.
- SQLite relay persistence, production readiness checks, rate and quota controls, signed/notarized macOS release enforcement, and published SHA-256 checksums.
- Bounded, re-redacted native diagnostics export and an in-app release update banner.
- Resumable first-run create/join setup with device readiness checks, conservative defaults, partial room-creation recovery, a persistent setup checklist, Help-based reopen/restart controls, and an in-room guided first Codex turn.

### Security

- The relay transports only opaque MLS, Welcome, HPKE, and exporter-sealed payloads. Codex credentials and live local processes remain host-local; selected project/file, transcript, terminal, and browser context reaches room members only through authenticated encrypted room payloads.
- Device removal revokes relay access and invites before an MLS Remove commit excludes future traffic.

### Fixed

- New-room onboarding now persists the local-history preference before native MLS setup and applies retention only after the group exists, preventing false room-creation failures and duplicate-room retries.
- Invitation lookups now project only the exact host and requester public identities required for pre-membership verification, allowing genuine new members and hosts to verify each other without opening the team device directory.

### Known limitations

- This protocol-v2 alpha does not migrate pre-v2 rooms, ciphertext, cryptographic state, or invite links.
- Native MLS state loss requires rejoining and cannot recover earlier backlog or retained history.
- Rate limiting is process-local, and multi-instance relay operation requires shared storage and edge/shared rate limiting.
- Browser builds expose only a native-app notice; all workspace, identity, relay, diagnostics, and MLS behavior requires the native app.

## [0.1.0-alpha.0] - 2026-07-04

### Added

- First public macOS-first Tauri desktop and self-hosted relay scaffold.
- Encrypted room messages and history, invite delivery, local Codex app-server approval, browser, terminal, file/diff, Git, pull-request, and Actions surfaces.
- TypeScript, relay, Rust, and ad-hoc-signed macOS packaging CI.

### Known limitations

- The first public artifact was unsigned and not notarized; later release automation requires Developer ID signing and notarization.

[0.1.0-alpha.0]: https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.0-alpha.0
