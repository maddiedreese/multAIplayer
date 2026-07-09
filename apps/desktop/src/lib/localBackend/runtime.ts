import { invoke } from "@tauri-apps/api/core";

import type { CommandResult } from "./types";

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
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
