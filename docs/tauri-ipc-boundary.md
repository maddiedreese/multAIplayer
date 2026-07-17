# Tauri IPC boundary notes

This document records maintained trust assumptions, authorization constraints,
and known residual risks at the native command boundary. It is not an audit
report, a per-command review log, or evidence that every registered command is
safe. The compiler-owned registration surface lives in
`apps/desktop/src-tauri/src/lib.rs`; behavior and authorization evidence lives
in the Rust and product-journey tests beside the implementation.

## Boundary model

The Tauri main webview is part of the trusted computing base. Commands that
return project plaintext or perform constrained signing are intentional parts
of that boundary; the native layer does not make a compromised main webview
safe.

Fallible commands use `#[typed_tauri_command::command]`. The registration macro
requires the marker emitted by that attribute, so a fallible command cannot be
registered without returning the shared `CommandResult` contract. This is a
compile-time interface check, not a behavior or authorization review.

Native command changes should be reviewed for:

1. sensitive inputs and outputs;
2. Rust-side validation of untrusted values;
3. the native authorization or state prerequisite; and
4. behavior before initialization, after expiry, across rooms, and during
   incompatible transitions.

## Closed findings that define current invariants

- **Filesystem permission grants are allowlist-based.** Codex filesystem grants
  fail closed unless every path is canonically beneath the active room's
  natively approved project root. Relative paths, parent and symlink escapes,
  globs, special-directory grants, malformed shapes, missing roots, and network
  grants are denied before approval and rechecked immediately before a response
  is sent.
- **Codex roots and positive approvals require native authority.** Rust confirms
  and stores the canonical project root plus execution profile. Root or profile
  changes prompt again. Positive command, file-change, and permission responses
  require native confirmation bound to the exact pending room, request, and
  method; denials remain prompt-free.

## Residual boundaries

- **Room IDs scope native state; they do not authenticate callers.** Several
  terminal, Codex, MLS, and outbox commands rely on the single trusted main
  webview. Before introducing mutually untrusted local principals, bind room
  authority to an unforgeable native session.
- **Plaintext and constrained signing deliberately cross IPC.** File, archive,
  terminal, Codex, MLS-processing, and history commands return content needed
  by the UI. Device-auth and host-transfer commands expose constrained signing
  operations. Private keys, OAuth tokens, relay cookies, invite verifiers, and
  exporter secrets are not returned, but a compromised main webview can invoke
  the allowed surface.
- **Native confirmation authorizes exact commands, not semantic safety.** Shell
  and terminal execution use bounded, expiring, exact-parameter grants and the
  macOS sandbox. Text risk labels are review aids only.
- **Non-Codex project roots are local UI selections.** Project, Git, shell, and
  clone commands validate paths and containment, but their initial roots are
  not all native room grants. A future plugin or untrusted-web model needs
  separate native grants.
- **Path authorization cannot eliminate filesystem TOCTOU.** Roots and existing
  ancestors are canonicalized when a grant is registered and rechecked after
  confirmation, but portable path checks cannot pin directory inodes against
  later replacement. Operation-time checks and sandboxing remain necessary.

## Maintenance

Changing a command's inputs, outputs, authority, process or network behavior,
path reach, or cross-room visibility requires review of the implementation and
its tests against the boundary model above. Adding or removing a command needs
no parallel Markdown inventory: `declare_registered_commands!` is the source of
truth, and the Rust compiler verifies the typed fallible-command contract.
