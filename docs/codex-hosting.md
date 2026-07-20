# How Codex Hosting Works

This document describes the Codex hosting mechanism. The [threat model](threat-model.md) is normative for security claims and trust assumptions.

multAIplayer does not use the OpenAI API and does not borrow another user's ChatGPT or Codex subscription from a hosted website.

Instead, a room has one active host. The host is a desktop user who has local access to:

- their own Codex app-server/session;
- the local project folder attached to the room;
- room-scoped terminal sessions;
- the room browser surface;
- local Git and optional native GitHub OAuth.

People chat normally in the room. When someone clicks Codex or types `@Codex`, the app prepares a proposed Codex turn from the room context. The active host reviews and approves that turn. If approved, the host's local desktop app sends the prepared input to the host's local Codex app-server and streams the result back into the room as encrypted room events.

## Compatibility And Catalog Selection

The supported Codex app-server compatibility range is 0.133.0–0.144.0, with generated-schema contract fixtures for 0.133.0, 0.143.0, and 0.144.0. Versions older than 0.133.0 cannot host turns. A version newer than 0.144.0 is labelled unverified: ordinary compatible behavior can continue, but security-sensitive features stay behind manifest/capability checks and fail closed when their contract is unknown.

Model settings express room intent and are resolved against the active host's local `model/list` catalog. `auto` selects the catalog's default model, reasoning effort, and service tier. `pinned` requests the saved choice; if the host catalog does not support a pinned reasoning effort or service tier, the desktop uses a catalog-supported fallback and shows the fallback.

## Bidirectional Requests And Host Approval

App-server is bidirectional JSON-RPC. In addition to responses and notifications, Codex can request command, file-change, permission, tool-input, MCP elicitation, dynamic-tool, or authentication decisions. Supported interactive requests are shown only to the active host for the originating room; dynamic-tool, token-refresh, attestation, and unknown requests are rejected natively without sending their parameters to the webview. The host's decision is returned to the same native app-server session; it is not treated as permission for another room or process.

Waiting for a person pauses the active execution timeout, but each pending request has a 15-minute wall-clock deadline. Expiry, room shutdown, host-session shutdown, malformed requests, unknown privileged methods, or invalid responses fail closed and send a bounded cancellation/error response to Codex.

## Host-local Codex Account, Apps, And MCP

The profile drawer can inspect the host's Codex account, start browser/device login, list available apps, inspect MCP authentication status, and begin MCP OAuth. This state stays host-local. Login ids, authorization refresh data, account tokens, raw app/MCP responses, and token-refresh notifications are never room events or local room history.

The device-wide app-tool approval default can be `auto`, `prompt`, or, on supported versions, `writes`. This writes the host's persistent Codex configuration and can affect other Codex clients on that device. `writes` trusts only tools that declare themselves read-only and prompts before writes; it is not a room-scoped override.

## Activity And Thread Continuity

The room activity timeline uses a bounded canonical `codex.activity` record projected from item lifecycle notifications. It contains stable ids, category, lifecycle status, timestamps, typed command/file/tool/web/image/agent/reasoning details, and normalized subagent relationships. Reasoning summaries are shared by default. Provider-supplied raw reasoning can be included only when the active host enables the off-by-default per-room setting; provider/model/app-server availability is not guaranteed. Included content is encrypted before relay transport, visible to room members, and retained in encrypted local history; turning sharing off cannot retract earlier deliveries. The projector discards the raw upstream object, unknown fields, environment/account/auth data, token refreshes, token deltas, and streaming output deltas. Lifecycle updates coalesce by stable activity id.

Each device stores a normalized encrypted thread graph per room and selects one active thread for turns and goals. Hosts can refresh, switch, or fork a thread. Fork-through-turn (`lastTurnId`) requires Codex 0.143.0 or newer; 0.133.0 can list and fully fork threads but rejects that narrower operation with an upgrade message. Thread discovery admits only the active session tree and excludes prompt previews from stored titles.

The agent tree is separate from the conversation thread graph. It is derived only from normalized subagent activity (`spawn`, `send`, `resume`, `wait`, and `close`) and never from raw app-server payloads.

## What The Relay Can See

The relay routes metadata and ciphertext. It should not receive:

- plaintext room chat;
- plaintext attachments;
- Codex credentials;
- OpenAI credentials;
- repo files or diffs;
- terminal output;
- browser page contents;
- GitHub access tokens.

The relay does see operational metadata needed to route the room:

- team and room ids/names;
- host labels and status;
- device public keys and fingerprints;
- invite ids and expiry metadata;
- opaque MLS message sizes, ids, timestamps, epoch hints, and sender/device routing labels;
- plaintext attachment routing and descriptive metadata such as filename, MIME type, declared size, room id, epoch, and expiry; attachment contents remain exporter-encrypted;
- authenticated GitHub identity and relay-session metadata when sign-in is enabled.

GitHub access tokens are stored in the operating-system credential store behind the native Rust boundary. The relay observes the identity token only during verify-then-discard bootstrap at initial sign-in or CLI relay-session re-establishment; native code calls GitHub directly for draft PR creation and Actions reads. Host-local project paths and Codex model/tuning configuration are encoded for room members as RFC 9420 MLS snapshots via `mls-rs`; the threat model owns the security and audit claims for that path.

## Host Handoff

If a host runs out of Codex usage or needs to step away, they can create a handoff. The new host gets the room context and inherited room settings, then uses their own local project folder. The app reuses an already-attached project only when its GitHub remote matches the handoff repository; otherwise, the new host explicitly selects a matching clone or a destination for cloning. The outgoing host's path is context, not filesystem authority.

The alpha sends the available room context to the new host's Codex invocation when accepting a usage-limit handoff. Codex-native compaction is not part of the public alpha contract.

## Browser And Terminal

The in-room browser and terminals are host-local capabilities. Room members can request actions, but the host approves sensitive steps and owns the local machine risk. Signed-in browser pages, terminal output, `.env` reads, credentials, and private repo content may become visible to the room if the host shares or approves them.
