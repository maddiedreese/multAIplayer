# Deliberately single-node relay

Status: accepted

Date: 2026-07-14

## Context

The relay owns one SQLite writer, process-local WebSocket fanout and presence, identity sessions, and local defense-in-depth rate counters. Replicating that process would require shared session, fanout, attachment, quota, and mutation coordination. That complexity is not justified by the alpha's scale and would make a small self-hosted relay harder to operate and audit.

## Decision

The supported relay topology is deliberately one Node.js process and one writer for each SQLite database. Scale a relay vertically. If independent capacity or failure domains are needed, shard whole teams across independent relay deployments; a room and its team never span relays.

Durable entities remain in memory for request handling and are stored as entity-scoped JSON rows in normalized SQLite tables. A request mutates tracked memory first and then performs its incremental SQLite transaction synchronously before returning success or broadcasting. If a runtime write fails or is rejected, the persistence coordinator is permanently poisoned for that process: readiness fails, active sockets close, and every later non-operational HTTP or WebSocket action is refused until restart reloads committed SQLite state. The failed request may roll its memory back for a bounded response, but the poisoned process never treats that rollback as durable or resumes service.

The persistence coordinator drains tracked row mutations into one explicit batch and acknowledges that batch only after the corresponding SQLite unit of work returns successfully. An expected MLS epoch compare-and-swap conflict leaves both the process and drained batch retryable. Every other write failure poisons the process once. HTTP mutations that restore a pre-request memory snapshot use the shared `persistMutationOrRollback` decision path; a rollback failure is raised as an invariant violation rather than reported as a cleanly rejected request. These rules prevent a memory rollback from being confused with either a committed database transaction or restored service health.

`MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES` bounds the combined top-level durable records and team-member records held by one process (default `250000`). `MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM` independently caps team-owned records (default `25000`), so one team cannot consume the global ceiling. Ciphertext is bounded independently by retained bytes: MLS backlog has relay/team/room ceilings, while sealed attachments have relay/team ceilings. This closes the gap where a bounded record count could still retain oversized variable-length payloads. Startup fails when loaded state exceeds a ceiling; admission first persists eligible expiry/inactive-room reclamation, and replacement validates its net global and destination-scope move before releasing the source. A rejected replacement restores byte accounting to its previous value. The byte defaults are conservative guardrails and were not established by the synchronous-write soak. This is a deliberate alpha storage model, not a claim of a relational query layer, unlimited retention, or benchmark-validated memory capacity.

Do not add Redis, distributed fanout, shared sessions, or multiple writers speculatively. New durable state must reuse the existing store, codec, and persistence coordinator rather than add a compatibility reader, second in-memory representation, or feature-specific transaction layer. The relay process must be fenced before a restored database or replacement writer starts. Process-local limits remain defense in depth, while durable account/resource invariants belong in SQLite. Internet-facing deployments put the relay behind one trusted TLS reverse proxy or edge service for source-IP and volumetric controls.

## Consequences

- Presence, socket fanout, and transient counters intentionally disappear on restart; durable sessions and room state reload from SQLite.
- A deployment cannot claim transparent failover, active-active service, or horizontal scaling.
- Backup restoration is a stop, restore, reconcile, and start operation.
- The small in-process fanout and limiter remain preferable to dependencies that do not solve a current scale problem.
- Operators must size and monitor both entry and retained-byte ceilings; increasing them trades a larger memory dataset for headroom rather than changing the architecture.
- A poisoned production relay emits the stable `relay_store_persistence_poisoned` alert event and exits nonzero for supervisor restart. Repeated poison/restart cycles require investigation of disk space, permissions, filesystem health, and SQLite errors; there is no degraded in-memory write mode.

## Revisit when

Revisit only after measured single-node limits or availability requirements cannot be met by vertical scaling or team-level sharding. Any proposal must coordinate persistence, sessions, presence, fanout, attachments, semantic quotas, and edge identity together and add tests for those shared boundaries.
