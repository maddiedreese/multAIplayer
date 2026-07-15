# Deliberately single-node relay

Status: accepted

Date: 2026-07-14

## Context

The relay owns one SQLite writer, process-local WebSocket fanout and presence, identity sessions, and local defense-in-depth rate counters. Replicating that process would require shared session, fanout, attachment, quota, and mutation coordination. That complexity is not justified by the alpha's scale and would make a small self-hosted relay harder to operate and audit.

## Decision

The supported relay topology is deliberately one Node.js process and one writer for each SQLite database. Scale a relay vertically. If independent capacity or failure domains are needed, shard whole teams across independent relay deployments; a room and its team never span relays.

Durable entities remain in memory for request handling and are stored as entity-scoped JSON rows in normalized SQLite tables. A request mutates tracked memory first and then performs its incremental SQLite transaction synchronously before returning success or broadcasting; the former debounced whole-store snapshot path is not a runtime persistence mode. If a runtime write fails or is rejected, the persistence coordinator is permanently poisoned for that process: readiness fails, active sockets close, and every later non-operational HTTP or WebSocket action is refused until restart reloads committed SQLite state. The failed request may roll its memory back for a bounded response, but the poisoned process never treats that rollback as durable or resumes service. Full-state serialization remains only for the one-time legacy JSON import.

`MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES` bounds the combined top-level durable records and team-member records held by one process (default `250000`). Startup fails when loaded state exceeds the ceiling. New compound insertions reserve quota and then either complete or roll back every contributed entity and quota record when capacity rejects a later insertion; capacity rejection does not poison a healthy database. This is a deliberate alpha storage model, not a claim of a relational query layer or an unbounded dataset.

Do not add Redis, distributed fanout, shared sessions, or multiple writers speculatively. The relay process must be fenced before a restored database or replacement writer starts. Process-local limits remain defense in depth, while durable account/resource invariants belong in SQLite. Internet-facing deployments put the relay behind one trusted TLS reverse proxy or edge service for source-IP and volumetric controls.

## Consequences

- Presence, socket fanout, and transient counters intentionally disappear on restart; durable sessions and room state reload from SQLite.
- A deployment cannot claim transparent failover, active-active service, or horizontal scaling.
- Backup restoration is a stop, restore, reconcile, and start operation.
- The small in-process fanout and limiter remain preferable to dependencies that do not solve a current scale problem.
- Operators must size and monitor the durable-entry ceiling; increasing it trades a larger memory dataset for headroom rather than changing the architecture.
- A poisoned relay requires operator restart and investigation of disk space, permissions, filesystem health, and SQLite errors; it does not provide a degraded in-memory write mode.
- The separate multi-instance rate-limiting decision defines minimum requirements if this topology is revisited.

## Revisit when

Revisit only after measured single-node limits or availability requirements cannot be met by vertical scaling or team-level sharding. Any proposal must coordinate persistence, sessions, presence, fanout, attachments, semantic quotas, and edge identity together and satisfy the adversarial suite in [Multi-instance rate limiting](multi-instance-rate-limiting.md).
