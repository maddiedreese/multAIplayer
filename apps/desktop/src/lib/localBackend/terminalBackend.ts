import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";
import type { TerminalSnapshot } from "./types";

const previewTerminals = new Map<string, TerminalSnapshot>();

export async function startTerminal(
  roomId: string,
  name: string,
  cwd: string,
  command: string
): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_start", {
      request: { roomId, name, cwd, command }
    });
  }

  const snapshot: TerminalSnapshot = {
    id: `${roomId}:${name}`,
    roomId,
    name,
    cwd,
    command,
    running: true,
    exitStatus: null,
    startedAt: String(Date.now()),
    lines: [
      { stream: "system", text: `$ ${command}` },
      { stream: "stdout", text: command.startsWith("echo ") ? command.slice(5) : "Preview mode: open the Tauri app for persistent host terminals." }
    ]
  };
  previewTerminals.set(snapshot.id, snapshot);
  return snapshot;
}

export async function listTerminals(roomId: string): Promise<TerminalSnapshot[]> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot[]>("terminal_list", { roomId });
  }

  return Array.from(previewTerminals.values()).filter((terminal) => terminal.roomId === roomId);
}

export async function readTerminal(id: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_read", { id });
  }

  const existing = previewTerminals.get(id);
  if (existing) return existing;
  throw new Error(`Terminal not found: ${id}`);
}

export async function writeTerminal(id: string, input: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_write", {
      request: { id, input }
    });
  }

  const snapshot = await readTerminal(id);
  const updated: TerminalSnapshot = {
    ...snapshot,
    lines: [...snapshot.lines, { stream: "stdin", text: input.replace(/\n$/, "") }]
  };
  previewTerminals.set(id, updated);
  return updated;
}

export async function stopTerminal(id: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_stop", { id });
  }

  const snapshot = await readTerminal(id);
  const updated: TerminalSnapshot = { ...snapshot, running: false, exitStatus: 0 };
  previewTerminals.set(id, updated);
  return updated;
}
