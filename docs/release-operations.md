# Release and relay operations

This is the living maintainer runbook for release readiness, public alpha publication, official relay deployment, and hosted-to-self-hosted migration. Keep operational changes here instead of creating another launch checklist. User deployment details remain in [self-hosting.md](self-hosting.md); security claims remain in [threat-model.md](threat-model.md).

## Release readiness

Before opening a release candidate PR, tagging, or publishing artifacts, run:

```bash
npm run release:preflight
```

This covers the TypeScript and Rust verification suites, package/application builds, license checks, environment/toolchain checks, and a fixture SQLite backup/restore drill. For the exact blocking and scheduled jobs, see [ci-policy.md](ci-policy.md).

Before a wider alpha, manually verify on two macOS devices and two GitHub accounts:

- invite acceptance, encrypted chat, attachments, member removal, epoch advancement, and removed-device exclusion;
- project selection, file/diff inspection, Codex approval, terminal and browser approval;
- Git branch, commit, push, draft PR, and Actions status;
- active-host handoff, including a simulated Codex usage limit;
- a relay restart with durable encrypted sessions; and
- the limitations in [alpha-limitations.md](alpha-limitations.md) against the release notes.

Do not present the alpha as externally audited, production-ready, enterprise compliant, or capable of retroactive erasure or synchronized identity recovery.

## Maintainer-owned launch decisions

Decide and record the official website, relay HTTP origin, relay WebSocket URL, GitHub OAuth owner/scopes, hosting provider, release cadence, support expectation, disclosure contact, and Apple signing identity. A reasonable alpha topology is:

```text
Website: https://multaiplayer.com
Relay API: https://relay.multaiplayer.com
Relay rooms: wss://relay.multaiplayer.com/rooms
GitHub scopes: read:user public_repo
```

Use `read:user repo` only after making private-repository access an explicit product and trust decision. Codex/OpenAI credentials never belong in the relay: Codex uses the active host's local app-server.

The desktop release build should set `VITE_RELAY_HTTP_URL` and `VITE_RELAY_URL` to the final hosted endpoints, and its CSP must allow exactly those origins. Publish `https://multaiplayer.com/releases/latest.json` for each release; set `security: true` for security fixes.

## Official relay deployment

The official relay is a stronger operational commitment than a local self-hosted instance. Use stable HTTPS/WSS routing, persistent mounted storage, provider secret management, rollback support, health checks, backup support, and logs with redaction controls. One instance is acceptable for alpha; multi-instance operation requires shared storage and shared or edge rate limiting.

Start from `.env.example` and set production values in the same environment that launches the relay. The critical shape is:

```bash
NODE_ENV=production
GITHUB_CLIENT_ID=...
GITHUB_OAUTH_SCOPES="read:user public_repo"
MULTAIPLAYER_RELAY_SESSION_SECRET=...
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com
MULTAIPLAYER_RELAY_REQUIRE_AUTH=true
MULTAIPLAYER_RELAY_DEBUG=false
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
MULTAIPLAYER_RELAY_SEED_DEMO=false
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false
MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED=false
```

Generate the stable session secret with a password manager or `openssl rand -base64 32`. Rotating it signs users out. Configure all size, retention, upload, rate, connection, and room quotas from `.env.example`; do not copy a stale second list into this guide.

Run in the deployed environment:

```bash
NODE_ENV=production npm run doctor:production-relay
```

The doctor must pass before the endpoint is advertised. Also verify:

- `/healthz` reports process health and `/readyz` becomes not-ready during shutdown;
- WebSocket upgrades reach `/rooms` and enforce the exact browser origin;
- a staged drain rejects new HTTP/WS work, closes sockets with `1012`, and flushes storage;
- `/metrics` contains bounded counters rather than room content;
- SQLite is mounted persistently outside `/tmp` and a staged backup restores successfully;
- rate and quota failures are observable without plaintext payloads; and
- relay storage and traffic contain no plaintext transcripts, attachments, repo files, terminal output, Codex/OpenAI credentials, or plaintext GitHub tokens.

Trust proxy headers only when a documented reverse proxy strips client-supplied forwarding headers and writes its own. In that case set both proxy variables true; otherwise keep both false.

### Relay rollback

Keep the previous artifact and a pre-deploy SQLite backup. If authentication, storage, or WebSocket routing fails, remove the official relay from public copy and direct users to self-hosting. If plaintext leakage is suspected, stop the relay, preserve evidence privately, and follow `SECURITY.md` instead of opening a public issue.

## Signing, provenance, and publication

Release tags should be signed with `git tag -s` and verified with `git tag -v`. The release workflow requires these GitHub secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
KEYCHAIN_PASSWORD
```

It builds the macOS app/DMG, verifies Developer ID signing and stapled notarization, runs Gatekeeper checks, writes checksums, emits an SPDX SBOM, records build-provenance attestations, and keyless-signs the checksum manifest and SBOM with Sigstore. Missing signing secrets fail the release; do not publish ad hoc or unsigned local builds as public artifacts.

Use [reproducible-builds.md](reproducible-builds.md) to compare the unsigned application payload. Signed/notarized archives are not claimed to be bit-for-bit reproducible.

Before announcement, verify the update manifest, release notes, artifact digests, signature/notarization status, SBOM/provenance attachments, hosted relay, and two-person dogfood result. Ordinary bug reports should use the bounded redacted diagnostics export; never request invite fragments, credentials, transcripts, terminal output, browser content, or private source by default.

## Hosted relay exit policy

Give at least 30 days' public notice before a planned official hosted relay shutdown. During the notice window, keep sign-in, relay connectivity, and these instructions available unless an emergency security, legal, provider, or private-data incident makes that unsafe. Emergency notice may be shorter only for those reasons and should preserve the minimum safe migration path.

The relay is not the source of truth for project folders, Git history, room keys, or device-local encrypted history. Migration recreates relay-side teams, rooms, memberships, sessions, invites, backlog, and blobs.

## Hosted-to-self-hosted migration

Choose a quiet window and keep every original device intact. Before cutover:

1. Deploy the destination using [self-hosting.md](self-hosting.md), persistent storage, HTTPS/WSS, and a passing production doctor.
2. Build a desktop whose CSP allows the destination HTTPS and WSS origins.
3. Back up the destination relay and verify `/healthz`, `/readyz`, `/rooms`, restart persistence, and content-free logs.

On the coordinating device, change the Settings relay HTTP and WebSocket URLs, sign in again, and recreate the team and rooms. Generate fresh capability-authenticated invites; never copy old invite links or fragments into public logs, issues, or chat.

For every member/device:

1. Keep the old room locally until the replacement works.
2. Switch relay URLs and sign in to the new origin.
3. Join with a fresh private invite.
4. Send and receive an encrypted test message and attachment.
5. Confirm retained local history remains readable.

With two members, verify the active host, Codex approval, session persistence, member removal, and future-traffic exclusion. After all members join, advance the room key epoch and deliver the new key only to eligible registered devices.

If a device cannot read retained history, stop before clearing rooms or reinstalling: the relay cannot reconstruct device-local keys/history. Until encrypted export/import ships, preserved devices are the continuity mechanism.

### Migration rollback

Before final cutover, members can switch Settings back to the hosted origins and continue in the original rooms. Messages sent only through the destination are not copied back automatically. Keep the hosted rooms quiet during observation, then publish the cutover time and retain the old service for the promised notice window.

## Maintenance rules

- Update this guide when a release workflow, production doctor check, relay default, or migration behavior changes.
- Keep exact environment defaults in `.env.example` and [self-hosting.md](self-hosting.md), not duplicated here.
- Keep CI policy in [ci-policy.md](ci-policy.md), dependency/security automation in [dependency-security.md](dependency-security.md), and security boundaries in [threat-model.md](threat-model.md).
- Run `npm run test:scripts`; project hygiene verifies local links, documented npm scripts, and documented relay/GitHub environment names.
- Before a non-alpha claim, require independent cryptography review, production-scale persistence/rate limiting, recurring multi-device adversarial journeys, and documented release-key custody.
