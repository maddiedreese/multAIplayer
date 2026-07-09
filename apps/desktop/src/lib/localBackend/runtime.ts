import { invoke } from "@tauri-apps/api/core";

import type { CommandResult } from "./types";

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

export async function runShellCommand(cwd: string, command: string): Promise<CommandResult> {
  if (isTauriRuntime()) {
    return invoke<CommandResult>("run_shell_command", {
      request: { cwd, command }
    });
  }

  return {
    cwd,
    command,
    status: 0,
    stdout: `$ ${command}\nPreview mode: open the Tauri app to run host commands.\n`,
    stderr: ""
  };
}
