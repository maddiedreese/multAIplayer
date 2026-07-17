# Self-Hosting

This is an operator configuration guide. The [threat model](threat-model.md) is the sole normative source for security claims, trust assumptions, and residual risks.

The relay is intended to be self-hostable. In the current alpha it routes encrypted room events and manages presence; it does not call OpenAI or store plaintext chat transcripts.

Teams moving from the hosted relay to their own relay should use
[Migrating From The Hosted Relay](#migrating-from-the-hosted-relay).

Supported alpha self-hosting requirements:

- Node.js runtime for the relay;
- GitHub OAuth app configured by the self-hoster;
- HTTPS and WebSocket support;
- a trusted TLS reverse proxy or edge service in front of every internet-facing relay, with the Node listener unreachable from the public internet;
- a desktop build whose app-shell CSP includes the self-hosted relay HTTP and WebSocket origins;
- persistent SQLite storage for hosted or internet-facing relays;
- relay-managed encrypted attachment blob storage in SQLite.

Account deletion is committed to the primary SQLite database. Never restore a database backup from before an account deletion; the relay deliberately has no second deletion ledger. See [Relay operations](relay-operations.md#account-deletion-and-backup-restores).

## Desktop onboarding, authentication, and invite links

The self-hosted desktop must be compiled with its GitHub Device Flow client id and exact relay origin for authenticated create/join onboarding; the relay verifies the resulting access token and does not own the Device Flow client. GitHub identifies the relay member; ChatGPT authorizes only the local Codex process and is never configured on the relay. Invitees may join after relay/GitHub readiness without Codex, ChatGPT authorization, or a project folder. A creator must complete the local host-readiness checks before creating the first room.

Provider verification URLs are not general self-host configuration. The desktop accepts the exact GitHub device page and a small allowlist of official OpenAI HTTPS hosts, and Rust repeats those checks before opening the system browser. GitHub Enterprise or another identity provider therefore requires an explicit reviewed code/configuration change rather than passing an arbitrary OAuth URL through the relay.

Official builds generate `https://open.multaiplayer.com/invite#…` and register `applinks:open.multaiplayer.com` plus `applinks:multaiplayer.com`. All invite material is in the fragment; the website does not learn the self-hosted relay or invite. The recipient's app must already be configured for the same relay before admission can succeed.

A differently branded or independently distributed desktop cannot inherit the official universal-link association. It must use its own HTTPS hosts, serve no-redirect AASA files whose `appID` exactly matches its Apple Team ID and bundle identifier, update the native/TypeScript host allowlists and CSP, add the associated-domain entitlement, sign the app with that team, and provide its own privacy-preserving install landing. Do not add a custom scheme as a shortcut. Until that work is reviewed and manually tested, distribute the complete link privately and have recipients paste it into the configured app.

## Relay Configuration

The relay reads configuration from shell-exported environment variables first. For local and single-process deployments, it also loads `.env` files before reading relay settings:

- an explicit `MULTAIPLAYER_RELAY_ENV_FILE=/absolute/path/to/.env`;
- `apps/relay/.env` when present;
- the repo root `.env` when present.

Shell-exported values take precedence over `.env` file values. The parser supports simple `KEY=value` lines, quoted values, blank lines, and comments.

`npm run doctor` checks a contributor's local development toolchain. Production
relay configuration is checked by the relay's own configuration parser and
pre-deploy entry point. To validate the same build and environment without opening
a listener, run:

```bash
npm run build -w @multaiplayer/relay
NODE_ENV=production node apps/relay/dist/predeploy-check.js
```

The check rejects invalid origins, disabled authentication or rate limits, enabled
debug routes, missing metrics protection, insufficient disk headroom, and a missing
KeyPackage validator. It does not replace TLS, backups, log review, process
supervision, or a trusted edge for an internet-facing deployment.

## Docker Relay

The relay includes a production Dockerfile at `apps/relay/Dockerfile`.

Build it from the repository root:

```bash
docker build -f apps/relay/Dockerfile -t multaiplayer-relay:alpha .
```

Run it with a persistent `/data` mount:

```bash
docker run --rm -p 4321:4321 \
  -v multaiplayer-relay-data:/data \
  -e MULTAIPLAYER_RELAY_METRICS_TOKEN=replace_with_a_different_32_char_token \
  -e MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://your-app.example \
  -e MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=false \
  -e MULTAIPLAYER_RELAY_DEBUG=false \
  multaiplayer-relay:alpha
```

The image sets `NODE_ENV=production`, `PORT=4321`, `MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite`, and the bundled `MULTAIPLAYER_MLS_VALIDATOR_PATH` by default. Both the container healthcheck and platform readiness use `/readyz`. Its public JSON is deliberately minimal: `{ "ok": true }` while ready, or `{ "ok": false, "code": "relay_shutting_down" | "persistence_unavailable" }` with status `503`; it does not expose filesystem configuration. During shutdown, `/readyz` reports not-ready, new HTTP requests and WebSocket upgrades are rejected, existing room WebSockets close with code `1012` (`Service Restart`), and the relay store is flushed before exit. Give the process a termination grace period long enough for the flush to complete.

The production container and `npm start -w @multaiplayer/relay` run the pre-deploy
check before opening a listener. Startup and `/readyz` additionally verify database
access and deletion reconciliation. Supervise the process, alert on restarts and
`relay_store_persistence_poisoned`, and probe `/readyz` externally.

For a source checkout, build the fail-closed public KeyPackage validator before starting the relay:

```bash
cd apps/desktop/src-tauri
cargo build --locked --release -p mls-core --bin mls-keypackage-validator
export MULTAIPLAYER_MLS_VALIDATOR_PATH="$PWD/target/release/mls-keypackage-validator"
```

Production startup rejects a missing validator path; the relay never substitutes a TypeScript MLS parser.

## Relay Storage

SQLite is the relay's only runtime backend, including for local development. With no data path set, the relay uses `.multaiplayer/relay-store.sqlite`:

```bash
MULTAIPLAYER_RELAY_DATA_PATH=.multaiplayer/relay-store.sqlite
```

Hosted or internet-facing relays should place the SQLite database on persistent storage:

```bash
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES=250000
MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM=25000
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES=50000000
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM=25000000
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM=5000000
MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES=100000000
MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM=50000000
MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES=1000000000
MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON=true
```

SQLite uses WAL mode and transactions. Successful responses and broadcasts follow
durable writes; related MLS state changes commit atomically.

Runtime writes complete before a successful response or broadcast. If a write
fails, `/readyz` reports `persistence_unavailable`, product traffic is refused, and
the process exits for a supervised restart. See [Relay operations](relay-operations.md)
for incident response, monitoring, and restores.

The relay hydrates durable state into one process-local store. Entry-count and
ciphertext-byte ceilings bound that working set globally and per team; startup
rejects an invalid hierarchy. The alpha defaults retain at most 150 MB of combined
attachment and MLS ciphertext before representation overhead. They replace the
earlier 600 MB combined defaults, which were not safe for the hosted 1 GB process.
Lower them for constrained hosts and measure resident memory before raising them.

Run one relay writer per SQLite database. Scale vertically or place whole teams on
independent relays; see the [single-node relay decision](decisions/single-node-relay.md).

If an existing relay database is unreadable, has missing or unsupported version metadata, contains malformed critical rows, or exceeds a configured startup ceiling, startup fails rather than serving an empty replacement workspace. The configured database remains in place across restarts so supervision cannot turn a recovery failure into an empty live relay. Operators must inspect the startup error and recover, restore, or deliberately replace the database while the relay is stopped. Keep regular backups of `MULTAIPLAYER_RELAY_DATA_PATH`.

The relay enables conservative size, retention, rate, socket, and per-account
quotas by default. Encrypted attachments and MLS backlog remain opaque while their
stored bytes and retention are bounded. Treat complete invite URLs and fragments
as secrets and redact them from logs and support artifacts.

The root [`.env.example`](../.env.example) lists every supported setting and its
default. Change limits only in response to measured resource needs; invalid values
fail startup. Authenticated quotas survive restarts. The in-process rate limiter
does not, which is one reason multiple production replicas are unsupported.

Internet-facing deployments require a reverse proxy or edge that terminates TLS,
strips client-supplied forwarding headers, and applies coarse source-IP controls.
Bind Node to a private interface so clients cannot bypass it. Leave
`MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false` unless that isolation is verified.

Production logging, metrics, shutdown, restriction, and incident procedures live
in [Relay operations](relay-operations.md).

Workspace mutations can require GitHub sign-in:

```bash
MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=false
```

When enabled, reading workspace metadata, creating teams, creating rooms, creating invites, registering devices, uploading encrypted attachment blobs, changing host state, and changing room settings return `401` unless the desktop has a valid GitHub session cookie with that relay. Authenticated device registration is bound to the signed-in GitHub user id.

Authenticated workspace reads are membership-scoped. A signed-in user only receives teams and rooms where they are a known team member. Room-level mutations and attachment blob reads also require membership. Invite metadata remains readable by invite id so a joiner can verify that the relay metadata matches the invite fragment; the desktop then presents that invite id during WebSocket join to be admitted as a team member.

Authentication is enabled by default in every environment, even before a native desktop has completed GitHub sign-in.

The repository's `.env.example` is the exception: it is a loopback-only development
profile with the unsafe auth opt-out enabled. Copy it to the repository-root `.env`,
run `npm run doctor`, then run `npm run tauri:dev`; Tauri starts the root relay and
Vite development processes. Those processes load the root environment file.
GitHub identity sign-in is intentionally unavailable in this mode because native
identity verification is compiled against one trusted HTTPS relay origin.
Production startup rejects the auth opt-out.

Session cookies are `HttpOnly`, `SameSite=Lax`, and marked `Secure` whenever `NODE_ENV=production`, so an authenticated production deployment requires HTTPS/WSS. The pre-deploy check rejects auth-disabled production configuration. Use `MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=true` only for a private LAN development relay.

Credentialed browser origins and WebSocket room upgrades can be restricted:

```bash
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com,https://app.multaiplayer.com
```

If one or more valid origins are configured, the relay only emits CORS credential headers and accepts browser-origin WebSocket upgrades for those exact origins. Production pre-deploy requires a non-empty valid allowlist. Requests that omit the `Origin` header are still allowed so native clients and server-side health checks continue to work.

The allowlist is therefore a browser CORS and WebSocket-origin control, not a client-authentication boundary. Native and server-side clients can omit `Origin`; authentication, device-session signatures, membership authorization, and TLS provide the corresponding identity and transport controls. Only an omitted header receives this exemption: an explicitly empty `Origin` value is invalid and rejected.

Origin entries are normalized to bare origins by the relay. `https://multaiplayer.com/` becomes `https://multaiplayer.com`. The exact `tauri://localhost` origin is also supported for the packaged macOS webview. Another custom scheme, a path, query, fragment, credentials, wildcard, or a custom port on that desktop origin rejects the entire allowlist.

## GitHub OAuth

The native desktop supports GitHub device-code OAuth. This works well because users can sign in through a browser without the desktop app receiving an OAuth redirect. Create a GitHub OAuth app, enable **Device Flow**, and compile the self-hosted desktop with its public client id and the exact relay origin:

```bash
MULTAIPLAYER_NATIVE_GITHUB_CLIENT_ID=your_client_id \
MULTAIPLAYER_NATIVE_RELAY_HTTP_ORIGIN=https://relay.example.com \
npm run tauri:build
```

No client secret is embedded or required. Identity sign-in requests only `read:user`. Optional native pull-request and Actions API workflows request `repo` later through an explicit device flow. Git push uses the host's ordinary Git credential path, not either OAuth token. GitHub's `repo` scope is intentionally broad: approving that optional grant gives the native app access to private repositories available to the same GitHub account, not only the repository currently open in multAIplayer. Native code stores the two tokens separately, verifies that they identify the same account, and never sends the repository token to the relay. Signing out of multAIplayer deletes both local tokens and the relay session but does not revoke the OAuth app authorization in GitHub settings.

While authorization is pending, the desktop polls at GitHub's advertised interval. It increases that interval when GitHub asks it to slow down and stops when the device code expires, is denied, or GitHub returns another terminal error. Users must start sign-in again after a terminal error.

GitHub access tokens stay behind the native Rust IPC boundary. Native commands repeat repository, branch, request-size, response-size, text, and GitHub URL validation before returning bounded results to the webview. The relay never receives PR bodies, repository targets, or Actions responses. Structured relay request logs record only method, route path without its query string, status, duration, and a bounded request id; they do not record request bodies or the transient verification token. GitHub remains a separate processor of the data sent to its API.

## Account deletion

The desktop exposes account deletion after the user transfers or deletes owned resources. Deletion is durable in the current SQLite database; backup policy must prevent an older copy from restoring the account. See [Relay operations](relay-operations.md#account-deletion-and-backup-restores).

For local development, the desktop app expects these values from the root `.env`:

```bash
VITE_RELAY_HTTP_URL=http://127.0.0.1:4321
VITE_RELAY_URL=ws://127.0.0.1:4321/rooms
VITE_ALLOW_RELAY_CONFIGURATION=true
```

The first two env vars define the packaged defaults; `VITE_ALLOW_RELAY_CONFIGURATION=true` exposes the endpoint controls in Settings. Official packaged builds pin their hosted endpoints, hide these controls, and do not allow localhost relay access. A custom self-hosted relay origin requires a self-built desktop app with `apps/desktop/src-tauri/tauri.conf.json` updated so `connect-src` includes both the relay HTTP origin and the matching WebSocket origin. The override is stored locally on that device.

The alpha relay stores durable token-free signed-in sessions in its configured state store. Hosted and internet-facing deployments should use SQLite and should add backup/restore drills and shared/external rate limiting before making production or multi-instance claims.

## Migrating From The Hosted Relay

The relay does not hold plaintext room history, MLS private state, or exporter-derived history secrets. Migrating from the hosted relay to a self-hosted relay is therefore a membership and routing cutover, not a server-side transcript export.

Plan to:

- stand up the self-hosted relay and pass its production pre-deploy check;
- use a desktop build whose app-shell CSP allows the self-hosted HTTP and WebSocket relay origins;
- switch each desktop app's `HTTP API URL` and `WebSocket rooms URL` in Settings;
- sign in to GitHub again for the new relay origin when auth is required;
- recreate teams and rooms on the self-hosted relay;
- issue fresh invites so each device joins the new relay-side rooms;
- confirm new encrypted chat, attachments, Codex host approval, and local history readability before treating the migration as complete.

The encrypted room archive is a portable, read-only copy of display history already available on one device. It does not contain MLS authority, membership, credentials, exporter secrets, or live room state, so it cannot migrate a room to another relay. Keep the original devices and their encrypted archives until the replacement rooms are verified; see [Encrypted room archives](room-archives.md).
