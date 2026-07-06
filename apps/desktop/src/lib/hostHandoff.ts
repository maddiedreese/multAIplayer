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

export interface HandoffRepoIdentity {
  owner: string;
  repo: string;
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

export function handoffRepoIdentity(handoff: Pick<HostHandoffPlaintextPayload, "gitRepoOwner" | "gitRepoName">): HandoffRepoIdentity | null {
  const owner = handoff.gitRepoOwner?.trim();
  const repo = handoff.gitRepoName?.trim();
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function sameHandoffRepo(
  expected: HandoffRepoIdentity | null,
  actual: HandoffRepoIdentity | null
): boolean {
  if (!expected || !actual) return false;
  return expected.owner.toLowerCase() === actual.owner.toLowerCase() &&
    expected.repo.toLowerCase() === actual.repo.toLowerCase();
}

export function hostHandoffTitle(handoff: Pick<HostHandoffPlaintextPayload, "reason" | "fromHost">): string {
  return handoff.reason === "usage_limit"
    ? `Continue with another host`
    : `Host handoff from ${handoff.fromHost}`;
}

export function hostHandoffDetail(handoff: Pick<HostHandoffPlaintextPayload, "reason" | "fromHost" | "gitRepoOwner" | "gitRepoName" | "gitBranch">): string {
  const repo = handoff.gitRepoOwner && handoff.gitRepoName
    ? `${handoff.gitRepoOwner}/${handoff.gitRepoName}${handoff.gitBranch ? `@${handoff.gitBranch}` : ""}`
    : "an equivalent local project folder";
  return handoff.reason === "usage_limit"
    ? `${handoff.fromHost} is out of Codex usage. Attach ${repo} to continue from the room context.`
    : `Attach ${repo} to continue from ${handoff.fromHost}'s handoff.`;
}
