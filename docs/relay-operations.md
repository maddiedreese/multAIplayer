# Relay operations

This runbook covers backup restores, account restrictions, incident response, and
monitoring for an internet-facing relay. Start with [Self-hosting](self-hosting.md)
for the basic single-node deployment.

## Pre-deploy and readiness

The relay's own parser and pre-deploy entry point are the single configuration
authority. Validate the built relay without opening a listener:

```bash
npm run build -w @multaiplayer/relay
NODE_ENV=production node apps/relay/dist/predeploy-check.js
```

Production startup runs this check again. `/readyz` additionally covers database
access and account-deletion reconciliation. Supervise the process, probe `/readyz`
externally, and alert on restart loops and `relay_store_persistence_poisoned`.

If a write fails, the relay refuses product traffic and exits for a supervised
restart from committed SQLite state. Inspect disk capacity, permissions,
filesystem health, SQLite diagnostics, and restart history; do not suppress the
exit or restore readiness in-process. Keep one writer per SQLite database.

## Logs, metrics, and shutdown

Production emits structured request logs with bounded metadata and an
`x-request-id`; it does not log bodies, credentials, content, or local paths.

The Prometheus `/metrics` endpoint contains operational counters and latency
histograms, not payload contents. It remains disabled until a token of at least 32
characters is configured:

```bash
MULTAIPLAYER_RELAY_METRICS_TOKEN=$(openssl rand -base64 32)
curl -H "Authorization: Bearer $MULTAIPLAYER_RELAY_METRICS_TOKEN" https://relay.example/metrics
```

Store the token in a secret manager. Do not reuse it, place it in a query string,
or expose `/metrics` through an unauthenticated proxy exception.

Shutdown timing is configurable:

```bash
MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS=0
MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS=10000
```

`/readyz` becomes not-ready immediately. The drain interval lets load balancers
stop routing before sockets close; the grace interval bounds WebSocket shutdown.

## Account restrictions

Restrictions deny an abusive GitHub identity without deleting shared encrypted
records. Fence the relay's sole writer, back up the database, run the stopped-relay
restriction CLI with a bounded reason and optional expiry, then restart and verify
that existing sessions were evicted and new sessions are denied. The public HTTP
API has no operator restriction endpoint. A restriction is service denial, not
retroactive erasure from collaborators' devices.

## Account deletion and backup restores

The normal self-hosted mode is:

```bash
MULTAIPLAYER_RELAY_DELETION_PROTECTION=primary_only
```

Account deletion remains available, but an operator must never restore a database
backup from before a deletion. No external deletion service is needed.

If any such backup can be restored, use `restore_safe`. It requires an
S3-compatible bucket outside the primary volume and every restorable backup set.
Tombstones contain a keyed pseudonym and lifecycle timestamps, not a raw GitHub id,
login, token, or record inventory.

Configure `MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT`, `_BUCKET`, `_REGION`,
`_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_URL_STYLE` (`path` or `virtual-host`), an
optional `_PREFIX`, a separate `MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY`, and
`MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS`. The protection horizon
must exceed the longest restorable backup retention. Production requires at least
90 days. Incomplete, unreachable, malformed, or oversized ledgers fail startup.

To restore, keep the destination isolated from public traffic, restore SQLite,
configure the same external bucket and HMAC key, build the relay, and run:

```bash
npm run deletions:reconcile -w @multaiplayer/relay
```

A zero exit and `{ "ok": true, ... }` confirm that the ledger was authenticated and
applied. If a restored identity still owns live resources, prefer a newer
post-transfer backup. If those resources must be deleted, back up the isolated
database and run:

```bash
node apps/relay/dist/reconcile-deletions.js \
  --delete-owned-resources \
  --subject=<exact-64-character-subject-from-error>
```

Rerun reconciliation before opening traffic. Then start normally, verify
`/readyz`, and authenticate with a non-deleted test identity. Record the backup id,
restore time, reconciliation result, and operator.

Deletion removes relay sessions, device material, memberships, unused invites,
pending admissions, and quota records for the identity. It does not rewrite shared
MLS ciphertext, encrypted attachments, collaborator data, local Mac history, or
existing backups, and it does not revoke the OAuth grant at GitHub.
