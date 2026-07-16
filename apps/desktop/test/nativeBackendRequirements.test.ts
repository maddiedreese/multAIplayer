import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLocalPreviewServers,
  forkCodexThread,
  readProjectFile,
  runShellCommand,
  searchProjectFiles,
  startTerminal,
  writeProjectFile
} from "../src/lib/platform/localBackend/index";
import { isTauriRuntime } from "../src/lib/platform/localBackend/runtime";

test("native runtime detection requires a callable Tauri invoke boundary", () => {
  const previousWindow = globalThis.window;
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} }
    });
    assert.equal(isTauriRuntime(), false);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: { invoke: () => undefined } }
    });
    assert.equal(isTauriRuntime(), true);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow
    });
  }
});

test("native-only backends reject instead of fabricating successful browser results", async () => {
  const expected = /requires the native desktop app/;

  await assert.rejects(searchProjectFiles("/repo", "App"), expected);
  await assert.rejects(readProjectFile("/repo", "README.md"), expected);
  await assert.rejects(writeProjectFile("/repo", "README.md", "changed"), expected);
  await assert.rejects(forkCodexThread("room-a", "thread-a", "/repo"), expected);
  await assert.rejects(detectLocalPreviewServers(), expected);
  await assert.rejects(startTerminal("room-a", "dev", "/repo", "npm run dev"), expected);
  await assert.rejects(runShellCommand("room-a", "/repo", "git status", "Test user"), expected);
});
