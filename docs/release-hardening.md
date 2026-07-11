# Release Hardening

multAIplayer alpha releases are security-sensitive because the desktop app can coordinate local project files, terminals, browser state, GitHub access, and a local Codex host. This checklist is for maintainers preparing public alpha artifacts or a hosted relay.

## Required Local Gates

Run these before tagging or publishing a release candidate:

```bash
npm run doctor
npm run license:check
npm run sqlite:backup-restore-drill
npm run verify
```

For an internet-facing relay, run the production relay doctor in the same environment used to start the relay:

```bash
npm run doctor:production-relay
```

The production relay doctor must pass before using an official hosted relay. It checks for GitHub OAuth, a strong durable session secret, explicit exact HTTP(S) allowed origins, auth-required mode, disabled debug endpoints, disabled demo seeding, enabled rate limits, SQLite relay storage on a persistent path, and conservative proxy-header handling.

## Release Artifacts

The GitHub release workflow builds macOS artifacts and writes `SHA256SUMS.txt`. Public macOS release artifacts must be Developer ID signed and notarized. The workflow imports the Developer ID Application certificate into a temporary CI keychain, passes notarization credentials to Tauri, verifies the app with `codesign`, validates stapled tickets on both the `.app` and `.dmg`, and runs Gatekeeper checks with `spctl` before packaging.

Required GitHub secrets for signed/notarized releases:

- `APPLE_CERTIFICATE`: base64 encoded Developer ID Application `.p12`;
- `APPLE_CERTIFICATE_PASSWORD`: password for the exported `.p12`;
- `APPLE_SIGNING_IDENTITY`: Developer ID Application signing identity;
- `APPLE_ID`: Apple ID email used for notarization;
- `APPLE_PASSWORD`: app-specific password for that Apple ID;
- `APPLE_TEAM_ID`: Apple Developer team id;
- `KEYCHAIN_PASSWORD`: temporary CI keychain password.

If any required Apple signing secret is missing, the release workflow fails before building artifacts. Do not publish unsigned public alpha builds.

Do not attach ad hoc local builds to public releases. Release artifacts should come from GitHub Actions so the source commit, workflow logs, and checksums are visible.

## Update Notices

The alpha does not use the Tauri auto-updater. Instead, the desktop app checks `https://multaiplayer.com/releases/latest.json` and shows an in-app banner when the manifest advertises a newer version. Security updates should set `security: true` so the banner is labelled as a security update.

Manifest shape:

```json
{
  "version": "0.1.1-alpha.0",
  "url": "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0",
  "notes": "Security update for room trust handling.",
  "security": true
}
```

The banner is only a nudge; alpha users still need to download and install the new signed build manually. Publish or update the manifest before announcing a security fix.

## Relay Deployment

Before advertising an official relay, verify the exact environment that will run the relay:

```bash
NODE_ENV=production npm run doctor:production-relay
```

For Docker deployments, build from the repository root with `apps/relay/Dockerfile`, mount persistent storage at `/data`, and set `MULTAIPLAYER_RELAY_ALLOWED_ORIGINS` to bare origins only, such as `https://multaiplayer.com`. The image defaults to SQLite at `/data/relay-store.sqlite`; do not use JSON storage, `*`, path-scoped origins, `/tmp` storage, or disabled rate limits for public relays.

Before tagging a public alpha, run a backup/restore drill against a staged copy of the relay SQLite file:

```bash
node scripts/sqlite-backup-restore-drill.mjs --data-path=/path/to/relay-store.sqlite
```

The release preflight runs the same drill in fixture mode so the backup path stays exercised in CI-friendly environments.

The SQLite backup drill does not remove the alpha storage scaling caveat: encrypted room envelopes are incremental, but the normalized non-envelope relay tables are still cleared and reinserted as a full snapshot on each debounced state flush. Treat that as an alpha-scale ceiling to revisit before operating a larger hosted relay with many rooms, members, devices, invites, or sessions.

## Field Diagnostics

When an alpha tester hits an ordinary crash or app bug, ask them to open Account settings and click `Save diagnostics`. The native app persists capture-redacted warning/error entries as `diagnostics.jsonl` in the platform app log directory (`~/Library/Logs/com.multaiplayer.desktop/` on macOS), with `0600` permissions and seven-day, 256 KiB, and 500-entry limits. Rust validates each stored line, re-redacts it, assembles the bundle, and writes it through the system save dialog. The web preview remains memory-only and offers `Copy diagnostics`. Do not add a command that returns persisted entries, bundle contents, or the selected destination to the webview.

The bundle contains app version, runtime/platform metadata, relay origins, and recent redacted warning/error entries. It does not intentionally include room transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, or GitHub tokens. Users should still review the saved JSON before attaching it to a GitHub issue. Diagnostics are not encrypted at rest in this alpha; revisit that decision before collecting richer data. During review, require stable error codes and bounded ids instead of payload objects even when the compound-key denylist would omit known sensitive fields.

## Secrets

Release workflows and logs must not expose:

- GitHub OAuth client secrets;
- GitHub access tokens;
- OpenAI or Codex credentials;
- current capability-bearing invite URLs/fragments and legacy room-key-bearing invite fragments;
- decrypted room payloads;
- private repo files, diffs, or terminal output.

The release workflow does not need OpenAI credentials because Codex runs through the user's local Codex app-server, not through the OpenAI API.

## CI And Release Workflow Bounds

CI and release jobs should keep least-privilege GitHub permissions and explicit timeouts. The alpha workflows use read-only repository permissions for CI, write access only for creating GitHub releases, and bounded job runtimes so a stuck build cannot run indefinitely.

Manual release dispatches must point at an existing tag that starts with `v` and uses only letters, numbers, dots, underscores, or hyphens. The release workflow validates the tag before checking it out, builds from the detached tag ref, and passes the validated tag through environment variables instead of interpolating raw dispatch input into shell commands.

## Before A Non-Alpha Release

Before presenting multAIplayer as production-ready, release hardening should include:

- documented maintainer release key custody;
- backup/restore drills and operational runbooks for SQLite relay storage;
- external or shared-store rate limiting for multi-instance relays;
- private security contact and disclosure process;
- recurring end-to-end multi-device invite, removal, recovery, malicious-relay substitution, and key-epoch tests.
