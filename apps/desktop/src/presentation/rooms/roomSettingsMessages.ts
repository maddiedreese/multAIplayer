import type { ApprovalPolicy, RoomSettingsPlaintextPayload } from "@multaiplayer/protocol";
import type { ChatMessage } from "../../types";
import {
  formatCodexModel,
  formatCodexReasoningEffort,
  formatCodexSandboxLevel,
  formatCodexSpeed,
  formatMessageTime
} from "../../lib/formatting/appFormatters";

interface RoomSettingsMessageLabels {
  approvalPolicyLabels: Record<ApprovalPolicy, string>;
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
    case "codexModel":
      return `${event.changedBy} changed the Codex model from ${formatCodexModel(event.previousValue)} to ${formatCodexModel(event.nextValue)}.`;
    case "codexReasoningEffort":
      return `${event.changedBy} changed Codex reasoning from ${formatCodexReasoningEffort(event.previousValue)} to ${formatCodexReasoningEffort(event.nextValue)}.`;
    case "codexRawReasoningEnabled":
      return `${event.changedBy} ${event.nextValue === "true" ? "enabled" : "disabled"} sharing and retention of raw provider reasoning for room members.`;
    case "codexSpeed":
      return `${event.changedBy} changed Codex speed from ${formatCodexSpeed(event.previousValue)} to ${formatCodexSpeed(event.nextValue)}.`;
    case "codexSandboxLevel":
      return `${event.changedBy} changed Codex sandbox from ${formatCodexSandboxLevel(event.previousValue)} to ${formatCodexSandboxLevel(event.nextValue)}.`;
    case "projectPath":
      return `${event.changedBy} changed the project folder from ${event.previousValue} to ${event.nextValue}.`;
    case "browserProfilePersistent":
      return `${event.changedBy} changed browser profile mode from ${formatBrowserProfilePersistence(event.previousValue)} to ${formatBrowserProfilePersistence(event.nextValue)}.`;
  }
}

function formatApprovalPolicy(value: string, labels: RoomSettingsMessageLabels): string {
  return labels.approvalPolicyLabels[value as ApprovalPolicy] ?? value;
}

function formatBrowserProfilePersistence(value: string): string {
  return value === "true" ? "persistent profile" : "refresh before each approved open";
}
