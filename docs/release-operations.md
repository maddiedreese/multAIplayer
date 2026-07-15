# Release and relay operations

This is the living maintainer runbook for release readiness, public alpha publication, official relay deployment, and hosted-to-self-hosted migration. Keep operational changes here instead of creating another launch checklist. User deployment details remain in [self-hosting.md](self-hosting.md); security claims remain in [threat-model.md](threat-model.md).

## Release readiness

Before opening a release candidate PR, tagging, or publishing artifacts, run:

```bash
npm run release:preflight
```

This covers the TypeScript and Rust verification suites, package/application builds, license checks, environment/toolchain checks, and a fixture SQLite backup/restore drill. For the exact blocking and scheduled jobs, see [ci-policy.md](ci-policy.md).

Release Please maintains [the project changelog](../CHANGELOG.md), workspace versions, release pull request, version tag, and GitHub Release from Conventional Commit subjects. Its `extra-files` configuration updates exact internal npm pins together with the Tauri Cargo version and Codex app-server client version; the workflow then deterministically regenerates npm lock metadata, synchronizes the native Cargo lock package version, and signs that follow-up commit. The project-hygiene suite checks every synchronized version source and the lock synchronization path; review the resulting diff on every generated release pull request. With the built-in Actions token, GitHub suppresses recursive pull-request workflows, so a maintainer must close and reopen the generated pull request to create the required CI event. An optional fine-grained `RELEASE_PLEASE_TOKEN` with repository Contents and Pull requests read/write access removes that step. When the built-in token creates the tag, the preparation workflow explicitly dispatches the signed-artifact workflow. Merging the generated pull request attaches the notarized app, checksums, SBOM, and attestations to the generated release. Do not maintain point-in-time release-note drafts in `docs/`.

Before a wider alpha, manually verify on two Apple silicon Macs running macOS 11 or later and two GitHub accounts:

- first-run create and join readiness, GitHub Device Flow in the system browser, local Codex/ChatGPT browser or device login, cancellation, and copy-link recovery when the browser cannot open;
- a signed, installed build receiving the official HTTPS invitation as both a cold start and a warm-app activation, including the explicit alternate-host retry after installation; confirm that neither app nor website logs, storage, analytics, or network requests contain the fragment;
- KeyPackage publication, capability invite approval, Welcome join, encrypted chat, attachments, MLS removal, epoch advancement, and removed-device exclusion;
- project selection, file/diff inspection, Codex approval, terminal and browser approval;
- Git branch, commit, push, draft PR, and Actions status;
- active-host handoff, including a simulated Codex usage limit;
- a relay restart with durable encrypted sessions; and
- the limitations in [alpha-limitations.md](alpha-limitations.md) against the release notes; and
- the bundled Rust KeyPackage validator path and fail-closed production startup.

Do not present the alpha as externally audited, production-ready, enterprise compliant, or capable of retroactive erasure or synchronized identity recovery.

## Maintainer-owned launch decisions

Decide and record the official website, relay HTTP origin, relay WebSocket URL, GitHub OAuth owner/scopes, hosting provider, release cadence, support expectation, disclosure contact, and Apple signing identity. Do not ship a desktop build until these operator-owned values are configured. Use this shape when recording the final values:

```text
Website: https://multaiplayer.com
Relay provider: Railway
Relay API: https://relay.multaiplayer.com
Relay rooms: wss://relay.multaiplayer.com/rooms
GitHub scopes: read:user repo
Desktop support: Apple silicon, macOS 11 or later
```

The official alpha deliberately supports both public and private repositories. Disclose that GitHub's broad `repo` scope covers repositories the signed-in user can access. Codex/OpenAI credentials never belong in the relay: Codex uses the active host's local app-server.

The desktop release build should set `VITE_RELAY_HTTP_URL` and `VITE_RELAY_URL` to the final hosted endpoints, and its CSP must allow exactly those origins. Publish `https://<official-site>/releases/latest.json` for each release; set `security: true` for security fixes.

The official invitation transport is an HTTPS universal link, not a custom URL scheme. Before signing, publish no-redirect Apple App Site Association files on both `multaiplayer.com` and `open.multaiplayer.com` for exactly `/invite` and `/invite/`, with the release Team ID and bundle id `com.multaiplayer.desktop`. The canonical link is `https://open.multaiplayer.com/invite#invite=<id>&multaiplayerJoin=<capability>&approval=request`; all invite material stays in the fragment. The apex host is the explicit retry target after installation. `npm run verify:aasa` checks the live association files, and the package checks verify that the associated-domain entitlement is present. Those checks establish configuration shape, not operating-system dispatch: the cold-start and warm-app cases above remain signed-release manual checks.

## Official relay deployment

The official free-alpha relay is deployed on Railway at `https://relay.multaiplayer.com` (`wss://relay.multaiplayer.com/rooms`). It is not release-ready until this runbook's persistence, secrets, TLS/WSS, monitoring, OAuth, and backup/restore gates pass. Railway builds `apps/relay/Dockerfile` from `main`; `railway.json` disables Serverless sleeping and pins the deployment health check, restart policy, drain timing, and the single San Francisco replica. Keeping the relay warm removes wake-up latency but bills its continuous actual CPU and memory use; the Railway project-level hard spending limit remains the cost backstop. The service uses Railway-managed secrets and a 5 GB persistent volume mounted at `/data`, with SQLite at `/data/relay-store.sqlite`. Railway is an infrastructure processor, not an additional identity provider or plaintext room-content service. The official relay is a stronger operational commitment than a local self-hosted instance: retain rollback support, health checks, backups, and logs with redaction controls. A second replica is blocked on shared persistence/attachment coordination and both the implementation and required adversarial acceptance suite in the accepted [edge plus atomic shared-store rate-limiting contract](decisions/multi-instance-rate-limiting.md).

Start from `.env.example` and set production values in the same environment that launches the relay. The critical shape is:

```bash
NODE_ENV=production
PORT=8080
RAILWAY_RUN_UID=0
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT=https://t3.storageapi.dev
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION=auto
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE=virtual-host
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_PREFIX=relay-deletions/v1
MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS=7776000
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
MULTAIPLAYER_MLS_VALIDATOR_PATH=/app/bin/mls-keypackage-validator
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com,https://open.multaiplayer.com
MULTAIPLAYER_RELAY_REQUIRE_AUTH=true
MULTAIPLAYER_RELAY_DEBUG=false
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=true
MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED=true
```

The relay stores token-free identity sessions; it has no OAuth-token encryption secret to generate or rotate. Configure all size, retention, upload, rate, connection, and room quotas from `.env.example`; do not copy a stale second list into this guide.

Pin `PORT=8080` and target both the generated and custom Railway domains at port `8080`; otherwise a stale domain target can pass Railway's internal health check while returning `502` publicly. Railway volumes are mounted as `root`, so Railway's documented `RAILWAY_RUN_UID=0` override is required for the relay to write SQLite data under `/data`. This grants root only inside the isolated service container; it does not grant host or Railway control-plane access. Reassess the override if Railway adds managed non-root volume ownership or the image gains a verified privilege-dropping entrypoint.

Run in the deployed environment:

```bash
NODE_ENV=production npm run doctor:production-relay
```

The doctor must pass before the endpoint is advertised. Also verify:

- `/healthz` reports process health and `/readyz` becomes not-ready during shutdown;
- WebSocket upgrades reach `/rooms` and enforce the exact browser origin;
- a staged drain rejects new HTTP/WS work, closes sockets with `1012`, and flushes storage;
- `/metrics` contains bounded counters and publish, WebSocket-send, and SQLite-write latency histograms rather than room content;
- SQLite is mounted persistently outside `/tmp` and a staged backup restores successfully;
- the Railway Bucket deletion ledger is outside the SQLite volume/backup set, startup reconciliation succeeds, and a staged pre-deletion backup cannot resurrect the deleted identity;
- rate and quota failures are observable without plaintext payloads; and
- relay storage and traffic contain no plaintext transcripts, attachments, repo files, terminal output, Codex/OpenAI credentials, or plaintext GitHub tokens.

Trust proxy headers only when a documented reverse proxy strips client-supplied forwarding headers and writes its own. Railway documents `X-Real-IP` as the client address supplied by its public edge, so the official Railway deployment sets both proxy variables true. Other deployments must keep both false unless their proxy provides an equivalent guarantee.

### Backup restore and deletion replay

Never restore directly into the public service. Create an isolated Railway service/environment with no public domain, attach the restored SQLite copy, and inject the same deletion-ledger bucket plus HMAC key. Run `npm run build -w @multaiplayer/relay` and then `npm run deletions:reconcile -w @multaiplayer/relay`. The command must exit zero before any domain or traffic is attached. It authenticates every active tombstone, compares all primary-state identities regardless of local applied markers, reapplies deletion, and commits the resulting state. A blocker means the restored snapshot predates required ownership transfer or host handoff; keep it isolated and use a safe snapshot or resolve ownership before retrying. Record the Railway snapshot id, SQLite integrity result, tombstone/pending/deleted/pruned counts, and operator. Start normally and verify readiness only after that evidence is retained.

The production snapshot maximum is 7,689,600 seconds (89 days); every tombstone uses a 7,776,000-second (90-day) protection horizon to provide scheduling/clock margin. A delayed reconciliation appends a fresh tombstone before primary cleanup, extending coverage from the time data is actually removed rather than relying on the original request date. Startup deletes each external tombstone and its matching primary applied marker only after that object's `protectUntil`. Until the newest object expires, the deleted GitHub identity cannot sign back in. Do not reduce the horizon below the longest backup retention or rotate/lose the HMAC key while protected backups exist.

### Relay rollback

Keep the previous artifact and a pre-deploy SQLite backup. A rollback that restores SQLite must follow the isolated deletion-replay procedure above before traffic resumes; restoring SQLite alone is prohibited because it can resurrect deleted identity data. If authentication, storage, or WebSocket routing fails, remove the official relay from public copy and direct users to self-hosting. If plaintext leakage is suspected, stop the relay, preserve evidence privately, and follow `SECURITY.md` instead of opening a public issue.

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

It builds only `aarch64-apple-darwin`, verifies that the executable is arm64-only and declares `LSMinimumSystemVersion` 11.0, then verifies Developer ID signing and stapled notarization, runs Gatekeeper checks, writes checksums, emits an SPDX SBOM, records build-provenance attestations, and keyless-signs the checksum manifest and SBOM with Sigstore. Missing signing secrets fail the release; do not publish ad hoc or unsigned local builds as public artifacts.

The release lane validates the live AASA documents before the Developer ID build and verifies the packaged associated-domain entitlement afterward. Keep `APPLE_TEAM_ID` synchronized across signing, the AASA application identifier, and the ten-character Team ID validation. The ordinary macOS CI package uses Tauri's ad-hoc (`-`) identity, which requires no Apple account or personal certificate and proves that the entitlement was assembled into the code signature. Only a Developer ID-signed, installed application whose Team ID matches the live domains can prove macOS universal-link routing.

Use [reproducible-builds.md](reproducible-builds.md) to compare the unsigned application payload. Signed/notarized archives are not claimed to be bit-for-bit reproducible.

Before announcement, verify the update manifest, release notes, artifact digests, signature/notarization status, SBOM/provenance attachments, hosted relay, and two-person dogfood result. Ordinary bug reports should use the bounded redacted diagnostics export; never request invite fragments, credentials, transcripts, terminal output, browser content, or private source by default.

## Hosted relay exit policy

Give at least 30 days' public notice before a planned official hosted relay shutdown. During the notice window, keep sign-in, relay connectivity, and these instructions available unless an emergency security, legal, provider, or private-data incident makes that unsafe. Emergency notice may be shorter only for those reasons and should preserve the minimum safe migration path.

The relay is not the source of truth for project folders, Git history, MLS private state, or device-local encrypted history. Migration recreates relay-side teams, rooms, memberships, sessions, invites, backlog, and blobs.

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

With two members, verify the active host, Codex approval, session persistence, member removal, and future-traffic exclusion. After all members join, issue an MLS Update Commit and verify every eligible device advances while removed or stale devices do not.

If a device cannot read retained history, stop before clearing rooms or reinstalling: the relay cannot reconstruct MLS state or exporter-derived history secrets. Until encrypted export/import ships, preserved devices are the continuity mechanism.

### Migration rollback

Before final cutover, members can switch Settings back to the hosted origins and continue in the original rooms. Messages sent only through the destination are not copied back automatically. Keep the hosted rooms quiet during observation, then publish the cutover time and retain the old service for the promised notice window.

## Maintenance rules

- Update this guide when a release workflow, production doctor check, relay default, or migration behavior changes.
- Keep exact environment defaults in `.env.example` and [self-hosting.md](self-hosting.md), not duplicated here.
- Keep CI policy in [ci-policy.md](ci-policy.md), dependency/security automation in [dependency-security.md](dependency-security.md), and security boundaries in [threat-model.md](threat-model.md).
- Run `npm run test:scripts`; project hygiene verifies local links, documented npm scripts, and documented relay/GitHub environment names.
- Before a non-alpha claim, require independent cryptography review, production-scale persistence/rate limiting, recurring multi-device adversarial journeys, and documented release-key custody.
