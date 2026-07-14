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
- Multi-instance readiness requires adversarial tests for concurrent reservations, expiry, retry, failover, and limiter-store outage behavior.

## Revisit when

Revisit the store and edge products, algorithms, and exact budgets before the second production replica or the first multi-instance availability claim, whichever comes first. Any alternative must preserve atomic semantic quotas, a trusted client-IP boundary, fail-closed write behavior, and topology-independent limits; sticky routing alone does not satisfy this decision.
