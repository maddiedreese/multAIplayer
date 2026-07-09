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

## License Maintenance

Keep this file current when adding or replacing embedded editor, terminal, browser, or native runtime dependencies. Release checks should continue to run `npm run license:check`; Rust crate licenses should also be reviewed before release when Cargo dependencies change.
