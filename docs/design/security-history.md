# Security change history

This is non-normative historical context. The [threat model](../threat-model.md)
is the only source for current security claims, assumptions, and residual risks.
Git history retains the detailed chronology that previously lived in that file.

- **2026-07-15:** completed the Tauri command audit and exact-set registration
  check, tightened Codex filesystem grants and Git patch confinement, authenticated
  update metadata, and replaced generated prose evidence with executed test reports.
- **2026-07-14:** added encrypted room archives, fail-closed single-node SQLite
  persistence, durable quotas and restrictions, native GitHub credential custody,
  MLS room configuration, HTTPS invite delivery, and native browser authorization.
- **2026-07-13:** strengthened resumable onboarding-state bounds, invite
  authenticator separation, staged MLS rollback, typed native errors, and native
  module reviewability.
- **2026-07-12:** migrated cleanly to RFC 9420 MLS through `mls-rs`, pinned one
  ciphersuite, moved secret state behind Rust/Tauri, and removed protocol-v1
  compatibility.
- **2026-07-11:** defined host handoff and unaudited status, documented release
  reproduction limits, and hardened untrusted-input, approval, and crypto receive
  boundaries.

Update the current threat model whenever a change alters a trust boundary,
cryptographic lifecycle, privileged surface, security claim, or published
limitation. Add a history bullet only when it materially helps future reviewers.
