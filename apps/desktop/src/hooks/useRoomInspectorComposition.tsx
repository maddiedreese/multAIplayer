import React, { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { codexModelOptions, codexSandboxLevelOptions, defaultCodexModel } from "@multaiplayer/protocol";
import { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import { RoomInspectorPanel } from "../components/RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";
import { canStageRoomChatAttachment } from "../lib/chat/chatPolicy";
import { formatBytes, formatCodexModel, formatTimestamp } from "../lib/formatting/appFormatters";
import { resolveFilePreviewTab } from "../lib/files/filePreview";
import { resolveGitWorkflowDraft } from "../lib/git/gitWorkflowDraft";
import { selectRoomInspectorView } from "../application/views/containerViewSelectors";
import { buildRoomInspectorCapabilities } from "./containerCapabilities";
import {
  buildProjectControlState,
  buildRoomBrowserProps,
  buildRoomInspectorWorkProps
} from "../presentation/containers/containerPropBuilders";
import { defaultProjectPath } from "../lib/platform/localBackend";
import { buildRoomMemberRows, buildTeamMemberRows } from "../presentation/roster/rosterDisplayRows";
import { canControlRoomTerminal } from "../lib/terminal/terminalAccess";
import { buildRoomInspectorModelProjection } from "../presentation/rooms/roomInspectorModelProjection";
import { useFileTerminalDisplay } from "./useFileTerminalDisplay";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useLocalIdentity } from "./useLocalIdentity";
import { useRoomAccess } from "./useRoomAccess";
import { approvalDelegationPolicyLabels, approvalPolicyLabels, defaultBrowserUrl } from "../appDefaults";
import { useAppStore } from "../store/appStore";
import type { RoomInspectorSources } from "./roomInspectorCompositionTypes";
export type { RoomInspectorCapabilities, RoomInspectorSources } from "./roomInspectorCompositionTypes";

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
  const model = buildRoomInspectorModelProjection(selectedRoom, codexProbe, roomSettings.customCodexModel);
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
      selectedAttachmentWarningDetail: fileDisplay.selectedAttachmentReview?.warningDetail ?? undefined,
      filePreviewTab,
      formatBytes,
      ...capabilities.workspaceFiles,
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
      onRefresh: capabilities.github.refresh
    };
  }
  function composeCommonWorkProps() {
    return buildRoomInspectorWorkProps({
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
      teamRoster: composeTeamRosterProps(),
      roomMembers: {
        members: roomMemberRows,
        localDeviceId: deviceId,
        message: deviceIdentityMessage,
        ...capabilities.roomMembers
      },
      hostHandoff: composeHostHandoffProps(),
      encryptedInvite: composeEncryptedInviteProps(),
      approvalPolicy: {
        labels: approvalPolicyLabels,
        delegationLabels: approvalDelegationPolicyLabels,
        sandboxOptions: codexSandboxLevelOptions,
        message: roomSettings.settingsMessage ?? null,
        selectedPolicy: selectedRoom.approvalPolicy,
        selectedDelegationPolicy: selectedRoom.approvalDelegationPolicy,
        selectedSandboxLevel: model.selectedSandboxLevel,
        disabled: settingsDisabled,
        onSelectPolicy: capabilities.settings.selectApprovalPolicy,
        onSelectDelegationPolicy: capabilities.settings.selectApprovalDelegationPolicy,
        onSelectSandboxLevel: capabilities.settings.selectSandboxLevel
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
        onSelectModel: capabilities.settings.selectModel,
        onSelectReasoningEffort: capabilities.settings.selectReasoningEffort,
        onRawReasoningEnabledChange: capabilities.settings.setRawReasoningEnabled,
        onSelectSpeed: capabilities.settings.selectSpeed,
        onCustomModelChange: (value) => setCustomCodexModelForRoom(selectedRoom.id, value, model.selectedModel),
        onApplyCustomModel: () => capabilities.settings.selectModel(model.customModel)
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
        ...capabilities.git
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
        ...capabilities.terminal,
        onSelectTerminal: (terminalId) => setSelectedTerminalIdForRoom(selectedRoom.id, terminalId)
      }
    });
  }

  function composeTeamRosterProps() {
    return {
      members: teamMemberRows,
      hasSelectedTeam: Boolean(selectedTeamId),
      busy: Boolean(teamRoster?.busy),
      message: teamRoster?.message ?? null,
      ...capabilities.teamRoster
    };
  }

  function composeHostHandoffProps() {
    return {
      handoffs: codexRuntime.hostHandoffs ?? [],
      acceptDisabled: !hasSelectedRoom || access.isSelectedRoomLocked || hostBusy,
      patchApplyDisabled: !access.isActiveHost,
      onAcceptHandoff: capabilities.hostHandoff.accept,
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
      ...capabilities.invite,
      onInviteSecretInputChange: setInviteSecretInputValue
    };
  }
  const commonWorkProps = composeCommonWorkProps();
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

function inspectorSettingsDisabled(
  hasSelectedRoom: boolean,
  roomLocked: boolean,
  settingsBusy: boolean,
  isActiveHost: boolean
) {
  return !hasSelectedRoom || roomLocked || settingsBusy || !isActiveHost;
}
