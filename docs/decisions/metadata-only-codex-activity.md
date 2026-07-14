# Bounded structured Codex collaboration activity

Status: accepted

Date: 2026-07-10

Updated: 2026-07-13

## Context

Room members need enough Codex progress information to understand what Codex is doing: whether work started, changed phase, ran a command, edited a file, used a tool or the web, generated an image, spawned a subagent, completed, or failed. A metadata-only lifecycle label is too coarse for collaborative review. Raw app-server notifications, however, can contain unbounded commands, output, tool arguments and results, prompts, environment values, account state, token data, local paths, and future fields whose sensitivity is not yet understood.

Encrypting a raw upstream event before relay delivery would hide it from the relay but would still disclose all of that content to every room member and persist it in local history. Redaction after storage would be too late.

## Decision

Project Codex activity through a bounded discriminated schema before it can enter room state. Canonical activity contains stable ids, declared item type and lifecycle status, bounded timestamps, typed details, and normalized agent relationships required by the chat disclosures and agent view.

The accepted typed details are reasoning summaries and, under the separate policy below, provider-supplied raw reasoning; command text, bounded aggregate output, exit code, and duration; changed paths, action, and bounded diffs; tool name/server plus bounded input, result, error, and duration; bounded web action/query/URL/find pattern; bounded image prompt; and bounded subagent prompt/model/reasoning effort/state. Agent edges are normalized to spawn, send, resume, wait, or close plus bounded thread identifiers. Unknown item types or fields do not become shared merely because they arrive from a supported app-server.

Reasoning summaries are the default. Provider-supplied raw reasoning may enter the projection only when the active host has enabled the off-by-default per-room sharing setting for that turn. Availability depends on the provider, model, and app-server build; the setting is permission to share available content, not a promise that content exists. Raw reasoning uses an explicit nested disclosure and the same bounded, encrypted room transport and retention path as the rest of the activity. Because delivery gives every room member a retainable copy, disabling the setting later is prospective and cannot revoke earlier deliveries.

Generated-image bytes use the separate encrypted chat-attachment path: only allowlisted raster data is accepted, larger originals use exporter-encrypted blob storage, and the native projection creates a safe generated name rather than retaining or sharing an upstream local output path.

Discard the raw notification object and all fields outside the selected schema, including environment data, account/authentication state, token refreshes, token deltas, and streaming output deltas. Structured command output, diffs, tool data, URLs, prompts, and reported paths are nevertheless potentially sensitive; bounding and encryption are not redaction.

The canonical activity is carried in MLS application messages and encrypted local history. Room members can expand its typed disclosures in chat, and the agent view can visualize normalized subagent relationships. Clients retain at most 160 activity records per room, and persisted records follow the room's local-history retention and clearing controls. The relay sees only normal opaque MLS routing metadata.

This boundary remains separate from explicit sharing flows for chat, generated-image and user attachments, approved terminal results, workspace requests, and other artifacts that have their own size, expiry, and review controls. Attachment-blob expiry is independent of local message retention.

## Consequences

- The activity feed is a bounded collaborative disclosure, not a complete execution log or a secret scanner.
- New activity fields require schema, projection, bounds, UI, and privacy review before they are shared.
- The projector must be tested with oversized, malformed, unknown, and secret-bearing upstream payloads.
- Diagnostics may record stable error codes and bounded identifiers, but cannot serve as a bypass for excluded activity content.
- Thread and subagent discovery must fail closed when identity cannot be resolved without heuristics that could expose unrelated local sessions.
- Raw-reasoning sharing must remain host-controlled, per-room, and off by default; UI copy must state that provider availability is not guaranteed and that sharing is visible to and retainable by room members.
- Users must be told that expanded commands, output, diffs, tool data, URLs, prompts, and paths are encrypted to the room but may disclose sensitive project information to its members.

## Revisit when

Add a new detail type only with a field-level schema, explicit bounds, retention analysis, user-visible disclosure, and tests at both the native projection and protocol boundary. Keep binary artifacts in the attachment path and do not broaden the canonical activity envelope into a raw upstream log channel.
