import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useAppRelaySync } from "./useAppRelaySync";
import type { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";
import { useRoomPanelActions } from "./useRoomPanelActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type RoomRuntime = ReturnType<typeof useRoomRuntimeContext>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type WorkspaceFlow = ReturnType<typeof useWorkspaceFlowContext>;

export function useAppRoomPanelActions({
  appState,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  roomRuntime,
  relaySync,
  workspaceFlow
}: {
  appState: AppStateSlices;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  roomRuntime: RoomRuntime;
  relaySync: RelaySync;
  workspaceFlow: WorkspaceFlow;
}) {
  const {
    workspaceState,
    roomRuntimeState,
    roomChatState
  } = appState;
  const {
    selectedRoom,
    messages,
    activeBrowserUrl
  } = selected;
  const {
    setPendingCodexApprovalForRoom,
    removeQueuedCodexApprovalForRoom,
    setApprovalVisibleForRoom,
    setChatMessageForRoom,
    setDraftForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalInputForRoom,
    setFileQueryForRoom,
    setInspectorTabForRoom,
    setFilePreviewTabForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom
  } = roomActions;

  return useRoomPanelActions({
    chat: {
      selectedRoomId: selectedRoom.id,
      messages,
      localPreviews: selectedRuntime.localPreviews,
      copyMessageMarkdown: workspaceFlow.copyMessageMarkdown,
      copyCodexOutputMarkdown: workspaceFlow.copyCodexOutputMarkdown,
      openEncryptedAttachmentBlob: workspaceFlow.openEncryptedAttachmentBlob,
      toggleMessageReaction: roomInteraction.toggleMessageReaction,
      publishChatMessageEdit: roomInteraction.publishChatMessageEdit,
      publishChatMessageDelete: roomInteraction.publishChatMessageDelete,
      publishChatMessage: roomInteraction.publishChatMessage,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      removeQueuedCodexApprovalForRoom,
      promoteNextCodexApprovalForRoom: roomRuntime.promoteNextCodexApprovalForRoom,
      approveCodexTurn: roomRuntime.approveCodexTurn,
      handleCodexInvoke: roomRuntime.handleCodexInvoke,
      activeCodexApproval: selectedRuntime.activeCodexApproval,
      publishCodexQueueEvent: relaySync.publishCodexQueueEvent,
      selectedRoom,
      pauseGoal: roomRuntime.pauseGoal,
      resumeGoal: roomRuntime.resumeGoal,
      editGoal: roomRuntime.editGoal,
      deleteGoal: roomRuntime.deleteGoal,
      tickGoalElapsed: roomRuntime.tickGoalElapsed,
      copyMarkdownWithFallback: workspaceFlow.copyMarkdownWithFallback,
      setChatMessageForRoom,
      stopLocalPreview: roomRuntime.stopLocalPreview,
      setInspectorTabForRoom,
      setReplyToMessageForRoom: roomActions.setReplyToMessageForRoom,
      setDraftForRoom
    },
    header: {
      selectedRoomId: workspaceState.selectedRoomId,
      selectedRoomIdForTabs: selectedRoom.id,
      activeBrowserUrl,
      selectTeamRoom: workspaceState.selectTeamRoom,
      openRoomBrowserNow: roomRuntime.openRoomBrowserNow
    },
    terminal: {
      selectedRoomId: selectedRoom.id,
      terminalRequests: selectedRuntime.terminalRequests,
      copyTerminalMarkdown: workspaceFlow.copyTerminalMarkdown,
      runApprovedTerminalCheck: roomRuntime.runApprovedTerminalCheck,
      openInteractiveTerminal: roomRuntime.openInteractiveTerminal,
      setTerminalNameForRoom,
      setTerminalCommandForRoom,
      startNamedTerminal: roomRuntime.startNamedTerminal,
      requestTerminalCommand: roomRuntime.requestTerminalCommand,
      approveTerminalRequest: roomRuntime.approveTerminalRequest,
      denyTerminalRequest: roomRuntime.denyTerminalRequest,
      setSelectedTerminalIdForRoom,
      setTerminalInputForRoom,
      sendTerminalInput: roomRuntime.sendTerminalInput,
      restartSelectedTerminal: roomRuntime.restartSelectedTerminal,
      stopSelectedTerminal: roomRuntime.stopSelectedTerminal
    },
    workspaceFiles: {
      selectedRoomId: selectedRoom.id,
      copyProjectMarkdown: workspaceFlow.copyProjectMarkdown,
      setFileQueryForRoom,
      openProjectFile: workspaceFlow.openProjectFile,
      copyDiffSummaryMarkdown: workspaceFlow.copyDiffSummaryMarkdown,
      attachSelectedFileToMessage: workspaceFlow.attachSelectedFileToMessage,
      saveSelectedFileContent: workspaceFlow.saveSelectedFileContent,
      approveFileSaveRequest: workspaceFlow.approveFileSaveRequest,
      denyFileSaveRequest: workspaceFlow.denyFileSaveRequest,
      setFilePreviewTabForRoom,
      setSelectedFileForRoom,
      setSelectedDiffForRoom,
      setSensitiveAttachmentReviewKey: roomChatState.setSensitiveAttachmentReviewKey
    }
  });
}
