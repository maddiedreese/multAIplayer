import {
  codexModelOptions,
  codexReasoningEffortOptions,
  codexSandboxLevelOptions,
  codexSpeedOptions,
  defaultCodexModel
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "../lib/localBackend";
import {
  approvalDelegationPolicyLabels,
  approvalPolicyLabels,
  roomModeLabels
} from "../seedData";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRoomDisplayContext } from "./useAppRoomDisplayContext";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomPanelActions } from "./useAppRoomPanelActions";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import { useAppViewProps } from "./useAppViewProps";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useThemeMode } from "./useThemeMode";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type ThemeMode = ReturnType<typeof useThemeMode>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type RoomDisplay = ReturnType<typeof useAppRoomDisplayContext>;
type RoomPanels = ReturnType<typeof useAppRoomPanelActions>;
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type InviteActions = ReturnType<typeof useAppInviteActions>;

export function useAppViewModel({
  appState,
  githubAuth,
  localIdentity,
  theme,
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
}: {
  appState: AppStateSlices;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  theme: ThemeMode;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  roomDisplay: RoomDisplay;
  roomPanels: RoomPanels;
  roomRuntime: RoomRuntime;
  workspaceFlow: WorkspaceFlow;
  hostHandoffActions: HostHandoffActions;
  inviteActions: InviteActions;
}) {
  const {
    workspaceState,
    roomSettingsState,
    historyDefaultsState,
    appConfigState,
    appRuntimeState,
    localPreviewState,
    invitePanelState,
    shellLayout
  } = appState;
  const {
    selectedRoom,
    hasSelectedRoom,
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    selectedMessages,
    markdownSelectionMode,
    inspectorTab,
    secretWarningVisible,
    markdownCopyFallback,
    draft,
    pendingAttachments,
    activeBrowserUrl,
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
    roomGoal,
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
    terminalName,
    terminalCommand,
    terminalInput,
    terminalBusy,
    terminalError,
    roomTerminals,
    selectedTerminalId,
    toggleMarkdownSelectionMode,
    clearSelectedMessages,
    toggleMessageSelection
  } = selected;
  const {
    setChatMessageForRoom,
    setMarkdownCopyFallbackForRoom,
    setBrowserUrlForRoom,
    setProjectPathDraftForRoom,
    setInviteApprovalGateForRoom,
    setCustomCodexModelForRoom,
    updateSelectedGitWorkflowDraft
  } = roomActions;

  return useAppViewProps({
    shell: {
      sidebarCollapsed: shellLayout.sidebarCollapsed,
      inspectorCollapsed: shellLayout.inspectorCollapsed,
      shellStyle: shellLayout.shellStyle,
      onBeginSidebarResize: (event) => shellLayout.beginShellResize("sidebar", event),
      onBeginInspectorResize: (event) => shellLayout.beginShellResize("inspector", event),
      onToggleSidebarCollapsed: shellLayout.toggleSidebarCollapsed,
      onToggleInspectorCollapsed: shellLayout.toggleInspectorCollapsed
    },
    roomMainColumn: {
      teamRecords: workspaceState.teams,
      selectedTeam: workspaceState.selectedTeam,
      selectedRoom,
      localUser: localIdentity.localUser,
      hostBusy: selectedRuntime.hostBusy,
      isActiveHost: roomInteraction.isActiveHost,
      isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
      isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
      hasSelectedRoom,
      selectedCodexModel,
      selectedCodexReasoningEffort,
      selectedCodexSpeed,
      modelOptions: codexModelOptions,
      reasoningOptions: codexReasoningEffortOptions,
      speedOptions: codexSpeedOptions,
      settingsBusy: selectedRuntime.settingsBusy,
      selectedMessages,
      markdownSelectionMode,
      inspectorTab,
      roomHeaderActions: roomPanels.roomHeaderActions,
      onSetHost: hostHandoffActions.setRoomHost,
      onRenameRoom: roomRuntime.renameRoom,
      onSelectModel: roomRuntime.setCodexModel,
      onSelectReasoningEffort: roomRuntime.setCodexReasoningEffort,
      onSelectSpeed: roomRuntime.setCodexSpeed,
      onCopyRoomMarkdown: workspaceFlow.copyRoomMarkdown,
      onCopySelectedMarkdown: workspaceFlow.copySelectedMessagesMarkdown,
      onToggleMarkdownSelection: toggleMarkdownSelectionMode,
      onClearSelectedMessages: clearSelectedMessages,
      onShareLocalPreview: roomRuntime.openLocalPreviewDialog,
      notices: roomInteraction.roomNotices,
      secretWarningVisible,
      onAcknowledgeSecretWarning: roomInteraction.acknowledgeRoomVisibilityWarning,
      markdownCopyFallback,
      copyMarkdownWithFallback: workspaceFlow.copyMarkdownWithFallback,
      setChatMessageForRoom,
      setMarkdownCopyFallbackForRoom,
      messages: selectedRuntime.chatMessageRows,
      approvalVisible: selectedRuntime.approvalVisible,
      approvalSummary: selectedRuntime.codexApprovalSummaryDisplay,
      codexRunning: selectedRuntime.codexRunning,
      roomCanUseChat: selectedRuntime.roomCanUseChat,
      draft,
      replyTarget: selectedRuntime.replyTarget,
      roomGoal,
      pendingAttachmentsForCount: pendingAttachments,
      pendingAttachments: selectedRuntime.pendingAttachmentRows,
      queuedCodexTurns: selectedRuntime.queuedCodexTurnRows,
      localPreviewCards: selectedRuntime.localPreviewCards,
      pendingAttachmentSummary: selectedRuntime.pendingAttachmentSummary,
      onToggleMessageSelection: toggleMessageSelection,
      onRemovePendingAttachment: workspaceFlow.removePendingAttachment,
      onSendMessage: roomRuntime.sendMessage,
      roomChatPanelActions: roomPanels.roomChatPanelActions
    },
    roomInspectorPanel: {
      activeTab: inspectorTab,
      activeBrowserUrl,
      browserUrl,
      canHostBrowser: roomInteraction.canHostBrowser,
      onBrowserUrlChange: (url) => setBrowserUrlForRoom(selectedRoom.id, url),
      onOpenBrowserNow: roomRuntime.openRoomBrowserNow,
      selectedRoom,
      projectPathDraft,
      gitStatus,
      hasSelectedRoom,
      isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
      settingsBusy: selectedRuntime.settingsBusy,
      isActiveHost: roomInteraction.isActiveHost,
      defaultProjectPath,
      onProjectPathDraftChange: (path) => setProjectPathDraftForRoom(selectedRoom.id, path),
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
        onInviteApprovalGateChange: (enabled) => setInviteApprovalGateForRoom(selectedRoom.id, enabled),
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
      roomMode: {
        labels: roomModeLabels,
        onToggleMode: roomRuntime.toggleRoomMode
      },
      selectedCodexModel,
      selectedCodexReasoningEffort,
      selectedCodexSpeed,
      customCodexModel,
      model: {
        customModel: customCodexModel,
        modelOptions: codexModelOptions,
        reasoningOptions: codexReasoningEffortOptions,
        speedOptions: codexSpeedOptions,
        onSelectModel: roomRuntime.setCodexModel,
        onSelectReasoningEffort: roomRuntime.setCodexReasoningEffort,
        onSelectSpeed: roomRuntime.setCodexSpeed,
        onCustomModelChange: (model) => setCustomCodexModelForRoom(selectedRoom.id, model),
        onApplyCustomModel: () => roomRuntime.setCodexModel(customCodexModel)
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
          workspaceFlow.updateLocalHistorySettings({
            ...historyDefaultsState.historySettings,
            enabled
          }),
        onHistoryRetentionDaysChange: (retentionDays) =>
          workspaceFlow.updateLocalHistorySettings({
            ...historyDefaultsState.historySettings,
            retentionDays
          }),
        onClearRoomHistory: workspaceFlow.clearRoomHistory,
        onForgetRoomLocalData: workspaceFlow.forgetSelectedRoomLocalData,
        onApplyTeamDefaultsToRoom: workspaceFlow.applyTeamDefaultsToRoom,
        onTeamHistoryEnabledChange: (enabled) =>
          workspaceFlow.updateTeamHistoryDefaults({
            ...historyDefaultsState.teamHistorySettings,
            enabled
          }),
        onTeamHistoryRetentionDaysChange: (retentionDays) =>
          workspaceFlow.updateTeamHistoryDefaults({
            ...historyDefaultsState.teamHistorySettings,
            retentionDays
          }),
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
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
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
        onDraftChange: updateSelectedGitWorkflowDraft,
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
        terminalName,
        terminalCommand,
        terminalInput,
        terminalBusy,
        terminalError,
        terminalCommandRisks: roomDisplay.terminalCommandRisks,
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
        canRequestWorkspace: roomInteraction.canRequestWorkspace,
        ...roomPanels.terminalPanelActions
      }
    },
    appSidebar: {
      currentUser: githubAuth.currentUser,
      authBusy: githubAuth.authBusy,
      authConfig: githubAuth.authConfig,
      authError: githubAuth.authError,
      deviceFlow: githubAuth.deviceFlow,
      sidebarQuery: workspaceState.sidebarQuery,
      searchActive: roomDisplay.searchActive,
      workspaceError: workspaceState.workspaceError,
      newTeamName: workspaceState.newTeamName,
      newRoomName: workspaceState.newRoomName,
      newRoomProjectPath: workspaceState.newRoomProjectPath,
      selectedTeamId: workspaceState.selectedTeam,
      teams: roomDisplay.sidebarTeamRows,
      rooms: roomDisplay.sidebarRoomRows,
      messageHits: roomDisplay.sidebarMessageHitRows,
      historySearchBusy: appRuntimeState.historySearchBusy,
      activeSidebarPanel: workspaceState.activeSidebarPanel,
      themeMode: theme.themeMode,
      localUserName: localIdentity.localUser.name,
      selectedRoomName: selectedRoom.name,
      deviceId: localIdentity.deviceId,
      deviceIdentity: appRuntimeState.deviceIdentity,
      deviceIdentityMessage: appRuntimeState.deviceIdentityMessage,
      relayStatus: appRuntimeState.relayStatus,
      relayWsUrl: appConfigState.appConfig.relayWsUrl,
      relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
      codexProbe: appRuntimeState.codexProbe,
      projectPath: selectedRoom.projectPath,
      selectedCodexModel,
      selectedRoomApprovalPolicy: selectedRoom.approvalPolicy,
      roomPosture: roomInteraction.roomPosture,
      hasSelectedRoom,
      isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
      settingsBusy: selectedRuntime.settingsBusy,
      isActiveHost: roomInteraction.isActiveHost,
      relayHttpDraft: appConfigState.relayHttpDraft,
      relayWsDraft: appConfigState.relayWsDraft,
      selectedRoomMode: selectedRoom.mode,
      roomSettingsGateMessage: roomInteraction.roomSettingsGateMessage,
      historySettings: historyDefaultsState.historySettings,
      teamHistorySettings: historyDefaultsState.teamHistorySettings,
      teamDefaultApprovalPolicy: historyDefaultsState.teamDefaultApprovalPolicy,
      teamDefaultCodexModel: historyDefaultsState.teamDefaultCodexModel,
      teamDefaultBrowserProfilePersistent: historyDefaultsState.teamDefaultBrowserProfilePersistent,
      teamDefaultInviteApprovalGate: historyDefaultsState.teamDefaultInviteApprovalGate,
      appConfigMessage: appConfigState.appConfigMessage,
      roomSettingsMessage: settingsMessage,
      historyMessage: visibleHistoryMessage,
      onSignIn: githubAuth.beginGitHubSignIn,
      onSignOut: roomRuntime.signOut,
      onSidebarQueryChange: workspaceState.setSidebarQuery,
      onNewTeamNameChange: workspaceState.setNewTeamName,
      onCreateTeam: workspaceFlow.addTeam,
      onSelectTeam: workspaceState.setSelectedTeam,
      onNewRoomNameChange: workspaceState.setNewRoomName,
      onNewRoomProjectPathChange: workspaceState.setNewRoomProjectPath,
      onChooseNewRoomProjectPath: workspaceFlow.chooseNewRoomProjectPath,
      onCreateRoom: workspaceFlow.addRoom,
      onSelectRoom: workspaceState.setSelectedRoomId,
      onSelectSidebarPanel: workspaceState.setActiveSidebarPanel,
      onToggleTheme: theme.toggleThemeMode,
      onRotateDeviceIdentity: roomRuntime.rotateDeviceIdentity,
      onChooseProject: roomRuntime.chooseProjectPath,
      onRelayHttpDraftChange: appConfigState.setRelayHttpDraft,
      onRelayWsDraftChange: appConfigState.setRelayWsDraft,
      onResetRelay: appConfigState.resetRelayConfiguration,
      onSaveRelay: appConfigState.saveRelayConfiguration,
      onToggleRoomMode: roomRuntime.toggleRoomMode,
      onHistorySettingsChange: workspaceFlow.updateLocalHistorySettings,
      onClearRoomHistory: workspaceFlow.clearRoomHistory,
      onForgetRoomLocalData: workspaceFlow.forgetSelectedRoomLocalData,
      onTeamHistoryDefaultsChange: workspaceFlow.updateTeamHistoryDefaults,
      onTeamDefaultApprovalPolicyChange: workspaceFlow.updateTeamDefaultApprovalPolicy,
      onTeamDefaultCodexModelChange: workspaceFlow.updateTeamDefaultCodexModel,
      onTeamDefaultBrowserProfilePersistentChange: historyDefaultsState.setTeamDefaultBrowserProfilePersistent,
      onTeamDefaultInviteApprovalGateChange: workspaceFlow.updateTeamDefaultInviteApprovalGate,
      onApplyTeamDefaultsToRoom: workspaceFlow.applyTeamDefaultsToRoom,
      roomRecords: workspaceState.rooms
    },
    localPreviewDialog: {
      localPreviewDialog: localPreviewState.localPreviewDialog,
      closeLocalPreviewDialog: localPreviewState.closeLocalPreviewDialog,
      setLocalPreviewDialogSelectedUrl: localPreviewState.setLocalPreviewDialogSelectedUrl,
      setLocalPreviewDialogManualUrl: localPreviewState.setLocalPreviewDialogManualUrl,
      setLocalPreviewDialogPhase: localPreviewState.setLocalPreviewDialogPhase,
      localPreviewBusy: selectedRuntime.localPreviewBusy,
      prepareLocalPreviewConfirmation: roomRuntime.prepareLocalPreviewConfirmation,
      confirmLocalPreviewShare: roomRuntime.confirmLocalPreviewShare
    }
  });
}
