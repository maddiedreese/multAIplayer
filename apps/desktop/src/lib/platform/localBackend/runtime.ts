import { invokeNative } from "../nativeCommandError";

import type { CommandResult } from "./types";

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

export function requireNativeRuntime(feature: string): never {
  throw new Error(`${feature} requires the native desktop app.`);
}

async function authorizeShellExecution(request: {
  roomId: string;
  cwd: string;
  command: string;
  kind: "remote_request";
  requesterLabel: string;
}): Promise<string> {
  return invokeNative<string>("authorize_shell_execution", { request });
}

export async function runShellCommand(
  roomId: string,
  cwd: string,
  command: string,
  requesterLabel: string
): Promise<CommandResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Shell commands");
  const authorizationToken = await authorizeShellExecution({
    roomId,
    cwd,
    command,
    kind: "remote_request",
    requesterLabel
  });
  return invokeNative<CommandResult>("run_shell_command", {
    request: { roomId, cwd, command, authorizationToken }
  });
}

export async function clearShellExecutionGrants(roomId: string): Promise<number> {
  if (!isTauriRuntime()) return requireNativeRuntime("Shell authorization");
  return invokeNative<number>("clear_shell_execution_grants", { roomId });
}
