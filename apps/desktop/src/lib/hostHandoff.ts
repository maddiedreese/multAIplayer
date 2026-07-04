import type { ApprovalPolicy, HostHandoffPlaintextPayload } from "@multaiplayer/protocol";
import { normalizeCodexModel, normalizeProjectPath } from "./workspaceCreation";

export interface HandoffSettingsPatch {
  projectPath: string;
  codexModel: string;
  approvalPolicy: ApprovalPolicy;
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
