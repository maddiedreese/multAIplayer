import { useAppStore } from "../store/appStore";
import type { RoomInspectorCapabilities, RoomInspectorSources } from "../components/RoomInspectorContainer";
import type { RoomMainColumnCapabilities, RoomMainColumnSources } from "../components/RoomMainColumnContainer";
import type {
  SidebarDrawerCapabilities,
  SidebarNavigationCapabilities,
  SidebarSources
} from "../components/SidebarContainers";

export function buildRoomInspectorCapabilities(sources: RoomInspectorSources): RoomInspectorCapabilities {
  return {
    browser: { openNow: sources.roomRuntime.openRoomBrowserNow },
    project: { choosePath: sources.roomRuntime.chooseProjectPath, updatePath: sources.roomRuntime.updateProjectPath },
    teamRoster: {
      onPromote: (member) => sources.workspaceFlow.changeTeamMemberRole(member, "admin"),
      onDemote: (member) => sources.workspaceFlow.changeTeamMemberRole(member, "member"),
      onTransferOwnership: sources.workspaceFlow.transferOwnershipToTeamMember,
      onRemove: sources.workspaceFlow.removeMemberFromTeam
    },
    roomMembers: {
      onCopyFingerprint: (member) => sources.workspaceFlow.copyRoomMemberDeviceFingerprint(member, member.trusted),
      onTrust: sources.workspaceFlow.trustRoomMemberDevice,
      onUntrust: sources.workspaceFlow.untrustRoomMemberDevice
    },
    hostHandoff: { accept: sources.hostHandoff.acceptHostHandoff },
    invite: {
      onCopyInvite: sources.inviteActions.copyInviteLink,
      onImportInvite: sources.inviteActions.joinInviteSecret,
      onDecideInviteRequest: sources.inviteActions.decideInviteJoinRequest
    },
    settings: {
      selectApprovalPolicy: sources.roomRuntime.setApprovalPolicy,
      selectApprovalDelegationPolicy: sources.roomRuntime.setApprovalDelegationPolicy,
      selectSandboxLevel: sources.roomRuntime.setCodexSandboxLevel,
      selectModel: sources.roomRuntime.setCodexModel,
      selectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
      setRawReasoningEnabled: sources.roomRuntime.setCodexRawReasoningEnabled,
      selectSpeed: sources.roomRuntime.setCodexSpeed
    },
    history: {
      onHistoryEnabledChange: (enabled) =>
        sources.workspaceFlow.updateLocalHistorySettings({ ...useAppStore.getState().historySettings, enabled }),
      onHistoryRetentionDaysChange: (retentionDays) =>
        sources.workspaceFlow.updateLocalHistorySettings({ ...useAppStore.getState().historySettings, retentionDays }),
      onClearRoomHistory: sources.workspaceFlow.clearRoomHistory,
      onForgetRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
      onApplyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom,
      onRetryHistoryHydration: () => {
        const { selectedRoomId, retryHistoryHydrationForRoom } = useAppStore.getState();
        if (selectedRoomId) retryHistoryHydrationForRoom(selectedRoomId);
      },
      onTeamHistoryEnabledChange: (enabled) =>
        sources.workspaceFlow.updateTeamHistoryDefaults({ ...useAppStore.getState().teamHistorySettings, enabled }),
      onTeamHistoryRetentionDaysChange: (retentionDays) =>
        sources.workspaceFlow.updateTeamHistoryDefaults({
          ...useAppStore.getState().teamHistorySettings,
          retentionDays
        }),
      onTeamDefaultApprovalPolicyChange: sources.workspaceFlow.updateTeamDefaultApprovalPolicy,
      onTeamDefaultCodexModelChange: sources.workspaceFlow.updateTeamDefaultCodexModel,
      onTeamDefaultInviteApprovalGateChange: sources.workspaceFlow.updateTeamDefaultInviteApprovalGate
    },
    workspaceFiles: sources.roomPanels.workspaceFilesPanelActions,
    git: {
      onCopyPullRequestDraftMarkdown: sources.workspaceFlow.copyPullRequestDraftMarkdown,
      onApproveGitWorkflow: sources.roomRuntime.approveGitWorkflow
    },
    github: { refresh: sources.roomRuntime.refreshGitHubActions },
    terminal: sources.roomPanels.terminalPanelActions
  };
}

export function buildRoomMainColumnCapabilities(sources: RoomMainColumnSources): RoomMainColumnCapabilities {
  return {
    header: {
      onSetHost: sources.hostHandoff.setRoomHost,
      onRenameRoom: sources.roomRuntime.renameRoom,
      onSelectModel: sources.roomRuntime.setCodexModel,
      onSelectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
      onSelectSpeed: sources.roomRuntime.setCodexSpeed,
      onCopyRoomMarkdown: sources.workspaceFlow.copyRoomMarkdown,
      onCopySelectedMarkdown: sources.workspaceFlow.copySelectedMessagesMarkdown,
      onShareLocalPreview: sources.roomRuntime.openLocalPreviewDialog,
      onOpenRoomBrowser: sources.roomRuntime.openRoomBrowserNow
    },
    chat: {
      ...sources.chatActions,
      onRemovePendingAttachment: sources.workspaceFlow.removePendingAttachment,
      onSendMessage: sources.roomRuntime.sendMessage
    },
    retryMarkdownCopy: (title, markdown, roomId) => {
      void sources.workspaceFlow.copyMarkdownWithFallback(
        title,
        markdown,
        (message) => useAppStore.getState().setChatMessageForRoom(roomId, message),
        roomId
      );
    }
  };
}

export function buildSidebarNavigationCapabilities(sources: SidebarSources): SidebarNavigationCapabilities {
  return {
    signIn: sources.githubAuth.beginGitHubSignIn,
    signOut: sources.roomRuntime.signOut,
    createTeam: sources.workspaceFlow.addTeam,
    chooseNewRoomProjectPath: sources.workspaceFlow.chooseNewRoomProjectPath,
    createRoom: sources.workspaceFlow.addRoom,
    setTeamLifecycle: sources.workspaceFlow.setTeamLifecycle,
    setRoomLifecycle: sources.workspaceFlow.setRoomLifecycle
  };
}

export function buildSidebarDrawerCapabilities(sources: SidebarSources): SidebarDrawerCapabilities {
  return {
    signIn: sources.githubAuth.beginGitHubSignIn,
    signOut: sources.roomRuntime.signOut,
    rotateDeviceIdentity: sources.roomRuntime.rotateDeviceIdentity,
    clearDeletedHostedAccount: sources.githubAuth.clearDeletedHostedAccount,
    chooseProject: sources.roomRuntime.chooseProjectPath,
    updateLocalHistorySettings: sources.workspaceFlow.updateLocalHistorySettings,
    clearRoomHistory: sources.workspaceFlow.clearRoomHistory,
    forgetSelectedRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
    updateTeamHistoryDefaults: sources.workspaceFlow.updateTeamHistoryDefaults,
    updateTeamDefaultApprovalPolicy: sources.workspaceFlow.updateTeamDefaultApprovalPolicy,
    updateTeamDefaultCodexModel: sources.workspaceFlow.updateTeamDefaultCodexModel,
    updateTeamDefaultInviteApprovalGate: sources.workspaceFlow.updateTeamDefaultInviteApprovalGate,
    applyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom
  };
}
