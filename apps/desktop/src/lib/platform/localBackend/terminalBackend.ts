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
  return invokeNative<TerminalSnapshot>("terminal_start", {
    request: { roomId, name, cwd, command }
  });
}

export async function listTerminals(roomId: string): Promise<TerminalSnapshot[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot[]>("terminal_list", { roomId });
}

export async function readTerminal(id: string, afterRevision?: number): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot>("terminal_read", {
    id,
    ...(afterRevision === undefined ? {} : { afterRevision })
  });
}

export async function writeTerminal(
  roomId: string,
  id: string,
  input: string,
  afterRevision?: number
): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot>("terminal_write", {
    request: { roomId, id, input, ...(afterRevision === undefined ? {} : { afterRevision }) }
  });
}

export async function stopTerminal(id: string): Promise<TerminalSnapshot> {
  if (!isTauriRuntime()) return requireNativeRuntime("Terminals");
  return invokeNative<TerminalSnapshot>("terminal_stop", { id });
}
