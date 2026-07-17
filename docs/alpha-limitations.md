# Alpha limitations

multAIplayer is a public alpha for trusted-team testing, not production security
software. This page summarizes product constraints; it does not restate security
properties. The [threat model](threat-model.md) is authoritative for security
claims, audit status, metadata exposure, and residual risks.

## Releases and platforms

- Treat a build as supported only when it passes the signed, notarized release
  process in [Verifying releases](reproducible-builds.md) and is published from this repository.
- Public packages are Apple-silicon-only and declare macOS 11 as their minimum
  deployment target. Automated packaged-app runtime testing currently runs on
  macOS 15; macOS 11–14 remain unverified rather than claimed as tested support.
  Intel Macs, Windows, and Linux are not release targets.
- Official invitations use macOS universal links. Each release still needs a
  cold-start and warm-app test; static entitlement and parser checks do not prove
  operating-system dispatch.
- The missing-app landing page retains an invitation only in memory. Refreshing,
  closing, or leaving the page loses it, so the recipient must reopen the
  original private link.

## Accounts, hosting, and storage

- One native installation is bound to one GitHub identity because its MLS signing, HPKE, and encrypted-room state share that identity boundary. Signing out and back into the same account is supported; switching GitHub accounts on an existing installation is not. The app rejects a mismatched identity instead of reusing keys across accounts.
- GitHub identity authorizes hosted-relay membership with `read:user`. Optional repository workflows require a separate, on-demand broad `repo` grant, which can access private repositories available to the signed-in account.
  ChatGPT separately authorizes Codex on the active host. Joining a room does not
  require a Codex login until that device becomes the host.
- The free alpha relay has no uptime, recovery, or support guarantee. Keep normal
  Git and project backups.
- The relay is deliberately single-node. It loads durable entities into memory,
  writes entity payloads immediately as SQLite JSON rows, and enforces a
  configurable durable-entry ceiling. It is not an unbounded or general
  relational store. See the [single-node relay decision](decisions/single-node-relay.md)
  and [self-hosting guide](self-hosting.md).
- Internet-facing self-hosted deployments require a non-bypassable trusted TLS
  edge, persistent SQLite storage, monitoring, backups, restore drills, and abuse
  controls. Official desktop builds pin the official relay; another origin
  requires a self-built client.

## Encryption and recovery

- Protocol v2 uses RFC 9420 MLS through `mls-rs`, but the integration has not
  received an independent professional security audit. Start with the
  [cryptography guide](cryptography.md) and authoritative [threat model](threat-model.md).
- The relay cannot read encrypted room content, but it necessarily sees bounded
  routing, identity, timing, size, attachment-description, and lifecycle
  metadata. The threat model owns the exact inventory.
- Complete invite links are private, single-use bearer capabilities. Send them
  through a private channel. The active host must still validate the requesting
  device before admitting it.
- Removal blocks future relay access and advances the MLS group. It cannot erase
  content, exports, screenshots, or retained history secrets that a former member
  already received.
- Each device has its own MLS state. State loss requires a clean rejoin and loses
  access to pre-rejoin history; multi-device recovery and backfill remain limited.
- Pre-v2 rooms and pre-v3 invite authenticators are intentionally incompatible.
  Browser builds are an install notice and initialize no workspace, identity,
  relay, or MLS state.

## Codex and host-local risk

- Codex runs through the active host's standard local Codex app-server and
  account. The supported version range and version-specific feature limits live
  in [How Codex hosting works](codex-hosting.md).
- The host's Codex credentials, running process and session, account, app and MCP
  state, terminal and browser processes, and Git or GitHub credentials remain
  host-local. Project contents are not transferred wholesale automatically, but
  selected previews, files, diffs, attachments, handoff patches, structured Codex
  activity, and approved local previews can be shared with and retained by room
  members. The selected project path and room Codex model, reasoning,
  service-tier, speed, raw-reasoning, and sandbox settings are shared with room
  members in authenticated, encrypted `room.config` snapshots. multAIplayer's
  warnings and approval prompts reduce accidental sharing; they are not a sandbox
  or a complete secret scanner.
- Codex's upstream Computer Use and first-party browser capabilities are not
  exposed through multAIplayer's app-server integration. multAIplayer separately
  provides a host-local in-room browser: the active host can open URLs directly,
  while Codex and room browser-open requests remain behind host approval.
  Usage-limit handoff also cannot transfer processes, credentials, or unsaved
  host state.
- Local preview sharing creates a temporary public `trycloudflare.com` URL.
  Anyone with the URL may be able to view the preview until the tunnel stops.
