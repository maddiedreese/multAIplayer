# Rust panic policy

The Tauri backend treats data, filesystem, process, lock, and protocol failures as recoverable. Production command paths return typed values or `Result<_, String>` errors to the frontend; they must not use `unwrap()` or `expect()` to handle runtime input or mutable external state.

An audit on 2026-07-12 found no runtime-input `unwrap()` or `expect()` calls. A session-cache ownership assertion in `codex.rs` was converted to a non-panicking conditional, and the outer Tauri bootstrap now reports its fatal error and exits unsuccessfully without unwinding. The remaining production occurrences are deliberately narrow:

- `output.rs` compiles five constant, repository-owned secret-redaction expressions through one audited helper when first used.
- `diagnostics/redaction.rs` compiles two constant, repository-owned diagnostic-redaction expressions through one audited helper when first used.

The seven regular-expression constructions are provably independent of user input. Their tests exercise the expressions and their redaction behavior, and failing fast is intentional: continuing with a missing redactor could disclose credentials. Any future fallible expression sourced from configuration or input must return an error and fail closed instead. The crate denies Clippy's `unwrap_used` and `expect_used` lints in every non-test build; only these two named helper functions carry narrow `expect_used` exceptions. This compiler-aware guard excludes `#[cfg(test)]` code without relying on a textual source scanner.

Occurrences in modules guarded by `#[cfg(test)]`, `lib_tests.rs`, and dedicated `tests.rs` files are test assertions, not shipped paths. Test fixtures may continue using `unwrap()` and `expect()` when a failure should abort the test with local context.

Review production additions by asking whether the failed condition can depend on input, external processes, the filesystem, synchronization, persisted state, or protocol peers. If it can, propagate or handle the failure. Reserve a process-level panic for an unrecoverable bootstrap failure or a repository-owned compile-time-style invariant whose fallback would weaken security.
