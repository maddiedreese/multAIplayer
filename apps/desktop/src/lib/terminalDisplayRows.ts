import type {
  CodexEventDisplay,
  TerminalCommandRequestDisplay,
  TerminalOutputLineDisplay
} from "../components/TerminalPanel";
import type { CodexRoomEvent, TerminalCommandRequest } from "../types";
import type { TerminalLine } from "./localBackend";
import { formatCodexModel, formatTimestamp } from "./appFormatters";
import { formatCodexEventStatus } from "./activityLines";
import { detectSecretRisks, detectTerminalCommandRisks } from "./secretRisks";

export function buildTerminalOutputLines(lines: Array<TerminalLine | string>): TerminalOutputLineDisplay[] {
  return lines.map((line) => {
    const terminalLine = typeof line === "string" ? { stream: "system", text: line } : line;
    return {
      ...terminalLine,
      risks: detectSecretRisks(terminalLine.text)
    };
  });
}

export function buildTerminalRequestRows(requests: TerminalCommandRequest[]): TerminalCommandRequestDisplay[] {
  return requests.map((request) => ({
    id: request.id,
    command: request.command,
    requester: request.requester,
    cwd: request.cwd,
    status: request.status,
    risks: detectTerminalCommandRisks(request.command)
  }));
}

export function buildCodexEventRows(events: CodexRoomEvent[]): CodexEventDisplay[] {
  return events
    .slice(-5)
    .reverse()
    .map((event) => ({
      key: `${event.turnId}-${event.createdAt}-${event.status}`,
      status: event.status,
      statusLabel: formatCodexEventStatus(event.status),
      message: event.message,
      detail: `${event.threadId ?? formatCodexModel(event.model)} · ${formatTimestamp(event.createdAt)}`,
      host: event.host
    }));
}
