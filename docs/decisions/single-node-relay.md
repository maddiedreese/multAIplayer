# Deliberately single-node relay

Status: accepted

Date: 2026-07-14

## Context

The relay owns one SQLite writer, process-local WebSocket fanout and presence, identity sessions, and local defense-in-depth rate counters. Replicating that process would require shared session, fanout, attachment, quota, and mutation coordination. That complexity is not justified by the alpha's scale and would make a small self-hosted relay harder to operate and audit.

## Decision

The supported relay topology is deliberately one Node.js process and one writer for each SQLite database. Scale a relay vertically. If independent capacity or failure domains are needed, shard whole teams across independent relay deployments; a room and its team never span relays.

Do not add Redis, distributed fanout, shared sessions, or multiple writers speculatively. The relay process must be fenced before a restored database or replacement writer starts. Process-local limits remain defense in depth, while durable account/resource invariants belong in SQLite. Internet-facing deployments put the relay behind one trusted TLS reverse proxy or edge service for source-IP and volumetric controls.

## Consequences

- Presence, socket fanout, and transient counters intentionally disappear on restart; durable sessions and room state reload from SQLite.
- A deployment cannot claim transparent failover, active-active service, or horizontal scaling.
- Backup restoration is a stop, restore, reconcile, and start operation.
- The small in-process fanout and limiter remain preferable to dependencies that do not solve a current scale problem.
- The separate multi-instance rate-limiting decision defines minimum requirements if this topology is revisited.

## Revisit when

Revisit only after measured single-node limits or availability requirements cannot be met by vertical scaling or team-level sharding. Any proposal must coordinate persistence, sessions, presence, fanout, attachments, semantic quotas, and edge identity together and satisfy the adversarial suite in [Multi-instance rate limiting](multi-instance-rate-limiting.md).
