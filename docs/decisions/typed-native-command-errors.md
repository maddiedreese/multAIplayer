# Typed native command errors

Status: accepted

Date: 2026-07-14

## Context

Tauri commands previously rejected with display strings. That made any frontend recovery decision depend on human-readable prose and made a copy edit capable of changing control flow. Structured Tauri rejections also arrive in JavaScript as plain objects, so changing only the Rust return type would degrade existing `String(error)` presentation to `[object Object]`.

## Decision

Every fallible Tauri command returns a serializable `CommandError` with a stable snake-case `code` and a bounded human-readable `message`. [`apps/desktop/native-command-error-codes.json`](../../apps/desktop/native-command-error-codes.json) is the complete shared vocabulary; Rust and TypeScript derive or test against it instead of duplicating the list in prose. Internal Rust helpers may retain richer domain errors or `Result<_, String>` while they are not an IPC contract; the outer command assigns the narrowest stable category and otherwise uses `internal_error`. Codes are never inferred by matching old message text. Fallible commands use `#[typed_tauri_command::command]`; its procedural macro rejects any return type other than the canonical `crate::command_error::CommandResult<T>` during Rust compilation. Infallible commands continue to use Tauri's ordinary attribute.

Every frontend command call goes through `invokeNative`. It validates the rejection shape, bounds the message, produces a real `NativeCommandError`, and maps legacy strings or malformed values to a fixed internal failure. Frontend control flow branches only on the validated code. Copy remains presentation and may change independently.

Invite onboarding follows the same rule locally: `InviteJoinError.code` classifies legacy, expired, invalid, and host-binding failures; its message is not a recovery contract.

## Consequences

- Adding or changing a branchable code is a compatibility decision with Rust serialization and TypeScript normalization tests.
- Unknown or malformed native errors fail to `internal_error`; they do not expose object serialization or become new behavior through prose.
- Sensitive native causes stay behind the IPC boundary. Explicitly classified errors may carry bounded display copy; unclassified string causes become fixed internal copy rather than a diagnostic dump.
- Existing internal helpers can migrate incrementally without reintroducing string matching at command or UI boundaries.

## Revisit when

Revisit the taxonomy when a new frontend recovery path cannot be expressed by the existing codes. Add the narrowest semantic code and tests on both sides of IPC; do not create command-specific prose parsers or a generic unvalidated string-code escape hatch.
