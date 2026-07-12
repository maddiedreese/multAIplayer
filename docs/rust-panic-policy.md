# Rust panic policy

The Tauri backend treats data, filesystem, process, lock, and protocol failures as recoverable. Production command paths return typed values or `Result<_, String>` errors to the frontend; they must not use `unwrap()` or `expect()` to handle runtime input or mutable external state.

An audit on 2026-07-12 found no runtime-input `unwrap()` or `expect()` calls. A session-cache ownership assertion in `codex.rs` was converted to a non-panicking conditional, and the outer Tauri bootstrap now reports its fatal error and exits unsuccessfully without unwinding. The seven constant redaction expressions are compiled once into fallible `LazyLock` values. If any expression cannot compile, the applicable redactor replaces the entire value with a failure marker; it never returns potentially sensitive input and never panics.

The crate denies Clippy's `unwrap_used` and `expect_used` lints in every non-test build, and the repository hygiene test requires the exception list to remain empty. This compiler-aware guard excludes `#[cfg(test)]` code without relying on a textual source scanner. Any future fallible expression, including one sourced from configuration or input, must propagate an error or fail closed without reflecting the unredacted value.

Occurrences in modules guarded by `#[cfg(test)]`, `lib_tests.rs`, and dedicated `tests.rs` files are test assertions, not shipped paths. Test fixtures may continue using `unwrap()` and `expect()` when a failure should abort the test with local context.

Review production additions by asking whether the failed condition can depend on input, external processes, the filesystem, synchronization, persisted state, or protocol peers. If it can, propagate or handle the failure. Reserve a process-level panic for an unrecoverable bootstrap failure or a repository-owned compile-time-style invariant whose fallback would weaken security.
