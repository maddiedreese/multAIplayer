# Multi-instance rate limiting

Status: accepted

Date: 2026-07-14

## Context

The alpha relay uses process-local fixed-window limits. They are useful for containing accidental or abusive work within one process, but their counters are neither shared nor durable. Adding replicas would multiply effective limits, allow a client to evade a limit through load balancing or failover, and make identity- and resource-scoped quotas inconsistent.

The deployment choice affects client-IP trust, storage architecture, failure behavior, and which layer understands authenticated users, rooms, invites, attachments, and other relay resources. Deferring that choice until the service is under load would turn a security contract into an emergency infrastructure migration.

## Decision

Keep the process-local limiter as defense in depth, not as the correctness boundary for a horizontal deployment. Before a second production relay replica is enabled or any multi-instance availability claim is made, deploy both of these controls:

1. An edge or CDN limiter for coarse volumetric and source-IP controls. The edge must remove client-supplied forwarding headers and write the single trusted client address consumed by the relay. Direct client headers are never trusted.
2. Atomic shared-store limits for authenticated identity, room, invite, KeyPackage, attachment-volume, and other semantic resource budgets. Operations that consume a budget must update the counter and protected mutation in one reviewed transaction or use an equivalent atomic reservation/commit protocol.

Sticky routing may improve cache locality, but it is not a rate-limit correctness or security mechanism. Rebalancing, failover, retries, and deliberate connection churn bypass process-local counters.

If the shared limiter is unavailable, protected mutations fail closed with a bounded retry response. A narrowly documented degraded mode may preserve already-authorized read-only traffic, health checks, and operator diagnostics, but it must not silently fall back to per-process enforcement for quota-consuming writes. Metrics must distinguish edge rejection, shared-limit rejection, shared-limiter failure, and local defense-in-depth rejection without exposing identifiers.

## Consequences

- One relay writer remains the supported alpha topology until shared persistence, attachment coordination, and this limiting contract are implemented together.
- Operators need an explicit trusted-proxy boundary and must test spoofed forwarding headers before enabling client-IP enforcement at the edge.
- Identity- and resource-aware limits belong beside the authoritative shared mutation, while coarse denial-of-service protection remains at the edge.
- The local limiter stays enabled so a configuration or edge failure does not remove every in-process bound.
- Multi-instance readiness is blocked on the adversarial acceptance suite below; design review or ordinary process-local limiter tests cannot substitute for it.

## Required adversarial acceptance suite

The relay maintainers own this gate. The tests must run against the same shared-store limiter adapter and transactional mutation path used in production, not a standalone model. They land with that implementation and must be required CI before the second production replica or any multi-instance availability claim.

| Scenario                            | Required assertion                                                                                                                                                                     | Current status                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Concurrent reservations             | Requests sent concurrently through at least two relay processes cannot consume more than the shared identity/resource budget, including the final boundary reservation.                | Blocked: no shared limiter adapter exists.                          |
| Commit, rollback, expiry, and retry | A failed protected mutation releases or expires its reservation exactly once; retry cannot double-consume or exceed the budget.                                                        | Blocked: the atomic reservation/commit protocol is not implemented. |
| Replica failover                    | Killing a relay after reservation and before response cannot reset the budget or allow replay through another replica; recovery follows the documented commit/expiry rule.             | Blocked: multi-process shared persistence is not implemented.       |
| Limiter-store outage                | Quota-consuming writes fail closed with a bounded retry response, allowed read-only/health behavior remains explicit, and no request silently falls back to process-local enforcement. | Blocked: the shared limiter failure mode is not implemented.        |
| Edge/local interaction              | Trusted proxy identity is stable across replicas, spoofed forwarding headers are rejected, and edge, shared, and local rejection metrics remain distinguishable.                       | Blocked: the production edge/shared topology is not deployed.       |

The implementation PR must replace each blocked entry with the concrete automated test path and record the chosen failure/recovery semantics in this ADR. Release review verifies those paths exist and are required; it does not waive or manually attest the behaviors.

## Revisit when

Revisit the store and edge products, algorithms, and exact budgets before the second production replica or the first multi-instance availability claim, whichever comes first. Any alternative must preserve atomic semantic quotas, a trusted client-IP boundary, fail-closed write behavior, and topology-independent limits; sticky routing alone does not satisfy this decision.
