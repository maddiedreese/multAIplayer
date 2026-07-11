import { invoke } from "@tauri-apps/api/core";

import type { CommandResult } from "./types";

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

async function authorizeShellExecution(request: {
  roomId: string;
  cwd: string;
  command: string;
  kind: "remote_request" | "interactive_terminal";
  requesterLabel: string;
}): Promise<string> {
  return invoke<string>("authorize_shell_execution", { request });
}

export async function runShellCommand(
  roomId: string,
  cwd: string,
  command: string,
  requesterLabel: string
): Promise<CommandResult> {
  if (isTauriRuntime()) {
    const authorizationToken = await authorizeShellExecution({
      roomId,
      cwd,
      command,
      kind: "remote_request",
      requesterLabel
    });
    return invoke<CommandResult>("run_shell_command", {
      request: { roomId, cwd, command, authorizationToken }
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

export async function clearShellExecutionGrants(roomId: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("clear_shell_execution_grants", { roomId });
}
