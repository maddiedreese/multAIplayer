import type { createAppRoomPanelActions } from "./appRoomPanelActions";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomPanels = ReturnType<typeof createAppRoomPanelActions>;

export interface RoomInspectorSources {
  roomRuntime: Pick<
    RoomRuntime,
    | "openRoomBrowserNow"
    | "approveBrowserRequest"
    | "denyBrowserRequest"
    | "openApprovedBrowserRequest"
    | "chooseProjectPath"
    | "updateProjectPath"
    | "setApprovalPolicy"
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
