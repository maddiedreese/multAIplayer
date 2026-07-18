# Changelog

All notable user-visible and security-relevant changes are curated here. A release PR versions the reviewed `Unreleased` section without synthesizing notes from internal commits.

## [Unreleased]

_No changes recorded._

## [0.1.0-alpha.5] - 2026-07-18

### Fixed

- The native Keychain identity now remains authoritative when WebKit storage is reset for the same GitHub account, automatically restoring the original device identity instead of blocking room hosting.
- Blocking Codex account, thread, steering, Git, project-file, shell, archive, and preview operations now run away from the macOS UI thread, preventing multi-second app freezes while native work completes.
- Dialogs, onboarding codes, and the setup checklist now use the app's standard sans-serif type scale instead of oversized or monospaced popup typography.

## [0.1.0-alpha.4] - 2026-07-18

### Fixed

- The release two-client native MLS journey now verifies restored authentication from the app state instead of requiring the profile card to be rendered, preventing a late crash-recovery UI timing race from blocking signed builds.

## [0.1.0-alpha.3] - 2026-07-18

### Fixed

- Packaged macOS clients now authenticate relay HTTP and WebSocket traffic with a memory-only opaque relay session scoped to the exact official relay origin, so GitHub sign-in remains usable when WebKit blocks cross-site cookies. GitHub OAuth credentials remain in the native Keychain boundary.
- GitHub sign-in surfaces now explain the possible macOS Keychain prompt before authorization, including what multAIplayer stores, what it cannot access, and how “Always Allow” affects future prompts.

### Performance

- The terminal runtime now loads only when the Terminal tab is opened, reducing the initial desktop JavaScript bundle by about 28% and its compressed transfer size by about 26%.

## [0.1.0-alpha.2] - 2026-07-18

### Fixed

- Packaged macOS clients now install a secure cross-site relay session cookie, allowing the authenticated `tauri://localhost` WebView to use the official relay after GitHub sign-in.
- The sidebar setup checklist now uses the app's standard sans-serif typography at a compact size proportional to the surrounding sidebar controls.

## [0.1.0-alpha.1] - 2026-07-17

### Added

- Native RFC 9420 MLS rooms with pinned `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`, active-host commits, KeyPackage invite approval, retained exporter-derived history secrets, and encrypted chat and attachments.
- Room-scoped Codex hosting with explicit turn approval, bounded queues, goal controls, project/file/diff tools, terminals, an in-room browser, GitHub workflows, and host handoff.
- SQLite relay persistence, production readiness checks, rate and quota controls, signed/notarized macOS release enforcement, and published SHA-256 checksums.
- Bounded, re-redacted native diagnostics export and an in-app release update banner.
- Resumable first-run create/join setup with device readiness checks, conservative defaults, partial room-creation recovery, a persistent setup checklist, Help-based reopen/restart controls, and an in-room guided first Codex turn.

### Security

- The relay transports only opaque MLS, Welcome, HPKE, and exporter-sealed payloads. Codex credentials and live local processes remain host-local; selected project/file, transcript, terminal, and browser context reaches room members only through authenticated encrypted room payloads.
- Member removal revokes relay access before an MLS Remove commit excludes that member from future traffic.

### Fixed

- The production relay image no longer includes npm's unused dependency tree, removing a release-blocking high-severity `undici` vulnerability from the deployed runtime.
- New-room onboarding now persists the local-history preference before native MLS setup and applies retention only after the group exists, preventing false room-creation failures and duplicate-room retries.
- Invitation lookups now project only the exact host and requester public identities required for pre-membership verification, allowing genuine new members and hosts to verify each other without opening the team device directory.

### Known limitations

- This protocol-v2 alpha does not migrate pre-v2 rooms, ciphertext, cryptographic state, or invite links.
- Native MLS state loss requires rejoining and cannot recover earlier backlog or retained history.
- Rate limiting is process-local, and multi-instance relay operation requires shared storage and edge/shared rate limiting.
- Browser builds expose only a native-app notice; all workspace, identity, relay, diagnostics, and MLS behavior requires the native app.
