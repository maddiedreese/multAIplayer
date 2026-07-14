# Changelog

All notable user-visible and security-relevant changes are recorded here. Release Please maintains future release sections from Conventional Commit messages.

## [Unreleased]

### Added

- Native RFC 9420 MLS rooms with pinned `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`, active-host commits, KeyPackage invite approval, retained exporter-derived history secrets, and encrypted chat and attachments.
- Room-scoped Codex hosting with explicit turn approval, bounded queues, goal controls, project/file/diff tools, terminals, browser previews, GitHub workflows, and host handoff.
- SQLite relay persistence, production readiness checks, rate and quota controls, signed/notarized macOS release enforcement, checksums, SBOMs, and provenance attestations.
- Bounded, re-redacted native diagnostics export and an in-app release update banner.
- Resumable first-run create/join setup with device readiness checks, conservative defaults, partial room-creation recovery, a persistent setup checklist, Help-based reopen/restart controls, and an in-room guided first Codex turn.

### Security

- The relay transports opaque MLS, Welcome, HPKE, and exporter-sealed payloads; project files, transcripts, terminal/browser content, and Codex credentials remain host-local.
- Device removal revokes relay access and invites before an MLS Remove commit excludes future traffic.

### Fixed

- New-room onboarding now persists the local-history preference before native MLS setup and applies retention only after the group exists, preventing false room-creation failures and duplicate-room retries.

### Known limitations

- This protocol-v2 alpha does not migrate pre-v2 rooms, ciphertext, cryptographic state, or invite links.
- Native MLS state loss requires rejoining and cannot recover earlier backlog or retained history.
- Rate limiting is process-local, and multi-instance relay operation requires shared storage and edge/shared rate limiting.
- The browser build is a seeded UI preview; encrypted rooms require the native macOS app.

## [0.1.0-alpha.0] - 2026-07-04

### Added

- First public macOS-first Tauri desktop and self-hosted relay scaffold.
- Encrypted room messages and history, invite delivery, local Codex app-server approval, browser, terminal, file/diff, Git, pull-request, and Actions surfaces.
- TypeScript, relay, Rust, and ad-hoc-signed macOS packaging CI.

### Known limitations

- The first public artifact was unsigned and not notarized; later release automation requires Developer ID signing and notarization.

[0.1.0-alpha.0]: https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.0-alpha.0
