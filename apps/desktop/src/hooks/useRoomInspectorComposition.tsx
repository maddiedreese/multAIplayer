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
import { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import { RoomInspectorPanel } from "../components/RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";
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
import { selectRoomInspectorView } from "../lib/containerViewSelectors";
import { buildRoomInspectorCapabilities } from "../lib/containerCapabilities";
import {
  buildProjectControlState,
  buildRoomBrowserProps,
  buildRoomInspectorWorkProps
} from "../lib/containerPropBuilders";
import { defaultProjectPath } from "../lib/localBackend";
import { buildRoomMemberRows, buildTeamMemberRows } from "../lib/rosterDisplayRows";
import { canControlRoomTerminal } from "../lib/terminalAccess";
import { useFileTerminalDisplay } from "../hooks/useFileTerminalDisplay";
import { useGitHubWorkflowState } from "../hooks/useGitHubWorkflowState";
import { useLocalIdentity } from "../hooks/useLocalIdentity";
import { useRoomAccess } from "../hooks/useRoomAccess";
import { approvalDelegationPolicyLabels, approvalPolicyLabels, defaultBrowserUrl } from "../seedData";
import { useAppStore } from "../store/appStore";
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

export function useRoomInspectorComposition({ sources }: { sources: RoomInspectorSources }) {
  const capabilities = useMemo(() => buildRoomInspectorCapabilities(sources), [sources]);
  const view = useAppStore(useShallow(selectRoomInspectorView));
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
  const projectControlState = buildProjectControlState({
    hasSelectedRoom,
    roomLocked: access.isSelectedRoomLocked,
    settingsBusy,
    activeHost: access.isActiveHost,
    projectPathDraft,
    projectPath: selectedRoom.projectPath
  });
  const commonWorkProps = buildRoomInspectorWorkProps({
    project: {
      projectPath: selectedRoom.projectPath,
      projectPathDraft,
      branchLabel: gitStatus?.branch ?? "loading",
      ...projectControlState,
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
      copyDisabled: !access.canCopyRoomInvite,
      inviteSecretInput,
      inviteRequests: invite.requests ?? [],
      localDeviceId: deviceId,
      importDisabled: !inviteSecretInput.trim(),
      rotateDisabled:
        !hasSelectedRoom || access.isSelectedRoomLocked || !access.isActiveHost || Boolean(invite.keyRotationBusy),
      approvalDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || !access.isActiveHost,
      keyRotationBusy: Boolean(invite.keyRotationBusy),
      inviteLink: invite.link ?? "",
      inviteMessage: invite.message ?? null,
      ...capabilities.invite,
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
  });
  const browserProps = buildRoomBrowserProps({
    roomId: selectedRoom.id,
    browser,
    defaultUrl: defaultBrowserUrl,
    canHostBrowser: access.canHostBrowser,
    setUrl: setBrowserUrlForRoom,
    openNow: capabilities.browser.openNow,
    selectTab: selectBrowserTabForRoom,
    closeTab: closeBrowserTabForRoom
  });

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
