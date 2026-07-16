import type { ComponentProps } from "react";
import type { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import type { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";

type BrowserProps = ComponentProps<typeof BrowserAccessPanel>;
type WorkProps = Omit<ComponentProps<typeof RoomInspectorWorkPanel>, "activeTab">;
type ProjectProps = WorkProps["project"];
type TeamRosterProps = WorkProps["teamRoster"];
type RoomMemberProps = WorkProps["roomMembers"];
type HistoryProps = WorkProps["localHistory"];
type GitHandoffProps = WorkProps["gitHandoff"];
type TerminalProps = WorkProps["terminal"];
type WorkspaceFilesProps = WorkProps["workspaceFiles"];

/** UI capabilities required to render and operate the selected-room inspector. */
export interface RoomInspectorSources {
  roomRuntime: {
    openRoomBrowserNow: BrowserProps["onOpenBrowserNow"];
    approveBrowserRequest: BrowserProps["onApproveBrowserRequest"];
    denyBrowserRequest: BrowserProps["onDenyBrowserRequest"];
    openApprovedBrowserRequest: BrowserProps["onOpenApprovedBrowserRequest"];
    chooseProjectPath: ProjectProps["onChooseProjectPath"];
    updateProjectPath: ProjectProps["onUpdateProjectPath"];
    setApprovalPolicy: WorkProps["approvalPolicy"]["onSelectPolicy"];
    setCodexSandboxLevel: WorkProps["approvalPolicy"]["onSelectSandboxLevel"];
    setCodexModel: WorkProps["model"]["onSelectModel"];
    setCodexReasoningEffort: WorkProps["model"]["onSelectReasoningEffort"];
    setCodexRawReasoningEnabled: WorkProps["model"]["onRawReasoningEnabledChange"];
    setCodexSpeed: WorkProps["model"]["onSelectSpeed"];
    approveGitWorkflow: GitHandoffProps["onApproveGitWorkflow"];
    refreshGitHubActions: WorkProps["githubActions"]["onRefresh"];
  };
  workspaceFlow: {
    changeTeamMemberRole: (member: Parameters<TeamRosterProps["onPromote"]>[0], role: "admin" | "member") => void;
    transferOwnershipToTeamMember: TeamRosterProps["onTransferOwnership"];
    removeMemberFromTeam: TeamRosterProps["onRemove"];
    copyRoomMemberDeviceFingerprint: (
      member: Parameters<RoomMemberProps["onCopyFingerprint"]>[0],
      comparedLocally: boolean
    ) => void;
    markRoomMemberFingerprintCompared: RoomMemberProps["onMarkCompared"];
    clearRoomMemberFingerprintComparison: RoomMemberProps["onClearComparison"];
    updateLocalHistorySettings: (settings: HistoryProps["historySettings"]) => void;
    clearRoomHistory: HistoryProps["onClearRoomHistory"];
    forgetSelectedRoomLocalData: HistoryProps["onForgetRoomLocalData"];
    applyTeamDefaultsToRoom: HistoryProps["onApplyTeamDefaultsToRoom"];
    updateTeamHistoryDefaults: (settings: HistoryProps["teamHistorySettings"]) => void;
    updateTeamDefaultApprovalPolicy: HistoryProps["onTeamDefaultApprovalPolicyChange"];
    updateTeamDefaultCodexModel: HistoryProps["onTeamDefaultCodexModelChange"];
    updateTeamDefaultInviteApprovalGate: HistoryProps["onTeamDefaultInviteApprovalGateChange"];
    copyPullRequestDraftMarkdown: GitHandoffProps["onCopyPullRequestDraftMarkdown"];
  };
  hostHandoff: { acceptHostHandoff: WorkProps["hostHandoff"]["onAcceptHandoff"] };
  inviteActions: {
    copyInviteLink: WorkProps["encryptedInvite"]["onCopyInvite"];
    joinInviteSecret: WorkProps["encryptedInvite"]["onImportInvite"];
    decideInviteJoinRequest: WorkProps["encryptedInvite"]["onDecideInviteRequest"];
  };
  roomPanels: {
    workspaceFilesPanelActions: Pick<
      WorkspaceFilesProps,
      | "onCopyProjectMarkdown"
      | "onOpenProjectFile"
      | "onCopyDiffSummaryMarkdown"
      | "onAttachSelectedFileToMessage"
      | "onSaveSelectedFileContent"
      | "onApproveFileSaveRequest"
      | "onDenyFileSaveRequest"
      | "onCloseFileViewer"
    >;
    terminalPanelActions: Pick<
      TerminalProps,
      | "onCopyMarkdown"
      | "onOpenInteractiveTerminal"
      | "onApproveTerminalRequest"
      | "onDenyTerminalRequest"
      | "onSendTerminalData"
      | "onRestartTerminal"
      | "onStopTerminal"
      | "onRevokeExactCommandGrants"
    >;
  };
}
