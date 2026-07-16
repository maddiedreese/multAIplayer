import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";
import type { TerminalSnapshot } from "./types";

export async function startTerminal(
  roomId: string,
  name: string,
  cwd: string,
  command: string
): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  const authorizationToken = await invokeNative<string>("authorize_shell_execution", {
    request: {
      roomId,
      cwd,
      command,
      kind: "interactive_terminal",
      requesterLabel: "Local host"
    }
  });
  return invokeNative<TerminalSnapshot>("terminal_start", {
    request: { roomId, name, cwd, command, authorizationToken }
  });
}

export async function listTerminals(roomId: string): Promise<TerminalSnapshot[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot[]>("terminal_list", { roomId });
}

export async function readTerminal(id: string): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot>("terminal_read", { id });
}

export async function writeTerminal(roomId: string, id: string, input: string): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  const authorizationToken = await invokeNative<string>("authorize_terminal_input", {
    request: { roomId, terminalId: id, input, requesterLabel: "Local host" }
  });
  return invokeNative<TerminalSnapshot>("terminal_write", {
    request: { roomId, id, input, authorizationToken }
  });
}

export async function stopTerminal(id: string): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot>("terminal_stop", { id });
}
