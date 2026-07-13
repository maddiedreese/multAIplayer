# Third-Party Notices

multAIplayer is licensed under Apache-2.0. The desktop app also includes open source components that remain under their own licenses.

## Editor

- Monaco Editor (`monaco-editor`) - MIT License - https://github.com/microsoft/monaco-editor

Monaco powers the in-app workspace file editor and syntax-aware editing surface.

## Terminal

- xterm.js (`@xterm/xterm`) - MIT License - https://github.com/xtermjs/xterm.js
- xterm.js Fit Addon (`@xterm/addon-fit`) - MIT License - https://github.com/xtermjs/xterm.js
- portable-pty (`portable-pty`) - MIT License - https://github.com/wezterm/wezterm

xterm.js renders the terminal UI. The native Tauri host uses a Rust PTY layer through `portable-pty` to start, read, write, and stop host-side terminal sessions.

## Browser And Desktop Runtime

- Tauri (`tauri`, `@tauri-apps/api`, Tauri plugins) - Apache-2.0 OR MIT - https://github.com/tauri-apps/tauri
- Wry (`wry`, via Tauri runtime) - Apache-2.0 OR MIT - https://github.com/tauri-apps/wry

Tauri and Wry provide the native desktop shell and in-room WebView surface. The WebView uses the operating system webview engine selected by Tauri/Wry.

## MLS, HPKE, And Encrypted Storage

- `mls-rs` 0.54.0, `mls-rs-core` 0.26.0, `mls-rs-crypto-awslc` 0.23.0, and `mls-rs-provider-sqlite` 0.22.0 - Apache-2.0 OR MIT - https://github.com/awslabs/mls-rs
- `hpke` 0.14.0 - MIT OR Apache-2.0 - https://github.com/rozbb/rust-hpke
- `aws-lc-rs` 1.16.2 - ISC AND (Apache-2.0 OR ISC) - https://github.com/aws/aws-lc-rs
- `libsqlite3-sys` 0.35.0 - MIT - https://github.com/rusqlite/rusqlite

These crates implement RFC 9420 MLS, the residual RFC 9180 pairwise invite seal, cryptographic primitives, and the SQLCipher-backed native state provider. Cargo dependency licenses were reviewed manually for this migration because the npm license gate does not inspect the Cargo graph.

## License Maintenance

Keep this file current when adding or replacing embedded editor, terminal, browser, cryptographic, storage, or native runtime dependencies. Release checks should continue to run `npm run license:check`; Rust crate licenses must also be reviewed before release when Cargo dependencies change.
