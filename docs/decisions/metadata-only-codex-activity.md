# Metadata-only Codex activity

Status: accepted

Date: 2026-07-10

## Context

Room members need enough Codex progress information to understand whether work started, changed phase, spawned a subagent, completed, or failed. Raw app-server notifications can also contain commands, output, tool arguments and results, prompts, environment values, account state, token data, and future fields whose sensitivity is not yet understood.

Encrypting a raw upstream event before relay delivery would hide it from the relay but would still disclose all of that content to every room member and persist it in local history. Redaction after storage would be too late.

## Decision

Project Codex activity through a bounded allowlist before it can enter room state. Canonical activity contains only stable ids, declared item type and lifecycle status, bounded timestamps, and limited normalized agent relationships or action labels required by the activity timeline and thread/agent views.

Discard raw commands, output, arguments, results, prompt previews, upstream JSON, environment data, secret-bearing fields, account/authentication state, token refreshes, token deltas, and output deltas. Unknown item types or fields do not become shared merely because they arrive from a supported app-server.

The canonical activity is then carried in encrypted room envelopes and encrypted local history. This boundary is separate from explicit sharing flows for chat, attachments, approved terminal results, diffs, and other artifacts that have their own review and size controls.

## Consequences

- The activity timeline is intentionally coarse and cannot be treated as a full execution log.
- New activity fields require schema, projection, bounds, UI, and privacy review before they are shared.
- The projector must be tested with oversized, malformed, unknown, and secret-bearing upstream payloads.
- Diagnostics may record stable error codes and bounded identifiers, but cannot serve as a bypass for excluded activity content.
- Thread and subagent discovery must fail closed when identity cannot be resolved without heuristics that could expose unrelated local sessions.

## Revisit when

Richer collaboration should use a separate, explicit artifact-sharing design with host preview/approval, field-level schemas, retention rules, and user-visible disclosure. Do not broaden the canonical activity envelope into a raw log channel.
