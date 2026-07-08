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

- Maintainers will give at least 90 days' public notice before a planned official hosted relay shutdown.
- During that window, sign-in, relay connectivity, and migration instructions should remain functional unless an emergency security, legal, provider, or private-data exposure incident prevents it.
- The official migration path is the [hosted-to-self-hosted relay migration runbook](relay-migration-runbook.md): users stand up a self-hosted relay, switch the desktop Settings relay URLs, recreate team/room membership there, and keep local room keys/history on each device.
- Encrypted export/import is planned as a future belt-and-suspenders exit path. Do not imply it exists until it ships; describe current continuity as device-local history plus relay migration.

If an emergency shutdown cannot honor the full 90 days, publish the reason, keep the minimum safe relay functionality online for migration when possible, and direct users to the runbook.

## Production Secrets

Create and store:

- `GITHUB_CLIENT_ID`;
- `MULTAIPLAYER_RELAY_SESSION_SECRET`;
- deploy/provider credentials;
- Apple signing credentials, if signing now.

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

## Two-Person Dogfood

Run at least one full test with two GitHub accounts on two macOS devices:

- official relay sign-in;
- invite join;
- encrypted chat and attachments;
- local project attach;
- Codex approval;
- file/diff viewer;
- terminal typing;
- browser opening from UI and Codex instruction;
- Git branch/commit/push/draft PR/Actions;
- host usage-limit handoff;
- member removal/locked-room behavior;
- relay restart with durable encrypted sessions.
- hosted-to-self-hosted relay migration using [relay-migration-runbook.md](relay-migration-runbook.md).

Capture issues with the dogfood report template. Redact secrets, private code, room keys, invite fragments, transcripts, terminal output, and signed-in browser pages.

## Trust And Security Copy

Before announcing, review public copy for these exact promises:

- The relay does not need plaintext chat, attachments, repo files, Codex credentials, OpenAI credentials, browser contents, or terminal output.
- The active host's local machine is powerful and sensitive: project files, terminal, browser, Git, GitHub, and Codex run through that host.
- GitHub OAuth tokens are held by the relay for identity, PR creation, and Actions reads; durable sessions are encrypted at rest when the session secret is configured.
- The alpha has known limitations and should not be described as production-ready.

Avoid promising external audits, production-grade E2EE member removal, or enterprise compliance until those are actually true.

## Release Cadence And Support

Recommendation:

- weekly or biweekly alpha tags while the product is moving quickly;
- GitHub Issues for bugs, UX, dogfood reports, and relay deployment help;
- GitHub Security Advisories or the `SECURITY.md` contact path for vulnerabilities and private-data exposure;
- a short support expectation in the README saying alpha support is best-effort.
