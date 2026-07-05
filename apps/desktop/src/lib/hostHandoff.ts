import type { ApprovalPolicy, HostHandoffPlaintextPayload } from "@multaiplayer/protocol";
import { normalizeCodexModel, normalizeProjectPath } from "./workspaceCreation";

export interface HandoffSettingsPatch {
  projectPath: string;
  codexModel: string;
  approvalPolicy: ApprovalPolicy;
}

export interface HostHandoffCandidate {
  id: string;
  status: "available" | "accepted";
}

export function isRoomHostMutationInFlight(
  busyByRoom: Record<string, boolean>,
  roomId: string
): boolean {
  return busyByRoom[roomId] === true;
}

export function roomHostMutationInFlightMessage(): string {
  return "Host change is already in progress for this room.";
}

const approvalPolicies: ApprovalPolicy[] = [
  "ask_every_turn",
  "auto_chat_only",
  "auto_browser_allowed_sites",
  "never_host"
];

export function createHandoffSettingsPatch(handoff: HostHandoffPlaintextPayload): HandoffSettingsPatch {
  const projectPath = normalizeProjectPath(handoff.projectPath);
  if (!projectPath) throw new Error("Host handoff is missing a supported project path.");
  const codexModel = normalizeCodexModel(handoff.codexModel);
  if (!codexModel) throw new Error("Host handoff is missing a supported Codex model.");
  if (!approvalPolicies.includes(handoff.approvalPolicy as ApprovalPolicy)) {
    throw new Error(`Host handoff approval policy is not supported: ${handoff.approvalPolicy}`);
  }
  return {
    projectPath,
    codexModel,
    approvalPolicy: handoff.approvalPolicy as ApprovalPolicy
  };
}

export function findRoomHostHandoff<T extends HostHandoffCandidate>(
  handoffs: T[],
  handoffId: string
): T | null {
  return handoffs.find((handoff) => handoff.id === handoffId) ?? null;
}

export function canAcceptRoomHostHandoff<T extends HostHandoffCandidate>(
  handoffs: T[],
  handoffId: string
): boolean {
  const handoff = findRoomHostHandoff(handoffs, handoffId);
  return handoff?.status === "available";
}

export function roomHostHandoffMessage<T extends HostHandoffCandidate>(
  handoffs: T[],
  handoffId: string
): string {
  const handoff = findRoomHostHandoff(handoffs, handoffId);
  if (!handoff) return "Host handoff is no longer available in this room.";
  if (handoff.status !== "available") {
    return `Host handoff is ${handoff.status}, not available.`;
  }
  return "Host handoff is available.";
}
