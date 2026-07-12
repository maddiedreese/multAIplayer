# Self-Hosting

The relay is intended to be self-hostable. In v1 it routes encrypted room events and manages presence; it does not call OpenAI or store plaintext chat transcripts.

Teams moving from the hosted relay to their own relay should use the [hosted-to-self-hosted relay migration runbook](relay-migration-runbook.md). The short version is: deploy and verify a self-hosted relay, use a desktop build whose app-shell CSP allows the self-hosted HTTP and WebSocket origins, change each desktop app's Settings drawer to those relay URLs, recreate team/room membership with fresh invites, and rely on each device's local room keys and encrypted local history for continuity.

Supported alpha self-hosting requirements:

- Node.js runtime for the relay;
- GitHub OAuth app configured by the self-hoster;
- HTTPS and WebSocket support;
- a desktop build whose app-shell CSP includes the self-hosted relay HTTP and WebSocket origins;
- persistent SQLite storage for hosted or internet-facing relays;
- relay-managed encrypted attachment blob storage in SQLite for hosted or internet-facing relays, or JSON storage for local/dev self-hosting.

## Relay Configuration

The relay reads configuration from shell-exported environment variables first. For local and single-process deployments, it also loads `.env` files before reading relay settings:

- an explicit `MULTAIPLAYER_RELAY_ENV_FILE=/absolute/path/to/.env`;
- `apps/relay/.env` when present;
- the repo root `.env` when present.

Shell-exported values take precedence over `.env` file values. The parser supports simple `KEY=value` lines, quoted values, blank lines, and comments.

For a hosted or internet-facing relay, run the production relay doctor against the same shell environment used to start the relay:

```bash
npm run doctor:production-relay
```

This check fails if GitHub OAuth is missing, durable session encryption is weak or missing, credentialed browser origins are unset or not exact HTTP(S) origins, auth is explicitly disabled, debug endpoints are enabled, demo workspace seeding is enabled, in-process rate limits are disabled, relay storage points at `/tmp`, or untrusted proxy headers are accepted. It is a deployment sanity check, not a substitute for TLS, backups, log review, process supervision, or an external rate limiter in multi-instance deployments.

## Docker Relay

The relay includes a production Dockerfile at `apps/relay/Dockerfile`.

The runtime entry point is intentionally only a bootstrap: `createRelayApp()` composes configuration, HTTP routes, WebSocket handling, persistence, and lifecycle ownership, while `src/index.ts` starts that composition and installs signal handlers. Embedders and tests can construct the same production application without triggering a listener as an import side effect.

Build it from the repository root:

```bash
docker build -f apps/relay/Dockerfile -t multaiplayer-relay:alpha .
```

Run it with a persistent `/data` mount and the same environment that passes `npm run doctor:production-relay`:

```bash
docker run --rm -p 4321:4321 \
  -v multaiplayer-relay-data:/data \
  -e GITHUB_CLIENT_ID=your_client_id \
  -e MULTAIPLAYER_RELAY_SESSION_SECRET=replace_with_at_least_32_chars \
  -e MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com \
  -e MULTAIPLAYER_RELAY_REQUIRE_AUTH=true \
  -e MULTAIPLAYER_RELAY_DEBUG=false \
  -e MULTAIPLAYER_RELAY_SEED_DEMO=false \
  multaiplayer-relay:alpha
```

The image sets `NODE_ENV=production`, `PORT=4321`, `MULTAIPLAYER_RELAY_STORAGE=sqlite`, and `MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite` by default. The container healthcheck reads `/healthz`; point platform readiness at `/readyz`. During shutdown, `/readyz` reports not-ready, new HTTP requests and WebSocket upgrades are rejected, existing room WebSockets close with code `1012` (`Service Restart`), and the relay store is flushed before exit. Give the process a termination grace period long enough for the flush to complete.

## Relay Storage

SQLite is the default relay backend, including for local development. With no storage variables set, the relay uses `.multaiplayer/relay-store.sqlite`. Its transactional writes and WAL recovery make it the safer baseline:

```bash
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=.multaiplayer/relay-store.sqlite
```

The legacy JSON snapshot backend remains available only as an explicit local-development or migration choice. Set both variables so this choice is visible:

```bash
MULTAIPLAYER_RELAY_STORAGE=json
MULTAIPLAYER_RELAY_DATA_PATH=/var/lib/multaiplayer/relay-store.json
```

Hosted or internet-facing relays must use SQLite to pass the production relay doctor:

```bash
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
```

SQLite uses WAL mode and transactional writes to normalized relay tables for teams, rooms, invites, device keys, encrypted backlog, encrypted attachment blobs, team membership, and encrypted GitHub sessions. It is the required alpha storage backend for hosted relays because it is more crash-safe than replacing one JSON file. JSON storage remains an explicit compatibility option for local development and migration; it is never selected implicitly.

For upgrade continuity, a relay started with neither storage variable set checks the former default path `.multaiplayer/relay-store.json` before initializing the default SQLite database. It imports a valid version-1 snapshot transactionally, then renames the JSON source to `relay-store.json.migrated-to-sqlite`. Restarts load only the committed SQLite state, so the import is idempotent. An unreadable or unsupported legacy snapshot aborts startup and remains in place for operator recovery; it never falls through to an empty store. Explicit storage or data-path settings are never auto-migrated. Back up the JSON file first and use the explicit migration runbook when operating outside these defaults.

If the relay cannot parse the configured store, or the store version is unsupported, it moves the store aside next to the original path with a `.corrupt-...` suffix and starts from a clean in-memory state. Keep regular backups of `MULTAIPLAYER_RELAY_DATA_PATH` for production/self-hosted deployments; the quarantine file is a recovery aid, not a replacement for backups.

The alpha store contains:

- teams and room records;
- known team member ids used for metadata counts;
- device ECDH public keys and fingerprints;
- invite metadata;
- encrypted WebSocket message envelopes and ciphertext payloads;
- encrypted attachment blob ciphertext and metadata.
- encrypted GitHub session access tokens, only when `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured.

It does not contain:

- plaintext chat transcripts;
- Codex credentials;
- OpenAI credentials;
- plaintext GitHub access tokens;
- repo files;
- terminal output in plaintext.

GitHub sign-in sessions are memory-only unless the relay has a session secret. To keep users signed in across relay restarts, configure a high-entropy secret and keep it stable:

```bash
MULTAIPLAYER_RELAY_SESSION_SECRET=$(openssl rand -base64 32)
```

With this set, the relay encrypts GitHub session access tokens with AES-GCM before writing them to the configured relay store and prunes expired sessions on load and save. The secret must be at least 32 characters; shorter values are ignored and durable sessions stay disabled. If the secret is missing, sessions are not persisted and restarting the relay signs users out. If the secret changes, previously stored sessions cannot be decrypted and users must sign in again. Plaintext access tokens in the relay store are ignored.

The desktop Account drawer reads `/auth/config` and shows whether the connected relay is using encrypted-at-rest sessions or memory-only sessions.

Local development seeds a small demo workspace by default. Production relays do not seed demo teams or rooms unless explicitly enabled:

```bash
MULTAIPLAYER_RELAY_SEED_DEMO=true
```

The encrypted reconnect backlog is pruned by both count and age:

```bash
MULTAIPLAYER_RELAY_BACKLOG_LIMIT=200
MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS=30
```

These limits apply to ciphertext envelopes only. Plaintext live metadata such as presence and `room.updated` broadcasts is not stored in the encrypted backlog.

Expired reconnect backlog entries are pruned on load, publish, debug inspection, and relay store save.

Invite metadata expires by default:

```bash
MULTAIPLAYER_RELAY_INVITE_TTL_DAYS=7
```

The relay stores invite metadata and registered public device keys, not room keys. Current invite links contain a private bearer capability and the active host's public binding. The capability fragment is not sent in HTTP requests and crosses relay transport only inside a request sealed to the host key; the issuer's capability verifier is desktop-local. Operators should redact complete invite URLs and fragments from logs and support artifacts. Host approval returns the current epoch key in an authenticated host-to-device wrap sealed to the validated requester. Legacy room-key-bearing links are scrubbed from browser history and rejected.

Encrypted attachment blobs are also bounded and pruned:

```bash
MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS=30
MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES=5000000
MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES=250000000
MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW=100000000
MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_WINDOW_MS=3600000
```

The max-bytes setting limits both the declared plaintext attachment size and the ciphertext field size accepted by the relay. The live quota limits the total unexpired encrypted attachment blob volume per signed-in user. The upload bytes quota limits burst upload volume in the configured window. Blob payloads are still ciphertext; these limits are for relay storage and request-size control, not content inspection.

Encrypted room events are also bounded before they enter WebSocket fanout or backlog:

```bash
MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES=1000000
```

This caps the serialized encrypted envelope, including ids, sender fields, nonce, ciphertext, and device-sealed invite key material. Larger file previews should use encrypted attachment blobs instead of oversized room events.

Expired invites and encrypted attachment blobs are pruned when loaded from disk, when the relay store is saved, and when debug state is inspected. Direct reads of an expired invite or blob return an expired response and remove the record.

The relay applies fixed-window in-memory rate limits by default:

```bash
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS=60000
MULTAIPLAYER_RELAY_RATE_LIMIT_AUTH=30
MULTAIPLAYER_RELAY_RATE_LIMIT_READ=300
MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION=120
MULTAIPLAYER_RELAY_RATE_LIMIT_ATTACHMENT=60
MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET=600
MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT=120
MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER=20
MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE=5
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false
MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED=false
MULTAIPLAYER_RELAY_EPOCH_ENVELOPE_LIMIT=1000000
```

These limits are keyed by signed-in session when available, otherwise by client IP. By default, the relay uses the direct socket address and ignores `X-Forwarded-For`, because direct internet clients can spoof that header. Forwarded addresses are used only when both proxy variables are true. Set them only when a trusted reverse proxy removes client-supplied forwarding headers and writes its own; the production doctor rejects the unsafe one-sided configuration. HTTP requests over the limit receive `429` with `Retry-After`; room WebSocket clients receive an encrypted-room-safe error message and remain connected. The alpha limiter is process-local, so multi-instance deployments should add an edge or shared-store limiter in front of the relay.

The relay also enforces a durable envelope budget for each room-key epoch. A monotonic count is stored with the room independently of backlog retention and survives restarts. At the ceiling, ordinary publishes stop and the active host must publish a `room.key` transition; that transition remains permitted and atomically resets the counter for the next epoch, so the room cannot deadlock. The one-million-envelope default keeps random 96-bit AES-GCM nonce use far below its birthday bound without disrupting realistic rooms.

Concurrent WebSocket connection caps are also enforced per signed-in user when available, otherwise per client identity, and per room device id after join. These caps are intentionally above normal use; they exist to prevent a runaway client from holding unbounded sockets.

Team and room creation also have authenticated per-user daily caps:

```bash
MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP=25
MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP=100
MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER=500
```

Daily creation quota rejections return `429` with `Retry-After` and a structured `quota_exceeded` JSON body that clients can render directly. The total-room cap is checked against the signed-in user's current visible rooms and returns the same structured `quota_exceeded` shape.

Authenticated quotas use the GitHub session identity. If a self-hosted relay deliberately disables auth, rate limits still fall back to client IP, but authenticated per-user creation and blob-volume quotas cannot identify a durable account and are correspondingly weaker.

Debug endpoints are disabled in every environment unless explicitly enabled, and enabled routes accept requests only from the local loopback socket:

```bash
MULTAIPLAYER_RELAY_DEBUG=true
```

The relay's GitHub OAuth and PR/Actions upstream requests have a ten-second deadline. Timeout and network failures return bounded gateway errors instead of occupying handlers indefinitely. JSON and SQLite store files (including SQLite sidecars) use owner-only permissions (`0600`). A missing dedicated data directory is created as `0700`; an existing operator-supplied parent directory is not re-permissioned.

Production relays emit structured JSON request logs by default. Local development can opt in:

```bash
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
```

Each response includes an `x-request-id` header. The relay accepts a bounded incoming `x-request-id` or generates one. Logs include request method, path, status code, duration, and request id; they do not include room plaintext, encrypted payload bodies, attachment contents, GitHub tokens, Codex credentials, terminal output, browser pages, or repo files.

Startup, shutdown, configuration rejection, persistence, and quarantine events use the same structured JSON envelope even when request logging is disabled. Those operational events use stable event names and bounded scalar fields; invalid environment values, local store paths, and raw error objects are deliberately omitted.

The relay also exposes content-free operational counters at `/metrics`, including active sockets, live encrypted blob count and bytes, published envelope count, accepted attachment upload count and bytes, upload rejection counts by reason, rate-limit rejection counts by bucket, quota rejection counts by quota type, WebSocket connection attempt/accept/rejection counts, start time, and uptime.

Graceful shutdown timing is configurable:

```bash
MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS=0
MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS=10000
```

When shutdown starts, `/readyz` flips to not-ready immediately. `MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS` keeps the process alive briefly for load balancers to stop routing before sockets close; `MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS` bounds how long existing room WebSockets can take to close before they are terminated.

Workspace mutations can require GitHub sign-in:

```bash
MULTAIPLAYER_RELAY_REQUIRE_AUTH=true
```

When enabled, reading workspace metadata, creating teams, creating rooms, creating invites, registering devices, uploading encrypted attachment blobs, changing host state, and changing room settings return `401` unless the desktop has a valid GitHub session cookie with that relay. Authenticated device registration is bound to the signed-in GitHub user id.

Authenticated workspace reads are membership-scoped. A signed-in user only receives teams and rooms where they are a known team member. Room-level mutations and attachment blob reads also require membership. Invite metadata remains readable by invite id so a joiner can verify that the relay metadata matches the invite fragment; the desktop then presents that invite id during WebSocket join to be admitted as a team member.

Local development can leave auth off for seeded-room testing. Production relays default it on when `NODE_ENV=production`, even if GitHub OAuth has not been configured yet; self-hosters can still set the variable explicitly.

Credentialed browser origins and WebSocket room upgrades can be restricted:

```bash
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com,https://app.multaiplayer.com
```

If set, the relay only emits CORS credential headers and accepts browser-origin WebSocket upgrades for those exact origins. If unset, local development is permissive, while production denies browser origins by default. Requests without a browser `Origin` header are still allowed so native clients and server-side health checks continue to work.

Origin entries are normalized to bare origins by the relay. `https://multaiplayer.com/` becomes `https://multaiplayer.com`. Entries with paths, queries, fragments, credentials, wildcards, or non-HTTP(S) schemes are invalid for production doctor because CORS and WebSocket `Origin` checks cannot be path-scoped. Native desktop requests without an `Origin` header are still allowed.

## GitHub OAuth

The alpha relay supports GitHub device-code OAuth. This works well for the desktop app because users can sign in through a browser without the desktop app needing to receive an OAuth redirect.

Create a GitHub OAuth app, then start the relay with:

```bash
GITHUB_CLIENT_ID=your_client_id npm run dev:relay
```

By default the relay requests:

```bash
GITHUB_OAUTH_SCOPES="read:user public_repo"
```

That is enough for identity plus public open-source PR creation. For private repositories, set:

```bash
GITHUB_OAUTH_SCOPES="read:user repo"
```

The app shows the relay-advertised scopes in the Account drawer so users can see what the self-hosted relay is asking GitHub to authorize.

GitHub access tokens stay on the relay and are used only for identity, draft pull request creation, and Actions run reads. The relay does not return tokens to desktop clients, does not persist plaintext tokens, and normalizes successful/error responses from GitHub before returning them so arbitrary upstream fields are not relayed into the app.

For local development, the desktop app expects:

```bash
VITE_RELAY_HTTP_URL=http://127.0.0.1:4321
VITE_RELAY_URL=ws://127.0.0.1:4321/rooms
```

These env vars define the packaged defaults. The official packaged alpha app-shell CSP allows localhost development relays and the hosted multAIplayer relay origin; it does not allow arbitrary HTTPS/WSS relay origins. A custom self-hosted relay origin therefore requires a self-built desktop app with `apps/desktop/src-tauri/tauri.conf.json` updated so `connect-src` includes both the relay HTTP origin and the matching WebSocket origin. After the build permits those origins, desktop users can open Settings and change the relay HTTP API URL and WebSocket rooms URL. The override is stored locally on that device.

The alpha relay supports durable encrypted signed-in sessions when `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured. Hosted and internet-facing deployments should use SQLite and should add backup/restore drills, token-rotation operations, and shared/external rate limiting before making production or multi-instance claims.

## Migrating From The Hosted Relay

The relay does not hold plaintext room history or room keys. Migrating from the hosted relay to a self-hosted relay is therefore a membership and routing cutover, not a server-side transcript export.

Use [relay-migration-runbook.md](relay-migration-runbook.md) for the full procedure and verification checklist. Plan to:

- stand up the self-hosted relay and pass `NODE_ENV=production npm run doctor:production-relay`;
- use a desktop build whose app-shell CSP allows the self-hosted HTTP and WebSocket relay origins;
- switch each desktop app's `HTTP API URL` and `WebSocket rooms URL` in Settings;
- sign in to GitHub again for the new relay origin when auth is required;
- recreate teams and rooms on the self-hosted relay;
- issue fresh invites so each device joins the new relay-side rooms;
- confirm new encrypted chat, attachments, Codex host approval, and local history readability before treating the migration as complete.

Encrypted export/import is planned as a future belt-and-suspenders backup and exit path. Until it ships, keep the original devices and their local encrypted history intact during migration.
