import {
  codexModelOptions,
  codexReasoningEffortOptions,
  codexSandboxLevelOptions,
  codexSpeedOptions,
  defaultCodexModel
} from "@multaiplayer/protocol";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../lib/codexCatalogResolver";
import { defaultProjectPath } from "../lib/localBackend";
import { approvalDelegationPolicyLabels, approvalPolicyLabels } from "../seedData";
import type { AppViewModelOptions } from "./appViewModelTypes";
import type { useAppViewProps } from "./useAppViewProps";

type RoomInspectorInput = Parameters<typeof useAppViewProps>[0]["roomInspectorPanel"];
type RoomInspectorOptions = Pick<
  AppViewModelOptions,
  | "appState"
  | "githubAuth"
  | "localIdentity"
  | "selected"
  | "selectedRuntime"
  | "roomInteraction"
  | "roomActions"
  | "roomDisplay"
  | "roomPanels"
  | "roomRuntime"
  | "workspaceFlow"
  | "hostHandoffActions"
  | "inviteActions"
>;

export function createRoomInspectorInput({
  appState,
  githubAuth,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  roomDisplay,
  roomPanels,
  roomRuntime,
  workspaceFlow,
  hostHandoffActions,
  inviteActions
}: RoomInspectorOptions): RoomInspectorInput {
  const { workspaceState, historyDefaultsState, appRuntimeState, invitePanelState } = appState;
  const {
    selectedRoom,
    hasSelectedRoom,
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    activeBrowserUrl,
    browserTabs,
    activeBrowserTabId,
    browserUrl,
    projectPathDraft,
    gitStatus,
    selectedTeamMemberRows,
    selectedTeamMembersBusy,
    selectedTeamMembersMessage,
    inviteApprovalGate,
    inviteLink,
    inviteMessage,
    settingsMessage,
    customCodexModel,
    visibleHistoryMessage,
    fileQuery,
    projectFiles,
    selectedFile,
    selectedDiff,
    fileBusy,
    fileMessage,
    filePreviewTab,
    gitWorkflowDraft,
    gitWorkflowBusy,
    gitWorkflowMessage,
    actionRuns,
    actionsLastChecked,
    actionsBusy,
    actionsMessage,
    terminalBusy,
    terminalError,
    roomTerminals,
    selectedTerminalId,
    inspectorTab
  } = selected;
  const resolvedSettings = resolveCodexRunSettings(selectedRoom, appRuntimeState.codexProbe);

  return {
    activeTab: inspectorTab,
    activeBrowserUrl,
    browserTabs,
    activeBrowserTabId,
    browserUrl,
    canHostBrowser: roomInteraction.canHostBrowser,
    onBrowserUrlChange: (url) => roomActions.setBrowserUrlForRoom(selectedRoom.id, url),
    onOpenBrowserNow: roomRuntime.openRoomBrowserNow,
    onSelectBrowserTab: (tabId) => roomActions.selectBrowserTabForRoom(selectedRoom.id, tabId),
    onCloseBrowserTab: (tabId) => roomActions.closeBrowserTabForRoom(selectedRoom.id, tabId),
    selectedRoom,
    projectPathDraft,
    gitStatus,
    hasSelectedRoom,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    settingsBusy: selectedRuntime.settingsBusy,
    isActiveHost: roomInteraction.isActiveHost,
    defaultProjectPath,
    onProjectPathDraftChange: (path) => roomActions.setProjectPathDraftForRoom(selectedRoom.id, path),
    onChooseProjectPath: roomRuntime.chooseProjectPath,
    onUpdateProjectPath: roomRuntime.updateProjectPath,
    teamRoster: {
      members: selectedTeamMemberRows,
      hasSelectedTeam: Boolean(workspaceState.selectedTeam),
      busy: selectedTeamMembersBusy,
      message: selectedTeamMembersMessage,
      onPromote: (member) => workspaceFlow.changeTeamMemberRole(member, "admin"),
      onDemote: (member) => workspaceFlow.changeTeamMemberRole(member, "member"),
      onTransferOwnership: workspaceFlow.transferOwnershipToTeamMember,
      onRemove: workspaceFlow.removeMemberFromTeam
    },
    roomMembers: {
      members: roomInteraction.roomMemberRows,
      localDeviceId: localIdentity.deviceId,
      message: appRuntimeState.deviceIdentityMessage,
      onCopyFingerprint: (member) => workspaceFlow.copyRoomMemberDeviceFingerprint(member, member.trusted),
      onTrust: workspaceFlow.trustRoomMemberDevice,
      onUntrust: workspaceFlow.untrustRoomMemberDevice
    },
    hostHandoffs: selectedRuntime.hostHandoffs,
    hostBusy: selectedRuntime.hostBusy,
    onAcceptHandoff: hostHandoffActions.acceptHostHandoff,
    selectedCodexSandboxLevel,
    encryptedInvite: {
      inviteApprovalGate,
      copyDisabled: !roomInteraction.canCopyRoomInvite,
      inviteSecretInput: invitePanelState.inviteSecretInput,
      inviteRequests: selectedRuntime.inviteRequests,
      localDeviceId: localIdentity.deviceId,
      gateDisabled: !hasSelectedRoom || roomInteraction.isSelectedRoomLocked,
      importDisabled: !invitePanelState.inviteSecretInput.trim(),
      rotateDisabled:
        !hasSelectedRoom ||
        roomInteraction.isSelectedRoomLocked ||
        !roomInteraction.isActiveHost ||
        selectedRuntime.keyRotationBusy,
      approvalDisabled:
        !hasSelectedRoom || roomInteraction.isSelectedRoomLocked || !roomInteraction.isActiveHost,
      keyRotationBusy: selectedRuntime.keyRotationBusy,
      inviteLink,
      inviteMessage,
      onCopyInvite: inviteActions.copyInviteLink,
      onInviteApprovalGateChange: (enabled) => roomActions.setInviteApprovalGateForRoom(selectedRoom.id, enabled),
      onInviteSecretInputChange: invitePanelState.setInviteSecretInputValue,
      onImportInvite: inviteActions.joinInviteSecret,
      onRotateRoomKey: inviteActions.rotateSelectedRoomKey,
      onDecideInviteRequest: inviteActions.decideInviteJoinRequest
    },
    approvalPolicy: {
      labels: approvalPolicyLabels,
      delegationLabels: approvalDelegationPolicyLabels,
      sandboxOptions: codexSandboxLevelOptions,
      message: settingsMessage,
      selectedSandboxLevel: selectedCodexSandboxLevel,
      onSelectPolicy: roomRuntime.setApprovalPolicy,
      onSelectDelegationPolicy: roomRuntime.setApprovalDelegationPolicy,
      onSelectSandboxLevel: roomRuntime.setCodexSandboxLevel
    },
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    customCodexModel,
    model: {
      customModel: customCodexModel,
      modelOptions: catalogModelOptions(appRuntimeState.codexProbe),
      reasoningOptions: catalogReasoningOptionsForModel(appRuntimeState.codexProbe, resolvedSettings.model),
      speedOptions: catalogSpeedOptionsForModel(appRuntimeState.codexProbe, resolvedSettings.model),
      onSelectModel: roomRuntime.setCodexModel,
      onSelectReasoningEffort: roomRuntime.setCodexReasoningEffort,
      onSelectSpeed: roomRuntime.setCodexSpeed,
      onCustomModelChange: (model) => roomActions.setCustomCodexModelForRoom(selectedRoom.id, model),
      onApplyCustomModel: () => roomRuntime.setCodexModel(customCodexModel)
    },
    codexRuntime: {
      roomId: selectedRoom.id,
      projectPath: selectedRoom.projectPath
    },
    localHistory: {
      historySettings: historyDefaultsState.historySettings,
      teamHistorySettings: historyDefaultsState.teamHistorySettings,
      selectedTeam: Boolean(workspaceState.selectedTeam),
      hasSelectedRoom,
      settingsBusy: selectedRuntime.settingsBusy,
      teamDefaultApprovalPolicy: historyDefaultsState.teamDefaultApprovalPolicy,
      approvalPolicyLabels,
      teamDefaultCodexModel: historyDefaultsState.teamDefaultCodexModel,
      defaultCodexModel,
      codexModelOptions,
      teamDefaultBrowserProfilePersistent: historyDefaultsState.teamDefaultBrowserProfilePersistent,
      teamDefaultInviteApprovalGate: historyDefaultsState.teamDefaultInviteApprovalGate,
      message: visibleHistoryMessage,
      onHistoryEnabledChange: (enabled) =>
        workspaceFlow.updateLocalHistorySettings({ ...historyDefaultsState.historySettings, enabled }),
      onHistoryRetentionDaysChange: (retentionDays) =>
        workspaceFlow.updateLocalHistorySettings({ ...historyDefaultsState.historySettings, retentionDays }),
      onClearRoomHistory: workspaceFlow.clearRoomHistory,
      onForgetRoomLocalData: workspaceFlow.forgetSelectedRoomLocalData,
      onApplyTeamDefaultsToRoom: workspaceFlow.applyTeamDefaultsToRoom,
      onTeamHistoryEnabledChange: (enabled) =>
        workspaceFlow.updateTeamHistoryDefaults({ ...historyDefaultsState.teamHistorySettings, enabled }),
      onTeamHistoryRetentionDaysChange: (retentionDays) =>
        workspaceFlow.updateTeamHistoryDefaults({ ...historyDefaultsState.teamHistorySettings, retentionDays }),
      onTeamDefaultApprovalPolicyChange: workspaceFlow.updateTeamDefaultApprovalPolicy,
      onTeamDefaultCodexModelChange: workspaceFlow.updateTeamDefaultCodexModel,
      onTeamDefaultBrowserProfilePersistentChange: historyDefaultsState.setTeamDefaultBrowserProfilePersistent,
      onTeamDefaultInviteApprovalGateChange: workspaceFlow.updateTeamDefaultInviteApprovalGate
    },
    workspaceFiles: {
      fileQuery,
      projectFiles,
      selectedFile,
      selectedDiff,
      fileBusy,
      fileMessage,
      fileSaveRequests: selected.fileSaveRequests,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      isActiveHost: roomInteraction.isActiveHost,
      selectedFileRisks: roomDisplay.selectedFileRisks,
      selectedFileNeedsAttachmentReview: roomDisplay.selectedFileNeedsAttachmentReview,
      selectedSensitiveFileReviewed: roomDisplay.selectedSensitiveFileReviewed,
      selectedAttachmentActionLabel: roomDisplay.selectedAttachmentReview?.actionLabel ?? "Attach",
      selectedAttachmentWarningDetail: roomDisplay.selectedAttachmentReview?.warningDetail ?? undefined,
      filePreviewTab,
      ...roomPanels.workspaceFilesPanelActions
    },
    gitHandoff: {
      draft: gitWorkflowDraft,
      preview: roomInteraction.gitApprovalPreview,
      readiness: roomInteraction.githubWorkflowReadiness,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      gitWorkflowBusy,
      isActiveHost: roomInteraction.isActiveHost,
      message: gitWorkflowMessage,
      onDraftChange: roomActions.updateSelectedGitWorkflowDraft,
      onCopyPullRequestDraftMarkdown: workspaceFlow.copyPullRequestDraftMarkdown,
      onApproveGitWorkflow: roomRuntime.approveGitWorkflow
    },
    githubActions: {
      summary: roomInteraction.actionsSummary,
      readiness: roomInteraction.githubActionsReadiness,
      runs: actionRuns,
      owner: gitWorkflowDraft.prOwner,
      repo: gitWorkflowDraft.prRepo,
      branch: gitWorkflowDraft.branchName,
      lastChecked: actionsLastChecked,
      busy: actionsBusy,
      refreshDisabled:
        !roomInteraction.canReadLocalWorkspace ||
        actionsBusy ||
        !roomInteraction.isActiveHost ||
        !roomInteraction.githubActionsReadiness.ready,
      currentUserSignedIn: Boolean(githubAuth.currentUser),
      message: actionsMessage,
      onRefresh: () => roomRuntime.refreshGitHubActions()
    },
    terminal: {
      terminalBusy,
      terminalError,
      terminalRisks: roomDisplay.terminalRisks,
      codexEvents: roomDisplay.codexEventRows,
      commandRequests: roomDisplay.terminalRequestRows,
      roomTerminals,
      selectedTerminal: selectedRuntime.selectedTerminal,
      selectedTerminalId,
      selectedTerminalCanControl: selectedRuntime.selectedTerminalCanControl,
      selectedTerminalCanRestart: selectedRuntime.selectedTerminalCanRestart,
      terminalOutputLines: roomDisplay.terminalOutputLines,
      codexRunning: selectedRuntime.codexRunning,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      ...roomPanels.terminalPanelActions
    }
  };
}
