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

## Retiring a registered device

When an installation has been lost or replaced, retire its registration so it no
longer consumes the account's device limit. This is quota recovery, not credential
revocation. Stop and fence the sole relay writer, back up the database, then run:

```bash
npm run devices:retire -w @multaiplayer/relay -- \
  <github-user-id> <device-id> \
  --data-path=/data/relay-store.sqlite \
  --confirm-relay-stopped \
  --confirm-device-id=<device-id>
```

The command deletes exactly that device registration and its unused KeyPackages.
It does not delete the account, team membership, shared ciphertext, consumed
KeyPackage tombstones, or GitHub account sessions. It refuses a device that still
hosts a room; hand off or delete that room first. Restart the relay and verify that
the replacement device can register. A copy that remains signed in to GitHub can
register again; use account restriction or deletion for a compromised account.

## Account deletion and backup restores

Account deletion is committed to the primary SQLite database. The relay has no
external deletion ledger, so an older backup can restore deleted account data.
Expire or destroy every backup that predates a deletion before treating that
deletion as durable across disaster recovery.

During a restore, keep the destination isolated, choose a backup that contains
every completed account deletion, start the relay, verify `/readyz`, and
authenticate with a non-deleted test identity before opening traffic. If no such
backup exists, do not restore an older copy into service.

Deletion removes relay sessions, device material, memberships, unused invites,
pending admissions, and quota records for the identity. It does not rewrite shared
MLS ciphertext, encrypted attachments, collaborator data, local Mac history, or
existing backups, and it does not revoke the OAuth grant at GitHub.
