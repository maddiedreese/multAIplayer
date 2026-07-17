# Self-Hosting

This is an operator configuration guide. The [threat model](threat-model.md) is the sole normative source for security claims, trust assumptions, and residual risks.

The relay is intended to be self-hostable. In the current alpha it routes encrypted room events and manages presence; it does not call OpenAI or store plaintext chat transcripts.

Teams moving from the hosted relay to their own relay should use the [hosted-to-self-hosted migration procedure](../CONTRIBUTING.md#hosted-to-self-hosted-migration). The short version is: deploy and verify a self-hosted relay, build the desktop with its self-host relay origins allowed and relay editing enabled, change each desktop app's Settings drawer to those URLs, recreate team/room membership with fresh KeyPackage invites, and preserve each device's native MLS state and encrypted local history for continuity.

Supported alpha self-hosting requirements:

- Node.js runtime for the relay;
- GitHub OAuth app configured by the self-hoster;
- HTTPS and WebSocket support;
- a trusted TLS reverse proxy or edge service in front of every internet-facing relay, with the Node listener unreachable from the public internet;
- a desktop build whose app-shell CSP includes the self-hosted relay HTTP and WebSocket origins;
- persistent SQLite storage for hosted or internet-facing relays;
- relay-managed encrypted attachment blob storage in SQLite.

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

For a hosted or internet-facing relay, run the production relay doctor against the same shell environment used to start the relay:

```bash
node scripts/doctor.mjs --production-relay
```

This check fails if credentialed origins are unset or are not exact HTTP(S) origins or the exact `tauri://localhost` desktop origin, auth is explicitly disabled, debug endpoints are enabled, in-process rate limits are disabled, or relay storage points at `/tmp`. It warns when forwarded proxy headers are trusted because it cannot prove that the relay is isolated behind an edge that overwrites client-supplied forwarding headers. Session identifiers are hashed before persistence by the relay rather than controlled by a deployment secret. The doctor is a deployment sanity check, not a substitute for TLS, backups, log review, process supervision, or the mandatory trusted edge and IP-level controls for an internet-facing deployment.

## Docker Relay

The relay includes a production Dockerfile at `apps/relay/Dockerfile`.

The runtime entry point is intentionally only a bootstrap: `createRelayApp()` composes configuration, HTTP routes, WebSocket handling, persistence, and lifecycle ownership, while `src/index.ts` starts that composition and installs signal handlers. Embedders and tests can construct the same production application without triggering a listener as an import side effect.

Build it from the repository root:

```bash
docker build -f apps/relay/Dockerfile -t multaiplayer-relay:alpha .
```

Run it with a persistent `/data` mount and the same environment that passes `node scripts/doctor.mjs --production-relay`:

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

The production container, `npm start -w @multaiplayer/relay`, and the official Railway service run `predeploy-check.js` before opening a listener. That check parses the production configuration without opening the database or contacting the deletion ledger, rejects missing or invalid origins, authentication, rate limits, or metrics protection, measures configured-volume disk headroom, and verifies that the bundled MLS KeyPackage validator is executable. A failed preflight exits instead of briefly serving with an invalid deployment. Startup and `/readyz` remain the authoritative checks for database access, deletion-ledger reconciliation, and readiness after the volume is attached.

Railway's documented healthcheck is deployment-time only; it does **not** continuously restart a live process whose `/readyz` later fails. The production relay therefore closes room sockets and exits nonzero shortly after `relay_store_persistence_poisoned`; `restartPolicyType: ALWAYS` then restarts that stopped process. Alert on deployment crashes (which now includes every persistence poison), retain the exact structured JSON field `"event":"relay_store_persistence_poisoned"` for diagnosis, and run an external uptime probe against `/readyz`. Treat either alert or a restart loop as an incident. See Railway's [healthcheck](https://docs.railway.com/deployments/healthchecks) and [restart-policy](https://docs.railway.com/deployments/restart-policy) contracts.

The repository pins the npm version used by Railway in `packageManager`. CI installs that version before its clean install so a lockfile generated by a platform-specific npm version cannot silently omit optional packages needed by the Linux image. When dependency metadata changes, regenerate and verify the lockfile with the pinned npm version before deploying; a Railway build failure has no deployment log because no container was started.

For a source checkout, build the fail-closed public KeyPackage validator before starting the relay:

```bash
cd apps/desktop/src-tauri
cargo build --locked --release -p mls-core --bin mls-keypackage-validator
export MULTAIPLAYER_MLS_VALIDATOR_PATH="$PWD/target/release/mls-keypackage-validator"
```

Production startup and `node scripts/doctor.mjs --production-relay` reject a missing validator path; the relay never substitutes a TypeScript MLS parser.

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
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES=100000000
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM=50000000
MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM=10000000
MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES=500000000
MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM=250000000
MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES=1000000000
MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON=true
```

SQLite uses WAL mode and immediate, incremental transactions against normalized relay tables for teams, rooms, invites, device public keys, KeyPackages, opaque MLS backlog, sealed attachment blobs, team membership, and token-free GitHub identity sessions. Each in-memory entity mutation is tracked as an explicit row upsert or delete; steady-state writes do not encode, clear, or rewrite the full relay store. MLS message, receipt, room-epoch, and related entity changes share one transaction, including the compare-and-swap transition that accepts only one Commit for an expected room epoch. SQLite is the sole runtime storage backend, removing the debounced whole-file crash window and scaling writes with the changed entities.

Runtime writes are synchronous before a successful response or broadcast, but memory is the request-working set rather than a write-ahead log. If SQLite throws or rejects a write, the relay permanently poisons that process: `/readyz` returns `503` with `persistence_unavailable`, active room sockets close, and product HTTP/WebSocket traffic is refused. Production then exits nonzero so the configured supervisor restarts from committed SQLite state. `/healthz` and protected metrics remain briefly available during the 250 ms fail-stop window. Do not suppress the exit or attempt to restore readiness in-process; inspect disk capacity, permissions, filesystem health, SQLite diagnostics, and restart-loop history.

`MULTAIPLAYER_RELAY_SQLITE_WAL_AUTOCHECKPOINT_PAGES` defaults to SQLite's `1000`. A local 250-page comparison reduced maximum observed event-loop delay and WAL size, but request and publish p99 regressed. A subsequent 15-minute Railway-volume run at the default—with 50 rooms, 100 members, 16 reconnecting clients, two reload phases, and continuous synchronous writes—measured 67.2 ms request p99, 54.1 ms acknowledgement p99, 104.9 ms event-loop p99, a 245.2 ms maximum event-loop delay, and a 4,194,192-byte maximum WAL. It passed source/backup integrity with no errors or leaked sockets, so the shorter checkpoint is not adopted. The saturation workload averaged 0.932 of the one-vCPU allocation, which makes CPU headroom the capacity constraint before WAL size. Keep synchronous persistence and the 1000-page default; checkpoint tuning remains the first lever if a later production-shaped run breaches an explicit latency or storage target. The methodology and retained JSON artifact are in [Relay synchronous-persistence soak](benchmarks/relay-soak-2026-07-15.md).

The relay still hydrates durable state into one process-local store at startup. `MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES` bounds all top-level durable records plus individual team-member records; `MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM` caps team-owned records below that global ceiling so one tenant cannot exhaust it. Ciphertext-bearing records have independent byte-weighted ceilings: MLS backlog bytes are bounded for the relay, each team, and each room; sealed attachment blobs are bounded for the relay and each team. The byte accounting uses the retained UTF-8 JSON/ciphertext size, not a client-declared plaintext size. Room ceilings must not exceed team ceilings, and team ceilings must not exceed relay ceilings; startup and the production doctor reject an invalid hierarchy. Before attachment or MLS admission, the relay reclaims expired attachments and backlog belonging to archived, deleted, or missing rooms and persists those deletions. Cross-scope replacements validate their net byte move atomically. Reaching a ceiling aborts startup or returns `capacity_exceeded` (`507` over HTTP or a typed WebSocket error) without retaining a partial replacement or misreporting the condition as persistence failure. These defaults are conservative alpha guardrails, not benchmark-derived capacity guarantees: lower them for constrained hosts and measure resident memory before raising them. Run one relay writer per SQLite database; general multi-instance coordination is not claimed until reads and all compare-and-swap mutations move behind a shared database service. Horizontal deployments also require shared rate limiting and attachment-storage coordination.

This is a deliberate architecture, not an accidental alpha omission. Scale vertically or place whole teams on independent relays; never let two processes write the same SQLite database. See the [single-node relay decision](decisions/single-node-relay.md).

The public alpha starts with the current version-1 SQLite schema. Missing or unsupported version metadata and malformed critical rows fail startup for operator recovery; the relay never replaces unreadable durable state with an empty store. Consumed MLS KeyPackage hashes are retained permanently to prevent replay under a new id or after restart. New tombstones retain the originating team id and count against that team's existing durable-entry ceiling as well as the relay-wide ceiling; this contains one team's churn without inventing a hidden lifetime account lockout. Narrow legacy backfills without a team scope remain bounded by the relay-wide ceiling. Account deletion removes the matching tombstone's stored `userId` and `deviceId` owner fields but preserves its stable KeyPackage content hash and team capacity scope. That hash is not anonymous: someone who already knows the KeyPackage bytes or hash may still correlate it with the tombstone.

Before deploying this schema over a pre-public relay, stop its sole writer and verify that every durable `relay_*` table is empty. If any contains pre-alpha data, retain any operator backup you need and deliberately replace that pre-public database; the public build has no general migration reader for it. The one narrow safety migration backfills consumed-KeyPackage hashes from approved invites and invite-ACK receipts still present in an older version-1 database, including expired rows loaded during startup. It cannot reconstruct hashes from both artifacts after an older build already pruned them, so replacing any non-empty pre-alpha database remains required before public alpha. This is a one-time pre-release check, not an upgrade procedure for a released schema.

If an existing relay database is unreadable, has missing or unsupported version metadata, contains malformed critical rows, or exceeds a configured startup ceiling, startup fails rather than serving an empty replacement workspace. The configured database remains in place across restarts so supervision cannot turn a recovery failure into an empty live relay. Operators must inspect the startup error and recover, restore, or deliberately replace the database while the relay is stopped. Keep regular backups of `MULTAIPLAYER_RELAY_DATA_PATH`.

The alpha store contains:

- teams and room records;
- known team member ids used for membership authorization, roles, and counts;
- device MLS signature and HPKE public keys and fingerprints;
- invite metadata;
- public single-use MLS KeyPackages;
- opaque MLS messages, sealed invite requests, and Welcome blobs;
- exporter-sealed attachment blobs and metadata;
- token-free GitHub identity sessions and their expiration.

It does not contain:

- plaintext chat transcripts;
- Codex credentials;
- OpenAI credentials;
- GitHub access tokens;
- host-local project paths and Codex model/tuning configuration;
- repo files;
- terminal output in plaintext.

The native desktop owns GitHub Device Flow and stores the access token in the operating-system credential store. At sign-in it sends the token once over TLS to the relay's `/auth/github/verify` endpoint. The relay verifies `/user`, creates its ordinary token-free identity session, and discards the token. Pull-request creation and Actions reads go from native code directly to GitHub. The former relay OAuth client/scope and token-encryption configuration, device start/poll routes, and GitHub proxy routes no longer exist.

A self-built desktop pins its public OAuth client id and exact relay HTTPS origin at compile time with `MULTAIPLAYER_NATIVE_GITHUB_CLIENT_ID` and `MULTAIPLAYER_NATIVE_RELAY_HTTP_ORIGIN`. No client secret is used. Identity sign-in is fixed to `read:user`. Optional pull-request and Actions API workflows start a separate `repo` device grant on demand; native code stores it separately and verifies it belongs to the signed-in identity. Git push uses ordinary host Git credentials.

The encrypted reconnect backlog is pruned by both count and age:

```bash
MULTAIPLAYER_RELAY_BACKLOG_LIMIT=200
MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS=30
```

These limits apply to opaque MLS messages only. Plaintext live metadata such as presence and `room.updated` broadcasts is not stored in the MLS backlog.

Expired reconnect backlog entries are pruned on load, publish, debug inspection, and relay store save.

Invite metadata expires by default:

```bash
MULTAIPLAYER_RELAY_INVITE_TTL_DAYS=7
```

The relay stores invite metadata, registered public device keys, and public single-use KeyPackages, not MLS private state or group secrets. Current invite links contain a private bearer capability and the active host's public HPKE binding. The capability fragment is not sent in HTTP requests and crosses relay transport only inside an RFC 9180 HPKE request sealed to the host; the issuer's capability verifier is desktop-local. Operators should redact complete invite URLs and fragments from logs and support artifacts. Approval consumes the exact request-bound KeyPackage, publishes an Add Commit, and delivers a one-shot MLS Welcome to the authenticated requester. Pre-v2 links are rejected.

Encrypted attachment blobs are also bounded and pruned:

```bash
MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS=30
MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES=5000000
MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES=250000000
MULTAIPLAYER_ATTACHMENT_BLOB_TEAM_LIVE_QUOTA_BYTES=1000000000
MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW=100000000
MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_WINDOW_MS=3600000
```

The max-bytes setting limits both the declared attachment size and the exporter-sealed blob size accepted by the relay. The live quota limits the total unexpired sealed attachment volume per signed-in user. The upload bytes quota limits burst upload volume in the configured window. Blob payloads remain opaque; these limits are for relay storage and request-size control, not content inspection.

For signed-in accounts, upload-window usage is stored in SQLite with the blob write and survives restart. A failed persistence attempt rolls back both the blob and its reservation. The live-volume ceiling is derived from unexpired stored blobs, so it also survives restart without a second counter.

Opaque MLS messages are also bounded before they enter WebSocket fanout or backlog:

```bash
MULTAIPLAYER_RELAY_MLS_MESSAGE_MAX_BYTES=1000000
```

This legacy-named configuration variable caps the serialized MLS routing record and opaque MLS blob. Invite requests, Welcomes, and KeyPackages have their own independent bounds. Larger file previews should use exporter-sealed attachment storage instead of oversized MLS application messages.

Expired invites and encrypted attachment blobs are pruned when loaded from disk, when the relay store is saved, and when debug state is inspected. Direct reads of an expired invite or blob return an expired response and remove the record.

The relay applies continuously refilled token-bucket rate limits by default:

```bash
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS=60000
MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER=8
MULTAIPLAYER_RELAY_RATE_LIMIT_AUTH=30
MULTAIPLAYER_RELAY_RATE_LIMIT_READ=300
MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION=120
MULTAIPLAYER_RELAY_RATE_LIMIT_ATTACHMENT=60
MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET=600
MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT=120
MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER=20
MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE=5
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false
```

Each configured cap is both burst capacity and tokens refilled over `MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS`, which removes the fixed-window boundary burst. An unsigned attempt consumes the strict client-IP bucket. A request with a server-validated session consumes both its separate hashed-session bucket and a bounded shared-network bucket whose capacity is the configured cap multiplied by `MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER`. This lets several legitimate signed-in users share a home, office, or carrier NAT without collapsing their individual allowance, while valid-session rotation remains bounded at the network level and caller-selected cookie values cannot create trusted buckets. By default, the relay uses the direct socket address and ignores `X-Forwarded-For`, because direct internet clients can spoof that header. Forwarded addresses are used only when `MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=true`. Set it only when a trusted reverse proxy removes client-supplied forwarding headers and writes its own; the production doctor prints a strong warning whenever header trust is enabled. HTTP requests over the limit receive `429` with `Retry-After`; room WebSocket clients receive an encrypted-room-safe error message and remain connected. The alpha limiter remains process-local and resets on restart; it is development-grade defense in depth, not durable or distributed enforcement. A second production replica is unsupported: sticky routing does not provide shared quota, persistence, presence, or fanout correctness.

For every hosted or internet-facing deployment, the reverse proxy or edge is mandatory even with one replica. It terminates TLS, strips client-supplied forwarding headers, writes one trusted client address, bounds request bodies and connection timeouts, and applies coarse source-IP/volumetric controls before traffic reaches Node. Bind the relay to a private interface or platform-private service so clients cannot bypass that edge. The production doctor checks the relay-side header configuration; it cannot prove network isolation or edge policy, so operators must test both direct-origin reachability and spoofed forwarding headers.

Treat a hosting, CDN, load-balancer, or forwarding-header change as invalidating this trust decision. Disable `MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS` until the new path is verified, then run `npm --workspace @multaiplayer/relay exec -- tsx --test test/http/rate-limits.test.ts` and independently confirm that the origin is unreachable, a client-supplied forwarding header is stripped, and the provider-authenticated address wins. The automated test covers relay behavior; the last three checks are deployment checks and cannot be inferred from repository configuration.

MLS derives per-message keys and nonces from its key schedule, so protocol v2 has no cryptographic nonce budget or per-epoch envelope counter. Generic rate, size, backlog, and socket limits remain abuse controls. Commits are instead serialized by expected epoch and active-host identity.

Concurrent WebSocket connection caps are also enforced per signed-in user when available, otherwise per client identity, and per room device id after join. These caps are intentionally above normal use; they exist to prevent a runaway client from holding unbounded sockets.

Team and room creation also have authenticated per-user daily caps:

```bash
MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP=25
MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP=100
MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER=500
MULTAIPLAYER_RELAY_REGISTERED_DEVICE_CAP_USER=25
MULTAIPLAYER_RELAY_RETAINED_AUTH_SESSION_CAP_USER=20
MULTAIPLAYER_RELAY_LIVE_KEY_PACKAGE_CAP_USER=250
MULTAIPLAYER_RELAY_LIVE_INVITE_CAP_USER=100
```

Daily team and room counters are stored in SQLite under the single-writer relay model, expire at the next UTC day, and survive restarts. Their reservation and protected write persist together; failed persistence rolls both back. Rejections return `429` with `Retry-After` and a structured `quota_exceeded` JSON body that clients can render directly. The total-room cap is checked against the signed-in user's current visible rooms. Registered-device, live KeyPackage, and invite ceilings are derived from persisted records for the signed-in account. They therefore survive restart without maintaining a second counter, and one account cannot consume the relay-wide durable-entry budget merely by minting device identifiers. GitHub verification retains at most the configured number of sessions for one identity; issuing another evicts the session with the earliest expiry (then stable session digest), closes its live sockets, and commits the replacement in one account mutation turn.

Device ids are permanently bound to their first registered MLS public keys in this alpha. Reuse a stable device id for the same key material; a key change requires a new id and consumes another slot in the registered-device cap. There is no device-retirement or key-reset endpoint in the current alpha. Account deletion is the only user-facing way to reclaim retained device registrations; self-hosted operators can raise the cap when that tradeoff is appropriate. Register fresh keys under a new device id and rejoin rooms through the normal enrollment flow.

Authenticated quotas use the GitHub session identity. If a self-hosted relay deliberately disables auth, rate limits still fall back to client IP, but authenticated per-user creation and blob-volume quotas cannot identify a durable account and are correspondingly weaker.

Debug endpoints are disabled in every environment unless explicitly enabled, and enabled routes accept requests only from the local loopback socket:

```bash
MULTAIPLAYER_RELAY_DEBUG=true
```

The relay's GitHub identity-verification request and the native desktop's PR/Actions upstream requests have a ten-second deadline. Timeout and network failures return bounded gateway errors instead of occupying handlers indefinitely. JSON and SQLite store files (including SQLite sidecars) use owner-only permissions (`0600`). A missing dedicated data directory is created as `0700`; an existing operator-supplied parent directory is not re-permissioned.

Production relays emit structured JSON request logs by default. Local development can opt in:

```bash
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
```

Each response includes an `x-request-id` header. The relay accepts a bounded incoming `x-request-id` or generates one. Logs include request method, path, status code, duration, and request id; they do not include room plaintext, encrypted payload bodies, attachment contents, GitHub tokens, Codex credentials, terminal output, browser pages, or repo files.

Startup, shutdown, configuration rejection, and persistence events use the same structured JSON log record even when request logging is disabled. Those operational events use stable event names and bounded scalar fields; invalid environment values, local store paths, and raw error objects are deliberately omitted.

The relay exposes content-free operational counters, event-loop-delay gauges, and fixed-bucket latency histograms in Prometheus text format at `/metrics`. Histograms cover publish queue through successful persistence/fanout, WebSocket send callback completion/backpressure, and synchronous SQLite writes, with standard `_bucket`, `_sum`, and `_count` series in seconds. Counters and gauges include active sockets, live sealed-blob count and actual stored ciphertext bytes, exact retained MLS/attachment bytes and their relay-wide ceilings, durable-capacity rejections by resource and scope, published opaque-message count, accepted attachment upload count and stored bytes, upload rejection counts by reason, rate-limit and quota rejections, WebSocket connection outcomes, start time, and uptime. Event-loop p99/max gauges make synchronous SQLite blocking visible. The endpoint is always bearer-authenticated and remains disabled until a token of at least 32 characters is configured:

```bash
MULTAIPLAYER_RELAY_METRICS_TOKEN=$(openssl rand -base64 32)
curl -H "Authorization: Bearer $MULTAIPLAYER_RELAY_METRICS_TOKEN" https://relay.example/metrics
```

Store this token in the scraper's secret manager. Do not reuse the session-persistence secret, put the token in a URL query, or expose `/metrics` through an unauthenticated reverse-proxy exception.

Every relay HTTP error has a stable `code` alongside its bounded human-readable `error` message. Clients should branch on the code rather than matching prose; unknown future codes should fall back to status-class handling and the human-readable message.

Graceful shutdown timing is configurable:

```bash
MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS=0
MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS=10000
```

When shutdown starts, `/readyz` flips to not-ready immediately. `MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS` is measured in milliseconds, defaults to `0`, and is bounded from `0` through `60000`; malformed values fall back to the default and out-of-range values are clamped to that range. It keeps the process alive briefly for load balancers to stop routing before sockets close. `MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS` bounds how long existing room WebSockets can take to close before they are terminated.

Workspace mutations can require GitHub sign-in:

```bash
MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=false
```

When enabled, reading workspace metadata, creating teams, creating rooms, creating invites, registering devices, uploading encrypted attachment blobs, changing host state, and changing room settings return `401` unless the desktop has a valid GitHub session cookie with that relay. Authenticated device registration is bound to the signed-in GitHub user id.

Authenticated workspace reads are membership-scoped. A signed-in user only receives teams and rooms where they are a known team member. Room-level mutations and attachment blob reads also require membership. Invite metadata remains readable by invite id so a joiner can verify that the relay metadata matches the invite fragment; the desktop then presents that invite id during WebSocket join to be admitted as a team member.

Authentication is enabled by default in every environment, even before a native desktop has completed GitHub sign-in.

Session cookies are `HttpOnly`, `SameSite=Lax`, and marked `Secure` whenever `NODE_ENV=production`. An authenticated production deployment therefore requires HTTPS/WSS; browsers and compliant clients will not return that cookie over plain HTTP. For a deliberately unauthenticated private LAN development relay, set `MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=true` explicitly and treat it as development-only. That opt-out does not make production GitHub sign-in work over HTTP, and the production-relay doctor intentionally rejects auth-disabled deployments.

Credentialed browser origins and WebSocket room upgrades can be restricted:

```bash
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com,https://app.multaiplayer.com
```

If one or more valid origins are configured, the relay only emits CORS credential headers and accepts browser-origin WebSocket upgrades for those exact origins. An unset, empty, or whitespace-only value produces an empty allowlist: local development remains permissive for browser origins, while production denies every request or WebSocket upgrade that supplies an `Origin`. Any non-empty invalid entry fails runtime configuration instead of being treated as absent. The production relay doctor rejects an empty configuration. Requests that omit the `Origin` header are still allowed in either environment so native clients and server-side health checks continue to work.

The allowlist is therefore a browser CORS and WebSocket-origin control, not a client-authentication boundary. Native and server-side clients can omit `Origin`; authentication, device-session signatures, membership authorization, and TLS provide the corresponding identity and transport controls. Only an omitted header receives this exemption: an explicitly empty `Origin` value is invalid and rejected.

Origin entries are normalized to bare origins by the relay. `https://multaiplayer.com/` becomes `https://multaiplayer.com`. The exact `tauri://localhost` origin is also supported for the packaged macOS webview. If any configured entry uses another custom scheme, a path, query, fragment, credentials, wildcard, or a custom port on that desktop origin, runtime startup rejects the entire allowlist instead of silently dropping that entry; the production doctor applies the same fail-closed rule. Native desktop requests without an `Origin` header are still allowed.

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

The relay has no separate user-profile or billing-account table. A signed-in user can call `DELETE /auth/account` with JSON `{ "confirmation": "delete my account" }`; the desktop exposes this as a destructive Account action. Deletion is blocked until the user transfers or deletes owned teams and hands off hosted rooms. It removes that identity's relay sessions, device material, team memberships, unused invites, pending admission artifacts, and quota records. The native app separately deletes its Keychain token. In restore-safe mode, the relay first commits a pseudonymous external tombstone; if primary persistence then fails, access remains denied and startup reconciliation retries deletion before listening.

Hosted operators can deny an abusive GitHub identity without deleting shared encrypted records. Account restrictions are durable in the relay store, survive restart, deny new GitHub verification and stored sessions, and evict auth/device sessions, presence, subscriptions, and live sockets when applied through the relay control. The public HTTP API has no operator endpoint. Use the stopped-relay CLI from the [operator runbook](../CONTRIBUTING.md#hosted-account-restriction) and retain only a bounded reason code; restriction is service denial, not retroactive erasure or removal from other devices.

Deletion removes the identity from shared membership and host metadata, but it does not delete shared team or room records or rewrite MLS ciphertext and its sender/routing metadata, encrypted attachments, or accepted-message receipts. Those records remain available to collaborators and follow their ordinary configured retention because rewriting them would break shared encrypted history, downloads, replay/idempotency protection, or MLS state. Deleting relay data does not erase encrypted data already stored on a user's Macs, revoke the OAuth grant at GitHub, or selectively purge an operator's existing backups. Users remove local history with the app's per-room local controls and may revoke the OAuth grant in GitHub settings.

Set `MULTAIPLAYER_RELAY_DELETION_PROTECTION=primary_only` when the deployment has no backup capable of restoring deleted SQLite rows. Account deletion remains available, but the operator must not later restore an older copy containing the identity. Use `restore_safe` whenever such backups exist. Restore-safe production requires an S3-compatible bucket outside the primary volume and every restorable backup set; its immutable authenticated objects are retained through the protection horizon and contain only a keyed pseudonym and lifecycle timestamps, never a raw GitHub id, login, token, or record inventory.

Configure restore-safe S3 with `MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_URL_STYLE` (`path` or `virtual-host`), optional `_PREFIX`, a separate `MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY`, and `MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS`. The horizon must exceed the longest restorable backup retention; the official service uses 90 days around an 89-day snapshot window. Incomplete, unreachable, malformed, or over-10,000-entry ledgers fail startup before the server listens.

If reconciliation reports that a restored identity still owns live resources, keep the relay offline. Transfer those resources by restoring a safe current database when possible. If they must be deleted, run `npm run build -w @multaiplayer/relay`, then `node apps/relay/dist/reconcile-deletions.js --delete-owned-resources --subject=<exact-subject-from-error>`. The command accepts only the reported 64-character pseudonym, marks that identity's live owned teams and hosted rooms deleted, completes identity cleanup, and exits without starting the listener. Back up the isolated database before using this destructive resolution.

Every startup first lists and authenticates every object, including expired tombstones, hashes every GitHub identity found in primary state, and reapplies matching deletions even if SQLite says that tombstone was previously applied. Inspecting expired entries before collection covers the case where the external write succeeded but primary persistence remained unavailable past the original horizon. The comparison also protects partial/manual restores that retain a local marker while resurrecting identity rows. Before that cleanup commit it appends a new tombstone protected from the cleanup-attempt time. Only after primary cleanup persists does the same pass purge expired external tombstones and remove local pseudonymous markers whose objects are confirmed gone. Any active tombstone blocks new GitHub sign-in for that identity; sign-in becomes possible again only after the newest protection horizon and successful purge.

For a restore, keep the destination isolated from public traffic, restore SQLite, configure the same external bucket and HMAC key, build the relay, and run `npm run deletions:reconcile -w @multaiplayer/relay`. A zero exit and JSON `{ "ok": true, ... }` prove the ledger was reachable, authenticated, and applied to that restored store. If reconciliation reports active owned teams or hosted rooms from an older backup, it fails closed without listening; use a newer post-transfer backup or resolve ownership in the isolated copy, then rerun. Do not bypass the ledger or open traffic first. Afterward start the relay normally (which repeats the check), verify `/readyz`, authenticate with a non-deleted test identity, and record the backup id, restore time, reconciliation counts, and operator. A production restore drill remains an operator gate even though reconciliation itself is automated.

For local development, the desktop app expects:

```bash
VITE_RELAY_HTTP_URL=http://127.0.0.1:4321
VITE_RELAY_URL=ws://127.0.0.1:4321/rooms
VITE_ALLOW_RELAY_CONFIGURATION=true
```

The first two env vars define the packaged defaults; `VITE_ALLOW_RELAY_CONFIGURATION=true` exposes the endpoint controls in Settings. Official packaged builds pin their hosted endpoints, hide these controls, and do not allow localhost relay access. A custom self-hosted relay origin requires a self-built desktop app with `apps/desktop/src-tauri/tauri.conf.json` updated so `connect-src` includes both the relay HTTP origin and the matching WebSocket origin. The override is stored locally on that device.

The alpha relay stores durable token-free signed-in sessions in its configured state store. Hosted and internet-facing deployments should use SQLite and should add backup/restore drills and shared/external rate limiting before making production or multi-instance claims.

## Migrating From The Hosted Relay

The relay does not hold plaintext room history, MLS private state, or exporter-derived history secrets. Migrating from the hosted relay to a self-hosted relay is therefore a membership and routing cutover, not a server-side transcript export.

Use the [release operations migration procedure](../CONTRIBUTING.md#hosted-to-self-hosted-migration) for the full procedure and verification checklist. Plan to:

- stand up the self-hosted relay and pass `NODE_ENV=production node scripts/doctor.mjs --production-relay`;
- use a desktop build whose app-shell CSP allows the self-hosted HTTP and WebSocket relay origins;
- switch each desktop app's `HTTP API URL` and `WebSocket rooms URL` in Settings;
- sign in to GitHub again for the new relay origin when auth is required;
- recreate teams and rooms on the self-hosted relay;
- issue fresh invites so each device joins the new relay-side rooms;
- confirm new encrypted chat, attachments, Codex host approval, and local history readability before treating the migration as complete.

The encrypted room archive is a portable, read-only copy of display history already available on one device. It does not contain MLS authority, membership, credentials, exporter secrets, or live room state, so it cannot migrate a room to another relay. Keep the original devices and their encrypted archives until the replacement rooms are verified; see [Encrypted room archives](room-archives.md).
