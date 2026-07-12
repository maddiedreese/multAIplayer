# Public Alpha Maintainer Guide

This guide covers the launch tasks that require maintainer accounts, production secrets, domains, signing decisions, or live people. It complements the automated release checks in [alpha-release-readiness.md](alpha-release-readiness.md).

## GitHub OAuth App

Create the OAuth app under the account or organization that should own the official multAIplayer identity.

Recommended alpha settings:

- Application name: `multAIplayer`
- Homepage URL: `https://multaiplayer.com`
- Authorization callback URL: use GitHub device-code OAuth for the desktop flow; if GitHub requires a callback URL for the app record, set it to the official site URL or a documented placeholder page.
- Scopes: start with `read:user public_repo`.

Use `read:user repo` only when the official hosted relay is explicitly ready to ask users for private repository access. Keep that as a visible product/trust decision, not a silent default.

Set the relay environment:

```bash
GITHUB_CLIENT_ID=...
GITHUB_OAUTH_SCOPES="read:user public_repo"
```

## Domain And URLs

Recommended alpha shape:

- Website: `https://multaiplayer.com`
- Relay API: `https://relay.multaiplayer.com`
- Relay rooms WebSocket: `wss://relay.multaiplayer.com/rooms`

This keeps static/public site hosting separate from relay operations while staying easy for users to understand.

In the desktop app defaults or release instructions, use:

```bash
VITE_RELAY_HTTP_URL=https://relay.multaiplayer.com
VITE_RELAY_URL=wss://relay.multaiplayer.com/rooms
```

Keep the packaged desktop CSP aligned with these origins. The alpha app shell intentionally allows localhost development relays and `https://relay.multaiplayer.com` / `wss://relay.multaiplayer.com`, not arbitrary HTTPS/WSS egress.

Dogfood and public alpha release builds should set these `VITE_RELAY_*` defaults once the official relay URLs are final, so first launch points at the hosted relay instead of requiring local relay setup.

For the relay:

```bash
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com
```

If you later host a web build at another exact origin, add that origin explicitly. Do not use wildcard origins.

## Hosted Relay Provider

Pick a provider that gives:

- stable HTTPS/WSS routing;
- persistent mounted storage;
- secret management;
- deploy rollback;
- health checks;
- logs with redaction controls;
- a clear story for backups.

For the alpha, a single instance is acceptable if the public copy says it is alpha infrastructure. Avoid multi-instance relay hosting until there is shared storage and shared/edge rate limiting.

## Hosted Relay Sunset Policy

Publish the hosted relay exit guarantee before the public alpha announcement:

- Maintainers will give at least 30 days' public notice before a planned official hosted relay shutdown.
- During that window, sign-in, relay connectivity, and migration instructions should remain functional unless an emergency security, legal, provider, or private-data exposure incident prevents it.
- The official migration path is the [hosted-to-self-hosted relay migration runbook](relay-migration-runbook.md): users stand up a self-hosted relay, switch the desktop Settings relay URLs, recreate team/room membership there, and keep local room keys/history on each device.
- Encrypted export/import is planned as a future belt-and-suspenders exit path. Do not imply it exists until it ships; describe current continuity as device-local history plus relay migration.

If an emergency shutdown cannot honor the full 30 days, publish the reason, keep the minimum safe relay functionality online for migration when possible, and direct users to the runbook.

## Production Secrets

Create and store:

- `GITHUB_CLIENT_ID`;
- `MULTAIPLAYER_RELAY_SESSION_SECRET`;
- deploy/provider credentials;
- Apple signing credentials, when signing locally.

Do not store OpenAI or Codex credentials in the relay. multAIplayer uses each host's local Codex app-server, not a project-owned OpenAI API key.

## Signing And Notarization

Recommendation for the first public alpha: use Apple Developer ID signing and notarization because the release workflow supports it when secrets are configured.

Create or export a Developer ID Application certificate, then add these GitHub Actions secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
KEYCHAIN_PASSWORD
```

`APPLE_CERTIFICATE` should be the base64 encoded `.p12` export:

```bash
openssl base64 -A -in /path/to/developer-id-application.p12 -out certificate-base64.txt
```

Use an app-specific password for `APPLE_PASSWORD`. Use a generated random value for `KEYCHAIN_PASSWORD`; it only protects the temporary CI keychain during a release job. The release workflow fails if any signing/notarization secret is missing, so do a dry-run tag before the announcement tag.

After the first signed release succeeds, verify the GitHub Release says the artifact is Developer ID signed and notarized.

## Update And Support Loop

Publish `https://multaiplayer.com/releases/latest.json` for every public alpha build. The desktop app reads this manifest and shows an update banner when `version` is newer than the installed app. Set `security: true` for security fixes so stale clients get a stronger in-app nudge. The alpha still uses manual downloads, not Tauri auto-update, so release announcements should tell users to install the new signed build.

For ordinary bug reports, ask native-app testers to open Account settings, click `Save diagnostics`, choose a destination, review the JSON, and attach it to the GitHub issue. Rust validates and re-redacts the capture-redacted JSONL records, assembles the bundle, and writes it directly through the system save dialog. No command returns stored entries, bundle contents, or the selected path to the webview. Native diagnostics remain owner-only (`0600`) in the platform app log directory and are bounded to seven days, 256 KiB, and 500 entries. The web preview keeps only its in-memory ring and offers `Copy diagnostics`. The file is not encrypted at rest in this alpha, so do not expand collection beyond bounded warning/error metadata without revisiting that design. Do not ask users to paste terminal output, room transcripts, any current capability-bearing or legacy room-key-bearing invite fragment, private repo files, or browser contents unless they explicitly choose to share that material.

In code and review, require diagnostic calls to contain stable error codes and bounded ids, never payload objects. The sensitive-key omission and text redaction layers protect against mistakes but do not make arbitrary objects safe to log. Keeping diagnostics outside web storage narrows incidental exposure; it does not neutralize a compromised desktop shell or its other Tauri capabilities.

## Two-Person Dogfood

Run at least one full test with two GitHub accounts on two macOS devices:

- official relay sign-in;
- capability-authenticated invite join, including full key fingerprint and outer-sender binding;
- encrypted chat and attachments;
- local project attach;
- Codex approval;
- file/diff viewer;
- terminal typing;
- browser opening from UI and Codex instruction;
- Git branch/commit/push/draft PR/Actions;
- host usage-limit handoff;
- member removal, epoch advancement, removed-device exclusion, and locked-room behavior;
- malicious-relay metadata, requester-key substitution, replay, and cross-epoch rejection;
- relay restart with durable encrypted sessions.
- hosted-to-self-hosted relay migration using [relay-migration-runbook.md](relay-migration-runbook.md).

Capture issues with the dogfood report template. Redact secrets, private code, room keys, invite fragments, transcripts, terminal output, and signed-in browser pages.

## Trust And Security Copy

Before announcing, review public copy for these exact promises:

- The relay does not need plaintext chat, attachments, repo files, Codex credentials, OpenAI credentials, browser contents, or terminal output.
- The active host's local machine is powerful and sensitive: project files, terminal, browser, Git, GitHub, and Codex run through that host.
- GitHub OAuth tokens are held by the relay for identity, PR creation, and Actions reads; durable sessions are encrypted at rest when the session secret is configured.
- The alpha has known limitations and should not be described as production-ready.

Avoid promising external audits, retroactive erasure, synchronized identity recovery, or enterprise compliance until those are actually true.

## Release Cadence And Support

Recommendation:

- weekly or biweekly alpha tags while the product is moving quickly;
- GitHub Issues for bugs, UX, dogfood reports, and relay deployment help;
- GitHub Security Advisories or the `SECURITY.md` contact path for vulnerabilities and private-data exposure;
- a short support expectation in the README saying alpha support is best-effort.

## Dependency And Coverage Maintenance

Dependabot checks the root npm workspace, the native Cargo workspace, and GitHub Actions each month. Direct npm and Cargo dependencies remain exact-pinned during alpha. Compatible patch/minor updates and majors arrive in separate batches; treat a major batch as an explicit owner migration decision with upstream migration-note and transitive-change review, updated compatibility fixtures/docs where relevant, and the complete CI gate. This does not require a second reviewer. Keep lockfiles synchronized and inspect release-tooling changes before merging any dependency batch.

Every third-party GitHub Action is referenced by an immutable commit SHA. The adjacent version comment is the human-readable release that the SHA represents; update the SHA and comment together. Do not replace these references with mutable major-version tags. Dependabot understands pinned Action references and proposes reviewed SHA updates.

The web-and-relay CI job runs `npm run test:coverage` after the full workspace verification. It enforces package-specific thresholds across protocol, crypto, Git, GitHub, and Codex, plus the focused relay authorization/input-limit gate. Protocol is held at 100% in every measured category; relay authorization and input limits require 100% lines, statements, and functions plus 90% branches. The Codex package isolates process spawning and newline framing behind an injectable transport so request correlation, timeouts, exits, restarts, and cleanup are deterministic tests; its ratchet is 99% lines/statements, 100% functions, and 95% branches. CI uploads LCOV and JSON summaries as the `package-and-relay-coverage` artifact. Treat threshold reductions, exclusions, or removal of security-sensitive modules as security-review decisions. Coverage complements the real-relay lifecycle and persistence invariants; it does not replace integration or end-to-end tests.

Canonical crypto encodings and the relay persistence codec also carry seeded `fast-check` properties. They assert deterministic ordering, semantic round trips, canonical Base64 alphabets, exact buffer slicing, malformed-record isolation, and encode/decode idempotence. The relay codec accepts an injected clock so expiry and serialized timestamps are reproducible; production defaults to the system clock. Preserve replay seeds when diagnosing a failure, and add a regression example before changing an invariant exposed by a minimized counterexample.

Crypto changes that affect authentication, validation, key binding, algorithms, versions, or context must also pass `npm run test:mutation -w @multaiplayer/crypto`. The composite command runs Stryker, writes a deterministic summary, and invokes the repository policy checker as a hard gate. The gate requires 100% overall and per-file mutation scores with no survivors; every ignored mutant is pinned to an exact source signature and rationale in `packages/crypto/mutation-policy.json`. Stryker's lower `break` threshold exists only so it still emits the JSON needed for the stricter checker; it is not the acceptance threshold. CI runs the same composite command and retains the full report artifact. A deterministic script test proves that a synthetic 60% report exits with a policy failure. Do not lower the ratchet, move a region marker to exclude code, or widen an ignore to accommodate a change.

The same zero-survivor, 100%-per-file policy independently governs relay authorization (`apps/relay/src/authz.ts`) and protocol record guards (`packages/protocol/src/type-guards.ts`). Run `npm run test:mutation -w @multaiplayer/relay` or `npm run test:mutation -w @multaiplayer/protocol` after changing those surfaces. Separate CI jobs retain deterministic summaries and full HTML/JSON reports so a failure is attributable without waiting for the longer crypto mutation job. TypeScript checker compile errors are recorded as invalid generated programs; timeouts, survivors, uncovered code, runtime errors, broad ignores, or unlisted source files fail policy.
