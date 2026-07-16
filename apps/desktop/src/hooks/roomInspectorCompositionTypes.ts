import type { ComponentProps } from "react";
import type { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";
import type { createAppRoomPanelActions } from "./appRoomPanelActions";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";

export type InspectorWorkProps = ComponentProps<typeof RoomInspectorWorkPanel>;
type WorkspaceFileActions = Pick<
  InspectorWorkProps["workspaceFiles"],
  | "onCopyProjectMarkdown"
  | "onOpenProjectFile"
  | "onCopyDiffSummaryMarkdown"
  | "onAttachSelectedFileToMessage"
  | "onSaveSelectedFileContent"
  | "onApproveFileSaveRequest"
  | "onDenyFileSaveRequest"
  | "onCloseFileViewer"
>;
type TerminalActions = Pick<
  InspectorWorkProps["terminal"],
  | "onCopyMarkdown"
  | "onOpenInteractiveTerminal"
  | "onApproveTerminalRequest"
  | "onDenyTerminalRequest"
  | "onSendTerminalData"
  | "onRestartTerminal"
  | "onStopTerminal"
  | "onRevokeExactCommandGrants"
>;

export interface RoomInspectorCapabilities {
  browser: { openNow: () => void };
  project: { choosePath: () => void; updatePath: () => void };
  teamRoster: Pick<InspectorWorkProps["teamRoster"], "onPromote" | "onDemote" | "onTransferOwnership" | "onRemove">;
  roomMembers: Pick<InspectorWorkProps["roomMembers"], "onCopyFingerprint" | "onTrust" | "onUntrust">;
  hostHandoff: { accept: InspectorWorkProps["hostHandoff"]["onAcceptHandoff"] };
  invite: Pick<InspectorWorkProps["encryptedInvite"], "onCopyInvite" | "onImportInvite" | "onDecideInviteRequest">;
  settings: {
    selectApprovalPolicy: InspectorWorkProps["approvalPolicy"]["onSelectPolicy"];
    selectApprovalDelegationPolicy: InspectorWorkProps["approvalPolicy"]["onSelectDelegationPolicy"];
    selectSandboxLevel: InspectorWorkProps["approvalPolicy"]["onSelectSandboxLevel"];
    selectModel: InspectorWorkProps["model"]["onSelectModel"];
    selectReasoningEffort: InspectorWorkProps["model"]["onSelectReasoningEffort"];
    setRawReasoningEnabled: InspectorWorkProps["model"]["onRawReasoningEnabledChange"];
    selectSpeed: InspectorWorkProps["model"]["onSelectSpeed"];
  };
  history: Pick<
    InspectorWorkProps["localHistory"],
    | "onHistoryEnabledChange"
    | "onHistoryRetentionDaysChange"
    | "onClearRoomHistory"
    | "onForgetRoomLocalData"
    | "onApplyTeamDefaultsToRoom"
    | "onRetryHistoryHydration"
    | "onTeamHistoryEnabledChange"
    | "onTeamHistoryRetentionDaysChange"
    | "onTeamDefaultApprovalPolicyChange"
    | "onTeamDefaultCodexModelChange"
    | "onTeamDefaultInviteApprovalGateChange"
  >;
  workspaceFiles: WorkspaceFileActions;
  git: Pick<InspectorWorkProps["gitHandoff"], "onCopyPullRequestDraftMarkdown" | "onApproveGitWorkflow">;
  github: { refresh: () => void };
  terminal: TerminalActions;
}

type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomPanels = ReturnType<typeof createAppRoomPanelActions>;

export interface RoomInspectorSources {
  roomRuntime: Pick<
    RoomRuntime,
    | "openRoomBrowserNow"
    | "chooseProjectPath"
    | "updateProjectPath"
    | "setApprovalPolicy"
    | "setApprovalDelegationPolicy"
    | "setCodexSandboxLevel"
    | "setCodexModel"
    | "setCodexReasoningEffort"
    | "setCodexRawReasoningEnabled"
    | "setCodexSpeed"
    | "approveGitWorkflow"
    | "refreshGitHubActions"
  >;
  workspaceFlow: Pick<
    WorkspaceFlow,
    | "changeTeamMemberRole"
    | "transferOwnershipToTeamMember"
    | "removeMemberFromTeam"
    | "copyRoomMemberDeviceFingerprint"
    | "trustRoomMemberDevice"
    | "untrustRoomMemberDevice"
    | "updateLocalHistorySettings"
    | "clearRoomHistory"
    | "forgetSelectedRoomLocalData"
    | "applyTeamDefaultsToRoom"
    | "updateTeamHistoryDefaults"
    | "updateTeamDefaultApprovalPolicy"
    | "updateTeamDefaultCodexModel"
    | "updateTeamDefaultInviteApprovalGate"
    | "copyPullRequestDraftMarkdown"
  >;
  hostHandoff: Pick<HostHandoffActions, "acceptHostHandoff">;
  inviteActions: Pick<InviteActions, "copyInviteLink" | "joinInviteSecret" | "decideInviteJoinRequest">;
  roomPanels: Pick<RoomPanels, "workspaceFilesPanelActions" | "terminalPanelActions">;
}
