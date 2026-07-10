import React, { useMemo, type ComponentProps } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  codexModelOptions,
  codexSandboxLevelOptions,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed
} from "@multaiplayer/protocol";
import { BrowserAccessPanel } from "./BrowserAccessPanel";
import { RoomInspectorPanel } from "./RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "./RoomInspectorWorkPanel";
import { canStageRoomChatAttachment } from "../lib/chatPolicy";
import { formatBytes, formatCodexModel, formatTimestamp } from "../lib/appFormatters";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../lib/codexCatalogResolver";
import { resolveFilePreviewTab } from "../lib/filePreview";
import { resolveGitWorkflowDraft } from "../lib/gitWorkflowDraft";
import { defaultProjectPath } from "../lib/localBackend";
import { buildRoomMemberRows, buildTeamMemberRows } from "../lib/rosterDisplayRows";
import { canControlRoomTerminal } from "../lib/terminalAccess";
import { useFileTerminalDisplay } from "../hooks/useFileTerminalDisplay";
import { useGitHubWorkflowState } from "../hooks/useGitHubWorkflowState";
import { useLocalIdentity } from "../hooks/useLocalIdentity";
import { useRoomAccess } from "../hooks/useRoomAccess";
import { approvalDelegationPolicyLabels, approvalPolicyLabels, defaultBrowserUrl, emptyRoom } from "../seedData";
import { useAppStore } from "../store/appStore";
import type { BrowserRoomState } from "../store/slices/browserSlice";
import type { CodexRuntimeRoomState } from "../store/slices/codexHostHandoffSlice";
import type { FilePanelRoomState } from "../store/slices/filePanelSlice";
import type { GitWorkflowRuntimeRoomState } from "../store/slices/gitWorkflowSlice";
import type { InviteRoomState } from "../store/slices/inviteSlice";
import type { RoomSettingsRoomState } from "../store/slices/roomSettingsSlice";
import type { TerminalRoomState } from "../store/slices/terminalSlice";
import type { createAppRoomPanelActions } from "../lib/appRoomPanelActions";
import type { useAppHostHandoffActions } from "../hooks/useAppHostHandoffActions";
import type { useAppInviteActions } from "../hooks/useAppInviteActions";
import type { useRoomRuntimeContext } from "../hooks/useRoomRuntimeContext";
import type { useWorkspaceFlowContext } from "../hooks/useWorkspaceFlowContext";

type WorkProps = ComponentProps<typeof RoomInspectorWorkPanel>;
type WorkspaceFileActions = Pick<
  WorkProps["workspaceFiles"],
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
  WorkProps["terminal"],
  | "onCopyMarkdown"
  | "onOpenInteractiveTerminal"
  | "onApproveTerminalRequest"
  | "onDenyTerminalRequest"
  | "onSendTerminalData"
  | "onRestartTerminal"
  | "onStopTerminal"
>;

export interface RoomInspectorCapabilities {
  browser: { openNow: () => void };
  project: { choosePath: () => void; updatePath: () => void };
  teamRoster: Pick<WorkProps["teamRoster"], "onPromote" | "onDemote" | "onTransferOwnership" | "onRemove">;
  roomMembers: Pick<WorkProps["roomMembers"], "onCopyFingerprint" | "onTrust" | "onUntrust">;
  hostHandoff: { accept: WorkProps["hostHandoff"]["onAcceptHandoff"] };
  invite: Pick<
    WorkProps["encryptedInvite"],
    "onCopyInvite" | "onImportInvite" | "onRotateRoomKey" | "onDecideInviteRequest"
  >;
  settings: {
    selectApprovalPolicy: WorkProps["approvalPolicy"]["onSelectPolicy"];
    selectApprovalDelegationPolicy: WorkProps["approvalPolicy"]["onSelectDelegationPolicy"];
    selectSandboxLevel: WorkProps["approvalPolicy"]["onSelectSandboxLevel"];
    selectModel: WorkProps["model"]["onSelectModel"];
    selectReasoningEffort: WorkProps["model"]["onSelectReasoningEffort"];
    selectSpeed: WorkProps["model"]["onSelectSpeed"];
  };
  history: Pick<
    WorkProps["localHistory"],
    | "onHistoryEnabledChange"
    | "onHistoryRetentionDaysChange"
    | "onClearRoomHistory"
    | "onForgetRoomLocalData"
    | "onApplyTeamDefaultsToRoom"
    | "onTeamHistoryEnabledChange"
    | "onTeamHistoryRetentionDaysChange"
    | "onTeamDefaultApprovalPolicyChange"
    | "onTeamDefaultCodexModelChange"
    | "onTeamDefaultInviteApprovalGateChange"
  >;
  workspaceFiles: WorkspaceFileActions;
  git: Pick<WorkProps["gitHandoff"], "onCopyPullRequestDraftMarkdown" | "onApproveGitWorkflow">;
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
  inviteActions: Pick<
    InviteActions,
    "copyInviteLink" | "joinInviteSecret" | "rotateSelectedRoomKey" | "decideInviteJoinRequest"
  >;
  roomPanels: Pick<RoomPanels, "workspaceFilesPanelActions" | "terminalPanelActions">;
}

const emptyBrowser: BrowserRoomState = {};
const emptyCodexRuntime: CodexRuntimeRoomState = {};
const emptyFilePanel: FilePanelRoomState = {};
const emptyGitRuntime: GitWorkflowRuntimeRoomState = {};
const emptyInvite: InviteRoomState = {};
const emptyRoomSettings: RoomSettingsRoomState = {};
const emptyTerminal: TerminalRoomState = {};

export function RoomInspectorContainer({ sources }: { sources: RoomInspectorSources }) {
  const capabilities = useMemo<RoomInspectorCapabilities>(
    () => ({
      browser: { openNow: sources.roomRuntime.openRoomBrowserNow },
      project: {
        choosePath: sources.roomRuntime.chooseProjectPath,
        updatePath: sources.roomRuntime.updateProjectPath
      },
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
        onRotateRoomKey: sources.inviteActions.rotateSelectedRoomKey,
        onDecideInviteRequest: sources.inviteActions.decideInviteJoinRequest
      },
      settings: {
        selectApprovalPolicy: sources.roomRuntime.setApprovalPolicy,
        selectApprovalDelegationPolicy: sources.roomRuntime.setApprovalDelegationPolicy,
        selectSandboxLevel: sources.roomRuntime.setCodexSandboxLevel,
        selectModel: sources.roomRuntime.setCodexModel,
        selectReasoningEffort: sources.roomRuntime.setCodexReasoningEffort,
        selectSpeed: sources.roomRuntime.setCodexSpeed
      },
      history: {
        onHistoryEnabledChange: (enabled) =>
          sources.workspaceFlow.updateLocalHistorySettings({
            ...useAppStore.getState().historySettings,
            enabled
          }),
        onHistoryRetentionDaysChange: (retentionDays) =>
          sources.workspaceFlow.updateLocalHistorySettings({
            ...useAppStore.getState().historySettings,
            retentionDays
          }),
        onClearRoomHistory: sources.workspaceFlow.clearRoomHistory,
        onForgetRoomLocalData: sources.workspaceFlow.forgetSelectedRoomLocalData,
        onApplyTeamDefaultsToRoom: sources.workspaceFlow.applyTeamDefaultsToRoom,
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
      workspaceFiles: sources.roomPanels.workspaceFilesPanelActions,
      git: {
        onCopyPullRequestDraftMarkdown: sources.workspaceFlow.copyPullRequestDraftMarkdown,
        onApproveGitWorkflow: sources.roomRuntime.approveGitWorkflow
      },
      github: { refresh: sources.roomRuntime.refreshGitHubActions },
      terminal: sources.roomPanels.terminalPanelActions
    }),
    [sources]
  );
  const view = useAppStore(
    useShallow((state) => {
      const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
      const selectedTeamId = state.selectedTeam;
      const presenceState = state.historyPresenceByRoom[selectedRoom.id];
      return {
        currentUser: state.currentUser,
        authConfig: state.authConfig,
        selectedRoom,
        hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
        selectedTeamId,
        selectedTeam: state.teams.find((team) => team.id === selectedTeamId) ?? null,
        browser: state.browserByRoom[selectedRoom.id] ?? emptyBrowser,
        codexRuntime: state.codexRuntimeByRoom[selectedRoom.id] ?? emptyCodexRuntime,
        filePanel: state.filePanelByRoom[selectedRoom.id] ?? emptyFilePanel,
        gitRuntime: state.gitWorkflowRuntimeByRoom[selectedRoom.id] ?? emptyGitRuntime,
        invite: state.inviteByRoom[selectedRoom.id] ?? emptyInvite,
        roomSettings: state.roomSettingsByRoom[selectedRoom.id] ?? emptyRoomSettings,
        terminal: state.terminalRuntimeByRoom[selectedRoom.id] ?? emptyTerminal,
        terminals: state.terminals,
        teamRoster: state.teamRosterByTeam[selectedTeamId],
        presence: presenceState?.presence,
        inspectorTab: presenceState?.inspectorTab ?? "files",
        historyMessage: presenceState?.historyMessage ?? null,
        teamHistoryMessage: state.teamHistoryByTeam[selectedTeamId || "__no-team"]?.message ?? null,
        sensitiveAttachmentReviewKey: state.sensitiveAttachmentReviewKey,
        deviceIdentity: state.deviceIdentity,
        deviceIdentityMessage: state.deviceIdentityMessage,
        trustedDeviceKeys: state.trustedDeviceKeys,
        forgottenRoomIds: state.forgottenRoomIds,
        revokedRoomIds: state.revokedRoomIds,
        revokedTeamIds: state.revokedTeamIds,
        historySettings: state.historySettings,
        teamHistorySettings: state.teamHistorySettings,
        teamDefaultApprovalPolicy: state.teamDefaultApprovalPolicy,
        teamDefaultCodexModel: state.teamDefaultCodexModel,
        teamDefaultBrowserProfilePersistent: state.teamDefaultBrowserProfilePersistent,
        teamDefaultInviteApprovalGate: state.teamDefaultInviteApprovalGate,
        codexProbe: state.codexProbe,
        inviteSecretInput: state.inviteSecretInput
      };
    })
  );
  const {
    currentUser,
    authConfig,
    selectedRoom,
    hasSelectedRoom,
    selectedTeamId,
    selectedTeam,
    browser,
    codexRuntime,
    filePanel,
    gitRuntime,
    invite,
    roomSettings,
    terminal,
    terminals,
    teamRoster,
    presence,
    inspectorTab,
    historyMessage,
    teamHistoryMessage,
    sensitiveAttachmentReviewKey,
    deviceIdentity,
    deviceIdentityMessage,
    trustedDeviceKeys,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    teamHistorySettings,
    teamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    codexProbe,
    inviteSecretInput
  } = view;
  const {
    setBrowserUrlForRoom,
    selectBrowserTabForRoom,
    closeBrowserTabForRoom,
    setProjectPathDraftForRoom,
    setInviteApprovalGateForRoom,
    setInviteSecretInputValue,
    setCustomCodexModelForRoom,
    setTeamDefaultBrowserProfilePersistent,
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
    inviteApprovalGate: invite.approvalGate ?? true
  });
  const selectedCodexModel = selectedRoom.codexModel ?? defaultCodexModel;
  const selectedCodexReasoningEffort = selectedRoom.codexReasoningEffort ?? defaultCodexReasoningEffort;
  const selectedCodexSpeed = selectedRoom.codexSpeed ?? defaultCodexSpeed;
  const selectedCodexSandboxLevel = selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel;
  const customCodexModel = roomSettings.customCodexModel ?? selectedCodexModel;
  const projectPathDraft = roomSettings.projectPathDraft ?? selectedRoom.projectPath;
  const selectedTerminalId = terminal.selectedTerminalId ?? null;
  const roomTerminals = useMemo(
    () => terminals.filter((item) => item.roomId === selectedRoom.id),
    [selectedRoom.id, terminals]
  );
  const selectedTerminal = roomTerminals.find((item) => item.id === selectedTerminalId) ?? null;
  const terminalRequests = terminal.requests ?? [];
  const fileDisplay = useFileTerminalDisplay({
    selectedFile: filePanel.selectedFile ?? null,
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    sensitiveAttachmentReviewKey,
    selectedTerminal,
    terminalLines: terminal.lines ?? [],
    terminalRequests,
    codexEvents: codexRuntime.events ?? []
  });
  const gitWorkflowDraft = resolveGitWorkflowDraft(
    gitRuntime.workflow?.draft ? { [selectedRoom.id]: gitRuntime.workflow.draft } : {},
    selectedRoom.id
  );
  const github = useGitHubWorkflowState({
    actionRuns: gitRuntime.actions?.runs ?? [],
    authConfig,
    currentUser,
    gitWorkflowDraft,
    projectPath: selectedRoom.projectPath
  });
  const resolvedSettings = resolveCodexRunSettings(selectedRoom, codexProbe);
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
        localPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
        trustedDeviceKeys
      }),
    [deviceId, deviceIdentity?.publicKeyFingerprint, localUser, presence, selectedRoom, trustedDeviceKeys]
  );
  const gitStatus = gitRuntime.workflow?.status ?? null;
  const settingsBusy = Boolean(roomSettings.settingsBusy);
  const hostBusy = Boolean(roomSettings.hostBusy);
  const filePreviewTab = resolveFilePreviewTab(
    filePanel.previewTab ?? "file",
    Boolean(filePanel.selectedDiff?.diff.trim())
  );
  const commonWorkProps: Omit<WorkProps, "activeTab"> = {
    project: {
      projectPath: selectedRoom.projectPath,
      projectPathDraft,
      branchLabel: gitStatus?.branch ?? "loading",
      disabled: !hasSelectedRoom || access.isSelectedRoomLocked || settingsBusy || !access.isActiveHost,
      attachDisabled:
        !hasSelectedRoom ||
        access.isSelectedRoomLocked ||
        settingsBusy ||
        !access.isActiveHost ||
        !projectPathDraft.trim() ||
        projectPathDraft.trim() === selectedRoom.projectPath,
      onProjectPathDraftChange: (path) => setProjectPathDraftForRoom(selectedRoom.id, path, selectedRoom.projectPath),
      onChooseProjectPath: capabilities.project.choosePath,
      onUseDefaultProjectPath: () =>
        setProjectPathDraftForRoom(selectedRoom.id, defaultProjectPath, selectedRoom.projectPath),
      onUpdateProjectPath: capabilities.project.updatePath
    },
    teamRoster: {
      members: teamMemberRows,
      hasSelectedTeam: Boolean(selectedTeamId),
      busy: Boolean(teamRoster?.busy),
      message: teamRoster?.message ?? null,
      ...capabilities.teamRoster
    },
    roomMembers: {
      members: roomMemberRows,
      localDeviceId: deviceId,
      message: deviceIdentityMessage,
      ...capabilities.roomMembers
    },
    hostHandoff: {
      handoffs: codexRuntime.hostHandoffs ?? [],
      acceptDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || hostBusy,
      onAcceptHandoff: capabilities.hostHandoff.accept,
      formatModel: formatCodexModel
    },
    encryptedInvite: {
      inviteApprovalGate: invite.approvalGate ?? true,
      copyDisabled: !access.canCopyRoomInvite,
      inviteSecretInput,
      inviteRequests: invite.requests ?? [],
      localDeviceId: deviceId,
      gateDisabled: !hasSelectedRoom || access.isSelectedRoomLocked,
      importDisabled: !inviteSecretInput.trim(),
      rotateDisabled:
        !hasSelectedRoom || access.isSelectedRoomLocked || !access.isActiveHost || Boolean(invite.keyRotationBusy),
      approvalDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || !access.isActiveHost,
      keyRotationBusy: Boolean(invite.keyRotationBusy),
      inviteLink: invite.link ?? "",
      inviteMessage: invite.message ?? null,
      ...capabilities.invite,
      onInviteApprovalGateChange: (enabled) => setInviteApprovalGateForRoom(selectedRoom.id, enabled),
      onInviteSecretInputChange: setInviteSecretInputValue
    },
    approvalPolicy: {
      labels: approvalPolicyLabels,
      delegationLabels: approvalDelegationPolicyLabels,
      sandboxOptions: codexSandboxLevelOptions,
      message: roomSettings.settingsMessage ?? null,
      selectedPolicy: selectedRoom.approvalPolicy,
      selectedDelegationPolicy: selectedRoom.approvalDelegationPolicy,
      selectedSandboxLevel: selectedCodexSandboxLevel,
      disabled: !hasSelectedRoom || access.isSelectedRoomLocked || settingsBusy || !access.isActiveHost,
      onSelectPolicy: capabilities.settings.selectApprovalPolicy,
      onSelectDelegationPolicy: capabilities.settings.selectApprovalDelegationPolicy,
      onSelectSandboxLevel: capabilities.settings.selectSandboxLevel
    },
    model: {
      customModel: customCodexModel,
      modelOptions: catalogModelOptions(codexProbe),
      reasoningOptions: catalogReasoningOptionsForModel(codexProbe, resolvedSettings.model),
      speedOptions: catalogSpeedOptionsForModel(codexProbe, resolvedSettings.model),
      selectedModel: selectedCodexModel,
      selectedModelLabel: formatCodexModel(selectedCodexModel),
      selectedReasoningEffort: selectedCodexReasoningEffort,
      selectedSpeed: selectedCodexSpeed,
      disabled: !hasSelectedRoom || access.isSelectedRoomLocked || settingsBusy || !access.isActiveHost,
      canApplyCustomModel: Boolean(customCodexModel.trim()) && customCodexModel.trim() !== selectedCodexModel,
      onSelectModel: capabilities.settings.selectModel,
      onSelectReasoningEffort: capabilities.settings.selectReasoningEffort,
      onSelectSpeed: capabilities.settings.selectSpeed,
      onCustomModelChange: (model) => setCustomCodexModelForRoom(selectedRoom.id, model, selectedCodexModel),
      onApplyCustomModel: () => capabilities.settings.selectModel(customCodexModel)
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
      teamDefaultBrowserProfilePersistent,
      teamDefaultInviteApprovalGate,
      message: historyMessage ?? teamHistoryMessage,
      ...capabilities.history,
      onTeamDefaultBrowserProfilePersistentChange: setTeamDefaultBrowserProfilePersistent
    },
    workspaceFiles: {
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
      selectedAttachmentWarningDetail: fileDisplay.selectedAttachmentReview?.warningDetail ?? undefined,
      filePreviewTab,
      formatBytes,
      ...capabilities.workspaceFiles,
      onFileQueryChange: (query) => setFileQueryForRoom(selectedRoom.id, query),
      onFilePreviewTabChange: (tab) => setFilePreviewTabForRoom(selectedRoom.id, tab)
    },
    gitHandoff: {
      draft: gitWorkflowDraft,
      preview: github.gitApprovalPreview,
      readiness: github.githubWorkflowReadiness,
      canReadLocalWorkspace: access.canReadLocalWorkspace,
      gitWorkflowBusy: Boolean(gitRuntime.workflow?.busy),
      isActiveHost: access.isActiveHost,
      message: gitRuntime.workflow?.message ?? null,
      onDraftChange: (patch) => editGitWorkflowDraftForRoom(selectedRoom.id, patch),
      ...capabilities.git
    },
    githubActions: {
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
      onRefresh: capabilities.github.refresh
    },
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
      ...capabilities.terminal,
      onSelectTerminal: (terminalId) => setSelectedTerminalIdForRoom(selectedRoom.id, terminalId)
    }
  };

  return (
    <RoomInspectorPanel
      activeTab={inspectorTab}
      browserPanel={
        <BrowserAccessPanel
          hidden={false}
          activeBrowserUrl={
            browser.tabs?.find((tab) => tab.id === browser.activeTabId)?.url ?? browser.activeUrl ?? null
          }
          browserTabs={browser.tabs ?? []}
          activeBrowserTabId={browser.activeTabId ?? null}
          browserUrl={browser.url ?? defaultBrowserUrl}
          canHostBrowser={access.canHostBrowser}
          onBrowserUrlChange={(url) => setBrowserUrlForRoom(selectedRoom.id, url, defaultBrowserUrl)}
          onOpenBrowserNow={capabilities.browser.openNow}
          onSelectBrowserTab={(tabId) => selectBrowserTabForRoom(selectedRoom.id, tabId)}
          onCloseBrowserTab={(tabId) => closeBrowserTabForRoom(selectedRoom.id, tabId)}
        />
      }
      filesPanel={<RoomInspectorWorkPanel activeTab="files" {...commonWorkProps} />}
      terminalPanel={<RoomInspectorWorkPanel activeTab="terminal" {...commonWorkProps} />}
      roomPanel={<RoomInspectorWorkPanel activeTab="room" {...commonWorkProps} />}
    />
  );
}
