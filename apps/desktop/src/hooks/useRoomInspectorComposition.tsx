import React, { useMemo } from "react";
import { codexModelOptions, codexSandboxLevelOptions, defaultCodexModel } from "@multaiplayer/protocol";
import { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import { RoomInspectorPanel } from "../components/RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";
import { canStageRoomChatAttachment } from "../lib/chat/chatPolicy";
import { formatBytes, formatCodexModel, formatTimestamp } from "../lib/formatting/appFormatters";
import { resolveFilePreviewTab } from "../lib/files/filePreview";
import { resolveGitWorkflowDraft, type GitWorkflowDraft } from "../lib/git/gitWorkflowDraft";
import { defaultProjectPath } from "../lib/platform/localBackend";
import { buildRoomMemberRows, buildTeamMemberRows } from "../presentation/roster/rosterDisplayRows";
import { canControlRoomTerminal } from "../lib/terminal/terminalAccess";
import { buildRoomInspectorModelProjection } from "../presentation/rooms/roomInspectorModelProjection";
import { useFileTerminalDisplay } from "./useFileTerminalDisplay";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useLocalIdentity } from "./useLocalIdentity";
import { useRoomAccess } from "./useRoomAccess";
import { approvalPolicyLabels, defaultBrowserUrl } from "../appDefaults";
import { useAppStore, type AppStoreState } from "../store/appStore";
import type { RoomInspectorSources } from "./roomInspectorCompositionTypes";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
export type { RoomInspectorSources } from "./roomInspectorCompositionTypes";

const emptyBrowser = {} as NonNullable<AppStoreState["browserByRoom"][string]>;
const emptyCodexRuntime = {} as NonNullable<AppStoreState["codexRuntimeByRoom"][string]>;
const emptyFilePanel = {} as NonNullable<AppStoreState["filePanelByRoom"][string]>;
const emptyGitRuntime = {} as NonNullable<AppStoreState["gitWorkflowRuntimeByRoom"][string]>;
const emptyInvite = {} as NonNullable<AppStoreState["inviteByRoom"][string]>;
const emptyRoomSettings = {} as NonNullable<AppStoreState["roomSettingsByRoom"][string]>;
const emptyTerminal = {} as NonNullable<AppStoreState["terminalRuntimeByRoom"][string]>;

export function useRoomInspectorComposition({
  sources,
  selectedRoom
}: {
  sources: RoomInspectorSources;
  selectedRoom: ClientRoomRecord;
}) {
  const roomId = selectedRoom.id;
  const currentUser = useAppStore((state) => state.currentUser);
  const authConfig = useAppStore((state) => state.authConfig);
  const hasSelectedRoom = useAppStore((state) => state.selectedRoomId != null);
  const selectedTeamId = useAppStore((state) => state.selectedTeam);
  const selectedTeam = useAppStore((state) => state.teams.find((team) => team.id === state.selectedTeam) ?? null);
  const browser = useAppStore((state) => state.browserByRoom[roomId] ?? emptyBrowser);
  const codexRuntime = useAppStore((state) => state.codexRuntimeByRoom[roomId] ?? emptyCodexRuntime);
  const filePanel = useAppStore((state) => state.filePanelByRoom[roomId] ?? emptyFilePanel);
  const gitRuntime = useAppStore((state) => state.gitWorkflowRuntimeByRoom[roomId] ?? emptyGitRuntime);
  const invite = useAppStore((state) => state.inviteByRoom[roomId] ?? emptyInvite);
  const roomSettings = useAppStore((state) => state.roomSettingsByRoom[roomId] ?? emptyRoomSettings);
  const terminal = useAppStore((state) => state.terminalRuntimeByRoom[roomId] ?? emptyTerminal);
  const terminals = useAppStore((state) => state.terminals);
  const teamRoster = useAppStore((state) => state.teamRosterByTeam[state.selectedTeam]);
  const presence = useAppStore((state) => state.historyPresenceByRoom[roomId]?.presence);
  const inspectorTab = useAppStore((state) => state.historyPresenceByRoom[roomId]?.inspectorTab ?? "files");
  const historyMessage = useAppStore((state) => state.historyPresenceByRoom[roomId]?.historyMessage ?? null);
  const historyHydrationStatus = useAppStore(
    (state) => state.historyPresenceByRoom[roomId]?.historyHydrationStatus ?? null
  );
  const teamHistoryMessage = useAppStore(
    (state) => state.teamHistoryByTeam[state.selectedTeam || "__no-team"]?.message ?? null
  );
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const deviceIdentity = useAppStore((state) => state.deviceIdentity);
  const deviceIdentityMessage = useAppStore((state) => state.deviceIdentityMessage);
  const trustedDeviceKeys = useAppStore((state) => state.trustedDeviceKeys);
  const forgottenRoomIds = useAppStore((state) => state.forgottenRoomIds);
  const revokedRoomIds = useAppStore((state) => state.revokedRoomIds);
  const revokedTeamIds = useAppStore((state) => state.revokedTeamIds);
  const historySettings = useAppStore((state) => state.historySettings);
  const teamHistorySettings = useAppStore((state) => state.teamHistorySettings);
  const teamDefaultApprovalPolicy = useAppStore((state) => state.teamDefaultApprovalPolicy);
  const teamDefaultCodexModel = useAppStore((state) => state.teamDefaultCodexModel);
  const teamDefaultInviteApprovalGate = useAppStore((state) => state.teamDefaultInviteApprovalGate);
  const codexProbe = useAppStore((state) => state.codexProbe);
  const inviteSecretInput = useAppStore((state) => state.inviteSecretInput);
  const {
    setBrowserUrlForRoom,
    selectBrowserTabForRoom,
    closeBrowserTabForRoom,
    setProjectPathDraftForRoom,
    setInviteSecretInputValue,
    setCustomCodexModelForRoom,
    editGitWorkflowDraftForRoom,
    setFileQueryForRoom,
    setFilePreviewTabForRoom,
    setSelectedTerminalIdForRoom
  } = useAppStore.getState();

  const { deviceId, localUser } = useLocalIdentity(currentUser);
  const access = useRoomAccess({
    hasSelectedRoom,
    selectedRoom,
    localUser,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    inviteApprovalGate: valueOr(invite.approvalGate, true)
  });
  const model = buildRoomInspectorModelProjection(selectedRoom, codexProbe, roomSettings.customCodexModel);
  const projectPathDraft = valueOr(roomSettings.projectPathDraft, selectedRoom.projectPath);
  const selectedTerminalId = valueOr(terminal.selectedTerminalId, null);
  const roomTerminals = useMemo(
    () => terminals.filter((item) => item.roomId === selectedRoom.id),
    [selectedRoom.id, terminals]
  );
  const selectedTerminal = valueOr(
    roomTerminals.find((item) => item.id === selectedTerminalId),
    null
  );
  const terminalRequests = valueOr(terminal.requests, []);
  const fileDisplay = useFileTerminalDisplay({
    selectedFile: valueOr(filePanel.selectedFile, null),
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    sensitiveAttachmentReviewKey,
    selectedTerminal,
    terminalLines: valueOr(terminal.lines, []),
    terminalRequests,
    codexEvents: valueOr(codexRuntime.events, [])
  });
  const gitWorkflowDraft = resolveGitWorkflowDraft(
    workflowDraftByRoom(selectedRoom.id, gitRuntime.workflow?.draft),
    selectedRoom.id
  );
  const github = useGitHubWorkflowState({
    actionRuns: valueOr(gitRuntime.actions?.runs, []),
    authConfig,
    currentUser,
    gitWorkflowDraft,
    projectPath: selectedRoom.projectPath
  });
  const teamMemberRows = useMemo(
    () =>
      buildTeamMemberRows({
        members: teamRoster?.members ?? [],
        team: selectedTeam,
        currentUser,
        localUserId: localUser.id
      }),
    [currentUser, localUser.id, selectedTeam, teamRoster?.members]
  );
  const roomMemberRows = useMemo(
    () =>
      buildRoomMemberRows({
        presence: presence ?? {},
        room: selectedRoom,
        localUser,
        localDeviceId: deviceId,
        ...(deviceIdentity?.publicKeyFingerprint
          ? { localPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint }
          : {}),
        trustedDeviceKeys
      }),
    [deviceId, deviceIdentity?.publicKeyFingerprint, localUser, presence, selectedRoom, trustedDeviceKeys]
  );
  const gitStatus = valueOr(gitRuntime.workflow?.status, null);
  const settingsBusy = Boolean(roomSettings.settingsBusy);
  const hostBusy = Boolean(roomSettings.hostBusy);
  const filePreviewTab = resolveFilePreviewTab(
    valueOr(filePanel.previewTab, "file"),
    Boolean(filePanel.selectedDiff?.diff.trim())
  );
  const projectControlState = inspectorProjectControlState(
    hasSelectedRoom,
    access.isSelectedRoomLocked,
    settingsBusy,
    access.isActiveHost,
    projectPathDraft,
    selectedRoom.projectPath
  );
  const settingsDisabled = inspectorSettingsDisabled(
    hasSelectedRoom,
    access.isSelectedRoomLocked,
    settingsBusy,
    access.isActiveHost
  );
  function composeWorkspaceFilesProps() {
    return {
      fileQuery: filePanel.query ?? "",
      projectFiles: filePanel.projectFiles ?? [],
      selectedFile: filePanel.selectedFile ?? null,
      gitStatus,
      selectedDiff: filePanel.selectedDiff ?? null,
      fileBusy: Boolean(filePanel.busy),
      fileMessage: filePanel.message ?? null,
      fileSaveRequests: filePanel.saveRequests ?? [],
      canReadLocalWorkspace: access.canReadLocalWorkspace,
      isActiveHost: access.isActiveHost,
      canAttachSelectedFile: canStageRoomChatAttachment(selectedRoom, access.isSelectedRoomLocked),
      selectedFileRisks: fileDisplay.selectedFileRisks,
      selectedFileNeedsAttachmentReview: fileDisplay.selectedFileNeedsAttachmentReview,
      selectedSensitiveFileReviewed: fileDisplay.selectedSensitiveFileReviewed,
      selectedAttachmentActionLabel: fileDisplay.selectedAttachmentReview?.actionLabel ?? "Attach",
      ...(fileDisplay.selectedAttachmentReview?.warningDetail
        ? { selectedAttachmentWarningDetail: fileDisplay.selectedAttachmentReview.warningDetail }
        : {}),
      filePreviewTab,
      formatBytes,
      ...sources.roomPanels.workspaceFilesPanelActions,
      onFileQueryChange: (query: string) => setFileQueryForRoom(selectedRoom.id, query),
      onFilePreviewTabChange: (tab: "file" | "diff") => setFilePreviewTabForRoom(selectedRoom.id, tab)
    };
  }
  function composeGithubActionsProps() {
    return {
      summary: github.actionsSummary,
      readiness: github.githubActionsReadiness,
      runs: gitRuntime.actions?.runs ?? [],
      owner: gitWorkflowDraft.prOwner,
      repo: gitWorkflowDraft.prRepo,
      branch: gitWorkflowDraft.branchName,
      lastChecked: gitRuntime.actions?.lastChecked ?? null,
      busy: Boolean(gitRuntime.actions?.busy),
      refreshDisabled:
        !access.canReadLocalWorkspace ||
        Boolean(gitRuntime.actions?.busy) ||
        !access.isActiveHost ||
        !github.githubActionsReadiness.ready,
      currentUserSignedIn: Boolean(currentUser),
      message: gitRuntime.actions?.message ?? null,
      formatTimestamp,
      onRefresh: sources.roomRuntime.refreshGitHubActions
    };
  }
  function composeCommonWorkProps(): Omit<React.ComponentProps<typeof RoomInspectorWorkPanel>, "activeTab"> {
    return {
      project: {
        projectPath: selectedRoom.projectPath,
        projectPathDraft,
        branchLabel: gitStatus?.branch ?? "loading",
        ...projectControlState,
        onProjectPathDraftChange: (path) => setProjectPathDraftForRoom(selectedRoom.id, path, selectedRoom.projectPath),
        onChooseProjectPath: sources.roomRuntime.chooseProjectPath,
        onUseDefaultProjectPath: () =>
          setProjectPathDraftForRoom(selectedRoom.id, defaultProjectPath, selectedRoom.projectPath),
        onUpdateProjectPath: sources.roomRuntime.updateProjectPath
      },
      teamRoster: composeTeamRosterProps(),
      roomMembers: {
        members: roomMemberRows,
        localDeviceId: deviceId,
        message: deviceIdentityMessage,
        onCopyFingerprint: (member) => sources.workspaceFlow.copyRoomMemberDeviceFingerprint(member, member.trusted),
        onTrust: sources.workspaceFlow.trustRoomMemberDevice,
        onUntrust: sources.workspaceFlow.untrustRoomMemberDevice
      },
      hostHandoff: composeHostHandoffProps(),
      encryptedInvite: composeEncryptedInviteProps(),
      approvalPolicy: {
        labels: approvalPolicyLabels,
        sandboxOptions: codexSandboxLevelOptions,
        message: roomSettings.settingsMessage ?? null,
        selectedPolicy: selectedRoom.approvalPolicy,
        selectedSandboxLevel: model.selectedSandboxLevel,
        disabled: settingsDisabled,
        onSelectPolicy: sources.roomRuntime.setApprovalPolicy,
        onSelectSandboxLevel: sources.roomRuntime.setCodexSandboxLevel
      },
      model: {
        customModel: model.customModel,
        modelOptions: model.modelOptions,
        reasoningOptions: model.reasoningOptions,
        speedOptions: model.speedOptions,
        selectedModel: model.selectedModel,
        selectedModelLabel: formatCodexModel(model.selectedModel),
        selectedReasoningEffort: model.selectedReasoningEffort,
        rawReasoningEnabled: model.rawReasoningEnabled,
        selectedSpeed: model.selectedSpeed,
        disabled: settingsDisabled,
        canApplyCustomModel: Boolean(model.customModel.trim()) && model.customModel.trim() !== model.selectedModel,
        onSelectModel: sources.roomRuntime.setCodexModel,
        onSelectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
        onRawReasoningEnabledChange: sources.roomRuntime.setCodexRawReasoningEnabled,
        onSelectSpeed: sources.roomRuntime.setCodexSpeed,
        onCustomModelChange: (value) => setCustomCodexModelForRoom(selectedRoom.id, value, model.selectedModel),
        onApplyCustomModel: () => sources.roomRuntime.setCodexModel(model.customModel)
      },
      codexRuntime: { roomId: selectedRoom.id, projectPath: selectedRoom.projectPath },
      localHistory: {
        historySettings,
        teamHistorySettings,
        selectedTeam: Boolean(selectedTeamId),
        hasSelectedRoom,
        settingsBusy,
        teamDefaultApprovalPolicy,
        approvalPolicyLabels,
        teamDefaultCodexModel,
        defaultCodexModel,
        codexModelOptions,
        teamDefaultInviteApprovalGate,
        message: historyMessage ?? teamHistoryMessage,
        hydrationStatus: historyHydrationStatus,
        onHistoryEnabledChange: (enabled) =>
          sources.workspaceFlow.updateLocalHistorySettings({ ...useAppStore.getState().historySettings, enabled }),
        onHistoryRetentionDaysChange: (retentionDays) =>
          sources.workspaceFlow.updateLocalHistorySettings({
            ...useAppStore.getState().historySettings,
            retentionDays
          }),
        onClearRoomHistory: sources.workspaceFlow.clearRoomHistory,
        onForgetRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
        onApplyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom,
        onRetryHistoryHydration: () => {
          const { selectedRoomId, retryHistoryHydrationForRoom } = useAppStore.getState();
          if (selectedRoomId) retryHistoryHydrationForRoom(selectedRoomId);
        },
        onTeamHistoryEnabledChange: (enabled) =>
          sources.workspaceFlow.updateTeamHistoryDefaults({
            ...useAppStore.getState().teamHistorySettings,
            enabled
          }),
        onTeamHistoryRetentionDaysChange: (retentionDays) =>
          sources.workspaceFlow.updateTeamHistoryDefaults({
            ...useAppStore.getState().teamHistorySettings,
            retentionDays
          }),
        onTeamDefaultApprovalPolicyChange: sources.workspaceFlow.updateTeamDefaultApprovalPolicy,
        onTeamDefaultCodexModelChange: sources.workspaceFlow.updateTeamDefaultCodexModel,
        onTeamDefaultInviteApprovalGateChange: sources.workspaceFlow.updateTeamDefaultInviteApprovalGate
      },
      workspaceFiles: composeWorkspaceFilesProps(),
      gitHandoff: {
        draft: gitWorkflowDraft,
        preview: github.gitApprovalPreview,
        readiness: github.githubWorkflowReadiness,
        canReadLocalWorkspace: access.canReadLocalWorkspace,
        gitWorkflowBusy: Boolean(gitRuntime.workflow?.busy),
        isActiveHost: access.isActiveHost,
        message: gitRuntime.workflow?.message ?? null,
        onDraftChange: (patch) => editGitWorkflowDraftForRoom(selectedRoom.id, patch),
        onCopyPullRequestDraftMarkdown: sources.workspaceFlow.copyPullRequestDraftMarkdown,
        onApproveGitWorkflow: sources.roomRuntime.approveGitWorkflow
      },
      githubActions: composeGithubActionsProps(),
      terminal: {
        terminalBusy: Boolean(terminal.busy),
        terminalError: terminal.ui?.error ?? null,
        terminalRisks: fileDisplay.terminalRisks,
        codexEvents: fileDisplay.codexEventRows,
        commandRequests: fileDisplay.terminalRequestRows,
        roomTerminals,
        selectedTerminal,
        selectedTerminalId,
        selectedTerminalCanControl: canControlRoomTerminal(
          selectedRoom,
          localUser,
          selectedTerminal,
          access.isSelectedRoomLocked
        ),
        selectedTerminalCanRestart: Boolean(selectedTerminal && !selectedTerminal.running),
        codexRunning: Boolean(codexRuntime.running),
        canReadLocalWorkspace: access.canReadLocalWorkspace,
        canApproveTerminal: access.canReadLocalWorkspace && access.isActiveHost,
        ...sources.roomPanels.terminalPanelActions,
        onSelectTerminal: (terminalId) => setSelectedTerminalIdForRoom(selectedRoom.id, terminalId)
      }
    };
  }

  function composeTeamRosterProps() {
    return {
      members: teamMemberRows,
      hasSelectedTeam: Boolean(selectedTeamId),
      busy: Boolean(teamRoster?.busy),
      message: teamRoster?.message ?? null,
      onPromote: (member: Parameters<typeof sources.workspaceFlow.changeTeamMemberRole>[0]) =>
        sources.workspaceFlow.changeTeamMemberRole(member, "admin"),
      onDemote: (member: Parameters<typeof sources.workspaceFlow.changeTeamMemberRole>[0]) =>
        sources.workspaceFlow.changeTeamMemberRole(member, "member"),
      onTransferOwnership: sources.workspaceFlow.transferOwnershipToTeamMember,
      onRemove: sources.workspaceFlow.removeMemberFromTeam
    };
  }

  function composeHostHandoffProps() {
    return {
      handoffs: codexRuntime.hostHandoffs ?? [],
      acceptDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || hostBusy,
      patchApplyDisabled: !access.isActiveHost,
      onAcceptHandoff: sources.hostHandoff.acceptHostHandoff,
      formatModel: formatCodexModel
    };
  }

  function composeEncryptedInviteProps() {
    return {
      copyDisabled: !access.canCopyRoomInvite,
      inviteSecretInput,
      inviteRequests: invite.requests ?? [],
      localDeviceId: deviceId,
      importDisabled: !inviteSecretInput.trim(),
      approvalDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || !access.isActiveHost,
      inviteLink: invite.link ?? "",
      inviteMessage: invite.message ?? null,
      onCopyInvite: sources.inviteActions.copyInviteLink,
      onImportInvite: sources.inviteActions.joinInviteSecret,
      onDecideInviteRequest: sources.inviteActions.decideInviteJoinRequest,
      onInviteSecretInputChange: setInviteSecretInputValue
    };
  }
  const commonWorkProps = composeCommonWorkProps();
  const browserProps: React.ComponentProps<typeof BrowserAccessPanel> = {
    hidden: false,
    roomId: selectedRoom.id,
    projectPath: selectedRoom.projectPath,
    activeBrowserUrl: firstPresent(browser.tabs?.find((tab) => tab.id === browser.activeTabId)?.url, browser.activeUrl),
    browserTabs: valueOr(browser.tabs, []),
    browserRequests: valueOr(browser.requests, []),
    browserMessage: valueOr(browser.message, null),
    activeBrowserTabId: valueOr(browser.activeTabId, null),
    browserUrl: valueOr(browser.url, defaultBrowserUrl),
    canHostBrowser: access.canHostBrowser,
    onBrowserUrlChange: (url) => setBrowserUrlForRoom(selectedRoom.id, url, defaultBrowserUrl),
    onOpenBrowserNow: sources.roomRuntime.openRoomBrowserNow,
    onApproveBrowserRequest: sources.roomRuntime.approveBrowserRequest,
    onDenyBrowserRequest: sources.roomRuntime.denyBrowserRequest,
    onOpenApprovedBrowserRequest: sources.roomRuntime.openApprovedBrowserRequest,
    onSelectBrowserTab: (tabId) => selectBrowserTabForRoom(selectedRoom.id, tabId),
    onCloseBrowserTab: (tabId) => closeBrowserTabForRoom(selectedRoom.id, tabId)
  };

  return (
    <RoomInspectorPanel
      activeTab={inspectorTab}
      browserPanel={<BrowserAccessPanel {...browserProps} />}
      filesPanel={<RoomInspectorWorkPanel activeTab="files" {...commonWorkProps} />}
      terminalPanel={<RoomInspectorWorkPanel activeTab="terminal" {...commonWorkProps} />}
      roomPanel={<RoomInspectorWorkPanel activeTab="room" {...commonWorkProps} />}
    />
  );
}

function inspectorSettingsDisabled(
  hasSelectedRoom: boolean,
  roomLocked: boolean,
  settingsBusy: boolean,
  isActiveHost: boolean
) {
  return !hasSelectedRoom || roomLocked || settingsBusy || !isActiveHost;
}

function inspectorProjectControlState(
  hasSelectedRoom: boolean,
  roomLocked: boolean,
  settingsBusy: boolean,
  isActiveHost: boolean,
  projectPathDraft: string,
  projectPath: string
) {
  const disabled = !hasSelectedRoom || roomLocked || settingsBusy || !isActiveHost;
  return {
    disabled,
    attachDisabled: disabled || !projectPathDraft.trim() || projectPathDraft.trim() === projectPath
  };
}

function workflowDraftByRoom(roomId: string, draft: Partial<GitWorkflowDraft> | undefined) {
  return draft ? { [roomId]: draft } : {};
}

function valueOr<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

function firstPresent<T>(...values: Array<T | null | undefined>): T | null {
  return values.find((value): value is T => value != null) ?? null;
}
