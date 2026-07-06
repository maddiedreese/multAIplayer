import type { ApprovalPolicy, RoomMode, RoomSettingsPlaintextPayload } from "@multaiplayer/protocol";
import type { ChatMessage } from "../types";
import { formatCodexModel, formatMessageTime } from "./appFormatters";
import { formatBrowserAccessLabel } from "./browserUi";

interface RoomSettingsMessageLabels {
  approvalPolicyLabels: Record<ApprovalPolicy, string>;
  roomModeLabels: Record<keyof RoomMode, string>;
}

export function buildRoomSettingsSystemMessage(
  event: RoomSettingsPlaintextPayload,
  labels: RoomSettingsMessageLabels
): ChatMessage {
  return {
    id: event.id,
    author: "multAIplayer",
    role: "system",
    body: buildRoomSettingsMessageBody(event, labels),
    time: formatMessageTime(event.changedAt),
    createdAt: event.changedAt
  };
}

export function buildRoomSettingsMessageBody(
  event: RoomSettingsPlaintextPayload,
  labels: RoomSettingsMessageLabels
): string {
  switch (event.setting) {
    case "roomName":
      return `${event.changedBy} changed the room title from ${event.previousValue} to ${event.nextValue}.`;
    case "approvalPolicy":
      return `${event.changedBy} changed the approval policy from ${formatApprovalPolicy(event.previousValue, labels)} to ${formatApprovalPolicy(event.nextValue, labels)}.`;
    case "roomMode":
      return `${event.changedBy} ${formatRoomModeChange(event.nextValue, labels)}.`;
    case "codexModel":
      return `${event.changedBy} changed the Codex model from ${formatCodexModel(event.previousValue)} to ${formatCodexModel(event.nextValue)}.`;
    case "projectPath":
      return `${event.changedBy} changed the project folder from ${event.previousValue} to ${event.nextValue}.`;
    case "browserAllowedOrigins":
      return `${event.changedBy} changed legacy browser origin metadata from ${formatOriginList(event.previousValue)} to ${formatOriginList(event.nextValue)}.`;
    case "browserProfilePersistent":
      return `${event.changedBy} changed browser profile mode from ${formatBrowserProfilePersistence(event.previousValue)} to ${formatBrowserProfilePersistence(event.nextValue)}.`;
  }
}

function formatApprovalPolicy(value: string, labels: RoomSettingsMessageLabels): string {
  return labels.approvalPolicyLabels[value as ApprovalPolicy] ?? value;
}

function formatRoomModeChange(value: string, labels: RoomSettingsMessageLabels): string {
  const [mode, state] = value.split(":");
  const label = labels.roomModeLabels[mode as keyof RoomMode] ?? mode;
  return `${state === "enabled" ? "enabled" : "disabled"} ${label} mode`;
}

function formatOriginList(value: string): string {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) return "no sites";
  return origins.map(formatBrowserAccessLabel).join(", ");
}

function formatBrowserProfilePersistence(value: string): string {
  return value === "true" ? "persistent profile" : "refresh before each approved open";
}
