import type {
  LocalPreviewPlaintextPayload
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
} from "@multaiplayer/protocol";
import { decryptJson } from "@multaiplayer/crypto";
import { loadHistorySettings } from "./lib/localHistory";
import {
  defaultProjectPath,
  type GitWorkflowResult,
} from "./lib/localBackend";
import type { GitHubActionRun } from "./lib/authClient";
import {
  normalizeRoomName
} from "./lib/workspaceCreation";
import { attachmentReviewScopeKey } from "./lib/attachmentPolicy";
import { roomChatGateMessage } from "./lib/chatPolicy";
import type { GitHubActionsTarget } from "./lib/githubWorkflowReadiness";
import type { GitWorkflowDraft } from "./lib/gitWorkflowDraft";
import {
  embeddedAttachmentBytes,
  encodedBytes,
  attachmentTypeFromName,
  formatTimestamp
} from "./lib/appFormatters";
import { useAppStateSlices } from "./hooks/useAppStateSlices";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { useLocalIdentity } from "./hooks/useLocalIdentity";
import { useRoomChatMutations } from "./hooks/useRoomChatMutations";
import { useAppRoomInteractionContext } from "./hooks/useAppRoomInteractionContext";
import { useAppRoomActions } from "./hooks/useAppRoomActions";
import { useAppSelectedRoomRuntime } from "./hooks/useAppSelectedRoomRuntime";
import { useAppRoomDisplayContext } from "./hooks/useAppRoomDisplayContext";
import { useThemeMode } from "./hooks/useThemeMode";
import { useAppWorkspaceRecords } from "./hooks/useAppWorkspaceRecords";
import { useAppHostHandoffActions } from "./hooks/useAppHostHandoffActions";
import { useAppInviteActions } from "./hooks/useAppInviteActions";
import { useRoomSettingsActor } from "./hooks/useRoomSettingsActor";
import { useAppRefs } from "./hooks/useAppRefs";
import { useAppSelectedRoomContext } from "./hooks/useAppSelectedRoomContext";
import { useAppViewModel } from "./hooks/useAppViewModel";
import { useAppWorkspaceFlow } from "./hooks/useAppWorkspaceFlow";
import { useAppRelaySync } from "./hooks/useAppRelaySync";
import { useAppRoomRuntime } from "./hooks/useAppRoomRuntime";
import { useAppRoomPanelActions } from "./hooks/useAppRoomPanelActions";
import { InlineSecretWarning } from "./components/common";
import { AppShellView } from "./components/AppShellView";
import type { InspectorTab } from "./components/RoomInspectorPanel";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatReaction,
  LocalPreviewRecord,
  NoSecretRoomInvite,
  SidebarPanel,
  TerminalCommandRequest
} from "./types";
import {
  approvalPolicyLabels,
  defaultBrowserReason,
  defaultBrowserStatus,
  defaultBrowserUrl,
  emptyRoom,
  initialMessagesByRoom,
  initialTerminalLinesByRoom,
  maxTerminalActivityLines,
  roomModeLabels,
  seededRooms,
  seededTeamMembers,
  seededTeams
} from "./seedData";

export function App() {
  const theme = useThemeMode();
  const appState = useAppStateSlices({
    workspace: {
      initialTeams: seededTeams,
      initialRooms: seededRooms,
      initialTeamMembersByTeam: seededTeamMembers,
      initialProjectPath: defaultProjectPath,
      initialRoomId: "room-desktop",
      initialMessagesByRoom
    },
    historyDefaults: { initialTeamId: seededTeams[0].id },
    terminals: { initialTerminalLinesByRoom }
  });
  const {
    workspaceState,
    appConfigState,
    roomChatState,
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState,
    invitePanelState,
    shellLayout
  } = appState;
  const appRefs = useAppRefs({
    rooms: workspaceState.rooms,
    selectedRoomId: workspaceState.selectedRoomId,
    gitWorkflowDraftsByRoom: githubWorkflowPanelState.gitWorkflowDraftsByRoom,
    hostBusyByRoom: roomSettingsState.hostBusyByRoom,
    settingsBusyByRoom: roomSettingsState.settingsBusyByRoom,
    keyRotationBusyByRoom: invitePanelState.keyRotationBusyByRoom,
    gitWorkflowBusyByRoom: githubWorkflowPanelState.gitWorkflowBusyByRoom,
    actionsBusyByRoom: githubWorkflowPanelState.actionsBusyByRoom,
    localPreviewBusyByRoom: localPreviewState.localPreviewBusyByRoom,
    fileBusyByRoom: filePanelState.fileBusyByRoom,
    terminalBusyByRoom: terminalPanelState.terminalBusyByRoom,
    browserRequestsByRoom: browserPanelState.browserRequestsByRoom
  });
  const githubAuth = useGitHubAuth(appConfigState.appConfig.relayHttpUrl);
  const localIdentity = useLocalIdentity(githubAuth.currentUser);
  const roomSettingsActor = useRoomSettingsActor(localIdentity.localUser);

  const selectedContext = useAppSelectedRoomContext({
    appState,
    githubAuth,
    localIdentity,
    fallbackRoom: emptyRoom,
    defaultBrowserUrl,
    defaultBrowserReason
  });
  const {
    selectedCodexModel,
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals,
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection,
    selectedTeamName,
    selectedTeamMembersMessage,
    selectedTeamMembersBusy,
    selectedTeamMemberRows,
    customCodexModel,
    projectPathDraft,
    messages,
    draft,
    selectedMessages,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    browserUrl,
    browserReason,
    activeBrowserUrl,
    gitStatus,
    gitWorkflowDraft,
    gitWorkflowBusy,
    gitWorkflowMessage,
    actionRuns,
    actionsBusy,
    actionsLastChecked,
    actionsMessage,
    terminalLines,
    terminalBusy,
    selectedTerminalId,
    terminalName,
    terminalCommand,
    terminalInput,
    terminalError,
    fileQuery,
    projectFiles,
    selectedFile,
    selectedDiff,
    filePreviewTab,
    fileBusy,
    fileMessage,
    inviteLink,
    inviteApprovalGate,
    inviteMessage,
    hostMessage,
    chatMessage,
    settingsMessage,
    visibleHistoryMessage,
    markdownCopyFallback
  } = selectedContext;
  const roomActions = useAppRoomActions({
    appState,
    appRefs,
    selectedRoom,
    maxTerminalActivityLines,
    defaultBrowserUrl,
    defaultBrowserReason,
    defaultCodexModel,
    defaultProjectPath
  });
  const {
    setHostMessageForRoom,
    setSelectedHostMessage,
    setChatMessageForRoom,
    setSelectedChatMessage,
    setMarkdownCopyFallbackForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage,
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage,
    setSettingsMessageForRoom,
    setSelectedSettingsMessage,
    setGitWorkflowBusyForRoom,
    setActionsBusyForRoom,
    setLocalPreviewBusyForRoom,
    setHostBusyForRoom,
    setSettingsBusyForRoom,
    setKeyRotationBusyForRoom,
    setFileBusyForRoom,
    setTerminalBusyForRoom,
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    setSelectedFileMessage,
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setTerminalInputForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError,
    appendTerminalLinesForRoom,
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom,
    setBrowserUrlForRoom,
    setBrowserReasonForRoom,
    setBrowserMessageForRoom,
    setSelectedBrowserMessage,
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage,
    setPendingAttachmentsForRoom,
    setDraftForRoom,
    setCustomCodexModelForRoom,
    setProjectPathDraftForRoom,
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom,
    updateSelectedGitWorkflowDraft,
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    appendInviteRequest,
    appendCodexEvent,
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  } = roomActions;
  const roomChatMutations = useRoomChatMutations({
    setMessagesByRoom: workspaceState.setMessagesByRoom
  });
  const workspaceRecords = useAppWorkspaceRecords({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    roomActions
  });
  const roomInteraction = useAppRoomInteractionContext({
    appState,
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    roomChatMutations,
    roomActions
  });
  const selectedRuntime = useAppSelectedRoomRuntime({
    appState,
    localIdentity,
    selected: selectedContext,
    roomInteraction
  });
  const hostHandoffActions = useAppHostHandoffActions({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    roomSettingsActor
  });
  const inviteActions = useAppInviteActions({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    roomChatMutations,
    workspaceRecords
  });

  const roomDisplay = useAppRoomDisplayContext({
    appState,
    selected: selectedContext,
    selectedRuntime,
    approvalPolicyLabels
  });
  const workspaceFlow = useAppWorkspaceFlow({
    appState,
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    workspaceRecords,
    inviteActions,
    roomDisplay,
    roomSettingsActor
  });

  const relaySync = useAppRelaySync({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    roomInteraction,
    roomActions,
    workspaceRecords,
    roomDisplay,
    inviteActions,
    hostHandoffActions,
    roomChatMutations
  });
  const roomRuntime = useAppRoomRuntime({
    appState,
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    relaySync,
    hostHandoffActions,
    roomSettingsActor
  });

  const roomPanels = useAppRoomPanelActions({
    appState,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    roomRuntime,
    workspaceFlow
  });
  const appView = useAppViewModel({
    appState,
    githubAuth,
    localIdentity,
    theme,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomActions,
    roomDisplay,
    roomPanels,
    roomRuntime,
    workspaceFlow,
    hostHandoffActions,
    inviteActions
  });

  return <AppShellView {...appView.appShellViewProps} />;
}
